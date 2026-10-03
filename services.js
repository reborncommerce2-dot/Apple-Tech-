/*
  services.js = EL MOTOR COMPARTIDO (capa de datos + reglas de negocio).
  ------------------------------------------------------------
  Es el MISMO archivo para el cotizador público (index.html) y el panel
  admin (admin.html). Nadie lee ni escribe Supabase directamente fuera
  de acá.

  Servicios expuestos:
    StorageService        -> store completo en memoria + sincronización con Supabase
    catalogService         -> catálogo de VENTA (Admin → Catálogo / Paso 5)
    modeloService          -> modelos de CANJE (Admin → Valoración / Paso 1)
    capacidadService       -> capacidades (Admin → Capacidades)
    valuationService       -> valor de canje por modelo+capacidad
    batteryService         -> reglas de batería (Admin → Batería / Paso 3)
    damageService          -> desperfectos (Admin → Desperfectos / Paso 4)
    contactService         -> datos de contacto (Admin → Contacto)
    pricingService         -> cálculo de la cotización, 100% en USD
    quotesHistoryService   -> historial de cotizaciones (Admin → Historial)
    leadsService           -> leads del cotizador (Admin → Leads)
    auditLogService        -> historial de cambios (Admin → Actividad)
    valuationBackupService -> exportar/importar modelos+capacidades+valoraciones
    authService            -> Supabase Auth + verificación de administrador
    backupService          -> exportar / importar / restaurar datos de ejemplo

  REGLAS DE DISEÑO DE StorageService (todas verificadas por tests):
   1. Los servicios siguen siendo sincrónicos (loadStore()/saveStore()):
      la caché en memoria se actualiza al instante.
   2. Solo una sesión de ADMINISTRADOR verificada (función is_admin() de
      Supabase) sube cambios. El público únicamente INSERTA cotizaciones
      y leads.
   3. Los cambios se suben en una cola serializada, en orden de
      dependencia (modelos/capacidades antes que valoraciones), y se
      comparan contra una FOTO (snapshot) de lo último confirmado:
      ninguna edición puede quedar sin subir.
   4. El estado real (guardando / guardado / error) se informa con
      onStatus(): la interfaz nunca dice "guardado" si no lo está.
   5. Si no se pueden leer los datos de Supabase, NO se usan datos de
      ejemplo ni se permite guardar: se informa el error.
   6. Un cambio remoto (Realtime) nunca pisa cambios locales pendientes.
   7. La migración desde el navegador viejo (localStorage) solo corre si
      la base sigue "pristine" (nadie la configuró), se reclama de forma
      atómica y nunca borra cotizaciones/leads ya recibidos.
*/

const STORE_KEY = "appletech_store_v2"; // solo se LEE, para migrar datos viejos del navegador
const MIGRATION_DONE_KEY = "appletech_migrated_supabase_v1";
const OUTBOX_KEY = "appletech_outbox_v1"; // cotizaciones/leads que no pudieron enviarse por falta de red
const DEFAULT_ADMIN_USER = "admin"; // solo como texto de respaldo para mostrar
const MAX_USD = 1000000; // mismo tope que las restricciones del SQL
const PAGE_SIZE = 1000;
const LOG_LIMITS = { quotesHistory: 500, leads: 500, auditLog: 300 }; // cuántas filas recientes trae el panel

const CONFIG_KEYS = ["modelos", "capacidades", "valoraciones", "bateria", "desperfectos", "catalog"];
const LOG_KEYS = ["quotesHistory", "leads", "auditLog"];
// Orden de dependencia: los "padres" primero (modelos, capacidades), después lo que los referencia.
const SYNC_ORDER = CONFIG_KEYS.concat(LOG_KEYS);

function uid(prefix) {
  return prefix + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function clampUSD(n) {
  return Math.min(MAX_USD, Math.max(0, Number(n) || 0));
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });
}

