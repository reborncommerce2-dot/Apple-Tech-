/*
  Puente para pruebas de navegador: el Supabase FALSO (con RLS) vive en
  Node y las páginas lo usan a través de un cliente "remoto" que reemplaza
  al script del CDN de supabase-js. Dos contextos de Playwright = dos
  dispositivos distintos contra la MISMA base.
*/
const CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

const PAGE_STUB = `
(function () {
  let seq = 0;
  const authCbs = {}; const chans = {};
  window.__sbAuthEvent = (id, ev, sess) => { (authCbs[id] || []).forEach((cb) => { try { cb(ev, sess); } catch (e) { console.error(e); } }); };
  window.__sbRealtime = (id, chanId, table) => { const ch = chans[chanId]; if (ch) ch.handlers.filter((h) => h.table === table).forEach((h) => h.cb({ table })); };
  const call = (msg) => window.__sbCall(msg);
  function Q(id, table) { this.id = id; this.table = table; this.op = "select"; this.filters = []; this.ret = false; this.payload = null; this.opts = null; this.ord = null; this.lim = null; this.rng = null; }
  Q.prototype.select = function () { this.ret = true; return this; };
  Q.prototype.insert = function (r) { this.op = "insert"; this.payload = r; return this; };
  Q.prototype.upsert = function (r, o) { this.op = "upsert"; this.payload = r; this.opts = o || null; return this; };
  Q.prototype.update = function (p) { this.op = "update"; this.payload = p; return this; };
  Q.prototype.delete = function () { this.op = "delete"; return this; };
  Q.prototype.eq = function (c, v) { this.filters.push({ t: "eq", c, v }); return this; };
  Q.prototype.in = function (c, v) { this.filters.push({ t: "in", c, v }); return this; };
  Q.prototype.order = function (c, o) { this.ord = { c, o: o || null }; return this; };
  Q.prototype.limit = function (n) { this.lim = n; return this; };
  Q.prototype.range = function (a, b) { this.rng = [a, b]; return this; };
  Q.prototype.then = function (res, rej) {
    return call({ t: "query", id: this.id, spec: { table: this.table, op: this.op, filters: this.filters, ret: this.ret, payload: this.payload, opts: this.opts, ord: this.ord, lim: this.lim, rng: this.rng } }).then(res, rej);
  };
  window.supabase = { createClient: function () {
    const id = "c" + (++seq) + "_" + Math.random().toString(36).slice(2);
    const auth = {};
    ["signUp", "signInWithPassword", "signOut", "getSession", "getUser", "updateUser", "resetPasswordForEmail"].forEach((m) => { auth[m] = (...a) => call({ t: "auth", id, m, a }); });
    auth.onAuthStateChange = (cb) => { (authCbs[id] = authCbs[id] || []).push(cb); call({ t: "authSub", id }); return { data: { subscription: { unsubscribe() {} } } }; };
    return {
      from: (t) => new Q(id, t),
      rpc: (name) => call({ t: "rpc", id, name }),
      auth,
      channel(name) {
        const chanId = id + "_" + name + "_" + (++seq);
        const ch = { handlers: [], chanId };
        chans[chanId] = ch;
        const api = {
          on(_t, f, cb) { ch.handlers.push({ table: f.table, cb }); return api; },
          subscribe() { call({ t: "chan", id, chanId, tables: ch.handlers.map((h) => h.table) }); return api; },
          _chanId: chanId,
        };
        return api;
      },
      removeChannel(api) { delete chans[api._chanId]; return call({ t: "rmchan", id, chanId: api._chanId }); },
    };
  } };
})();
`;

function installBridge(context, backend) {
  const storage = (() => { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; } }; })();
  const clients = new Map();
  const chans = new Map();
  const bridge = { clients, backend, calls: 0 };

  context.route(CDN, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: PAGE_STUB }));

  context.exposeBinding("__sbCall", async ({ page }, msg) => {
    bridge.calls += 1;
    let client = clients.get(msg.id);
    if (!client) { client = backend.createClient({ storage }); clients.set(msg.id, client); }
    const push = (fn, args) => page.evaluate(fn, args).catch(() => {});
    if (msg.t === "query") {
      const s = msg.spec;
      let q = client.from(s.table);
      if (s.op === "select") q = q.select("*");
      else if (s.op === "insert") q = q.insert(s.payload);
      else if (s.op === "upsert") q = q.upsert(s.payload, s.opts || undefined);
      else if (s.op === "update") q = q.update(s.payload);
      else if (s.op === "delete") q = q.delete();
      s.filters.forEach((f) => { q = f.t === "eq" ? q.eq(f.c, f.v) : q.in(f.c, f.v); });
      if (s.op !== "select" && s.ret) q = q.select("id");
      if (s.ord) q = q.order(s.ord.c, s.ord.o || undefined);
      if (s.lim !== null) q = q.limit(s.lim);
      if (s.rng) q = q.range(s.rng[0], s.rng[1]);
      return JSON.parse(JSON.stringify(await q));
    }
    if (msg.t === "auth") return JSON.parse(JSON.stringify(await client.auth[msg.m](...msg.a)));
    if (msg.t === "rpc") return await client.rpc(msg.name);
    if (msg.t === "authSub") {
      if (!client.__sub) {
        client.__sub = true;
        client.auth.onAuthStateChange((ev, sess) => push(([id, e, s]) => window.__sbAuthEvent && window.__sbAuthEvent(id, e, s), [msg.id, ev, sess]));
      }
      return null;
    }
    if (msg.t === "chan") {
      const ch = client.channel(msg.chanId);
      msg.tables.forEach((table) => ch.on("postgres_changes", { table }, () => push(([id, c, t]) => window.__sbRealtime && window.__sbRealtime(id, c, t), [msg.id, msg.chanId, table])));
      ch.subscribe();
      chans.set(msg.chanId, ch);
      return null;
    }
    if (msg.t === "rmchan") { const ch = chans.get(msg.chanId); if (ch) client.removeChannel(ch); chans.delete(msg.chanId); return "ok"; }
    return null;
  });

  bridge.expireSessions = () => clients.forEach((c) => c.auth._expire());
  bridge.recover = (email) => clients.forEach((c) => c.auth._recover(email));
  return bridge;
}
module.exports = { installBridge };
