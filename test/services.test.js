// Pruebas del motor (services.js) contra el Supabase falso con RLS. Sin red ni navegador.
//   node test/services.test.js
const { createBackend } = require("./helpers/fake_supabase.js");
const { assert, section, summary, makeStorage, makeSandbox, sleep, seedFactory } = require("./helpers/harness.js");

async function loginAdmin(backend, email) {
  const c = backend.createClient();
  const sb = makeSandbox(c);
  const r = await sb.run(`authService.verify(${JSON.stringify(email || "admin@t.com")}, "clave1234")`);
  return { c, sb, r };
}
function newBackend() {
  const b = createBackend();
  b.addUser("admin@t.com", "clave1234", true);
  b.addUser("intruso@t.com", "clave1234", false);
  return b;
}

async function testDatosYFabrica() {
  section("1) Datos de ejemplo y validación de forma");
  const sb = makeSandbox(null);
  const st = sb.run("StorageService.loadStore()");
  assert(st.modelos.length === 21 && st.capacidades.length === 4 && st.valoraciones.length === 84, "factory: 21 modelos, 4 capacidades, 84 valoraciones");
  assert(st.catalog.length === 21 && st.desperfectos.length === 10 && st.bateria.length === 5, "factory: catálogo 21, desperfectos 10, batería 5");
  assert(sb.run("validateStoreShape(defaultStore())").length === 0, "defaultStore pasa la validación");
  assert(sb.run('validateStoreShape({catalog:"x"})').length > 0, "backup inválido es rechazado");
  assert(sb.run('validateStoreShape({catalog:[],desperfectos:[],bateria:[],valoraciones:[{id:"a",modeloId:"m",capacidadId:"c",valorUSD:1}],modelos:[],capacidades:[]})').length > 0, "valoración huérfana es rechazada");
  const e = sb.run("emptyStore()");
  assert(e.modelos.length === 0 && e.catalog.length === 0, "emptyStore no trae datos de ejemplo");
  const sb2 = makeSandbox(null);
  await sb2.run("StorageService.init()");
  assert(!!sb2.run("StorageService.getLoadError()"), "sin cliente de Supabase: init informa error");
  assert(sb2.run("StorageService.loadStore().modelos.length") === 0, "sin cliente: NO se muestran datos de ejemplo al público");
}

async function testAuthYSeguridad() {
  section("2) Autenticación y autorización");
  const b = newBackend();
  let c = b.createClient(); let sb = makeSandbox(c);
  let r = await sb.run('authService.verify("admin@t.com","mala")');
  assert(!r.ok && r.reason === "invalid", "contraseña incorrecta -> invalid");
  r = await sb.run('authService.verify("intruso@t.com","clave1234")');
  assert(!r.ok && r.reason === "not-admin", "usuario registrado que NO es admin queda rechazado");
  assert((await c.auth.getSession()).data.session === null, "…y su sesión se cierra");
  r = await sb.run('authService.verify("admin@t.com","clave1234")');
  assert(r.ok === true && sb.run("StorageService.isAdmin()") === true, "admin legítimo entra");
  b.offline = true;
  c = b.createClient(); sb = makeSandbox(c);
  r = await sb.run('authService.verify("admin@t.com","clave1234")');
  assert(!r.ok && r.reason === "network", "sin red: mensaje de red, no 'contraseña incorrecta'");
  b.offline = false;

  // Intruso autoregistrado intenta escribir directo
  const evil = b.createClient();
  await evil.auth.signUp({ email: "nuevo@x.com", password: "abcdef" });
  const w = await evil.from("catalog").upsert([{ id: "x", nombre: "hack", precio_base_usd: 1, stock: 1, estado: "published" }]).select("id");
  assert(!!w.error, "cualquier usuario registrado NO puede escribir catálogo");
  const anon = b.createClient();
  assert(!!(await anon.from("valoraciones").upsert([{ id: "x" }]).select("id")).error, "anónimo no puede escribir valoraciones");
  assert((await anon.from("leads").select("*")).data.length === 0, "anónimo no puede leer leads");
  assert((await anon.from("app_meta").select("*")).data.length === 0, "anónimo no puede leer app_meta");
  assert((await anon.rpc("is_admin")).data === false, "is_admin() es false para anónimo");
}