// "64 GB" < "128 GB" < "1 TB": se ordena por tamaño real, no por texto.
function capacityBytes(nombre) {
  const m = String(nombre || "").match(/(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)/i);
  if (!m) return Number.POSITIVE_INFINITY;
  const n = parseFloat(m[1].replace(",", "."));
  const unit = m[2].toLowerCase();
  return n * (unit === "tb" ? 1024 : unit === "gb" ? 1 : 1 / 1024);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

/* Traduce un error técnico (Supabase/red) a un mensaje claro en español. */
function describeError(err) {
  const msg = String((err && (err.message || err.error_description)) || err || "");
  const status = err && (err.status || err.statusCode);
  const code = err && err.code;
  if (err && err.kind === "denied") return { kind: "denied", text: "El servidor rechazó el cambio por permisos. ¿Tu usuario es administrador?" };
  if (status === 401 || code === "PGRST301" || /jwt|token.*expired|not authenticated|invalid.*token/i.test(msg)) {
    return { kind: "auth", text: "Tu sesión venció. Volvé a ingresar para poder guardar." };
  }
  if (status === 403 || code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return { kind: "denied", text: "El servidor rechazó el cambio por permisos. ¿Tu usuario es administrador?" };
  }
  if (status === 0 || /failed to fetch|networkerror|network request|load failed|fetch failed|timeout|offline/i.test(msg)) {
    return { kind: "network", text: "Sin conexión con Supabase. Revisá tu internet y tocá Reintentar." };
  }
  if (code === "54000") return { kind: "rate", text: msg };
  return { kind: "other", text: msg || "Error desconocido." };
}

function isRetryable(err) {
  const d = describeError(err);
  const status = err && (err.status || err.statusCode);
  return d.kind === "network" || (typeof status === "number" && status >= 500);
}

/* ============================================================
   TABLES — mapeo entre el STORE local (camelCase) y las tablas de
   Supabase (snake_case, ver supabase_schema.sql).
   ============================================================ */
const TABLES = {
  modelos: {
    table: "modelos",
    toRow: (m) => ({ id: m.id, nombre: m.nombre, capacidad_ids: m.capacidadIds || [] }),
    toLocal: (r) => ({ id: r.id, nombre: r.nombre, capacidadIds: r.capacidad_ids || [] }),
    sort: (a, b) => naturalCompare(a.nombre, b.nombre),
  },
  capacidades: {
    table: "capacidades",
    toRow: (c) => ({ id: c.id, nombre: c.nombre, activo: c.activo !== false }),
    toLocal: (r) => ({ id: r.id, nombre: r.nombre, activo: r.activo !== false }),
    sort: (a, b) => (capacityBytes(a.nombre) - capacityBytes(b.nombre)) || naturalCompare(a.nombre, b.nombre),
  },
  valoraciones: {
    table: "valoraciones",
    toRow: (v) => ({ id: v.id, modelo_id: v.modeloId, modelo_nombre: v.modeloNombre || "", capacidad_id: v.capacidadId, capacidad_nombre: v.capacidadNombre || "", valor_usd: clampUSD(v.valorUSD) }),
    toLocal: (r) => ({ id: r.id, modeloId: r.modelo_id, modeloNombre: r.modelo_nombre || "", capacidadId: r.capacidad_id, capacidadNombre: r.capacidad_nombre || "", valorUSD: Number(r.valor_usd) || 0 }),
    sort: (a, b) => naturalCompare(a.modeloNombre, b.modeloNombre) || (capacityBytes(a.capacidadNombre) - capacityBytes(b.capacidadNombre)),
  },
  bateria: {
    table: "bateria",
    toRow: (b) => ({ id: b.id, porcentaje_minimo: Math.round(Number(b.porcentajeMinimo) || 0), porcentaje_maximo: Math.round(Number(b.porcentajeMaximo) || 0), descuento_usd: clampUSD(b.descuentoUSD), label: b.label || "", descripcion: b.desc || "" }),
    toLocal: (r) => ({ id: r.id, porcentajeMinimo: Number(r.porcentaje_minimo) || 0, porcentajeMaximo: Number(r.porcentaje_maximo) || 0, descuentoUSD: Number(r.descuento_usd) || 0, label: r.label || "", desc: r.descripcion || "" }),
    sort: (a, b) => b.porcentajeMinimo - a.porcentajeMinimo,
  },
  desperfectos: {
    table: "desperfectos",
    toRow: (d) => ({ id: d.id, nombre: d.nombre || "", descripcion: d.descripcion || "", descuento_usd: clampUSD(d.descuentoUSD), activo: d.activo !== false }),
    toLocal: (r) => ({ id: r.id, nombre: r.nombre || "", descripcion: r.descripcion || "", descuentoUSD: Number(r.descuento_usd) || 0, activo: r.activo !== false }),
    // Sin columna de orden: los más importantes (mayor descuento) primero, y después por nombre.
    sort: (a, b) => (b.descuentoUSD - a.descuentoUSD) || naturalCompare(a.nombre, b.nombre),
  },
  catalog: {
    table: "catalog",
    toRow: (p) => ({ id: p.id, nombre: p.nombre || "", precio_base_usd: clampUSD(p.precioBaseUSD), stock: p.stock ? 1 : 0, estado: ["published", "out", "draft"].includes(p.estado) ? p.estado : "draft", imagen_url: p.imagenUrl || "", detalle: p.detalle || "" }),
    toLocal: (r) => ({ id: r.id, nombre: r.nombre || "", precioBaseUSD: Number(r.precio_base_usd) || 0, stock: r.stock ? 1 : 0, estado: r.estado || "draft", imagenUrl: r.imagen_url || "", detalle: r.detalle || "" }),
    sort: (a, b) => naturalCompare(a.nombre, b.nombre),
  },
  quotesHistory: {
    table: "quotes_history",
    toRow: (h) => ({ id: h.id, fecha: h.fecha, modelo_id: h.modeloId || "", modelo_nombre: h.modeloNombre || "", capacidad_id: h.capacidadId || "", capacidad_nombre: h.capacidadNombre || "", valor_base_usd: clampUSD(h.valorBaseUSD), descuento_bateria_usd: clampUSD(h.descuentoBateriaUSD), descuento_desperfectos_usd: clampUSD(h.descuentoDesperfectosUSD), valor_final_usd: clampUSD(h.valorFinalUSD), color: h.color || "", bateria_label: h.bateriaLabel || "", desperfectos: Array.isArray(h.desperfectos) ? h.desperfectos : [] }),
    toLocal: (r) => ({ id: r.id, fecha: Number(r.fecha) || 0, modeloId: r.modelo_id || "", modeloNombre: r.modelo_nombre || "", capacidadId: r.capacidad_id || "", capacidadNombre: r.capacidad_nombre || "", valorBaseUSD: Number(r.valor_base_usd) || 0, descuentoBateriaUSD: Number(r.descuento_bateria_usd) || 0, descuentoDesperfectosUSD: Number(r.descuento_desperfectos_usd) || 0, valorFinalUSD: Number(r.valor_final_usd) || 0, color: r.color || "", bateriaLabel: r.bateria_label || "", desperfectos: Array.isArray(r.desperfectos) ? r.desperfectos : [] }),
    sort: (a, b) => b.fecha - a.fecha,
  },
  leads: {
    table: "leads",
    toRow: (l) => ({ id: l.id, fecha: l.fecha, nombre: l.nombre || "", whatsapp: l.whatsapp || "", modelo_id: l.modeloId || "", modelo_nombre: l.modeloNombre || "", resultado_usd: clampUSD(l.resultadoUSD), capacidad_nombre: l.capacidadNombre || "", producto_compra_nombre: l.productoCompraNombre || "", diferencia_usd: l.diferenciaUSD === null || l.diferenciaUSD === undefined ? null : clampUSD(l.diferenciaUSD), quote_id: l.quoteId || "" }),
    toLocal: (r) => ({ id: r.id, fecha: Number(r.fecha) || 0, nombre: r.nombre || "", whatsapp: r.whatsapp || "", modeloId: r.modelo_id || "", modeloNombre: r.modelo_nombre || "", resultadoUSD: Number(r.resultado_usd) || 0, capacidadNombre: r.capacidad_nombre || "", productoCompraNombre: r.producto_compra_nombre || "", diferenciaUSD: r.diferencia_usd === null || r.diferencia_usd === undefined ? null : Number(r.diferencia_usd), quoteId: r.quote_id || "" }),
    sort: (a, b) => b.fecha - a.fecha,
  },
  auditLog: {
    table: "audit_log",
    toRow: (a) => ({ id: a.id, fecha: a.fecha, accion: a.accion || "", entidad: a.entidad || "", valor_anterior: a.valorAnterior === undefined ? null : a.valorAnterior, valor_nuevo: a.valorNuevo === undefined ? null : a.valorNuevo }),
    toLocal: (r) => ({ id: r.id, fecha: Number(r.fecha) || 0, accion: r.accion || "", entidad: r.entidad || "", valorAnterior: r.valor_anterior === undefined ? null : r.valor_anterior, valorNuevo: r.valor_nuevo === undefined ? null : r.valor_nuevo }),
    sort: (a, b) => b.fecha - a.fecha,
  },
};

/* Store VACÍO (sin datos de ejemplo): es lo que se usa cuando no se
   pudo leer Supabase. Así, ante un error, NUNCA se muestran ni se
   suben precios de ejemplo. */
function emptyStore() {
  return {
    meta: { lastModified: null, configState: "pristine" },
    contact: { businessName: "Apple Tech", phone: "", whatsapp: "", instagram: "", address: "", hours: "" },
    catalog: [], desperfectos: [], bateria: [], modelos: [], capacidades: [], valoraciones: [],
    quotesHistory: [], leads: [], auditLog: [],
  };
}

/* ============================================================
   Validación y normalización de datos que vienen de afuera
   (backups importados y datos viejos del navegador).
   ============================================================ */
function isNum(v) { return typeof v === "number" && isFinite(v); }
function isText(v) { return typeof v === "string" && v.trim().length > 0; }

/* Devuelve una lista de problemas (vacía = el dato es válido). */
function validateStoreShape(raw, options) {
  const legacy = !!(options && options.legacy);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["El archivo no tiene el formato de un backup de Apple Tech."];
  const problems = [];
  const rules = {
    catalog: { required: true, label: "catálogo", ok: (it) => it && it.id && isText(it.nombre) && isNum(it.precioBaseUSD) },
    desperfectos: { required: true, label: "desperfectos", ok: (it) => it && it.id && isNum(it.descuentoUSD) },
    bateria: { required: true, label: "batería", ok: (it) => it && it.id && isNum(it.descuentoUSD) && isNum(it.porcentajeMinimo) && isNum(it.porcentajeMaximo) },
    valoraciones: { required: true, label: "valoraciones", ok: (it) => it && it.id && it.modeloId && it.capacidadId && isNum(it.valorUSD) },
    modelos: { required: !legacy, label: "modelos", ok: (it) => it && it.id && isText(it.nombre) && Array.isArray(it.capacidadIds) },
    capacidades: { required: !legacy, label: "capacidades", ok: (it) => it && it.id && isText(it.nombre) },
    quotesHistory: { required: false, label: "historial", ok: (it) => it && it.id && isNum(it.fecha) },
    leads: { required: false, label: "leads", ok: (it) => it && it.id && isNum(it.fecha) },
    auditLog: { required: false, label: "actividad", ok: (it) => it && it.id && isNum(it.fecha) },
  };
  Object.keys(rules).forEach((key) => {
    const rule = rules[key];
    const arr = raw[key];
    if (arr === undefined || arr === null) {
      if (rule.required) problems.push("Falta la sección «" + rule.label + "».");
      return;
    }
    if (!Array.isArray(arr)) { problems.push("La sección «" + rule.label + "» no es una lista."); return; }
    const bad = arr.findIndex((it) => !rule.ok(it));
    if (bad !== -1) problems.push("La sección «" + rule.label + "» tiene un elemento inválido (posición " + (bad + 1) + ").");
    const ids = arr.filter((it) => it && it.id).map((it) => String(it.id));
    if (new Set(ids).size !== ids.length) problems.push("La sección «" + rule.label + "» tiene ids repetidos.");
  });
  if (Array.isArray(raw.modelos) && Array.isArray(raw.capacidades) && Array.isArray(raw.valoraciones) && !problems.length) {
    const mIds = new Set(raw.modelos.map((m) => m.id));
    const cIds = new Set(raw.capacidades.map((c) => c.id));
    if (raw.valoraciones.some((v) => !mIds.has(v.modeloId) || !cIds.has(v.capacidadId))) {
      problems.push("Hay valoraciones que apuntan a un modelo o capacidad que no existe en el archivo.");
    }
  }
  if (raw.contact !== undefined && (raw.contact === null || typeof raw.contact !== "object" || Array.isArray(raw.contact))) {
    problems.push("La sección «contacto» no es válida.");
  }
  return problems;
}

function normalizeStore(raw) {
  const base = defaultStore();
  const s = Object.assign({}, base, raw || {});

  s.meta = Object.assign({ configState: "pristine" }, base.meta, (raw && raw.meta) || {});
  s.contact = Object.assign({}, base.contact, (raw && raw.contact) || {});

  // Nota: un array VACÍO es un valor válido (el administrador puede
  // vaciar el catálogo de venta a propósito) — solo se cae a los
  // valores de fábrica si el dato ni siquiera es un array, o si
  // contiene elementos con forma inválida (dato corrupto).
  // Esta función se usa SOLO con datos viejos del navegador y con
  // backups ya validados; los datos que vienen de Supabase NO pasan
  // por acá (así un registro raro nunca dispara datos de ejemplo).
  const catalogOk = Array.isArray(s.catalog) &&
    s.catalog.every((it) => it && it.id && it.nombre && typeof it.precioBaseUSD === "number");
  if (!catalogOk) s.catalog = base.catalog;
  s.catalog = s.catalog.map((it) => Object.assign({ imagenUrl: "", detalle: "" }, it));

  const damagesOk = Array.isArray(s.desperfectos) &&
    s.desperfectos.every((it) => it && it.id && typeof it.descuentoUSD === "number");
  if (!damagesOk) s.desperfectos = base.desperfectos;
  s.desperfectos = s.desperfectos.map((d) => Object.assign({ activo: true, descripcion: "" }, d));

  const batteryOk = Array.isArray(s.bateria) &&
    s.bateria.every((it) => it && it.id && typeof it.descuentoUSD === "number");
  if (!batteryOk) s.bateria = base.bateria;

  // Datos de versiones anteriores: si no había "modelos"/"capacidades"
  // guardados, se reconstruyen con los mismos ids que usaban las
  // valoraciones (ver CHANGELOG), sin perder ningún valor cargado.
  const modelosOk = Array.isArray(s.modelos) &&
    s.modelos.every((it) => it && it.id && it.nombre && Array.isArray(it.capacidadIds));
  if (!modelosOk) s.modelos = base.modelos;
  s.modelos = s.modelos.map((m) => Object.assign({ capacidadIds: [] }, m));

  const capacidadesOk = Array.isArray(s.capacidades) &&
    s.capacidades.every((it) => it && it.id && it.nombre);
  if (!capacidadesOk) s.capacidades = base.capacidades;
  s.capacidades = s.capacidades.map((c) => Object.assign({ activo: true }, c));

  const valuationOk = Array.isArray(s.valoraciones) &&
    s.valoraciones.every((it) => it && it.id && it.modeloId && it.capacidadId && typeof it.valorUSD === "number");
  if (!valuationOk) s.valoraciones = base.valoraciones;

  if (!Array.isArray(s.quotesHistory)) s.quotesHistory = [];
  if (!Array.isArray(s.leads)) s.leads = [];
  if (!Array.isArray(s.auditLog)) s.auditLog = [];

  return s;
}

/* Une dos listas por id (los elementos de `primary` ganan). */
function unionById(primary, secondary) {
  const seen = new Set();
  const out = [];
  (primary || []).concat(secondary || []).forEach((it) => {
    if (!it || seen.has(it.id)) return;
    seen.add(it.id);
    out.push(it);
  });
  return out;
}

/* ============================================================
   StorageService
   ============================================================ */
const StorageService = {
  _cache: null,
  _lastSynced: {}, // key -> Map(id -> foto JSON) de lo último CONFIRMADO en Supabase; "contact"/"meta" -> foto JSON
  _ready: null,
  _channel: null,
  _listeners: [],
  _statusListeners: [],
  _queue: Promise.resolve(),
  _inflight: 0,
  _dirty: false, // hay cambios locales todavía no confirmados
  _touchPending: false,
  _version: 0, // sube con cada cambio local (para descartar lecturas viejas)
  _isAdmin: false,
  _privateLoaded: false, // ¿se cargaron cotizaciones/leads/actividad? (solo admin)
  _loadError: null,
  _lastError: null,
  _status: { state: "idle", message: "", kind: "" },
  _tracked: new Set(),
  _refreshTimer: null,

  _client() {
    return (typeof window !== "undefined" && window.supabaseClient) || null;
  },

  /* ---------- Suscripciones de la interfaz ---------- */
  onChange(fn) {
    if (typeof fn === "function") this._listeners.push(fn);
  },
  _notify() {
    this._listeners.forEach((fn) => {
      try { fn(); } catch (err) { console.warn("StorageService: listener de onChange falló", err); }
    });
  },
  onStatus(fn) {
    if (typeof fn === "function") this._statusListeners.push(fn);
  },
  getStatus() {
    return Object.assign({}, this._status);
  },
  _setStatus(state, message, kind) {
    this._status = { state, message: message || "", kind: kind || "" };
    this._statusListeners.forEach((fn) => {
      try { fn(this.getStatus()); } catch (err) { console.warn("StorageService: listener de estado falló", err); }
    });
  },
  /* Si es distinto de null, NO hay datos confiables (la UI debe avisarlo). */
  getLoadError() { return this._loadError; },
  isAdmin() { return this._isAdmin; },
  setAdmin(flag) { this._isAdmin = !!flag; },
  hasPendingChanges() { return this._inflight > 0 || this._dirty; },

  loadStore() {
    if (!this._cache) {
      // Sin init() (solo ocurre en tests o si algo llama antes de tiempo):
      // valores de fábrica en memoria, sin tocar Supabase.
      this._cache = normalizeStore(null);
    }
    return this._cache;
  },

  _canWrite() {
    return !!(this._client() && this._isAdmin && !this._loadError);
  },

  /* touch=true (default) actualiza meta.lastModified: usar SIEMPRE que el
     cambio venga de una edición real del administrador. touch=false se
     usa para restaurar con su propia fecha y para cambios automáticos. */
  saveStore(store, options) {
    const touch = !options || options.touch !== false;
    if (touch) {
      store.meta = store.meta || {};
      store.meta.lastModified = Date.now();
    }
    this._cache = store;
    this._version += 1;
    if (touch) this._touchPending = true;

    const client = this._client();
    if (!client) return store; // modo memoria (tests): no hay nada que sincronizar
    if (!this._canWrite()) {
      this._dirty = true;
      const why = this._loadError
        ? "No hay conexión confiable con la base: el cambio NO se guardó."
        : "Esta sesión no tiene permisos de administrador: el cambio NO se guardó.";
      this._setStatus("error", why, this._loadError ? "network" : "denied");
      return store;
    }
    this._dirty = true;
    this._enqueue();
    return store;
  },

  _track(promise) {
    this._tracked.add(promise);
    const done = () => this._tracked.delete(promise);
    promise.then(done, done);
    return promise;
  },

  /* Espera a que terminen todas las operaciones en vuelo. */
  async waitIdle() {
    while (this._tracked.size) {
      await Promise.all([...this._tracked]);
    }
  },

  /* Fuerza un intento de guardado y devuelve { ok, error }. Lo usan el
     botón "Reintentar" y el botón "Guardar" del panel. */
  async flush() {
    if (!this._client()) return { ok: true };
    if (!this._canWrite()) {
      const e = this._loadError ? new Error(this._loadError) : Object.assign(new Error("Sin permisos de administrador."), { kind: "denied" });
      return { ok: false, error: e, message: describeError(e).text };
    }
    const r = await this._enqueue();
    return r;
  },

  _enqueue() {
    this._inflight += 1;
    this._setStatus("saving", "Guardando…");
    const run = async () => {
      let error = null;
      try {
        await this._persist();
      } catch (err) {
        error = err;
      }
      this._lastError = error;
      this._inflight -= 1;
      if (this._inflight === 0) {
        if (error) {
          this._dirty = true;
          const d = describeError(error);
          console.warn("StorageService: no se pudo guardar en Supabase", error);
          this._setStatus("error", d.text, d.kind);
          if (d.kind === "auth" && typeof window !== "undefined" && typeof window.__appletechOnLoggedOut === "function") {
            window.__appletechOnLoggedOut("expired");
          }
        } else {
          this._dirty = false;
          this._setStatus("saved", "Todos los cambios guardados");
        }
      }
      return error ? { ok: false, error, message: describeError(error).text } : { ok: true };
    };
    const job = this._queue.then(run);
    this._queue = job;
    return this._track(job);
  },

  /* Sube a Supabase TODO lo que difiere de la última foto confirmada. */
  async _persist() {
    const client = this._client();
    if (!client) return;
    const store = this._cache;
    const touch = this._touchPending;
    this._touchPending = false;
    try {
      const plans = {};
      SYNC_ORDER.forEach((key) => {
        if (this._lastSynced[key]) plans[key] = this._plan(key, store);
      });
      // 1) Borrados: los "hijos" primero (orden inverso).
      for (const key of SYNC_ORDER.slice().reverse()) {
        if (plans[key] && plans[key].deletes.length) await this._deleteRows(client, key, plans[key].deletes);
      }
      // 2) Altas/cambios: los "padres" primero.
      for (const key of SYNC_ORDER) {
        if (plans[key] && plans[key].upserts.length) await this._upsertRows(client, key, plans[key].upserts);
      }
      await this._syncContact(client, store.contact);
      if (touch) await this._syncMeta(client, store.meta);
    } catch (err) {
      if (touch) this._touchPending = true; // reintentar con la marca de "modificado"
      throw err;
    }
  },

  _plan(key, store) {
    const prev = this._lastSynced[key];
    const seen = new Set();
    const upserts = [];
    (store[key] || []).forEach((item) => {
      seen.add(item.id);
      const snap = stableStringify(item);
      if (prev.get(item.id) !== snap) upserts.push({ item, snap });
    });
    const deletes = [];
    prev.forEach((_, id) => { if (!seen.has(id)) deletes.push(id); });
    return { upserts, deletes };
  },

  async _upsertRows(client, key, upserts) {
    const def = TABLES[key];
    for (let i = 0; i < upserts.length; i += 200) {
      const chunk = upserts.slice(i, i + 200);
      const rows = chunk.map((u) => def.toRow(u.item));
      const { data, error } = await client.from(def.table).upsert(rows, { onConflict: "id" }).select("id");
      if (error) throw error;
      // Si RLS rechaza un UPDATE, Postgres no da error: simplemente no devuelve filas.
      if (!data || data.length !== rows.length) {
        throw Object.assign(new Error("El servidor no confirmó todos los cambios en " + def.table + "."), { kind: "denied" });
      }
      chunk.forEach((u) => this._lastSynced[key].set(u.item.id, u.snap));
    }
  },

  async _deleteRows(client, key, ids) {
    const def = TABLES[key];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await client.from(def.table).delete().in("id", chunk).select("id");
      if (error) throw error;
      chunk.forEach((id) => this._lastSynced[key].delete(id));
    }
  },

  async _syncContact(client, contact) {
    if (!contact) return;
    const snap = stableStringify(contact);
    if (this._lastSynced.contact === snap) return;
    const row = {
      id: "singleton",
      business_name: contact.businessName || "",
      phone: contact.phone || "",
      whatsapp: contact.whatsapp || "",
      instagram: contact.instagram || "",
      address: contact.address || "",
      hours: contact.hours || "",
    };
    const { data, error } = await client.from("contact").upsert([row], { onConflict: "id" }).select("id");
    if (error) throw error;
    if (!data || !data.length) throw Object.assign(new Error("El servidor no confirmó el contacto."), { kind: "denied" });
    this._lastSynced.contact = snap;
  },

  async _syncMeta(client, meta) {
    if (!meta) return;
    const row = { id: "singleton", last_modified: meta.lastModified || Date.now(), config_state: "configured" };
    const { data, error } = await client.from("app_meta").upsert([row], { onConflict: "id" }).select("id");
    if (error) throw error;
    if (!data || !data.length) throw Object.assign(new Error("El servidor no confirmó la fecha de modificación."), { kind: "denied" });
    meta.configState = "configured";
    this._lastSynced.meta = stableStringify(meta);
  },

  /* ---------- Lectura ---------- */
  async _selectAll(client, key) {
    const def = TABLES[key];
    const limit = LOG_LIMITS[key];
    if (limit) {
      const { data, error } = await client.from(def.table).select("*").order("fecha", { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    }
    // Sin límite de negocio: se pagina (PostgREST corta en 1000 filas por pedido).
    const all = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client.from(def.table).select("*").order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = data || [];
      all.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return all;
  },

  /* Trae el store COMPLETO. Si CUALQUIER tabla falla, lanza error: jamás
     se arma un store a medias ni se rellena con datos de ejemplo. */
  async _fetchAll(client, includePrivate) {
    const store = emptyStore();
    const synced = {};
    const keys = includePrivate ? SYNC_ORDER : CONFIG_KEYS;
    const errors = [];
    for (const key of keys) {
      try {
        const rows = await this._selectAll(client, key);
        store[key] = rows.map(TABLES[key].toLocal).sort(TABLES[key].sort);
        synced[key] = new Map(store[key].map((it) => [it.id, stableStringify(it)]));
      } catch (err) {
        errors.push(TABLES[key].table + ": " + describeError(err).text);
      }
    }
    try {
      const { data, error } = await client.from("contact").select("*").eq("id", "singleton");
      if (error) throw error;
      if (data && data[0]) {
        const r = data[0];
        store.contact = {
          businessName: r.business_name || "", phone: r.phone || "", whatsapp: r.whatsapp || "",
          instagram: r.instagram || "", address: r.address || "", hours: r.hours || "",
        };
        synced.contact = stableStringify(store.contact);
      }
    } catch (err) {
      errors.push("contact: " + describeError(err).text);
    }
    if (includePrivate) {
      try {
        const { data, error } = await client.from("app_meta").select("*").eq("id", "singleton");
        if (error) throw error;
        if (data && data[0]) {
          store.meta = { lastModified: Number(data[0].last_modified) || null, configState: data[0].config_state || "pristine" };
          synced.meta = stableStringify(store.meta);
        }
      } catch (err) {
        errors.push("app_meta: " + describeError(err).text);
      }
    }
    if (errors.length) {
      throw Object.assign(new Error("No se pudieron leer los datos (" + errors.join("; ") + ")"), { details: errors });
    }
    return { store, synced };
  },

  async _detectAdmin(client) {
    try {
      const { data } = await client.auth.getSession();
      if (!data || !data.session) return false;
      const res = await client.rpc("is_admin");
      return !res.error && res.data === true;
    } catch (err) {
      return false;
    }
  },

  /* Se llama UNA vez al arrancar. options.admin=true (panel admin) trae
     además cotizaciones, leads y actividad si la sesión es de admin. */
  init(options) {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      const client = this._client();
      if (!client) {
        this._cache = emptyStore();
        this._loadError = (typeof window !== "undefined" && window.supabaseClientError) || "Supabase no está configurado.";
        return this._cache;
      }
      this._isAdmin = await this._detectAdmin(client);
      await this.reload(options);
      this.flushOutbox();
      if (typeof window !== "undefined" && window.addEventListener) {
        window.addEventListener("online", () => { this.flushOutbox(); if (this._loadError) this.reload({ admin: this._privateLoaded }); });
      }
      return this._cache;
    })();
    return this._ready;
  },

  /* Vuelve a leer todo desde Supabase (después de login/logout, o al
     reintentar tras un error). Nunca pisa cambios locales sin guardar. */
  async reload(options) {
    const client = this._client();
    if (!client) return { ok: false };
    if (this._inflight > 0) await this.waitIdle();
    const wantPrivate = !!(options && options.admin) && this._isAdmin;
    try {
      const { store, synced } = await this._fetchAll(client, wantPrivate);
      this._cache = store;
      this._lastSynced = synced;
      this._privateLoaded = wantPrivate;
      this._loadError = null;
      this._dirty = false;
      if (this._status.state === "error") this._setStatus("idle", "");
    } catch (err) {
      console.warn("StorageService: no se pudo leer Supabase", err);
      this._loadError = describeError(err).text;
      if (!this._cache || this._loadError) { this._cache = emptyStore(); this._lastSynced = {}; }
      this._privateLoaded = false;
    }
    this._subscribeRealtime(client);
    this._notify();
    return { ok: !this._loadError, error: this._loadError };
  },

  /* ---------- Realtime ---------- */
  _subscribeRealtime(client) {
    if (!client.channel) return;
    if (this._channel && client.removeChannel) {
      try { client.removeChannel(this._channel); } catch (err) { /* ignorar */ }
    }
    const tables = CONFIG_KEYS.map((k) => TABLES[k].table).concat(["contact"]);
    if (this._privateLoaded) {
      LOG_KEYS.forEach((k) => tables.push(TABLES[k].table));
      tables.push("app_meta");
    }
    const channel = client.channel("appletech-store-sync-" + (this._privateLoaded ? "admin" : "public"));
    tables.forEach((t) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table: t }, () => this._scheduleRefresh());
    });
    channel.subscribe();
    this._channel = channel;
  },

  _scheduleRefresh(delay) {
    if (typeof clearTimeout === "undefined") return;
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this._refreshNow(), delay || 250);
  },

  async _refreshNow() {
    const client = this._client();
    if (!client) return;
    // Nunca pisar cambios propios que todavía no se confirmaron.
    if (this._inflight > 0 || this._dirty) { this._scheduleRefresh(600); return; }
    const version = this._version;
    try {
      const { store, synced } = await this._fetchAll(client, this._privateLoaded);
      if (this._version !== version || this._inflight > 0 || this._dirty) { this._scheduleRefresh(400); return; }
      this._cache = store;
      this._lastSynced = synced;
      this._loadError = null;
      this._notify();
    } catch (err) {
      console.warn("StorageService: fallo al refrescar por Realtime", err);
    }
  },

  /* ---------- Escritura del PÚBLICO: solo inserciones ---------- */
  insertRow(key, item) {
    const def = TABLES[key];
    const client = this._client();
    const store = this.loadStore();
    // Se agrega a la lista en memoria (así el panel lo ve si este navegador es admin).
    if (!client || this._lastSynced[key]) {
      (store[key] = store[key] || []).push(item);
      if (this._lastSynced[key]) this._lastSynced[key].set(item.id, stableStringify(item));
    }
    if (!client) return Promise.resolve({ ok: false, queued: false });
    return this._track(this._insertNow(client, key, item, def));
  },

  async _insertNow(client, key, item, def) {
    try {
      const { error } = await client.from(def.table).insert(def.toRow(item));
      if (!error || error.code === "23505") return { ok: true };
      throw error;
    } catch (err) {
      if (isRetryable(err)) {
        this._outboxPush(key, item);
        return { ok: false, queued: true, error: err };
      }
      console.warn("StorageService: no se pudo registrar en " + def.table, err);
      return { ok: false, queued: false, error: err };
    }
  },

  _outboxRead() {
    try {
      if (typeof localStorage === "undefined") return [];
      const list = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (err) { return []; }
  },
  _outboxWrite(list) {
    try {
      if (typeof localStorage === "undefined") return;
      if (list.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-50)));
      else localStorage.removeItem(OUTBOX_KEY);
    } catch (err) { /* almacenamiento lleno o bloqueado: se ignora */ }
  },
  _outboxPush(key, item) {
    const list = this._outboxRead();
    if (!list.some((e) => e.item && e.item.id === item.id)) list.push({ key, item });
    this._outboxWrite(list);
  },
  /* Reintenta enviar cotizaciones/leads que quedaron pendientes por falta de red. */
  async flushOutbox() {
    const client = this._client();
    const list = this._outboxRead();
    if (!client || !list.length) return { sent: 0, pending: list.length };
    const remaining = [];
    let sent = 0;
    for (const entry of list) {
      const def = TABLES[entry.key];
      if (!def || !entry.item) continue;
      try {
        const { error } = await client.from(def.table).insert(def.toRow(entry.item));
        if (!error || error.code === "23505") { sent += 1; continue; }
        throw error;
      } catch (err) {
        if (isRetryable(err)) remaining.push(entry);
      }
    }
    this._outboxWrite(remaining);
    return { sent, pending: remaining.length };
  },

  /* Trae TODAS las cotizaciones/leads/actividad (sin el tope de "los más
     recientes"), para que el backup sea completo. Solo admin. */
  async fetchFullLogs() {
    const client = this._client();
    if (!client || !this._isAdmin) return null;
    const out = {};
    for (const key of LOG_KEYS) {
      const def = TABLES[key];
      const all = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await client.from(def.table).select("*").order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        const rows = data || [];
        all.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      out[key] = all.map(def.toLocal).sort(def.sort);
    }
    return out;
  },

  /* ---------- Migración única desde localStorage ---------- */
  /* Solo corre desde una sesión de administrador verificada y solo si la
     base sigue "pristine". Nunca borra cotizaciones/leads existentes. */
  async migrateFromLocalStorageIfNeeded() {
    const client = this._client();
    if (!client) return { ok: false, reason: "sin-cliente-supabase" };
    if (!this._isAdmin) return { ok: false, reason: "no-admin" };
    if (typeof localStorage === "undefined") return { ok: false, reason: "sin-localStorage" };
    if (localStorage.getItem(MIGRATION_DONE_KEY) === "1") return { ok: false, reason: "ya-migrado-este-dispositivo" };

    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (err) { raw = null; }
    if (!raw || typeof raw !== "object") {
      localStorage.setItem(MIGRATION_DONE_KEY, "1");
      return { ok: false, reason: "sin-datos-locales" };
    }
    const problems = validateStoreShape(raw, { legacy: true });
    if (problems.length) {
      // No se toca nada: los datos locales quedan intactos en el navegador.
      localStorage.setItem(MIGRATION_DONE_KEY, "1");
      return { ok: false, reason: "datos-locales-invalidos", problems };
    }

    // 1) Leer el estado REAL de la base (no la caché). Si falla, se lanza
    //    el error y NO se marca como migrado: se reintenta la próxima vez.
    const current = await this._fetchAll(client, true);
    if (current.store.meta.configState !== "pristine") {
      localStorage.setItem(MIGRATION_DONE_KEY, "1");
      this._cache = current.store;
      this._lastSynced = current.synced;
      this._notify();
      return { ok: false, reason: "supabase-ya-configurado" };
    }

    // 2) Reclamar la migración de forma atómica: si dos dispositivos lo
    //    intentan a la vez, solo uno lo consigue.
    const claim = await client.from("app_meta")
      .update({ config_state: "configured", last_modified: Date.now() })
      .eq("id", "singleton").eq("config_state", "pristine").select("id");
    if (claim.error) throw claim.error;
    if (!claim.data || !claim.data.length) return { ok: false, reason: "otro-dispositivo-ya-migro" };

    // 3) Subir los datos locales. Cotizaciones/leads/actividad ya recibidos
    //    se CONSERVAN (unión por id): el historial del público nunca se pierde.
    try {
      const local = normalizeStore(raw);
      LOG_KEYS.forEach((k) => { local[k] = unionById(local[k], current.store[k]); });
      local.meta = Object.assign({}, local.meta, { lastModified: Date.now(), configState: "configured" });
      this._cache = local;
      this._lastSynced = current.synced;
      this._version += 1;
      this._touchPending = true;
      this._dirty = true;
      const r = await this._enqueue();
      if (!r.ok) throw r.error;
    } catch (err) {
      // Deshacer el "reclamo" para poder reintentar; la base sigue con lo que tenía.
      try { await client.from("app_meta").update({ config_state: "pristine" }).eq("id", "singleton"); } catch (e2) { /* ignorar */ }
      await this.reload({ admin: true });
      throw err;
    }
    localStorage.setItem(MIGRATION_DONE_KEY, "1"); // los datos locales NO se borran
    await this.reload({ admin: true });
    return { ok: true, migrated: true };
  },
};

