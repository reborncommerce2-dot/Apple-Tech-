/*
  Pruebas de NAVEGADOR (Chromium vía Playwright) sobre los archivos reales
  del sitio. Supabase se reemplaza por el Supabase falso con RLS
  (test/helpers/fake_supabase.js), compartido entre contextos: cada
  contexto de navegador es un "dispositivo" distinto contra la misma base.

    npm install && npx playwright install chromium
    node test/e2e.js
  (CHROMIUM_PATH=/ruta/a/chrome si querés usar otro ejecutable)
*/
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createBackend } = require("./helpers/fake_supabase.js");
const { installBridge } = require("./helpers/browser_bridge.js");
const { makeSandbox, seedFactory } = require("./helpers/harness.js");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; console.log("  ✓", msg); } else { fail++; console.error("  ✗ FALLÓ:", msg); } }
const section = (t) => console.log("\n=== " + t + " ===");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(ROOT, url === "/" ? "index.html" : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    }).listen(0, "127.0.0.1", () => resolve({ srv, base: "http://127.0.0.1:" + srv.address().port }));
  });
}

async function newBackend() {
  const b = createBackend();
  b.addUser("admin@t.com", "clave1234", true);
  b.addUser("intruso@t.com", "clave1234", false);
  return b;
}
async function seeded() {
  const b = await newBackend();
  await seedFactory(b, null);
  return b;
}