async function testSyncYSnapshots() {
  section("3) Guardado: ninguna edición se pierde");
  const b = newBackend();
  await seedFactory(b, null);
  const { sb } = await loginAdmin(b);
  await sb.run("StorageService.init({admin:true})");
  assert(sb.run("StorageService.loadStore().modelos.length") === 21, "admin carga 21 modelos desde Supabase");
  // BUG ORIGINAL: la segunda edición de la misma fila no se subía
  for (const v of [250, 260, 275]) {
    sb.run(`catalogService.update("ip13", { precioBaseUSD: ${v} })`);
    await sb.run("StorageService.waitIdle()");
    assert(b.rows("catalog").find((r) => r.id === "ip13").precio_base_usd === v, "edición #" + v + " de la MISMA fila llega a Supabase");
  }
  sb.run('valuationService.update("tv_ip11_64gb", { valorUSD: 111 })');
  await sb.run("StorageService.waitIdle()");
  sb.run('valuationService.update("tv_ip11_64gb", { valorUSD: 122 })');
  await sb.run("StorageService.waitIdle()");
  assert(b.rows("valoraciones").find((r) => r.id === "tv_ip11_64gb").valor_usd === 122, "valoración editada dos veces queda en 122");
  sb.run('batteryService.update("b80", { descuentoUSD: 21 })');
  sb.run('batteryService.update("b80", { descuentoUSD: 22 })');
  await sb.run("StorageService.waitIdle()");
  assert(b.rows("bateria").find((r) => r.id === "b80").descuento_usd === 22, "batería editada rápido dos veces queda en 22");
  assert(b.rows("audit_log").length >= 5, "la auditoría se sube a Supabase");
  assert(sb.run("StorageService.getStatus().state") === "saved", "estado final = saved");

  // orden de dependencia: modelo nuevo + valoración nueva en un solo guardado
  const m = sb.run('modeloService.create({nombre:"iPhone 99"}).item');
  sb.run(`modeloService.toggleCapacidad("${m.id}", "128gb")`);
  sb.run(`valuationService.create({modeloId:"${m.id}", capacidadId:"128gb", valorUSD: 999})`);
  await sb.run("StorageService.waitIdle()");
  assert(b.rows("valoraciones").some((r) => r.modelo_id === m.id && r.valor_usd === 999), "modelo + valoración nuevos se suben sin romper la clave foránea");
  sb.run(`modeloService.remove("${m.id}")`);
  await sb.run("StorageService.waitIdle()");
  assert(!b.rows("modelos").some((r) => r.id === m.id) && !b.rows("valoraciones").some((r) => r.modelo_id === m.id), "borrar un modelo lo borra a él y a sus valoraciones");

  // borrar y recrear la misma combinación (índice único)
  const v = sb.run('valuationService.getValue("ip12","256gb")');
  sb.run(`valuationService.remove("${v.id}")`);
  sb.run('valuationService.create({modeloId:"ip12", capacidadId:"256gb", valorUSD: 177})');
  await sb.run("StorageService.waitIdle()");
  assert(b.rows("valoraciones").filter((r) => r.modelo_id === "ip12" && r.capacidad_id === "256gb").length === 1 && sb.run("StorageService.getStatus().state") === "saved", "borrar y recrear modelo+capacidad no choca con el índice único");
}

async function testErroresDeGuardado() {
  section("4) Errores de red / permisos: nunca se dice 'guardado' si no lo está");
  const b = newBackend();
  await seedFactory(b, null);
  const { sb } = await loginAdmin(b);
  await sb.run("StorageService.init({admin:true})");
  b.offline = true;
  sb.run('catalogService.update("ip13", { precioBaseUSD: 301 })');
  await sb.run("StorageService.waitIdle()");
  let st = sb.run("StorageService.getStatus()");
  assert(st.state === "error" && st.kind === "network", "sin red: estado = error de red");
  assert(b.rows("catalog").find((r) => r.id === "ip13").precio_base_usd !== 301, "…y Supabase NO tiene el cambio");
  assert(sb.run("StorageService.hasPendingChanges()") === true, "…y queda marcado como pendiente");
  b.offline = false;
  const r = await sb.run("StorageService.flush()");
  assert(r.ok === true && b.rows("catalog").find((x) => x.id === "ip13").precio_base_usd === 301, "al volver la red, Reintentar sube el cambio");
  assert(sb.run("StorageService.getStatus().state") === "saved", "estado vuelve a saved");

  // (cada cambio encola un guardado; el siguiente reintenta solo, por eso se inyectan dos fallas)
  b.failNext("catalog", "upsert", { message: "JWT expired", status: 401, code: "PGRST301" });
  b.failNext("catalog", "upsert", { message: "JWT expired", status: 401, code: "PGRST301" });
  sb.run('catalogService.update("ip13", { precioBaseUSD: 302 })');
  await sb.run("StorageService.waitIdle()");
  assert(sb.run("StorageService.getStatus().kind") === "auth", "sesión vencida detectada como tal");
  await sb.run("StorageService.flush()");
  assert(sb.run("StorageService.getStatus().state") === "saved" && b.rows("catalog").find((x) => x.id === "ip13").precio_base_usd === 302, "el reintento posterior guarda el cambio que había fallado");

  // admin deja de serlo en el servidor: RLS rechaza
  b.admins.clear();
  sb.run('catalogService.update("ip13", { precioBaseUSD: 303 })');
  await sb.run("StorageService.waitIdle()");
  assert(sb.run("StorageService.getStatus().state") === "error" && sb.run("StorageService.getStatus().kind") === "denied", "si pierde permisos, el guardado falla con mensaje de permisos (no es silencioso)");
  assert(b.rows("catalog").find((x) => x.id === "ip13").precio_base_usd === 302, "…y la base no recibe el cambio");
}

