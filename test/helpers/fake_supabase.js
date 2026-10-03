/*
  test/helpers/fake_supabase.js — Supabase FALSO para pruebas, pero con las
  mismas reglas que supabase_schema.sql:

    * RLS: lectura pública de tablas de configuración; cotizaciones y leads
      solo se pueden INSERTAR (anon); audit_log/app_meta solo admin; la
      escritura de configuración exige estar en la lista de admins.
    * upsert sobre filas existentes sin permiso -> error 42501 (igual que
      Postgres); update/delete sin permiso -> 0 filas, SIN error (igual que RLS).
    * claves foráneas de valoraciones (23503) y cascada al borrar.
    * índice único modelo+capacidad (23505), rangos numéricos, estado de
      catálogo, límites de las tablas públicas, freno de 120 inserts/min.
    * tope de 1000 filas por consulta (PostgREST).
    * Auth: signUp / signInWithPassword / signOut / getSession / getUser /
      updateUser / resetPasswordForEmail / onAuthStateChange / rpc("is_admin").
    * Realtime: postgres_changes entregado solo a quien RLS le permite leer.
    * Fallas: backend.offline = true, backend.failNext(tabla, operación, error).

  Funciona en Node (require) y en el navegador (window.FakeSupabase).
*/
(function (root) {
  const PUBLIC_READ = ["modelos", "capacidades", "valoraciones", "bateria", "desperfectos", "catalog", "contact"];
  const PUBLIC_INSERT = ["quotes_history", "leads"];
  const ADMIN_ONLY = ["audit_log", "app_meta"];

  function netError() {
    return { message: "TypeError: Failed to fetch", status: 0, code: "" };
  }
  function rlsError(table) {
    return { message: 'new row violates row-level security policy for table "' + table + '"', code: "42501", status: 403 };
  }

  function createBackend(options) {
    const opts = options || {};
    const backend = {
      tables: {},
      users: new Map(), // id -> { id, email, password }
      admins: new Set(), // ids
      channels: [],
      offline: false,
      maxRows: opts.maxRows || 1000,
      log: [], // { table, op, who }
      _fail: [],
      _emails: [],
      _seq: 0,
      insertTimes: {},
    };

    const tbl = (name) => (backend.tables[name] = backend.tables[name] || new Map());
    const getRows = (name) => [...tbl(name).values()];

    backend.seed = function (name, rows) { rows.forEach((r) => tbl(name).set(r.id, JSON.parse(JSON.stringify(r)))); };
    backend.rows = function (name) { return getRows(name).map((r) => JSON.parse(JSON.stringify(r))); };
    backend.addUser = function (email, password, isAdmin) {
      const id = "user-" + ++backend._seq;
      backend.users.set(id, { id, email, password });
      if (isAdmin) backend.admins.add(id);
      return id;
    };
    backend.failNext = function (table, op, error) { backend._fail.push({ table, op, error: error || netError() }); };
    backend.setAppMeta = function (state, lastModified) {
      tbl("app_meta").set("singleton", { id: "singleton", last_modified: lastModified || null, config_state: state });
    };

    function takeFailure(table, op) {
      const i = backend._fail.findIndex((f) => (f.table === table || f.table === "*") && (f.op === op || f.op === "*"));
      if (i === -1) return null;
      return backend._fail.splice(i, 1)[0].error;
    }

    /* ---- reglas de acceso (RLS) ---- */
    function canSelect(table, who) {
      if (PUBLIC_READ.includes(table)) return true;
      return who.isAdmin;
    }
    function canInsert(table, who) {
      if (PUBLIC_READ.includes(table)) return who.isAdmin;
      if (PUBLIC_INSERT.includes(table)) return true;
      return who.isAdmin;
    }
    function canModify(table, who) { return who.isAdmin; }

    /* ---- restricciones ---- */
    function checkConstraints(table, row, all) {
      const num = (v) => typeof v === "number" && isFinite(v);
      const inRange = (v, a, b) => num(Number(v)) && Number(v) >= a && Number(v) <= b;
      const fail = (msg) => ({ message: msg, code: "23514", status: 400 });
      if (table === "valoraciones") {
        if (!inRange(row.valor_usd, 0, 1000000)) return fail("ck_valoraciones_valor");
        if (!tbl("modelos").has(row.modelo_id)) return { message: "fk_valoraciones_modelo", code: "23503", status: 409 };
        if (!tbl("capacidades").has(row.capacidad_id)) return { message: "fk_valoraciones_capacidad", code: "23503", status: 409 };
        const dup = getRows("valoraciones").find((v) => v.id !== row.id && v.modelo_id === row.modelo_id && v.capacidad_id === row.capacidad_id);
        if (dup) return { message: "uq_valoraciones_modelo_capacidad", code: "23505", status: 409 };
      }
      if (table === "bateria") {
        if (!(inRange(row.porcentaje_minimo, 0, 100) && inRange(row.porcentaje_maximo, 0, 100) && row.porcentaje_minimo <= row.porcentaje_maximo)) return fail("ck_bateria_rango");
        if (!inRange(row.descuento_usd, 0, 1000000)) return fail("ck_bateria_descuento");
      }
      if (table === "desperfectos" && !inRange(row.descuento_usd, 0, 1000000)) return fail("ck_desperfectos_descuento");
      if (table === "catalog") {
        if (!inRange(row.precio_base_usd, 0, 1000000)) return fail("ck_catalog_precio");
        if (![0, 1].includes(row.stock)) return fail("ck_catalog_stock");
        if (!["published", "out", "draft"].includes(row.estado)) return fail("ck_catalog_estado");
      }
      if (table === "app_meta" && !["pristine", "configured"].includes(row.config_state || "pristine")) return fail("ck_app_meta_state");
      if (table === "quotes_history") {
        const L = (v, n) => String(v || "").length <= n;
        if (!(String(row.id || "").length >= 1 && L(row.id, 80) && L(row.modelo_id, 80) && L(row.modelo_nombre, 120) && L(row.capacidad_nombre, 60) && L(row.color, 40) && L(row.bateria_label, 80))) return fail("ck_quotes_limites");
        if (!Array.isArray(row.desperfectos || [])) return fail("ck_quotes_limites");
        if (![row.valor_base_usd, row.descuento_bateria_usd, row.descuento_desperfectos_usd, row.valor_final_usd].every((v) => inRange(v, 0, 1000000))) return fail("ck_quotes_limites");
        if (!(row.fecha >= 1500000000000 && row.fecha <= 4000000000000)) return fail("ck_quotes_limites");
      }
      if (table === "leads") {
        const L = (v, n) => String(v || "").length <= n;
        if (!(L(row.nombre, 80) && /^[0-9]{0,20}$/.test(row.whatsapp || "") && L(row.modelo_nombre, 120) && L(row.producto_compra_nombre, 120))) return fail("ck_leads_limites");
        if (!inRange(row.resultado_usd, 0, 1000000)) return fail("ck_leads_limites");
        if (!(row.fecha >= 1500000000000 && row.fecha <= 4000000000000)) return fail("ck_leads_limites");
      }
      return null;
    }

    function rateLimited(table) {
      if (!PUBLIC_INSERT.includes(table)) return false;
      const now = Date.now();
      const list = (backend.insertTimes[table] = (backend.insertTimes[table] || []).filter((t) => now - t < 60000));
      if (list.length >= 120) return true;
      list.push(now);
      return false;
    }

    /* ---- Realtime ---- */
    function emit(table, type) {
      backend.channels.forEach((ch) => {
        if (!ch.subscribed) return;
        const allowed = PUBLIC_READ.includes(table) || ch.client._who().isAdmin;
        if (!allowed) return;
        ch.handlers.filter((h) => h.table === table).forEach((h) => {
          setTimeout(() => h.cb({ eventType: type, table }), 0);
        });
      });
    }

    function cascadeDeleteModelo(id) { getRows("valoraciones").filter((v) => v.modelo_id === id).forEach((v) => tbl("valoraciones").delete(v.id)); }
    function cascadeDeleteCapacidad(id) { getRows("valoraciones").filter((v) => v.capacidad_id === id).forEach((v) => tbl("valoraciones").delete(v.id)); }

    /* ---- constructor de consultas ---- */
    function Query(client, table) {
      this.client = client; this.table = table; this.op = "select"; this.filters = []; this.returning = false;
      this._order = null; this._limit = null; this._range = null; this.payload = null; this.opts = {};
    }
    Query.prototype.select = function () { this.returning = true; return this; };
    Query.prototype.insert = function (rows) { this.op = "insert"; this.payload = [].concat(rows); return this; };
    Query.prototype.upsert = function (rows, o) { this.op = "upsert"; this.payload = [].concat(rows); this.opts = o || {}; return this; };
    Query.prototype.update = function (patch) { this.op = "update"; this.payload = patch; return this; };
    Query.prototype.delete = function () { this.op = "delete"; return this; };
    Query.prototype.eq = function (c, v) { this.filters.push((r) => r[c] === v); return this; };
    Query.prototype.in = function (c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; };
    Query.prototype.order = function (c, o) { this._order = { c, asc: !(o && o.ascending === false) }; return this; };
    Query.prototype.limit = function (n) { this._limit = n; return this; };
    Query.prototype.range = function (a, b) { this._range = [a, b]; return this; };
    Query.prototype.then = function (resolve, reject) {
      return new Promise((res) => setTimeout(res, 0)).then(() => this.exec()).then(resolve, reject);
    };
    Query.prototype.exec = function () {
      const who = this.client._who();
      const table = this.table;
      backend.log.push({ table, op: this.op, who: who.email || "anon" });
      if (backend.offline) return { data: null, error: netError() };
      const injected = takeFailure(table, this.op);
      if (injected) return { data: null, error: injected };
      const matches = (r) => this.filters.every((f) => f(r));

      if (this.op === "select") {
        if (!canSelect(table, who)) return { data: [], error: null };
        let rows = getRows(table).filter(matches);
        if (this._order) rows.sort((a, b) => (a[this._order.c] > b[this._order.c] ? 1 : a[this._order.c] < b[this._order.c] ? -1 : 0) * (this._order.asc ? 1 : -1));
        let cap = backend.maxRows;
        if (this._range) { rows = rows.slice(this._range[0], this._range[1] + 1); }
        if (this._limit !== null) rows = rows.slice(0, this._limit);
        rows = rows.slice(0, cap);
        return { data: JSON.parse(JSON.stringify(rows)), error: null };
      }

      if (this.op === "insert") {
        if (!canInsert(table, who)) return { data: null, error: rlsError(table) };
        for (const r of this.payload) {
          if (tbl(table).has(r.id)) return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505", status: 409 } };
          const bad = checkConstraints(table, r);
          if (bad) return { data: null, error: bad };
          if (!who.isAdmin && rateLimited(table)) return { data: null, error: { message: "Demasiados registros en poco tiempo.", code: "54000", status: 400 } };
          tbl(table).set(r.id, Object.assign({ created_at: new Date().toISOString() }, JSON.parse(JSON.stringify(r))));
        }
        emit(table, "INSERT");
        return { data: this.returning ? this.payload.map((r) => ({ id: r.id })) : null, error: null };
      }

      if (this.op === "upsert") {
        const out = [];
        for (const r of this.payload) {
          const exists = tbl(table).has(r.id);
          if (exists ? !canModify(table, who) : !canInsert(table, who)) return { data: null, error: rlsError(table) };
          // con upsert, Postgres exige además permiso de UPDATE/SELECT: sin ser admin falla siempre
          if (!who.isAdmin) return { data: null, error: rlsError(table) };
          const merged = Object.assign({}, tbl(table).get(r.id), JSON.parse(JSON.stringify(r)));
          const bad = checkConstraints(table, merged);
          if (bad) return { data: null, error: bad };
          tbl(table).set(r.id, merged);
          out.push({ id: r.id });
        }
        emit(table, "UPSERT");
        return { data: this.returning ? out : null, error: null };
      }

      if (this.op === "update") {
        if (!canModify(table, who)) return { data: this.returning ? [] : null, error: null };
        const hit = getRows(table).filter(matches);
        hit.forEach((r) => tbl(table).set(r.id, Object.assign({}, r, this.payload)));
        if (hit.length) emit(table, "UPDATE");
        return { data: this.returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
      }

      if (this.op === "delete") {
        if (!canModify(table, who)) return { data: this.returning ? [] : null, error: null };
        const hit = getRows(table).filter(matches);
        hit.forEach((r) => {
          tbl(table).delete(r.id);
          if (table === "modelos") cascadeDeleteModelo(r.id);
          if (table === "capacidades") cascadeDeleteCapacidad(r.id);
        });
        if (hit.length) emit(table, "DELETE");
        return { data: this.returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
      }
      return { data: null, error: { message: "op no soportada" } };
    };

    /* ---- cliente (un "navegador"/dispositivo) ---- */
    backend.createClient = function (clientOptions) {
      const co = clientOptions || {};
      const storage = co.storage || null; // para persistir la sesión entre "recargas"
      const SKEY = "fake-sb-session";
      let session = null;
      const authListeners = [];
      if (storage) {
        try { const saved = JSON.parse(storage.getItem(SKEY) || "null"); if (saved && backend.users.has(saved.userId)) session = { userId: saved.userId }; } catch (e) { /* nada */ }
      }
      const client = {
        _who() {
          if (!session) return { isAdmin: false, email: null };
          const u = backend.users.get(session.userId);
          return { isAdmin: backend.admins.has(session.userId), email: u && u.email, id: session.userId };
        },
        _sessionObj() {
          if (!session) return null;
          const u = backend.users.get(session.userId);
          return { user: { id: u.id, email: u.email }, access_token: "fake-token-" + u.id };
        },
        from(table) { return new Query(client, table); },
        rpc(name) {
          if (backend.offline) return Promise.resolve({ data: null, error: netError() });
          if (name === "is_admin") return Promise.resolve({ data: client._who().isAdmin, error: null });
          return Promise.resolve({ data: null, error: { message: "función inexistente" } });
        },
        auth: {
          async signUp({ email, password }) {
            if (backend.offline) return { data: null, error: netError() };
            const id = backend.addUser(email, password, false);
            session = { userId: id };
            if (storage) storage.setItem(SKEY, JSON.stringify({ userId: id }));
            authListeners.forEach((cb) => cb("SIGNED_IN", client._sessionObj()));
            return { data: { session: client._sessionObj(), user: client._sessionObj().user }, error: null };
          },
          async signInWithPassword({ email, password }) {
            if (backend.offline) return { data: { session: null }, error: netError() };
            const u = [...backend.users.values()].find((x) => x.email === email && x.password === password);
            if (!u) return { data: { session: null }, error: { message: "Invalid login credentials", status: 400 } };
            session = { userId: u.id };
            if (storage) storage.setItem(SKEY, JSON.stringify({ userId: u.id }));
            authListeners.forEach((cb) => cb("SIGNED_IN", client._sessionObj()));
            return { data: { session: client._sessionObj(), user: client._sessionObj().user }, error: null };
          },
          async signOut() {
            session = null;
            if (storage) storage.removeItem(SKEY);
            authListeners.forEach((cb) => cb("SIGNED_OUT", null));
            return { error: null };
          },
          async getSession() {
            if (backend.offline && !session) return { data: { session: null }, error: null };
            return { data: { session: client._sessionObj() }, error: null };
          },
          async getUser() { return { data: { user: session ? client._sessionObj().user : null }, error: null }; },
          async updateUser(patch) {
            if (backend.offline) return { data: null, error: netError() };
            if (!session) return { data: null, error: { message: "Auth session missing!", status: 401 } };
            const u = backend.users.get(session.userId);
            if (patch.email) u.email = patch.email;
            if (patch.password) {
              if (String(patch.password).length < 6) return { data: null, error: { message: "Password should be at least 6 characters.", status: 422 } };
              u.password = patch.password;
            }
            return { data: { user: client._sessionObj().user }, error: null };
          },
          async resetPasswordForEmail(email, o) {
            if (backend.offline) return { data: null, error: netError() };
            backend._emails.push({ email, redirectTo: o && o.redirectTo });
            return { data: {}, error: null };
          },
          onAuthStateChange(cb) { authListeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
          // para tests: simula que la sesión venció en el servidor
          _expire() { session = null; if (storage) storage.removeItem(SKEY); authListeners.forEach((cb) => cb("SIGNED_OUT", null)); },
          _recover(email) {
            const u = [...backend.users.values()].find((x) => x.email === email);
            if (!u) return;
            session = { userId: u.id };
            authListeners.forEach((cb) => cb("PASSWORD_RECOVERY", client._sessionObj()));
          },
        },
        channel(name) {
          const ch = { name, handlers: [], subscribed: false, client };
          const api = {
            on(_t, filter, cb) { ch.handlers.push({ table: filter.table, cb }); return api; },
            subscribe() { ch.subscribed = true; backend.channels.push(ch); return api; },
            _ch: ch,
          };
          return api;
        },
        removeChannel(api) { const i = backend.channels.indexOf(api._ch); if (i !== -1) backend.channels.splice(i, 1); return Promise.resolve("ok"); },
      };
      return client;
    };

    return backend;
  }

  const api = { createBackend };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FakeSupabase = api;
})(typeof window !== "undefined" ? window : globalThis);