/* ============================================================
   auditLogService — Historial de cambios (Admin → Actividad).
   ------------------------------------------------------------
   Registra cambios de precios, batería, desperfectos, valoración,
   capacidades y modelos, con el valor anterior y el nuevo. Lo usan
   internamente catalogService/batteryService/damageService/
   modeloService/capacidadService/valuationBackupService — nunca
   hace falta llamarlo a mano desde afuera de services.js.
   ============================================================ */
const auditLogService = {
  getAll() {
    return StorageService.loadStore().auditLog.slice().sort((a, b) => b.fecha - a.fecha);
  },
  record(data) {
    const store = StorageService.loadStore();
    const item = {
      id: "log_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      fecha: Date.now(),
      accion: (data && data.accion) || "",
      entidad: (data && data.entidad) || "",
      valorAnterior: data && data.valorAnterior !== undefined ? data.valorAnterior : null,
      valorNuevo: data && data.valorNuevo !== undefined ? data.valorNuevo : null,
    };
    store.auditLog = store.auditLog || [];
    store.auditLog.push(item);
    StorageService.saveStore(store); // es una edición real del admin -> sí actualiza "última modificación"
    return item;
  },
};

/* ============================================================
   catalogService — CATÁLOGO DE VENTA (Admin → Precios).
   ------------------------------------------------------------
   Exclusivo del Paso 5 ("¿vas a comprar otro equipo?"). Este
   servicio no tiene ningún método para el Paso 1 — el Paso 1 usa
   modeloService (ver más abajo), 100% independiente de este
   catálogo.
   ============================================================ */