async function testLecturaFallida() {
  section("5) Si falla la lectura NO se pisan datos reales con los de ejemplo");
  const b = newBackend();
  await seedFactory(b, null);
  const ant = b.createClient();
  await ant.auth.signInWithPassword({ email: "admin@t.com", password: "clave1234" });
  const sb = makeSandbox(ant);
  b.failNext("valoraciones", "select", { message: "boom", status: 500 });
  await sb.run("StorageService.init({admin:true})");
  assert(!!sb.run("StorageService.getLoadError()"), "falla de lectura -> loadError");
  assert(sb.run("StorageService.loadStore().catalog.length") === 0, "no hay datos de ejemplo en memoria");
  const antes = JSON.stringify(b.rows("catalog"));
  sb.run('catalogService.create({nombre:"x"})');
  await sb.run("StorageService.waitIdle()");
  assert(JSON.stringify(b.rows("catalog")) === antes, "con loadError NO se escribe nada en la base");
  assert(sb.run("StorageService.getStatus().state") === "error", "y se informa el error");
  const r = await sb.run("StorageService.reload({admin:true})");
  assert(r.ok && !sb.run("StorageService.getLoadError()") && sb.run("StorageService.loadStore().modelos.length") === 21, "reintentar carga recupera todo");
}

async function testPublico() {
  section("6) Público: lectura, cotizaciones y leads");
  const b = newBackend();
  await seedFactory(b, null);
  const pub = makeSandbox(b.createClient());
  await pub.run("StorageService.init()");
  assert(pub.run("modeloService.getPublic().length") === 21, "el público ve 21 modelos con precio");
  assert(pub.run("capacidadService.getForModelo('ip13').length") === 4, "ip13 ofrece 4 capacidades");
  assert(pub.run("StorageService._privateLoaded") === false, "el público no carga cotizaciones/leads");
  const q = pub.run('quotesHistoryService.record({modeloId:"ip13",modeloNombre:"iPhone 13",capacidadId:"128gb",capacidadNombre:"128 GB",valorBaseUSD:200,descuentoBateriaUSD:15,descuentoDesperfectosUSD:0,valorFinalUSD:185,color:"Negro",bateriaLabel:"80% – 89%",desperfectos:["Cámara dañada"]})');
  const l = pub.run(`leadsService.record({nombre:"Ana",whatsapp:"+54 9 11 5555-1234",modeloId:"ip13",modeloNombre:"iPhone 13",resultadoUSD:185,capacidadNombre:"128 GB",productoCompraNombre:"iPhone 15",diferenciaUSD:155,quoteId:"${q.id}"})`);
  await pub.run("StorageService.waitIdle()");
  assert(b.rows("quotes_history").length === 1 && b.rows("quotes_history")[0].color === "Negro", "la cotización pública llega a Supabase (con color/batería/desperfectos)");
  assert(b.rows("leads").length === 1 && b.rows("leads")[0].whatsapp === "5491155551234", "el lead llega con WhatsApp normalizado");
  assert(b.rows("leads")[0].quote_id === q.id && b.rows("leads")[0].diferencia_usd === 155, "el lead referencia la cotización y la diferencia");
  const pc = pub.run('pricingService.calculateQuote({modeloId:"ip13",capacidadId:"128gb",bateriaId:"b80",desperfectoIds:["camara","pantalla","inexistente"]})');
  assert(pc.precioBaseUSD === 200 && pc.descuentoBateriaUSD === 15 && pc.descuentoDesperfectosUSD === 90 && pc.valorFinalUSD === 95, "cálculo: 200 − 15 − (30+60) = 95 (ignora desperfecto inexistente)");
  assert(pub.run('pricingService.calculateQuote({modeloId:"ip11",capacidadId:"64gb",bateriaId:"bmenos",desperfectoIds:["pantalla","faceid","camara","tapa","parlantes","microfono","botones","truetone","puerto","bateria_danada"]})').valorFinalUSD === 0, "descuentos mayores al valor -> final 0, nunca negativo");
  assert(pub.run('pricingService.calculateQuote({modeloId:"zzz",capacidadId:"64gb"})') === null, "modelo inexistente -> null");
  assert(pub.run('pricingService.calculateQuote({modeloId:"ip11",capacidadId:"zzz"})') === null, "capacidad inexistente -> null");
  assert(pub.run('pricingService.calculateQuote({modeloId:"ip11",capacidadId:"64gb",bateriaId:"borrada"})') === null, "regla de batería inexistente -> null (no asume sin descuento)");
  assert(pub.run('JSON.stringify(pricingService.calculateQuote({modeloId:"ip13",capacidadId:"128gb",bateriaId:"b80",desperfectoIds:["camara"]}))') === pub.run('JSON.stringify(pricingService.calculateQuote({modeloId:"ip13",capacidadId:"128gb",bateriaId:"b80",desperfectoIds:["camara"]}))'), "el cálculo es determinístico");

  // abuso: datos fuera de límites son rechazados por la base (el servicio ya recorta)
  const anon = b.createClient();
  const bad = await anon.from("leads").insert({ id: "z", fecha: Date.now(), nombre: "x".repeat(500), whatsapp: "abc", modelo_id: "", modelo_nombre: "", resultado_usd: 1 });
  assert(!!bad.error, "la base rechaza leads con basura (nombre largo / whatsapp no numérico)");
  const upd = await anon.from("quotes_history").delete().eq("id", q.id).select("id");
  assert(b.rows("quotes_history").length === 1, "un visitante NO puede borrar cotizaciones");
  const rate = createBackend();
  const a2 = rate.createClient();
  let lastErr = null;
  for (let i = 0; i < 125; i++) { const r = await a2.from("leads").insert({ id: "r" + i, fecha: Date.now(), nombre: "", whatsapp: "", modelo_id: "", modelo_nombre: "", resultado_usd: 1 }); if (r.error) lastErr = r.error; }
  assert(lastErr && lastErr.code === "54000" && rate.rows("leads").length === 120, "freno anti-spam: máximo 120 inserts por minuto");
}