function watch(page, errors) {
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|fonts\.g/.test(m.text())) errors.push("console: " + m.text()); });
}
async function device(browser, backend, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 390, height: 844 } });
  const bridge = installBridge(context, backend);
  // sin Internet real: fuentes y WhatsApp se atienden localmente
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await context.route("https://wa.me/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html>wa</html>" }));
  return { context, bridge };
}
async function open(dev, url, errors) {
  const page = await dev.context.newPage();
  watch(page, errors);
  await page.goto(url);
  return page;
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/* ---------- helpers del cotizador ---------- */
async function cotizar(page, { modelo, capacidad, color = "Negro", bateria = "80% – 89%", desperfectos = [] }) {
  await page.click("#btnStart");
  await page.click(`.model-card:has-text("${modelo}") >> nth=0`, { force: true }).catch(() => {});
  await page.locator(".model-card", { hasText: new RegExp("^\\s*" + modelo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$") }).click();
  await page.click("#btnNext");
  await page.locator(".chip", { hasText: capacidad }).first().click();
  await page.locator(".chip-color", { hasText: color }).click();
  await page.click("#btnNext");
  await page.locator(".battery-option", { hasText: bateria }).click();
  await page.click("#btnNext");
  for (const d of desperfectos) await page.locator(".defect-option", { hasText: d }).click();
  await page.click("#btnNext");
}

/* ============================================================ */
async function testCotizadorPublico(browser, base) {
  section("A) Cotizador público (celular 390×844)");
  const b = await seeded();
  const dev = await device(browser, b);
  const errors = [];
  const page = await open(dev, base + "/index.html", errors);
  await page.waitForFunction(() => !document.getElementById("btnStart").disabled);
  assert((await page.textContent("#btnStart")).includes("Empezar"), "carga inicial: botón habilitado");
  assert(await noOverflow(page), "sin scroll horizontal en celular (inicio)");
  await cotizar(page, { modelo: "iPhone 13", capacidad: "128 GB", desperfectos: ["Cámara dañada"] });
  await page.waitForFunction(() => /USD/.test(document.getElementById("resultAmount").textContent) && !/USD 0\b/.test(document.getElementById("resultAmount").textContent));
  await sleep(1100);
  assert((await page.textContent("#resultAmount")).replace(/\s/g, " ") === "USD 155", "resultado = 200 − 15 (batería) − 30 (cámara) = USD 155");
  assert(!(await page.textContent("#resultSummary")).includes("30"), "el cliente NO ve los montos de descuento");
  assert(await noOverflow(page), "sin scroll horizontal en el resultado");
  await page.waitForFunction(() => true);
  await sleep(400);
  assert(b.rows("quotes_history").length === 1, "la cotización quedó registrada en Supabase (1)");
  const q = b.rows("quotes_history")[0];
  assert(q.modelo_nombre === "iPhone 13" && q.valor_final_usd === 155 && q.color === "Negro" && q.bateria_label.includes("80") && q.desperfectos[0] === "Cámara dañada", "…con modelo, valor, color, batería y desperfectos");

  // ir y volver NO duplica
  await page.click("#btnRestart");
  assert(await page.isVisible("#screen-intro"), "reiniciar vuelve al inicio");

  // comparar con equipo en venta + WhatsApp + lead
  await cotizar(page, { modelo: "iPhone 13", capacidad: "128 GB", desperfectos: ["Cámara dañada"] });
  await sleep(300);
  await page.selectOption("#buySelect", { label: (await page.locator("#buySelect option", { hasText: "iPhone 15 —" }).first().textContent()) });
  assert((await page.textContent("#diffTotal")).includes("185"), "diferencia a pagar = 340 − 155 = USD 185");
  const optionsText = await page.locator("#buySelect option").allTextContents();
  assert(!optionsText.some((t) => /iPhone 17|iPhone 13 Pro/.test(t)), "solo se ofrecen equipos publicados y con stock (no borradores ni sin stock)");
  const href0 = await page.getAttribute("#btnWhatsapp", "href");
  assert(href0.startsWith("https://wa.me/5491159478541?text="), "WhatsApp usa el número cargado en Contacto");
  assert(decodeURIComponent(href0).includes("Quiero comprar: iPhone 15") && decodeURIComponent(href0).includes("USD 155"), "el mensaje incluye cotización y equipo a comprar");
  await page.fill("#leadPhone", "123");
  await page.click("#btnWhatsapp", { noWaitAfter: true });
  assert(await page.isVisible("#leadError"), "teléfono inválido: se avisa");
  assert(b.rows("leads").length === 0, "…y no se registra lead");
  await page.fill("#leadName", "Ana <b>Pérez</b>");
  await page.fill("#leadPhone", "11 5555-1234");
  const popup = page.context().waitForEvent("page");
  await page.click("#btnWhatsapp");
  await (await popup).close();
  await sleep(400);
  assert(b.rows("leads").length === 1, "al consultar por WhatsApp se registra 1 lead");
  const lead = b.rows("leads")[0];
  assert(lead.whatsapp === "1155551234" && lead.nombre.startsWith("Ana") && lead.producto_compra_nombre === "iPhone 15" && lead.diferencia_usd === 185 && lead.quote_id === b.rows("quotes_history").at(-1).id, "lead con nombre, WhatsApp, equipo, diferencia y vínculo a la cotización");
  assert(decodeURIComponent(await page.getAttribute("#btnWhatsapp", "href")).includes("Mi nombre: Ana"), "el mensaje incluye el nombre del cliente");
  const popup2 = page.context().waitForEvent("page");
  await page.click("#btnWhatsapp"); await (await popup2).close(); await sleep(300);
  assert(b.rows("leads").length === 1, "doble toque no duplica el lead");
  assert(b.rows("quotes_history").length === 2, "se registraron 2 cotizaciones en total (una por combinación distinta)");
  await page.click("#btnRestart");
  assert(errors.length === 0, "sin errores de consola/JS" + (errors.length ? ": " + errors.join(" | ") : ""));
  await dev.context.close();
}

async function testEstadosPublicos(browser, base) {
  section("B) Estados: sin conexión, base vacía, XSS");
  let b = await seeded();
  let dev = await device(browser, b);
  b.offline = true;
  let errors = [];
  let page = await open(dev, base + "/index.html", errors);
  await page.waitForFunction(() => document.getElementById("btnStart").textContent.includes("no disponible"));
  assert(await page.isDisabled("#btnStart"), "sin conexión: el cotizador NO deja empezar");
  assert((await page.textContent("#loadNote")).includes("No pudimos cargar"), "…y explica por qué");
  assert(!(await page.content()).includes("iPhone 17 Pro Max</span>"), "…y NO muestra datos de ejemplo");
  b.offline = false;
  await page.click("#btnRetryLoad");
  await page.waitForFunction(() => !document.getElementById("btnStart").disabled);
  assert(true, "al volver internet, Reintentar habilita el cotizador");
  await dev.context.close();

  b = await newBackend(); b.setAppMeta("pristine");
  dev = await device(browser, b);
  page = await open(dev, base + "/index.html", []);
  await page.waitForFunction(() => document.getElementById("btnStart").textContent.includes("preparación"));
  assert(await page.isDisabled("#btnStart"), "base vacía: 'Cotizador en preparación'");
  await dev.context.close();

  b = await seeded();
  b.seed("modelos", [{ id: "xss", nombre: '<img src=x onerror="window.__xss=1">Hack', capacidad_ids: ["128gb"] }]);
  b.seed("valoraciones", [{ id: "tv_xss", modelo_id: "xss", modelo_nombre: "x", capacidad_id: "128gb", capacidad_nombre: "128 GB", valor_usd: 100 }]);
  dev = await device(browser, b);
  page = await open(dev, base + "/index.html", []);
  await page.waitForFunction(() => !document.getElementById("btnStart").disabled);
  await page.click("#btnStart");
  assert(await page.evaluate(() => window.__xss === undefined), "un modelo con HTML malicioso no ejecuta código (público)");
  assert((await page.locator(".model-card", { hasText: "Hack" }).count()) === 1, "…se muestra como texto");
  await dev.context.close();
}

async function loginAdmin(page, email = "admin@t.com", pass = "clave1234") {
  await page.fill("#loginUser", email);
  await page.fill("#loginPass", pass);
  await page.click('#loginForm button[type="submit"]');
}
const tab = (page, name) => page.click(`.admin-tab[data-tab="${name}"]`);

async function testAdminAcceso(browser, base) {
  section("C) Admin: acceso, permisos y sesión (escritorio)");
  const b = await seeded();
  const dev = await device(browser, b, { width: 1280, height: 800 });
  const errors = [];
  const page = await open(dev, base + "/admin.html", errors);
  await page.waitForSelector("#loginView:not([hidden])");
  assert(await page.isHidden("#panelView"), "sin sesión: admin.html muestra solo el login");
  assert(!(await page.content()).includes("Resumen del catálogo"), "sin sesión: no se renderiza ningún dato del panel");
  await loginAdmin(page, "admin@t.com", "mala");
  await page.waitForSelector("#loginError:not([hidden])");
  assert((await page.textContent("#loginError")).includes("incorrectos"), "contraseña incorrecta: mensaje claro");
  await loginAdmin(page, "intruso@t.com");
  await page.waitForFunction(() => /permiso de administrador/.test(document.getElementById("loginError").textContent));
  assert(await page.isHidden("#panelView"), "usuario registrado pero NO admin: no entra al panel");
  b.offline = true;
  await loginAdmin(page);
  await page.waitForFunction(() => /No se pudo conectar|conexión/i.test(document.getElementById("loginError").textContent));
  assert(true, "sin red: mensaje de conexión (no 'contraseña incorrecta')");
  b.offline = false;
  await loginAdmin(page);
  await page.waitForSelector("#panelView:not([hidden])");
  await page.waitForFunction(() => document.getElementById("tabContent").textContent.includes("Resumen del catálogo de venta"));
  assert(true, "admin legítimo entra al panel y ve el Resumen");
  assert(await noOverflow(page), "panel sin scroll horizontal (escritorio)");

  // persistencia de sesión tras recargar
  await page.reload();
  await page.waitForSelector("#panelView:not([hidden])");
  assert(true, "tras recargar la página la sesión se mantiene");

  // sesión vencida
  dev.bridge.expireSessions();
  await page.waitForSelector("#loginView:not([hidden])");
  assert(true, "sesión vencida: vuelve al login sin recargar");

  // logout y datos privados
  await loginAdmin(page);
  await page.waitForSelector("#panelView:not([hidden])");
  await page.click("#btnLogout");
  await page.waitForSelector("#loginView:not([hidden])");
  assert(!(await page.content()).includes("Cotizaciones en historial"), "tras salir no queda nada del panel en pantalla");

  // olvidé mi contraseña + link de recuperación
  await page.fill("#loginUser", "admin@t.com");
  await page.click("#btnForgot");
  await page.waitForSelector("#loginInfo:not([hidden])");
  assert(b._emails.length === 1 && b._emails[0].redirectTo.endsWith("/admin.html"), "olvidé mi contraseña: se pide el email con redirección a admin.html");
  dev.bridge.recover("admin@t.com");
  await page.waitForSelector("#recoveryView:not([hidden])");
  await page.fill("#recPass", "corta"); await page.fill("#recPass2", "corta");
  await page.click('#recoveryForm button[type="submit"]');
  assert(await page.isVisible("#recoveryError"), "contraseña nueva demasiado corta: se rechaza");
  await page.fill("#recPass", "nuevaclave99"); await page.fill("#recPass2", "nuevaclave99");
  await page.click('#recoveryForm button[type="submit"]');
  await page.waitForSelector("#panelView:not([hidden])");
  assert([...b.users.values()].find((u) => u.email === "admin@t.com").password === "nuevaclave99", "recuperación: la contraseña nueva se guarda y entra al panel");
  assert(errors.length === 0, "sin errores de consola/JS" + (errors.length ? ": " + errors.join(" | ") : ""));
  await dev.context.close();
}

async function testAdminEdicion(browser, base) {
  section("D) Admin: editar → Supabase → público (dos dispositivos)");
  const b = await seeded();
  const devA = await device(browser, b, { width: 1280, height: 800 });
  const devP = await device(browser, b, { width: 390, height: 844 });
  const errors = [];
  const admin = await open(devA, base + "/admin.html", errors);
  await loginAdmin(admin);
  await admin.waitForSelector("#panelView:not([hidden])");
  const pub = await open(devP, base + "/index.html", errors);
  await pub.waitForFunction(() => !document.getElementById("btnStart").disabled);
  await pub.click("#btnStart");

  // 1) edición de precio de valoración: 2 veces seguidas (bug original)
  await tab(admin, "valuation");
  const valInput = admin.locator('[data-section="valoracion"][data-id="tv_ip13_128gb"] [data-field="valorUSD"]');
  await valInput.fill("250"); await valInput.blur();
  await admin.waitForFunction(() => /Todos los cambios guardados/.test(document.getElementById("syncText").textContent));
  assert(b.rows("valoraciones").find((r) => r.id === "tv_ip13_128gb").valor_usd === 250, "ADMIN → Supabase: valoración guardada (250)");
  await valInput.fill("260"); await valInput.blur();
  await sleep(700);
  assert(b.rows("valoraciones").find((r) => r.id === "tv_ip13_128gb").valor_usd === 260, "segunda edición de la misma fila también se guarda (260)");
  const logs = b.rows("audit_log").filter((l) => l.accion === "Cambio de valoración");
  assert(logs.length === 2, "exactamente 1 registro de auditoría por cambio (2), no uno por tecla");

  // 2) el público lo ve en vivo, sin recargar
  await pub.locator(".model-card", { hasText: /^\s*iPhone 13\s*$/ }).click();
  await pub.click("#btnNext");
  await pub.locator(".chip", { hasText: "128 GB" }).click();
  await pub.locator(".chip-color", { hasText: "Negro" }).click();
  await pub.click("#btnNext");
  await pub.locator(".battery-option", { hasText: "90% – 100%" }).click();
  await pub.click("#btnNext"); await pub.click("#btnNext");
  await sleep(1100);
  assert((await pub.textContent("#resultAmount")).includes("260"), "SUPABASE → público: ve USD 260");
  await valInput.fill("300"); await valInput.blur();
  await pub.waitForFunction(() => document.getElementById("resultAmount").textContent.includes("300"), null, { timeout: 5000 });
  assert(true, "el resultado en pantalla del cliente se actualiza solo a USD 300 (Realtime)");
  assert(b.rows("quotes_history").length === 1, "…sin duplicar la cotización en el historial");

  // 3) catálogo: precio, stock, estado, detalle
  await tab(admin, "catalog");
  const row = admin.locator('[data-section="catalog"][data-id="ip13pro"]');
  await row.locator('[data-field="estado"]').selectOption("published");
  await row.locator('[data-field="stock"]').evaluate((e) => e.click());
  await admin.waitForFunction(() => /guardados/.test(document.getElementById("syncText").textContent));
  await admin.locator('[data-section="catalog"][data-id="ip13pro"] [data-field="detalle"]').fill("256 GB · Batería 95%");
  await admin.locator('[data-section="catalog"][data-id="ip13pro"] [data-field="detalle"]').blur();
  await admin.locator('[data-section="catalog"][data-id="ip13pro"] [data-field="precioBaseUSD"]').fill("-30");
  await admin.locator('[data-section="catalog"][data-id="ip13pro"] [data-field="precioBaseUSD"]').blur();
  await sleep(600);
  const cat = b.rows("catalog").find((r) => r.id === "ip13pro");
  assert(cat.estado === "published" && cat.stock === 1 && cat.detalle === "256 GB · Batería 95%", "catálogo: estado, stock y detalle guardados");
  assert(cat.precio_base_usd === 0, "precio negativo ingresado -> 0");
  assert((await admin.locator('[data-section="catalog"][data-id="ip13pro"] [data-field="precioBaseUSD"]').inputValue()) === "0", "…y el campo muestra el valor corregido");
  await admin.locator('[data-section="catalog"][data-id="ip13pro"] [data-field="precioBaseUSD"]').fill("270");
  await admin.locator('[data-section="catalog"][data-id="ip13pro"] [data-field="precioBaseUSD"]').blur();
  await pub.waitForFunction(() => [...document.querySelectorAll("#buySelect option")].some((o) => o.textContent.includes("iPhone 13 Pro ·") && o.textContent.includes("270")), null, { timeout: 6000 });
  const opt = await pub.locator("#buySelect option", { hasText: "iPhone 13 Pro ·" }).textContent();
  assert(opt.includes("256 GB · Batería 95%") && opt.includes("270"), "el equipo publicado aparece para el cliente con su detalle y precio");

  // 4) contacto: botón real
  await tab(admin, "contact");
  await admin.fill('[data-section="contact"] [data-field="whatsapp"]', "12");
  await admin.click('[data-action="save-contact"]');
  assert((await admin.textContent("#contactMessage")).includes("entre 8 y 15"), "contacto: WhatsApp inválido se rechaza con mensaje");
  await admin.fill('[data-section="contact"] [data-field="whatsapp"]', "+54 9 11 6000-0000");
  await admin.fill('[data-section="contact"] [data-field="businessName"]', "Apple Tech Palermo");
  await admin.click('[data-action="save-contact"]');
  await admin.waitForFunction(() => /Guardado en Supabase/.test(document.getElementById("contactMessage").textContent));
  assert(b.rows("contact")[0].whatsapp === "5491160000000" && b.rows("contact")[0].business_name === "Apple Tech Palermo", "contacto guardado de verdad en Supabase");
  await pub.waitForFunction(() => document.getElementById("brandName").textContent === "Apple Tech Palermo", null, { timeout: 5000 });
  assert(true, "el nombre del negocio cambia en la web pública sin recargar");

  // 5) alta/baja de modelos, capacidades y valoraciones
  await tab(admin, "capacities");
  await admin.click('[data-action="add-capacidad"]');
  await sleep(500); // deja pasar el repintado por el eco de Realtime
  const capRow = admin.locator('[data-section="capacidad"]').last();
  await capRow.locator('[data-field="nombre"]').fill("1 TB"); await capRow.locator('[data-field="nombre"]').blur();
  await admin.click('[data-action="add-capacidad"]');
  await sleep(500); // deja pasar el repintado por el eco de Realtime
  const dupRow = admin.locator('[data-section="capacidad"]').last();
  await dupRow.locator('[data-field="nombre"]').fill("1 TB"); await dupRow.locator('[data-field="nombre"]').blur();
  assert((await admin.textContent("#capacidadMessage")).includes("Ya existe"), "capacidad duplicada: se rechaza con mensaje");
  await tab(admin, "valuation");
  await admin.click('[data-action="add-modelo"]');
  await sleep(500); // deja pasar el repintado por el eco de Realtime
  const newModel = admin.locator('[data-section="modelo"]').first();
  const nm = admin.locator('[data-section="modelo"]', { has: admin.locator('input[value="Nuevo modelo"]') });
  await nm.locator('[data-field="nombre"]').fill("iPhone 18"); await nm.locator('[data-field="nombre"]').blur();
  await sleep(300);
  assert(await admin.locator(".admin-no-price").count() >= 1, "modelo sin precios: avisa que NO se muestra al público");
  const group = () => admin.locator(".admin-valuation-group", { has: admin.locator('input[value="iPhone 18"]') });
  await group().locator('[data-action="toggle-modelo-capacidad"]', { hasText: "128 GB" }).click();
  await group().locator(".admin-row-missing", { hasText: "128 GB" }).locator('[data-action="add-valuation"]').click();
  const priceNew = group().locator('[data-section="valoracion"] [data-field="valorUSD"]');
  await priceNew.fill("900"); await priceNew.blur();
  await sleep(900);
  assert(b.rows("modelos").some((m) => m.nombre === "iPhone 18") && b.rows("valoraciones").some((v) => v.modelo_nombre === "iPhone 18" && v.valor_usd === 900), "modelo nuevo + capacidad + valor guardados en Supabase");
  await pub.click("#btnRestart");
  await pub.waitForFunction(() => !document.getElementById("btnStart").disabled);
  await pub.click("#btnStart");
  assert((await pub.locator(".model-card", { hasText: "iPhone 18" }).count()) === 1, "el modelo nuevo aparece en el cotizador público (con precio > 0)");

  // 6) historial y leads visibles
  await tab(admin, "history");
  assert((await admin.textContent("#tabContent")).includes("iPhone 13"), "Historial muestra la cotización del cliente");
  await tab(admin, "dashboard");
  assert(errors.length === 0, "sin errores de consola/JS" + (errors.length ? ": " + errors.join(" | ") : ""));
  await devA.context.close(); await devP.context.close();
}

async function testAdminRed(browser, base) {
  section("E) Admin: caídas de red y otro dispositivo");
  const b = await seeded();
  const devA = await device(browser, b, { width: 1280, height: 800 });
  const errors = [];
  const admin = await open(devA, base + "/admin.html", errors);
  await loginAdmin(admin);
  await admin.waitForSelector("#panelView:not([hidden])");
  await tab(admin, "catalog");
  const price = admin.locator('[data-section="catalog"][data-id="ip15"] [data-field="precioBaseUSD"]');
  b.offline = true;
  await price.fill("777"); await price.blur();
  await admin.waitForSelector(".sync-banner.is-error");
  assert((await admin.textContent("#syncText")).includes("Sin conexión"), "sin red: banner rojo 'Sin conexión' (NO dice guardado)");
  assert(b.rows("catalog").find((r) => r.id === "ip15").precio_base_usd === 340, "…y la base conserva el valor anterior");
  b.offline = false;
  await admin.click("#syncRetry");
  await admin.waitForFunction(() => /Todos los cambios guardados/.test(document.getElementById("syncText").textContent));
  assert(b.rows("catalog").find((r) => r.id === "ip15").precio_base_usd === 777, "Reintentar: el cambio llega a Supabase");

  // otro dispositivo (login nuevo) ve lo mismo
  const devB = await device(browser, b, { width: 1280, height: 800 });
  const adminB = await open(devB, base + "/admin.html", errors);
  await loginAdmin(adminB);
  await adminB.waitForSelector("#panelView:not([hidden])");
  await tab(adminB, "catalog");
  assert((await adminB.locator('[data-section="catalog"][data-id="ip15"] [data-field="precioBaseUSD"]').inputValue()) === "777", "otro dispositivo: mismos datos tras iniciar sesión");

  // cambio remoto mientras A tiene el cursor en un campo: no se pierde lo tipeado
  const nameA = admin.locator('[data-section="catalog"][data-id="ip16"] [data-field="nombre"]');
  await nameA.click(); await nameA.fill("Escribiendo…");
  await adminB.locator('[data-section="catalog"][data-id="ip11"] [data-field="precioBaseUSD"]').fill("111");
  await adminB.locator('[data-section="catalog"][data-id="ip11"] [data-field="precioBaseUSD"]').blur();
  await sleep(1500);
  assert((await nameA.inputValue()) === "Escribiendo…", "un cambio de otro admin NO borra lo que se está escribiendo");
  await nameA.blur();
  await sleep(900);
  assert((await admin.locator('[data-section="catalog"][data-id="ip11"] [data-field="precioBaseUSD"]').inputValue()) === "111", "…y al terminar de escribir se ve el cambio del otro admin");
  assert(b.rows("catalog").find((r) => r.id === "ip16").nombre === "Escribiendo…", "lo escrito se guardó");

  // borrado con confirmación
  admin.on("dialog", (d) => d.accept());
  await admin.locator('[data-section="catalog"][data-id="ip17"] [data-action="delete-model"]').click();
  await sleep(600);
  assert(!b.rows("catalog").some((r) => r.id === "ip17"), "eliminar un equipo del catálogo lo borra en Supabase");

  // backups
  await tab(admin, "backups");
  const [dl] = await Promise.all([admin.waitForEvent("download"), admin.click('[data-action="export-backup"]')]);
  const content = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  assert(content.tipo === "appletech-backup" && content.store.modelos.length === 21, "backup descargable con toda la configuración");
  const tmp = path.join(require("os").tmpdir(), "bk.json");
  fs.writeFileSync(tmp, JSON.stringify(content));
  // cambio posterior al backup: la importación tiene que deshacerlo
  await tab(admin, "catalog");
  const p15 = admin.locator('[data-section="catalog"][data-id="ip15"] [data-field="precioBaseUSD"]');
  await p15.fill("1"); await p15.blur(); await sleep(600);
  assert(b.rows("catalog").find((r) => r.id === "ip15").precio_base_usd === 1, "(preparación) precio cambiado después del backup");
  await tab(admin, "backups");
  await admin.setInputFiles("#importFile", tmp);
  admin.removeAllListeners("dialog"); admin.on("dialog", (d) => d.accept());
  const [dl2] = await Promise.all([admin.waitForEvent("download"), admin.click('[data-action="import-backup"]')]);
  assert((await dl2.suggestedFilename()).startsWith("backup-antes-de-importar"), "antes de importar se descarga automáticamente una copia");
  await admin.waitForFunction(() => /Backup importado/.test(document.getElementById("backupMessage").textContent));
  assert(b.rows("catalog").find((r) => r.id === "ip15").precio_base_usd === 777 && !b.rows("catalog").some((r) => r.id === "ip17"), "importar restaura los precios del backup (ip15 vuelve a 777) y respeta lo que ya no estaba");
  fs.writeFileSync(tmp, "no soy json");
  await admin.setInputFiles("#importFile", tmp);
  await admin.click('[data-action="import-backup"]').catch(() => {});
  await admin.waitForFunction(() => /no es un JSON/.test(document.getElementById("backupMessage").textContent), null, { timeout: 5000 }).catch(() => {});
  assert((await admin.textContent("#backupMessage")).includes("no es un JSON"), "archivo inválido: mensaje claro");
  // restauración de ejemplo exige escribir RESTAURAR
  admin.removeAllListeners("dialog");
  admin.on("dialog", (d) => d.accept("no"));
  await admin.click('[data-action="factory-reset"]');
  await admin.waitForFunction(() => /No se restauró nada/.test(document.getElementById("backupMessage").textContent), null, { timeout: 5000 }).catch(() => {});
  assert((await admin.textContent("#backupMessage")).includes("No se restauró nada"), "restaurar sin escribir RESTAURAR no hace nada");
  assert(errors.length === 0, "sin errores de consola/JS" + (errors.length ? ": " + errors.join(" | ") : ""));
  await devA.context.close(); await devB.context.close();
}

async function testPrimerUso(browser, base) {
  section("F) Primer uso: base vacía y migración desde el navegador viejo");
  const b = await newBackend(); b.setAppMeta("pristine");
  const dev = await device(browser, b, { width: 1280, height: 800 });
  const errors = [];
  const admin = await open(dev, base + "/admin.html", errors);
  await loginAdmin(admin);
  await admin.waitForSelector("#panelView:not([hidden])");
  await admin.waitForFunction(() => document.getElementById("tabContent").textContent.includes("La base está vacía"), null, { timeout: 8000 }).catch(() => {});
  assert((await admin.textContent("#tabContent")).includes("La base está vacía"), "base vacía: el panel lo explica");
  admin.on("dialog", (d) => d.accept());
  await admin.click('[data-action="load-sample"]');
  await admin.waitForFunction(() => /Datos de ejemplo cargados/.test(document.getElementById("tabContent").textContent));
  assert(b.rows("modelos").length === 21 && b.rows("app_meta")[0].config_state === "configured", "cargar ejemplo: 21 modelos en Supabase y base 'configured'");
  await dev.context.close();

  // migración real desde localStorage del navegador
  const b2 = await newBackend(); b2.setAppMeta("pristine");
  const dev2 = await device(browser, b2, { width: 1280, height: 800 });
  const ref = makeSandbox(null);
  const old = ref.run("defaultStore()");
  old.catalog[0].precioBaseUSD = 4321;
  await dev2.context.addInitScript((payload) => { if (!localStorage.getItem("appletech_store_v2") && !sessionStorage.getItem("seeded")) { localStorage.setItem("appletech_store_v2", payload); sessionStorage.setItem("seeded", "1"); } }, JSON.stringify(old));
  const adm2 = await open(dev2, base + "/admin.html", errors);
  await loginAdmin(adm2);
  await adm2.waitForFunction(() => /Se pasaron a Supabase/.test(document.getElementById("tabContent").textContent), null, { timeout: 8000 });
  assert(b2.rows("catalog").find((r) => r.id === "ip11").precio_base_usd === 4321, "migración: los datos del navegador viejo llegaron a Supabase");
  assert(await adm2.evaluate(() => localStorage.getItem("appletech_store_v2") !== null), "…y los datos locales se conservan como respaldo");
  assert(errors.length === 0, "sin errores de consola/JS" + (errors.length ? ": " + errors.join(" | ") : ""));
  await dev2.context.close();
}

async function testResponsive(browser, base) {
  section("G) Responsive");
  const b = await seeded();
  for (const [name, vp] of [["celular chico 360", { width: 360, height: 640 }], ["tablet 768", { width: 768, height: 1024 }], ["escritorio 1440", { width: 1440, height: 900 }]]) {
    const dev = await device(browser, b, vp);
    const p = await open(dev, base + "/index.html", []);
    await p.waitForFunction(() => !document.getElementById("btnStart").disabled);
    assert(await noOverflow(p), "index.html sin scroll horizontal en " + name);
    const a = await open(dev, base + "/admin.html", []);
    await a.waitForSelector("#loginView:not([hidden])");
    await loginAdmin(a); await a.waitForSelector("#panelView:not([hidden])");
    for (const t of ["dashboard", "catalog", "valuation", "battery", "damages", "contact", "backups"]) { await tab(a, t); if (!(await noOverflow(a))) { assert(false, "admin/" + t + " desborda en " + name); } }
    assert(true, "admin (todas las pestañas) sin scroll horizontal en " + name);
    await dev.context.close();
  }
}

(async () => {
  const { srv, base } = await startServer();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  try {
    await testCotizadorPublico(browser, base);
    await testEstadosPublicos(browser, base);
    await testAdminAcceso(browser, base);
    await testAdminEdicion(browser, base);
    await testAdminRed(browser, base);
    await testPrimerUso(browser, base);
    await testResponsive(browser, base);
  } catch (e) {
    fail++; console.error("ERROR INESPERADO:", e);
  } finally {
    await browser.close(); srv.close();
  }
  console.log("\n----------------------------------------");
  console.log("E2E  Total: " + (pass + fail) + "   OK: " + pass + "   FALLOS: " + fail);
  console.log("----------------------------------------");
  process.exit(fail ? 1 : 0);
})();