const catalogService = {
  getAll() {
    return StorageService.loadStore().catalog.slice();
  },
  // Lo único que puede ofrecerse para comprar: publicado Y con stock.
  // "estado" y "stock" son dos campos independientes a propósito —
  // un producto puede estar publicado pero momentáneamente sin stock.
  getForSale() {
    return this.getAll().filter((m) => m.estado === "published" && !!m.stock);
  },
  getById(id) {
    return this.getAll().find((m) => m.id === id) || null;
  },
  // Solo se aceptan links http(s) para la foto (nada de javascript:, data:, etc.).
  _cleanImageUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    return /^https?:\/\//i.test(u) && u.length <= 500 ? u : null;
  },
  create(data) {
    const store = StorageService.loadStore();
    const item = {
      id: (data && data.id) || uid("m_"),
      nombre: String((data && data.nombre) || "").trim().slice(0, 120) || "Nuevo equipo",
      precioBaseUSD: clampUSD(data && data.precioBaseUSD),
      stock: data && data.stock ? 1 : 0,
      estado: ["published", "out", "draft"].includes(data && data.estado) ? data.estado : "draft",
      imagenUrl: this._cleanImageUrl(data && data.imagenUrl) || "",
      detalle: String((data && data.detalle) || "").trim().slice(0, 160),
    };
    store.catalog.push(item);
    StorageService.saveStore(store);
    return item;
  },
  update(id, patch) {
    const store = StorageService.loadStore();
    const item = store.catalog.find((m) => m.id === id);
    if (!item) return null;
    if (patch.nombre !== undefined) {
      const nombre = String(patch.nombre).trim().slice(0, 120);
      if (nombre) item.nombre = nombre; // un nombre vacío se ignora: conserva el anterior
    }
    // auditLogService.record() hace su propio ciclo independiente de
    // loadStore()+saveStore(): el cambio de precio se GUARDA primero y se
    // REGISTRA en el log después de saveStore(store).
    let cambioPrecio = null;
    if (patch.precioBaseUSD !== undefined) {
      const anterior = item.precioBaseUSD;
      item.precioBaseUSD = clampUSD(patch.precioBaseUSD);
      if (anterior !== item.precioBaseUSD) cambioPrecio = { anterior, nuevo: item.precioBaseUSD };
    }
    if (patch.stock !== undefined) item.stock = patch.stock ? 1 : 0;
    if (patch.estado !== undefined && ["published", "out", "draft"].includes(patch.estado)) item.estado = patch.estado;
    if (patch.imagenUrl !== undefined) {
      const limpia = this._cleanImageUrl(patch.imagenUrl);
      if (limpia !== null) item.imagenUrl = limpia; // una URL inválida se ignora
    }
    if (patch.detalle !== undefined) item.detalle = String(patch.detalle).trim().slice(0, 160);
    StorageService.saveStore(store);
    if (cambioPrecio) {
      auditLogService.record({ accion: "Cambio de precio (venta)", entidad: item.nombre, valorAnterior: cambioPrecio.anterior, valorNuevo: cambioPrecio.nuevo });
    }
    return item;
  },
  remove(id) {
    const store = StorageService.loadStore();
    const item = store.catalog.find((m) => m.id === id);
    store.catalog = store.catalog.filter((m) => m.id !== id);
    StorageService.saveStore(store);
    if (item) auditLogService.record({ accion: "Eliminar equipo de venta", entidad: item.nombre, valorAnterior: item.precioBaseUSD, valorNuevo: null });
  },
};