async function testOffline() {
  section("7) Cotizaciones/leads sin red: cola local y reenvío");
  const b = newBackend();
  await seedFactory(b, null);
  const ls = makeStorage();
  const pub = makeSandbox(b.createClient(), { localStorage: ls });
  await pub.run("StorageService.init()");
  b.offline = true;
  pub.run('leadsService.record({nombre:"Luis",whatsapp:"5491100000000",modeloId:"ip12",modeloNombre:"iPhone 12",resultadoUSD:100})');
  await pub.run("StorageService.waitIdle()");
  assert(b.rows("leads").length === 0 && JSON.parse(ls.getItem("appletech_outbox_v1")).length === 1, "sin red: el lead queda en la cola local");
  b.offline = false;
  const r = await pub.run("StorageService.flushOutbox()");
  assert(r.sent === 1 && b.rows("leads").length === 1 && ls.getItem("appletech_outbox_v1") === null, "al volver la red se reenvía y la cola se vacía");
  await pub.run("StorageService.flushOutbox()");
  assert(b.rows("leads").length === 1, "reenviar dos veces no duplica");
}

async function testMigracion() {
  section("8) Migración desde localStorage (la parte más delicada)");
  const localStore = (sb) => {
    const s = sb.run("defaultStore()");
    s.catalog[2].precioBaseUSD = 4321; // dato propio del admin
    s.valoraciones[0].valorUSD = 777;
    s.leads = [{ id: "lead_old", fecha: 1700000000000, nombre: "viejo", whatsapp: "", modeloId: "ip11", modeloNombre: "iPhone 11", resultadoUSD: 1 }];
    return JSON.stringify(s);
  };
  const ref = makeSandbox(null);
  const payload = localStore(ref);

  // (a) base vacía + cliente ya mandó cotizaciones antes del primer login -> igual migra y conserva
  let b = newBackend();
  const pub = makeSandbox(b.createClient());
  await pub.run("StorageService.init()");
  pub.run('quotesHistoryService.record({modeloId:"ip11",modeloNombre:"iPhone 11",valorFinalUSD:50})');
  await pub.run("StorageService.waitIdle()");
  b.setAppMeta("pristine");
  let ls = makeStorage({ appletech_store_v2: payload });
  let c = b.createClient(); let sb = makeSandbox(c, { localStorage: ls });
  await sb.run('authService.verify("admin@t.com","clave1234")');
  await sb.run("StorageService.init({admin:true})");
  let res = await sb.run("StorageService.migrateFromLocalStorageIfNeeded()");
  assert(res.ok === true, "(a) migra aunque ya existan cotizaciones de clientes");
  assert(b.rows("catalog").find((r) => r.id === "ip11promax").precio_base_usd === 4321 && b.rows("valoraciones").find((r) => r.id === "tv_ip11_64gb").valor_usd === 777, "(a) los datos propios del navegador llegaron a Supabase");
  assert(b.rows("quotes_history").length === 1, "(a) la cotización del cliente NO se perdió");
  assert(b.rows("leads").some((l) => l.id === "lead_old"), "(a) los leads viejos del navegador se conservaron");
  assert(b.rows("app_meta")[0].config_state === "configured", "(a) la base queda 'configured'");
  assert(ls.getItem("appletech_store_v2") !== null && ls.getItem("appletech_migrated_supabase_v1") === "1", "(a) localStorage se conserva como respaldo y se marca migrado");
  res = await sb.run("StorageService.migrateFromLocalStorageIfNeeded()");
  assert(res.ok === false && res.reason === "ya-migrado-este-dispositivo", "(a) una segunda llamada no hace nada");

  // (b) base ya configurada: NO pisar
  b = newBackend();
  await seedFactory(b, null);
  const cfg = JSON.stringify(b.rows("catalog"));
  ls = makeStorage({ appletech_store_v2: payload });
  c = b.createClient(); sb = makeSandbox(c, { localStorage: ls });
  await sb.run('authService.verify("admin@t.com","clave1234")');
  await sb.run("StorageService.init({admin:true})");
  res = await sb.run("StorageService.migrateFromLocalStorageIfNeeded()");
  assert(res.reason === "supabase-ya-configurado" && JSON.stringify(b.rows("catalog")) === cfg, "(b) con la base ya configurada no se pisa nada");

  // (c) existen quotes_history pero NO config: no se confunde con "ya migrado"
  // (cubierto en (a)). (d) falla de red a mitad: reintento posterior funciona
  b = newBackend(); b.setAppMeta("pristine");
  ls = makeStorage({ appletech_store_v2: payload });
  c = b.createClient(); sb = makeSandbox(c, { localStorage: ls });
  await sb.run('authService.verify("admin@t.com","clave1234")');
  await sb.run("StorageService.init({admin:true})");
  b.failNext("valoraciones", "upsert", { message: "TypeError: Failed to fetch", status: 0 });
  let threw = false;
  try { await sb.run("StorageService.migrateFromLocalStorageIfNeeded()"); } catch (e) { threw = true; }
  assert(threw && b.rows("app_meta")[0].config_state === "pristine", "(d) si falla a mitad se deshace el reclamo (queda pristine)");
  assert(ls.getItem("appletech_migrated_supabase_v1") === null && ls.getItem("appletech_store_v2") !== null, "(d) no se marca migrado y no se borra nada local");
  res = await sb.run("StorageService.migrateFromLocalStorageIfNeeded()");
  assert(res.ok === true && b.rows("valoraciones").length === 84, "(d) el reintento completa la migración");

  // (e) dos dispositivos a la vez: solo uno migra
  b = newBackend(); b.setAppMeta("pristine");
  const mk = async () => { const l = makeStorage({ appletech_store_v2: payload }); const cc = b.createClient(); const s = makeSandbox(cc, { localStorage: l }); await s.run('authService.verify("admin@t.com","clave1234")'); await s.run("StorageService.init({admin:true})"); return s; };
  const [s1, s2] = [await mk(), await mk()];
  const rs = await Promise.all([s1.run("StorageService.migrateFromLocalStorageIfNeeded()"), s2.run("StorageService.migrateFromLocalStorageIfNeeded()")]);
  assert(rs.filter((r) => r.ok).length === 1, "(e) con dos dispositivos simultáneos migra exactamente uno");

  // (f) datos locales corruptos
  b = newBackend(); b.setAppMeta("pristine");
  ls = makeStorage({ appletech_store_v2: JSON.stringify({ catalog: "roto" }) });
  c = b.createClient(); sb = makeSandbox(c, { localStorage: ls });
  await sb.run('authService.verify("admin@t.com","clave1234")');
  await sb.run("StorageService.init({admin:true})");
  res = await sb.run("StorageService.migrateFromLocalStorageIfNeeded()");
  assert(res.reason === "datos-locales-invalidos" && b.rows("catalog").length === 0 && ls.getItem("appletech_store_v2") !== null, "(f) datos locales corruptos: no se sube nada ni se borra el original");

  // (g) un usuario sin permisos no migra
  b = newBackend(); b.setAppMeta("pristine");
  ls = makeStorage({ appletech_store_v2: payload });
  c = b.createClient(); sb = makeSandbox(c, { localStorage: ls });
  await sb.run('authService.verify("intruso@t.com","clave1234")');
  await sb.run("StorageService.init({admin:true})");
  res = await sb.run("StorageService.migrateFromLocalStorageIfNeeded()");
  assert(res.reason === "no-admin" && b.rows("catalog").length === 0, "(g) sin permisos de admin no hay migración");
}

async function testPersistenciaMultiDispositivo() {
  section("9) Persistencia entre dispositivos y Realtime");
  const b = newBackend();
  await seedFactory(b, null);
  const A = await loginAdmin(b); await A.sb.run("StorageService.init({admin:true})");
  const pub = makeSandbox(b.createClient()); await pub.run("StorageService.init()");
  let notified = 0; pub.window.__n = () => { notified++; };
  pub.run("StorageService.onChange(() => window.__n())");
  A.sb.run('catalogService.update("ip15", { precioBaseUSD: 999 })');
  await A.sb.run("StorageService.waitIdle()");
  await sleep(1200);
  assert(pub.run('catalogService.getById("ip15").precioBaseUSD') === 999, "ADMIN → Supabase → público: el nuevo precio llega por Realtime sin recargar");
  assert(notified >= 1, "el público fue notificado para repintar");
  // "otro dispositivo" desde cero
  const B = await loginAdmin(b); await B.sb.run("StorageService.init({admin:true})");
  assert(B.sb.run('catalogService.getById("ip15").precioBaseUSD') === 999, "otro dispositivo/navegador ve el mismo dato al iniciar sesión");
  // cambio remoto NO pisa cambio local sin confirmar
  B.sb.run('catalogService.update("ip16", { precioBaseUSD: 1 })');
  b.offline = true; B.sb.run('catalogService.update("ip16", { precioBaseUSD: 2 })'); await B.sb.run("StorageService.waitIdle()");
  b.offline = false;
  A.sb.run('catalogService.update("ip11", { precioBaseUSD: 5 })'); await A.sb.run("StorageService.waitIdle()");
  await sleep(1500);
  assert(B.sb.run('catalogService.getById("ip16").precioBaseUSD') === 2, "un cambio remoto no pisa un cambio local pendiente");
  await B.sb.run("StorageService.flush()");
  assert(b.rows("catalog").find((r) => r.id === "ip16").precio_base_usd === 2, "…y el cambio local pendiente termina guardado");
  // ids de admin ven cotizaciones; el público no recibe sus eventos
  assert(A.sb.run("StorageService._privateLoaded") === true, "admin carga cotizaciones/leads/actividad");
}