/* ============================================================
   modeloService — IDENTIDAD ADMINISTRABLE de modelos de CANJE
   (Admin → Valoración / Paso 1).
   ------------------------------------------------------------
   Reemplaza a la vieja lista fija STATIC_CONFIG.modelosCanje
   (eliminada de config.js): ahora los modelos se CREAN, RENOMBRAN
   y ELIMINAN desde Admin, viven en el STORE, y son la ÚNICA fuente
   de la que lee el Paso 1 del cotizador. Si se crea un modelo,
   aparece solo en el Paso 1; si se elimina, desaparece solo (junto
   con sus valoraciones, para no dejar datos huérfanos).
   Cada modelo también sabe qué capacidades tiene asociadas
   (capacidadIds) — ver toggleCapacidad().
   ============================================================ */
const modeloService = {
  getAll() {
    return StorageService.loadStore().modelos.slice();
  },
  getById(id) {
    return this.getAll().find((m) => m.id === id) || null;
  },
  // Lo que ve el CLIENTE en el Paso 1: solo modelos que tienen al menos
  // una capacidad activa con precio cargado (mayor a 0). Un modelo sin
  // precios no se ofrece, para no mostrar nunca "USD 0".
  getPublic() {
    const activas = capacidadService.getActive();
    return this.getAll().filter((m) => activas.some((c) => (m.capacidadIds || []).includes(c.id) && valuationService.hasPrice(m.id, c.id)));
  },
  _nombreDuplicado(nombre, excludeId) {
    const n = String(nombre).trim().toLowerCase();
    return this.getAll().some((m) => m.id !== excludeId && m.nombre.trim().toLowerCase() === n);
  },
  _nombreUnico(base) {
    let n = base;
    let i = 1;
    while (this._nombreDuplicado(n, null)) {
      i += 1;
      n = base + " (" + i + ")";
    }
    return n;
  },
  // data.nombre es OPCIONAL: si no se pasa (ej. botón "+ Agregar
  // modelo"), se genera un nombre único automáticamente para que la
  // creación nunca falle por duplicado. Si SÍ se pasa un nombre
  // explícito y ya existe, se rechaza con un mensaje claro (Fase 8).
  create(data) {
    const nombreDeseado = String((data && data.nombre) || "").trim().slice(0, 120);
    if (nombreDeseado && this._nombreDuplicado(nombreDeseado, null)) {
      return { ok: false, error: "Ya existe un modelo con ese nombre." };
    }
    const nombre = nombreDeseado || this._nombreUnico("Nuevo modelo");
    const store = StorageService.loadStore();
    const item = {
      id: (data && data.id) || ("m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
      nombre,
      capacidadIds: Array.isArray(data && data.capacidadIds) ? data.capacidadIds.slice() : [],
    };
    store.modelos.push(item);
    StorageService.saveStore(store);
    auditLogService.record({ accion: "Crear modelo", entidad: item.nombre, valorAnterior: null, valorNuevo: item.nombre });
    return { ok: true, item };
  },
  // Único punto de edición de campos simples (por ahora solo
  // "nombre"; capacidadIds se maneja con toggleCapacidad()).
  update(id, patch) {
    const store = StorageService.loadStore();
    const item = store.modelos.find((m) => m.id === id);
    if (!item) return { ok: false, error: "Modelo no encontrado." };
    if (patch.nombre !== undefined) {
      const nombre = String(patch.nombre).trim().slice(0, 120);
      if (!nombre) return { ok: false, error: "El nombre del modelo no puede estar vacío." };
      if (this._nombreDuplicado(nombre, id)) return { ok: false, error: "Ya existe un modelo con ese nombre." };
      const anterior = item.nombre;
      item.nombre = nombre;
      // Mantener sincronizado el nombre "cacheado" en cada valoración de este modelo.
      store.valoraciones.forEach((v) => { if (v.modeloId === id) v.modeloNombre = nombre; });
      StorageService.saveStore(store);
      if (anterior !== nombre) {
        auditLogService.record({ accion: "Renombrar modelo", entidad: nombre, valorAnterior: anterior, valorNuevo: nombre });
      }
      return { ok: true, item };
    }
    StorageService.saveStore(store);
    return { ok: true, item };
  },
  // Asocia o desasocia una capacidad de un modelo (Fase 4). Si se
  // QUITA una capacidad que ya tenía valor cargado, esa valoración
  // puntual se elimina (ya no tiene sentido: el Paso 2 no la va a
  // ofrecer más para ese modelo).
  toggleCapacidad(id, capacidadId) {
    const store = StorageService.loadStore();
    const item = store.modelos.find((m) => m.id === id);
    if (!item) return { ok: false, error: "Modelo no encontrado." };
    item.capacidadIds = item.capacidadIds || [];
    const yaAsociada = item.capacidadIds.includes(capacidadId);
    item.capacidadIds = yaAsociada
      ? item.capacidadIds.filter((c) => c !== capacidadId)
      : item.capacidadIds.concat([capacidadId]);
    if (yaAsociada) {
      store.valoraciones = store.valoraciones.filter((v) => !(v.modeloId === id && v.capacidadId === capacidadId));
    }
    StorageService.saveStore(store);
    const capacidad = capacidadService.getById(capacidadId);
    const nombreCapacidad = (capacidad && capacidad.nombre) || capacidadId;
    auditLogService.record({
      accion: yaAsociada ? "Quitar capacidad de modelo" : "Asociar capacidad a modelo",
      entidad: item.nombre + " — " + nombreCapacidad,
      valorAnterior: yaAsociada ? "asociada" : "sin asociar",
      valorNuevo: yaAsociada ? "sin asociar" : "asociada",
    });
    return { ok: true, item };
  },
  remove(id) {
    const store = StorageService.loadStore();
    const item = store.modelos.find((m) => m.id === id);
    if (!item) return { ok: false, error: "Modelo no encontrado." };
    store.modelos = store.modelos.filter((m) => m.id !== id);
    store.valoraciones = store.valoraciones.filter((v) => v.modeloId !== id);
    StorageService.saveStore(store);
    auditLogService.record({ accion: "Eliminar modelo", entidad: item.nombre, valorAnterior: item.nombre, valorNuevo: null });
    return { ok: true };
  },
};

/* ============================================================
   capacidadService — CATÁLOGO ADMINISTRABLE DE CAPACIDADES
   (Admin → Capacidades).
   ------------------------------------------------------------
   Reemplaza a la vieja lista fija STATIC_CONFIG.capacidades. Se
   pueden crear, renombrar, activar/desactivar y eliminar. Al
   eliminar una capacidad se la quita de todos los modelos que la
   tuvieran asociada y se borran sus valoraciones (para no dejar
   datos huérfanos apuntando a una capacidad que ya no existe).
   ============================================================ */
const capacidadService = {
  getAll() {
    return StorageService.loadStore().capacidades.slice();
  },
  // Las únicas que debe ofrecer el Paso 2 del cotizador al cliente.
  getActive() {
    return this.getAll().filter((c) => c.activo !== false);
  },
  // Lo que ve el CLIENTE en el Paso 2 para un modelo: capacidades activas,
  // asociadas a ese modelo y con precio cargado.
  getForModelo(modeloId) {
    const modelo = modeloService.getById(modeloId);
    if (!modelo) return [];
    return this.getActive().filter((c) => (modelo.capacidadIds || []).includes(c.id) && valuationService.hasPrice(modeloId, c.id));
  },
  getById(id) {
    return this.getAll().find((c) => c.id === id) || null;
  },
  _nombreDuplicado(nombre, excludeId) {
    const n = String(nombre).trim().toLowerCase();
    return this.getAll().some((c) => c.id !== excludeId && c.nombre.trim().toLowerCase() === n);
  },
  _nombreUnico(base) {
    let n = base;
    let i = 1;
    while (this._nombreDuplicado(n, null)) {
      i += 1;
      n = base + " (" + i + ")";
    }
    return n;
  },
  create(data) {
    const nombreDeseado = String((data && data.nombre) || "").trim().slice(0, 60);
    if (nombreDeseado && this._nombreDuplicado(nombreDeseado, null)) {
      return { ok: false, error: "Ya existe una capacidad con ese nombre." };
    }
    const nombre = nombreDeseado || this._nombreUnico("Nueva capacidad");
    const store = StorageService.loadStore();
    const item = {
      id: (data && data.id) || ("cap_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
      nombre,
      activo: data && data.activo !== undefined ? !!data.activo : true,
    };
    store.capacidades.push(item);
    StorageService.saveStore(store);
    auditLogService.record({ accion: "Crear capacidad", entidad: item.nombre, valorAnterior: null, valorNuevo: item.nombre });
    return { ok: true, item };
  },
  update(id, patch) {
    const store = StorageService.loadStore();
    const item = store.capacidades.find((c) => c.id === id);
    if (!item) return { ok: false, error: "Capacidad no encontrada." };
    // Igual que en catalogService.update: se guarda TODO primero con
    // StorageService.saveStore(store) y las entradas de auditoría se
    // registran DESPUÉS, para que el saveStore final de este método no
    // pise (sobreescriba) lo que auditLogService.record() ya guardó.
    let cambioNombre = null;
    if (patch.nombre !== undefined) {
      const nombre = String(patch.nombre).trim().slice(0, 60);
      if (!nombre) return { ok: false, error: "El nombre de la capacidad no puede estar vacío." };
      if (this._nombreDuplicado(nombre, id)) return { ok: false, error: "Ya existe una capacidad con ese nombre." };
      const anterior = item.nombre;
      item.nombre = nombre;
      store.valoraciones.forEach((v) => { if (v.capacidadId === id) v.capacidadNombre = nombre; });
      if (anterior !== nombre) cambioNombre = { anterior, nuevo: nombre };
    }
    let cambioActivo = null;
    if (patch.activo !== undefined) {
      const nuevoActivo = !!patch.activo;
      const anterior = item.activo !== false;
      item.activo = nuevoActivo;
      if (anterior !== nuevoActivo) cambioActivo = { anterior, nuevo: nuevoActivo };
    }
    StorageService.saveStore(store);
    if (cambioNombre) {
      auditLogService.record({ accion: "Renombrar capacidad", entidad: cambioNombre.nuevo, valorAnterior: cambioNombre.anterior, valorNuevo: cambioNombre.nuevo });
    }
    if (cambioActivo) {
      auditLogService.record({ accion: cambioActivo.nuevo ? "Activar capacidad" : "Desactivar capacidad", entidad: item.nombre, valorAnterior: cambioActivo.anterior, valorNuevo: cambioActivo.nuevo });
    }
    return { ok: true, item };
  },
  remove(id) {
    const store = StorageService.loadStore();
    const item = store.capacidades.find((c) => c.id === id);
    if (!item) return { ok: false, error: "Capacidad no encontrada." };
    store.capacidades = store.capacidades.filter((c) => c.id !== id);
    store.modelos.forEach((m) => { m.capacidadIds = (m.capacidadIds || []).filter((cid) => cid !== id); });
    store.valoraciones = store.valoraciones.filter((v) => v.capacidadId !== id);
    StorageService.saveStore(store);
    auditLogService.record({ accion: "Eliminar capacidad", entidad: item.nombre, valorAnterior: item.nombre, valorNuevo: null });
    return { ok: true };
  },
};

/* ============================================================
   valuationService — VALORACIÓN (Admin → Valoración).
   ------------------------------------------------------------
   Un valor de canje en USD por cada combinación modelo × capacidad,
   SIN multiplicadores ni factores — cada fila es un número
   independiente y 100% editable. Persistido en el STORE bajo
   "valoraciones". La identidad de modelo/capacidad viene siempre de
   modeloService/capacidadService (nunca de una lista fija).
   ============================================================ */
const valuationService = {
  getAll() {
    return StorageService.loadStore().valoraciones.slice();
  },
  getById(id) {
    return this.getAll().find((v) => v.id === id) || null;
  },
  // El corazón de Valoración: busca el valor de un modelo+capacidad
  // puntual. Devuelve null si esa combinación no está cargada (el
  // administrador la borró, o nunca existió) — pricingService debe
  // manejar ese caso sin romperse (ver más abajo).
  getValue(modeloId, capacidadId) {
    return this.getAll().find((v) => v.modeloId === modeloId && v.capacidadId === capacidadId) || null;
  },
  // Todas las capacidades cargadas para un modelo puntual (útil para
  // saber, en Admin, qué combinaciones ya existen y cuáles faltan).
  getByModelo(modeloId) {
    return this.getAll().filter((v) => v.modeloId === modeloId);
  },
  // ¿Esa combinación tiene un precio usable para el público? (cargada y mayor a 0)
  hasPrice(modeloId, capacidadId) {
    const v = this.getValue(modeloId, capacidadId);
    return !!v && Number(v.valorUSD) > 0;
  },
  create(data) {
    const store = StorageService.loadStore();
    const modeloId = data.modeloId;
    const capacidadId = data.capacidadId;
    // No permitir dos valoraciones para la misma combinación modelo+capacidad.
    const yaExiste = store.valoraciones.some((v) => v.modeloId === modeloId && v.capacidadId === capacidadId);
    if (yaExiste) return null;
    const modelo = modeloService.getById(modeloId);
    const capacidad = capacidadService.getById(capacidadId);
    const item = {
      id: data.id || ("tv_" + modeloId + "_" + capacidadId + "_" + Date.now()),
      modeloId,
      modeloNombre: (modelo && modelo.nombre) || data.modeloNombre || "",
      capacidadId,
      capacidadNombre: (capacidad && capacidad.nombre) || data.capacidadNombre || "",
      valorUSD: clampUSD(data.valorUSD),
    };
    store.valoraciones.push(item);
    StorageService.saveStore(store);
    auditLogService.record({ accion: "Cargar valoración", entidad: item.modeloNombre + " — " + item.capacidadNombre, valorAnterior: null, valorNuevo: item.valorUSD });
    return item;
  },
  update(id, patch) {
    const store = StorageService.loadStore();
    const item = store.valoraciones.find((v) => v.id === id);
    if (!item) return null;
    // Guardar primero, registrar en el log después (ver nota en
    // catalogService.update más arriba: evita que este saveStore pise
    // la entrada de auditoría).
    let cambio = null;
    if (patch.valorUSD !== undefined) {
      const anterior = item.valorUSD;
      item.valorUSD = clampUSD(patch.valorUSD);
      if (anterior !== item.valorUSD) cambio = { anterior, nuevo: item.valorUSD };
    }
    StorageService.saveStore(store);
    if (cambio) {
      auditLogService.record({ accion: "Cambio de valoración", entidad: item.modeloNombre + " — " + item.capacidadNombre, valorAnterior: cambio.anterior, valorNuevo: cambio.nuevo });
    }
    return item;
  },
  remove(id) {
    const store = StorageService.loadStore();
    const item = store.valoraciones.find((v) => v.id === id);
    store.valoraciones = store.valoraciones.filter((v) => v.id !== id);
    StorageService.saveStore(store);
    if (item) {
      auditLogService.record({ accion: "Eliminar valoración", entidad: item.modeloNombre + " — " + item.capacidadNombre, valorAnterior: item.valorUSD, valorNuevo: null });
    }
  },
};

/* ============================================================
   batteryService — reglas de descuento por salud de batería
   ============================================================ */
const batteryService = {
  getAll() {
    // Se muestran ordenadas de mayor a menor rango, es más fácil de leer.
    return StorageService.loadStore().bateria.slice().sort((a, b) => b.porcentajeMinimo - a.porcentajeMinimo);
  },
  getById(id) {
    return this.getAll().find((b) => b.id === id) || null;
  },
  _pct(n) {
    return Math.round(Math.max(0, Math.min(100, Number(n) || 0)));
  },
  create(data) {
    const store = StorageService.loadStore();
    const min = this._pct(data.porcentajeMinimo);
    const max = Math.max(min, this._pct(data.porcentajeMaximo));
    const item = {
      id: data.id || uid("b_"),
      porcentajeMinimo: min,
      porcentajeMaximo: max,
      descuentoUSD: clampUSD(data.descuentoUSD),
      label: String(data.label || "Nuevo rango").trim().slice(0, 80) || "Nuevo rango",
      desc: String(data.desc || "").trim().slice(0, 120),
    };
    store.bateria.push(item);
    StorageService.saveStore(store);
    return item;
  },
  update(id, patch) {
    const store = StorageService.loadStore();
    const item = store.bateria.find((b) => b.id === id);
    if (!item) return null;
    // El mínimo nunca puede quedar por encima del máximo (la base lo rechazaría).
    if (patch.porcentajeMinimo !== undefined) {
      item.porcentajeMinimo = this._pct(patch.porcentajeMinimo);
      if (item.porcentajeMaximo < item.porcentajeMinimo) item.porcentajeMaximo = item.porcentajeMinimo;
    }
    if (patch.porcentajeMaximo !== undefined) {
      item.porcentajeMaximo = this._pct(patch.porcentajeMaximo);
      if (item.porcentajeMinimo > item.porcentajeMaximo) item.porcentajeMinimo = item.porcentajeMaximo;
    }
    // Guardar primero, registrar en el log después (ver catalogService.update).
    let cambio = null;
    if (patch.descuentoUSD !== undefined) {
      const anterior = item.descuentoUSD;
      item.descuentoUSD = clampUSD(patch.descuentoUSD);
      if (anterior !== item.descuentoUSD) cambio = { anterior, nuevo: item.descuentoUSD };
    }
    if (patch.label !== undefined) {
      const label = String(patch.label).trim().slice(0, 80);
      if (label) item.label = label;
    }
    if (patch.desc !== undefined) item.desc = String(patch.desc).trim().slice(0, 120);
    StorageService.saveStore(store);
    if (cambio) {
      auditLogService.record({ accion: "Cambio de batería", entidad: item.label, valorAnterior: cambio.anterior, valorNuevo: cambio.nuevo });
    }
    return item;
  },
  remove(id) {
    const store = StorageService.loadStore();
    const item = store.bateria.find((b) => b.id === id);
    store.bateria = store.bateria.filter((b) => b.id !== id);
    StorageService.saveStore(store);
    if (item) auditLogService.record({ accion: "Eliminar regla de batería", entidad: item.label, valorAnterior: item.descuentoUSD, valorNuevo: null });
  },
  // Avisos para el administrador: rangos que se pisan o porcentajes sin cubrir.
  // No bloquea nada: el cliente elige una regla a mano, pero conviene que
  // los rangos sean coherentes.
  validateRanges() {
    const reglas = this.getAll().slice().sort((a, b) => a.porcentajeMinimo - b.porcentajeMinimo);
    const avisos = [];
    for (let i = 1; i < reglas.length; i += 1) {
      const prev = reglas[i - 1];
      const cur = reglas[i];
      if (cur.porcentajeMinimo <= prev.porcentajeMaximo) {
        avisos.push("«" + prev.label + "» y «" + cur.label + "» se superponen.");
      } else if (cur.porcentajeMinimo > prev.porcentajeMaximo + 1) {
        avisos.push("Entre «" + prev.label + "» y «" + cur.label + "» hay porcentajes sin cubrir (" + (prev.porcentajeMaximo + 1) + "% a " + (cur.porcentajeMinimo - 1) + "%).");
      }
    }
    if (reglas.length && reglas[0].porcentajeMinimo > 0) avisos.push("No hay ninguna regla para baterías por debajo de " + reglas[0].porcentajeMinimo + "%.");
    if (reglas.length && reglas[reglas.length - 1].porcentajeMaximo < 100) avisos.push("No hay ninguna regla para baterías por encima de " + reglas[reglas.length - 1].porcentajeMaximo + "%.");
    return avisos;
  },
};

/* ============================================================
   damageService — desperfectos del equipo
   ============================================================ */
const damageService = {
  getAll() {
    return StorageService.loadStore().desperfectos.slice();
  },
  // Lo único que debe pintarse en el paso 4 del cotizador.
  getActive() {
    return this.getAll().filter((d) => d.activo !== false);
  },
  getById(id) {
    return this.getAll().find((d) => d.id === id) || null;
  },
  create(data) {
    const store = StorageService.loadStore();
    const item = {
      id: data.id || uid("d_"),
      nombre: String(data.nombre || "Nuevo desperfecto").trim().slice(0, 120) || "Nuevo desperfecto",
      descripcion: String(data.descripcion || "").trim().slice(0, 300),
      descuentoUSD: clampUSD(data.descuentoUSD),
      activo: data.activo !== undefined ? !!data.activo : true,
    };
    store.desperfectos.push(item);
    StorageService.saveStore(store);
    return item;
  },
  update(id, patch) {
    const store = StorageService.loadStore();
    const item = store.desperfectos.find((d) => d.id === id);
    if (!item) return null;
    if (patch.nombre !== undefined) {
      const nombre = String(patch.nombre).trim().slice(0, 120);
      if (nombre) item.nombre = nombre; // vacío: conserva el anterior
    }
    if (patch.descripcion !== undefined) item.descripcion = String(patch.descripcion).trim().slice(0, 300);
    // Guardar primero, registrar en el log después (ver catalogService.update).
    let cambio = null;
    if (patch.descuentoUSD !== undefined) {
      const anterior = item.descuentoUSD;
      item.descuentoUSD = clampUSD(patch.descuentoUSD);
      if (anterior !== item.descuentoUSD) cambio = { anterior, nuevo: item.descuentoUSD };
    }
    if (patch.activo !== undefined) item.activo = !!patch.activo;
    StorageService.saveStore(store);
    if (cambio) {
      auditLogService.record({ accion: "Cambio de desperfecto", entidad: item.nombre, valorAnterior: cambio.anterior, valorNuevo: cambio.nuevo });
    }
    return item;
  },
  remove(id) {
    const store = StorageService.loadStore();
    const item = store.desperfectos.find((d) => d.id === id);
    store.desperfectos = store.desperfectos.filter((d) => d.id !== id);
    StorageService.saveStore(store);
    if (item) auditLogService.record({ accion: "Eliminar desperfecto", entidad: item.nombre, valorAnterior: item.descuentoUSD, valorNuevo: null });
  },
};

/* ============================================================
   contactService — datos de contacto centralizados
   ============================================================ */
const contactService = {
  get() {
    return Object.assign({}, StorageService.loadStore().contact);
  },
  // Devuelve { ok, contact } o { ok:false, error }. El WhatsApp se guarda
  // solo con dígitos (código de país incluido, sin +, espacios ni guiones).
  update(patch) {
    const clean = Object.assign({}, patch);
    const limites = { businessName: 80, phone: 40, whatsapp: 20, instagram: 80, address: 160, hours: 160 };
    Object.keys(clean).forEach((k) => {
      if (!(k in limites)) { delete clean[k]; return; }
      clean[k] = String(clean[k] == null ? "" : clean[k]).trim().slice(0, limites[k]);
    });
    if ("whatsapp" in clean) {
      clean.whatsapp = clean.whatsapp.replace(/\D/g, "");
      if (clean.whatsapp && (clean.whatsapp.length < 8 || clean.whatsapp.length > 15)) {
        return { ok: false, error: "El WhatsApp debe tener entre 8 y 15 números, con código de país (ej. 5491112345678)." };
      }
    }
    if ("businessName" in clean && !clean.businessName) {
      return { ok: false, error: "El nombre del negocio no puede quedar vacío." };
    }
    const store = StorageService.loadStore();
    store.contact = Object.assign({}, store.contact, clean);
    StorageService.saveStore(store);
    return { ok: true, contact: Object.assign({}, store.contact) };
  },
};

/* ============================================================
   pricingService — TODO el cálculo de la cotización, en USD
   ============================================================
   Fórmula:
     precioBaseUSD            = valor cargado en Admin → Valoración
                                 para ese (modelo, capacidad) exacto.
                                 SIN multiplicadores ni factores.
     descuentoBateriaUSD      = monto fijo de la regla de batería elegida
     descuentoDesperfectosUSD = suma de los desperfectos tildados (solo activos)
     valorFinalUSD            = precioBaseUSD - descuentoBateriaUSD - descuentoDesperfectosUSD (mínimo 0)
*/
const pricingService = {
  getCapacidad(id) {
    return capacidadService.getAll().find((c) => c.id === id) || null;
  },
  getColor(id) {
    return STATIC_CONFIG.colores.find((c) => c.id === id) || null;
  },
  calculateQuote({ modeloId, capacidadId, bateriaId, desperfectoIds }) {
    // La IDENTIDAD del modelo/capacidad viene siempre de modeloService
    // y capacidadService (Admin → Valoración / Admin → Capacidades);
    // el VALOR viene siempre de valuationService — nunca de un factor.
    const modelo = modeloService.getById(modeloId);
    const capacidad = this.getCapacidad(capacidadId);
    if (!modelo || !capacidad) return null;

    const valoracion = valuationService.getValue(modeloId, capacidadId);
    // Si el administrador borró esa combinación puntual de Valoración,
    // no rompemos la cotización: se toma como 0 (equipo "a consultar")
    // en vez de tirar un error. valoracionEncontrada permite a la UI
    // (si algún día lo necesita) distinguir "vale 0" de "no cargado".
    const precioBaseUSD = valoracion ? round2(valoracion.valorUSD) : 0;

    const bateria = bateriaId ? batteryService.getById(bateriaId) : null;
    // Una regla de batería que ya no existe invalida la cotización (no se
    // asume "sin descuento", que inflaría el valor).
    if (bateriaId && !bateria) return null;
    const descuentoBateriaUSD = bateria ? round2(Number(bateria.descuentoUSD) || 0) : 0;

    const activos = damageService.getActive();
    const descuentoDesperfectosUSD = round2((desperfectoIds || []).reduce((acc, id) => {
      const d = activos.find((x) => x.id === id);
      return acc + (d ? Number(d.descuentoUSD) || 0 : 0);
    }, 0));

    const valorFinalUSD = Math.max(0, round2(precioBaseUSD - descuentoBateriaUSD - descuentoDesperfectosUSD));

    return { precioBaseUSD, descuentoBateriaUSD, descuentoDesperfectosUSD, valorFinalUSD, valoracionEncontrada: !!valoracion };
  },
  formatUSD(n) {
    const num = Math.round(Number(n) || 0);
    return "USD " + num.toLocaleString("es-AR");
  },
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/* ============================================================
   quotesHistoryService — Historial de cotizaciones (Admin → Historial).
   ------------------------------------------------------------
   El cotizador público registra cada cotización con una INSERCIÓN
   directa (el visitante no puede leer, modificar ni borrar nada: solo
   insertar, ver supabase_schema.sql). Si no hay red, queda en una cola
   local y se reenvía sola cuando vuelve la conexión.
   ============================================================ */
const quotesHistoryService = {
  getAll() {
    return StorageService.loadStore().quotesHistory.slice().sort((a, b) => b.fecha - a.fecha);
  },
  record(data) {
    const d = data || {};
    const item = {
      id: uid("qh_"),
      fecha: Date.now(),
      modeloId: String(d.modeloId || "").slice(0, 80),
      modeloNombre: String(d.modeloNombre || "").slice(0, 120),
      capacidadId: String(d.capacidadId || "").slice(0, 80),
      capacidadNombre: String(d.capacidadNombre || "").slice(0, 60),
      valorBaseUSD: round2(clampUSD(d.valorBaseUSD)),
      descuentoBateriaUSD: round2(clampUSD(d.descuentoBateriaUSD)),
      descuentoDesperfectosUSD: round2(clampUSD(d.descuentoDesperfectosUSD)),
      valorFinalUSD: round2(clampUSD(d.valorFinalUSD)),
      color: String(d.color || "").slice(0, 40),
      bateriaLabel: String(d.bateriaLabel || "").slice(0, 80),
      desperfectos: (Array.isArray(d.desperfectos) ? d.desperfectos : []).map((x) => String(x).slice(0, 60)).slice(0, 12),
    };
    StorageService.insertRow("quotesHistory", item);
    return item;
  },
  remove(id) {
    const store = StorageService.loadStore();
    store.quotesHistory = store.quotesHistory.filter((q) => q.id !== id);
    StorageService.saveStore(store, { touch: false });
  },
};

/* ============================================================
   leadsService — Leads generados por el cotizador (Admin → Leads).
   ------------------------------------------------------------
   Se registra un lead cuando el cliente toca "Consultar por WhatsApp".
   Nombre y WhatsApp del cliente son OPCIONALES (campos del Paso 5).
   ============================================================ */
const leadsService = {
  getAll() {
    return StorageService.loadStore().leads.slice().sort((a, b) => b.fecha - a.fecha);
  },
  record(data) {
    const d = data || {};
    const item = {
      id: uid("lead_"),
      fecha: Date.now(),
      nombre: String(d.nombre || "").trim().slice(0, 80),
      whatsapp: String(d.whatsapp || "").replace(/\D/g, "").slice(0, 20),
      modeloId: String(d.modeloId || "").slice(0, 80),
      modeloNombre: String(d.modeloNombre || "").slice(0, 120),
      resultadoUSD: round2(clampUSD(d.resultadoUSD)),
      capacidadNombre: String(d.capacidadNombre || "").slice(0, 60),
      productoCompraNombre: String(d.productoCompraNombre || "").slice(0, 120),
      diferenciaUSD: d.diferenciaUSD === null || d.diferenciaUSD === undefined ? null : round2(clampUSD(d.diferenciaUSD)),
      quoteId: String(d.quoteId || "").slice(0, 80),
    };
    StorageService.insertRow("leads", item);
    return item;
  },
  remove(id) {
    const store = StorageService.loadStore();
    store.leads = store.leads.filter((l) => l.id !== id);
    StorageService.saveStore(store, { touch: false });
  },
};

/* ============================================================
   valuationBackupService — exportar/importar SOLO Valoración
   (modelos + capacidades + valoraciones). Más chico que el backup
   completo: sirve para llevar la lista de precios a otra instalación.
   ============================================================ */
const valuationBackupService = {
  exportJSON() {
    const store = StorageService.loadStore();
    const payload = {
      tipo: "appletech-valoraciones",
      version: 1,
      exportadoEl: new Date().toISOString(),
      modelos: store.modelos,
      capacidades: store.capacidades,
      valoraciones: store.valoraciones,
    };
    return JSON.stringify(payload, null, 2);
  },
  importJSON(jsonText) {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      return { ok: false, error: "El archivo no es un JSON válido." };
    }
    if (!parsed || !Array.isArray(parsed.modelos) || !Array.isArray(parsed.capacidades) || !Array.isArray(parsed.valoraciones)) {
      return { ok: false, error: "El archivo no tiene el formato esperado (modelos/capacidades/valoraciones)." };
    }
    const store = StorageService.loadStore();
    const candidato = Object.assign({}, store, { modelos: parsed.modelos, capacidades: parsed.capacidades, valoraciones: parsed.valoraciones });
    const problems = validateStoreShape(candidato);
    if (problems.length) return { ok: false, error: "Archivo inválido: " + problems.join(" ") };
    const normalized = normalizeStore(candidato);
    StorageService.saveStore(normalized, { touch: true });
    auditLogService.record({
      accion: "Importar valoraciones",
      entidad: "Modelos, capacidades y valores",
      valorAnterior: null,
      valorNuevo: normalized.modelos.length + " modelos, " + normalized.capacidades.length + " capacidades, " + normalized.valoraciones.length + " valores",
    });
    return { ok: true };
  },
};

/* ============================================================
   authService — Supabase Auth + verificación de ADMINISTRADOR
   ============================================================
   Tener una cuenta en Supabase Auth NO alcanza para entrar al panel: el
   usuario además tiene que estar en la tabla public.admins (se consulta
   con la función is_admin()). Las políticas RLS aplican la misma regla
   del lado del servidor, así que aunque alguien manipule esta página,
   no puede escribir nada.

   verify(email, pass) devuelve { ok:true } o { ok:false, reason, message }
   con reason: "invalid" | "network" | "not-admin" | "no-client".
*/
const authService = {
  _client() {
    return (typeof window !== "undefined" && window.supabaseClient) || null;
  },

  /* ¿El usuario de la sesión actual es administrador? */
  async checkAdmin() {
    const client = this._client();
    if (!client) return false;
    const ok = await StorageService._detectAdmin(client);
    StorageService.setAdmin(ok);
    return ok;
  },

  /* Se llama una vez al arrancar admin.html. Devuelve "admin" (sesión
     válida de administrador), "not-admin" (sesión de alguien sin permiso)
     o "none" (hay que mostrar el login). */
  async init() {
    const client = this._client();
    if (!client) return "none";
    try {
      // Avisos de cambios de sesión (vencida, cerrada en otra pestaña,
      // link de recuperación de contraseña). Los handlers se difieren
      // para no bloquear al SDK de Supabase.
      client.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          setTimeout(() => { if (typeof window.__appletechOnRecovery === "function") window.__appletechOnRecovery(); }, 0);
        } else if (event === "SIGNED_OUT" || (!session && event !== "INITIAL_SESSION")) {
          StorageService.setAdmin(false);
          setTimeout(() => { if (typeof window.__appletechOnLoggedOut === "function") window.__appletechOnLoggedOut("signed-out"); }, 0);
        }
      });
      const { data, error } = await client.auth.getSession();
      if (error) { console.warn("authService.init: getSession", error); return "none"; }
      if (!data || !data.session) return "none";
      return (await this.checkAdmin()) ? "admin" : "not-admin";
    } catch (err) {
      console.warn("authService.init: fallo inesperado", err);
      return "none";
    }
  },

  async getUsername() {
    const client = this._client();
    if (!client) return DEFAULT_ADMIN_USER;
    try {
      const { data } = await client.auth.getUser();
      return (data && data.user && data.user.email) || DEFAULT_ADMIN_USER;
    } catch (err) {
      return DEFAULT_ADMIN_USER;
    }
  },

  async verify(email, pass) {
    const client = this._client();
    if (!client) return { ok: false, reason: "no-client", message: "No hay conexión con Supabase. Revisá la configuración y tu internet." };
    let res;
    try {
      res = await client.auth.signInWithPassword({ email: String(email).trim(), password: String(pass) });
    } catch (err) {
      return { ok: false, reason: "network", message: "No se pudo conectar con Supabase. Revisá tu internet e intentá de nuevo." };
    }
    if (res.error) {
      const d = describeError(res.error);
      if (d.kind === "network") return { ok: false, reason: "network", message: d.text };
      return { ok: false, reason: "invalid", message: "Email o contraseña incorrectos." };
    }
    if (!res.data || !res.data.session) return { ok: false, reason: "invalid", message: "Email o contraseña incorrectos." };
    const isAdmin = await this.checkAdmin();
    if (!isAdmin) {
      try { await client.auth.signOut(); } catch (err) { /* ignorar */ }
      return { ok: false, reason: "not-admin", message: "Esta cuenta existe pero no tiene permiso de administrador." };
    }
    return { ok: true };
  },

  /* Cambia email y/o contraseña del admin logueado. Con newPass vacío no
     se toca la contraseña. Supabase puede pedir confirmar el cambio de
     email por correo (según la configuración del proyecto). */
  async changeCredentials(newUser, newPass) {
    const client = this._client();
    if (!client) return { ok: false, error: "Sin conexión a Supabase." };
    const patch = {};
    if (newUser) patch.email = newUser;
    if (newPass) patch.password = newPass;
    const { data, error } = await client.auth.updateUser(patch);
    if (error) return { ok: false, error: error.message || "No se pudo actualizar." };
    return { ok: true, user: data && data.user && data.user.email };
  },

  /* Nueva contraseña desde el link de recuperación (sesión de recuperación activa). */
  async updatePassword(newPass) {
    const client = this._client();
    if (!client) return { ok: false, error: "Sin conexión a Supabase." };
    const { error } = await client.auth.updateUser({ password: newPass });
    if (error) return { ok: false, error: error.message || "No se pudo cambiar la contraseña." };
    return { ok: true };
  },

  /* Envía el email para restablecer la contraseña. El link vuelve a
     admin.html (hay que agregar esa URL en Supabase -> Authentication ->
     URL Configuration -> Redirect URLs). */
  async sendPasswordReset(email) {
    const client = this._client();
    if (!client || !email) return { ok: false, error: "Falta el email." };
    const options = {};
    if (typeof window !== "undefined" && window.location && /^https?:/.test(window.location.protocol)) {
      options.redirectTo = window.location.origin + window.location.pathname;
    }
    const { error } = await client.auth.resetPasswordForEmail(String(email).trim(), options);
    if (error) return { ok: false, error: error.message || "No se pudo enviar el email." };
    return { ok: true };
  },

  async endSession() {
    const client = this._client();
    StorageService.setAdmin(false);
    if (!client) return;
    try { await client.auth.signOut(); } catch (err) { console.warn("authService.endSession", err); }
  },
};