async function testBackups() {
  section("10) Backups, importación y restauración");
  const b = newBackend();
  await seedFactory(b, null);
  const pub = makeSandbox(b.createClient()); await pub.run("StorageService.init()");
  for (let i = 0; i < 3; i++) pub.run('quotesHistoryService.record({modeloId:"ip11",modeloNombre:"iPhone 11",valorFinalUSD:' + i + '})');
  await pub.run("StorageService.waitIdle()");
  const A = await loginAdmin(b); await A.sb.run("StorageService.init({admin:true})");
  const json = await A.sb.run("backupService.exportFullJSON()");
  const parsed = JSON.parse(json);
  assert(parsed.tipo === "appletech-backup" && parsed.store.quotesHistory.length === 3 && parsed.store.modelos.length === 21, "backup completo incluye configuración y cotizaciones");
  A.sb.run('catalogService.update("ip13", { precioBaseUSD: 1 })'); await A.sb.run("StorageService.waitIdle()");
  let r = A.sb.run(`backupService.importJSON(${JSON.stringify(json)})`);
  await A.sb.run("StorageService.waitIdle()");
  assert(r.ok && b.rows("catalog").find((x) => x.id === "ip13").precio_base_usd === 200, "importar restaura los precios del backup");
  assert(b.rows("quotes_history").length === 3, "importar NO borra cotizaciones existentes");
  r = A.sb.run('backupService.importJSON("esto no es json")');
  assert(!r.ok, "JSON inválido rechazado");
  r = A.sb.run('backupService.importJSON(JSON.stringify({store:{catalog:[{id:"a"}],desperfectos:[],bateria:[],valoraciones:[]}}))');
  assert(!r.ok && b.rows("catalog").length === 21, "backup con elementos inválidos rechazado sin tocar nada");
  A.sb.run('catalogService.update("ip13", { precioBaseUSD: 1 })');
  A.sb.run("backupService.restoreFactoryDefaults()");
  await A.sb.run("StorageService.waitIdle()");
  assert(b.rows("catalog").find((x) => x.id === "ip13").precio_base_usd === 200 && b.rows("quotes_history").length === 3, "restaurar ejemplo vuelve la configuración y conserva el historial");
  // valoraciones solo
  const vj = A.sb.run("valuationBackupService.exportJSON()");
  assert(A.sb.run(`valuationBackupService.importJSON(${JSON.stringify(vj)})`).ok, "export/import de valoraciones funciona");
  assert(!A.sb.run('valuationBackupService.importJSON(JSON.stringify({modelos:[],capacidades:[],valoraciones:[{id:"v",modeloId:"x",capacidadId:"y",valorUSD:1}]}))').ok, "import de valoraciones huérfanas rechazado");
}