/* ============================================================
   backupService — exportar / importar / cargar datos de ejemplo
   ============================================================
   - El backup NO incluye usuarios ni contraseñas.
   - IMPORTAR reemplaza la CONFIGURACIÓN (catálogo, modelos, capacidades,
     valoraciones, desperfectos, batería, contacto) pero NUNCA borra
     cotizaciones, leads ni actividad que ya existan: se combinan por id.
   - RESTAURAR DATOS DE EJEMPLO también conserva todo ese historial.
*/
const backupService = {
  exportJSON() {
    const store = StorageService.loadStore();
    return JSON.stringify({ tipo: "appletech-backup", version: 3, exportadoEl: new Date().toISOString(), store }, null, 2);
  },

  /* Backup COMPLETO: trae TODAS las cotizaciones/leads/actividad de la
     base (no solo las más recientes que muestra el panel). */
  async exportFullJSON() {
    const store = Object.assign({}, StorageService.loadStore());
    const logs = await StorageService.fetchFullLogs();
    if (logs) LOG_KEYS.forEach((k) => { store[k] = logs[k]; });
    return JSON.stringify({ tipo: "appletech-backup", version: 3, exportadoEl: new Date().toISOString(), store }, null, 2);
  },

  importJSON(jsonText) {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      return { ok: false, error: "El archivo no es un JSON válido." };
    }
    const rawStore = parsed && parsed.store ? parsed.store : parsed;
    // Backups de la versión anterior (sin "modelos"/"capacidades") también se aceptan.
    const problems = validateStoreShape(rawStore, { legacy: true });
    if (problems.length) return { ok: false, error: "No se importó nada. " + problems.join(" ") };
    const normalized = normalizeStore(rawStore);
    const actual = StorageService.loadStore();
    LOG_KEYS.forEach((k) => { normalized[k] = unionById(normalized[k], actual[k]); });
    StorageService.saveStore(normalized, { touch: true });
    auditLogService.record({ accion: "Importar backup", entidad: "Configuración completa", valorAnterior: null, valorNuevo: normalized.modelos.length + " modelos, " + normalized.valoraciones.length + " valores, " + normalized.catalog.length + " equipos" });
    return { ok: true };
  },

  /* Vuelve la CONFIGURACIÓN a los datos de ejemplo de config.js. No toca
     cotizaciones, leads ni actividad. */
  restoreFactoryDefaults() {
    const actual = StorageService.loadStore();
    const fresh = defaultStore();
    LOG_KEYS.forEach((k) => { fresh[k] = (actual[k] || []).slice(); });
    fresh.meta = Object.assign({}, actual.meta, fresh.meta, { lastModified: actual.meta && actual.meta.lastModified, configState: (actual.meta && actual.meta.configState) || "pristine" });
    StorageService.saveStore(fresh, { touch: true });
    auditLogService.record({ accion: "Cargar datos de ejemplo", entidad: "Configuración completa", valorAnterior: null, valorNuevo: null });
    return StorageService.loadStore();
  },

  /* ¿La base está vacía (nadie cargó modelos todavía)? */
  isEmpty() {
    const s = StorageService.loadStore();
    return !s.modelos.length && !s.valoraciones.length && !s.catalog.length;
  },
};