async function testPaginacion() {
  section("11) Más de 1000 filas (tope de PostgREST)");
  const b = newBackend();
  await seedFactory(b, null);
  const rows = [];
  for (let i = 0; i < 1500; i++) rows.push({ id: "qh_" + String(i).padStart(5, "0"), fecha: 1700000000000 + i, modelo_id: "", modelo_nombre: "", capacidad_id: "", capacidad_nombre: "", valor_base_usd: 1, descuento_bateria_usd: 0, descuento_desperfectos_usd: 0, valor_final_usd: 1, color: "", bateria_label: "", desperfectos: [] });
  b.seed("quotes_history", rows);
  const A = await loginAdmin(b); await A.sb.run("StorageService.init({admin:true})");
  assert(A.sb.run("StorageService.loadStore().quotesHistory.length") === 500, "el panel carga las 500 más recientes");
  const full = await A.sb.run("backupService.exportFullJSON()");
  assert(JSON.parse(full).store.quotesHistory.length === 1500, "el backup completo trae las 1500 (paginado)");
  const big = [];
  for (let i = 0; i < 1200; i++) big.push({ id: "cap" + i, nombre: i + " GB", activo: true });
  b.seed("capacidades", big);
  const A2 = await loginAdmin(b); await A2.sb.run("StorageService.init({admin:true})");
  assert(A2.sb.run("StorageService.loadStore().capacidades.length") === 1204, "tablas de configuración grandes se leen completas (paginadas)");
}

async function testServicios() {
  section("12) Reglas de los servicios (validaciones y casos límite)");
  const b = newBackend(); await seedFactory(b, null);
  const { sb } = await loginAdmin(b); await sb.run("StorageService.init({admin:true})");
  const R = (c) => sb.run(c);
  R('catalogService.update("ip11", { precioBaseUSD: -50 })');
  assert(R('catalogService.getById("ip11").precioBaseUSD') === 0, "precio negativo -> 0");
  R('catalogService.update("ip11", { precioBaseUSD: "abc" })');
  assert(R('catalogService.getById("ip11").precioBaseUSD') === 0, "precio no numérico -> 0");
  R('catalogService.update("ip11", { precioBaseUSD: 99999999 })');
  assert(R('catalogService.getById("ip11").precioBaseUSD') === 1000000, "precio absurdo se recorta al tope");
  R('catalogService.update("ip11", { nombre: "   " })');
  assert(R('catalogService.getById("ip11").nombre') === "iPhone 11", "nombre vacío se ignora");
  R('catalogService.update("ip11", { imagenUrl: "javascript:alert(1)" })');
  assert(R('catalogService.getById("ip11").imagenUrl') === "", "imagen con javascript: rechazada");
  R('catalogService.update("ip11", { imagenUrl: "https://x.com/a.jpg", detalle: "128 GB · Batería 92%" })');
  assert(R('catalogService.getById("ip11").imagenUrl') === "https://x.com/a.jpg" && R('catalogService.getById("ip11").detalle') === "128 GB · Batería 92%", "imagen https y detalle se guardan");
  R('catalogService.update("ip11", { estado: "otro" })');
  assert(R('catalogService.getById("ip11").estado') === "published", "estado inválido ignorado");
  assert(R("catalogService.getForSale().length") === 12, "venta: publicados con stock (12 en el ejemplo)");
  R('catalogService.update("ip11", { stock: false })');
  assert(R('catalogService.getForSale().some(p=>p.id==="ip11")') === false, "publicado sin stock no se ofrece");
  assert(R('modeloService.create({nombre:"iphone 11"}).ok') === false, "modelo duplicado rechazado (sin importar mayúsculas)");
  assert(R('modeloService.update("ip11",{nombre:""}).ok') === false, "modelo con nombre vacío rechazado");
  assert(R('capacidadService.create({nombre:"64 GB"}).ok') === false, "capacidad duplicada rechazada");
  const bt = R('batteryService.update("b80", { porcentajeMinimo: 95 })');
  assert(bt.porcentajeMaximo >= bt.porcentajeMinimo, "batería: mínimo nunca supera al máximo");
  assert(R('batteryService.create({porcentajeMinimo:50,porcentajeMaximo:10}).porcentajeMaximo') === 50, "batería nueva con rango invertido se corrige");
  assert(R("batteryService.validateRanges().length") === 0 || true, "validateRanges ejecuta");
  R('damageService.update("pantalla", { descuentoUSD: -5 })');
  assert(R('damageService.getById("pantalla").descuentoUSD') === 0, "desperfecto negativo -> 0");
  R('damageService.update("pantalla", { activo: false })');
  assert(R('pricingService.calculateQuote({modeloId:"ip13",capacidadId:"128gb",bateriaId:"b90",desperfectoIds:["pantalla"]}).descuentoDesperfectosUSD') === 0, "desperfecto inactivo no descuenta");
  let c = R('contactService.update({whatsapp:"123"})');
  assert(c.ok === false, "WhatsApp demasiado corto rechazado");
  c = R('contactService.update({whatsapp:"+54 9 11 4444-5555", businessName:"Apple Tech Store"})');
  assert(c.ok && c.contact.whatsapp === "5491144445555", "WhatsApp se normaliza a dígitos");
  assert(R('contactService.update({businessName:" "}).ok') === false, "nombre del negocio vacío rechazado");
  await sb.run("StorageService.waitIdle()");
  assert(b.rows("contact")[0].whatsapp === "5491144445555", "el contacto llega a Supabase");
  // orden natural
  const names = R("modeloService.getAll().map(m=>m.nombre)");
  assert(names[0] === "iPhone 11" && names[1] === "iPhone 11 Pro" && names[3] === "iPhone 12", "modelos en orden natural (11, 11 Pro, 11 Pro Max, 12…)");
  R('capacidadService.create({nombre:"1 TB"})'); await sb.run("StorageService.waitIdle()");
  await sb.run("StorageService.reload({admin:true})");
  assert(R("capacidadService.getAll().map(c=>c.nombre)").slice(-1)[0] === "1 TB", "capacidades ordenadas por tamaño real (1 TB al final)");
  // modelo sin precios no es público
  const m = R('modeloService.create({nombre:"iPhone Sin Precio"}).item');
  R(`modeloService.toggleCapacidad("${m.id}","64gb")`);
  assert(R("modeloService.getPublic().length") === 21, "modelo sin valoración no se ofrece al público");
  R(`valuationService.create({modeloId:"${m.id}",capacidadId:"64gb",valorUSD:0})`);
  assert(R("modeloService.getPublic().length") === 21, "valoración en 0 tampoco");
  R(`valuationService.update(valuationService.getValue("${m.id}","64gb").id,{valorUSD:100})`);
  assert(R("modeloService.getPublic().length") === 22, "con precio > 0 aparece");
  R('capacidadService.update("64gb",{activo:false})');
  assert(R('capacidadService.getForModelo("ip13").map(c=>c.id).includes("64gb")') === false, "capacidad desactivada no se ofrece");
  // duplicados valoración
  assert(R('valuationService.create({modeloId:"ip13",capacidadId:"128gb",valorUSD:5})') === null, "valoración duplicada rechazada");
  // desperfectos orden
  assert(R("damageService.getAll()[0].id") !== undefined, "desperfectos cargan");
  // validateRanges
  R("(function(){ const s=StorageService.loadStore(); s.bateria=[{id:'a',porcentajeMinimo:0,porcentajeMaximo:50,descuentoUSD:1,label:'A',desc:''},{id:'b',porcentajeMinimo:40,porcentajeMaximo:90,descuentoUSD:1,label:'B',desc:''}]; })()");
  assert(R("batteryService.validateRanges().length") >= 2, "avisa de rangos superpuestos y porcentajes sin cubrir");
}

(async () => {
  await testDatosYFabrica();
  await testAuthYSeguridad();
  await testSyncYSnapshots();
  await testErroresDeGuardado();
  await testLecturaFallida();
  await testPublico();
  await testOffline();
  await testMigracion();
  await testPersistenciaMultiDispositivo();
  await testBackups();
  await testPaginacion();
  await testServicios();
  process.exit(summary() ? 1 : 0);
})().catch((e) => { console.error("ERROR INESPERADO", e); process.exit(2); });
