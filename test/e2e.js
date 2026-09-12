// Prueba end-to-end real (navegador headless) sobre los archivos
// estáticos, servidos por http://127.0.0.1:8791/
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8791";
let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  ✓", msg); }
  else { fail++; console.error("  ✗ FALLÓ:", msg); }
}

async function freshContext(browser, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 390, height: 844 } });
  return ctx;
}

async function loginAdmin(page) {
  await page.goto(BASE + "/admin.html");
  await page.waitForSelector("#loginView:not([hidden])");
  await page.fill("#loginUser", "admin");
  await page.fill("#loginPass", "admin123");
  await page.click('#loginForm button[type="submit"]');
  await page.waitForSelector("#panelView:not([hidden])", { timeout: 3000 });
}

function ignoreNoise(page) {
  page.on("pageerror", (err) => { fail++; console.error("  ✗ pageerror:", err.message); });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // Ruido esperado en este sandbox de pruebas sin acceso a internet
    // (Google Fonts), no tiene relación con el código del sitio.
    if (/failed to load resource/i.test(msg.text())) return;
    fail++;
    console.error("  ✗ console.error:", msg.text());
  });
}

(async () => {
  const browser = await chromium.launch();

  // ============================================================
  // 1) LOGIN ADMIN
  // ============================================================
  console.log("\n== LOGIN ADMIN ==");
  {
    const ctx = await freshContext(browser);
    const page = await ctx.newPage();
    ignoreNoise(page);

    await page.goto(BASE + "/admin.html");
    await page.waitForSelector("#loginView:not([hidden])");

    // Contraseña incorrecta -> error visible, panel sigue oculto
    await page.fill("#loginUser", "admin");
    await page.fill("#loginPass", "incorrecta");
    await page.click('#loginForm button[type="submit"]');
    await page.waitForTimeout(150);
    assert(await page.isVisible("#loginError"), "contraseña incorrecta debe mostrar error");
    assert(await page.isHidden("#panelView"), "panel debe seguir oculto con credenciales malas");

    // Credenciales correctas: admin / admin123 (verificación obligatoria del documento)
    await page.fill("#loginUser", "admin");
    await page.fill("#loginPass", "admin123");
    await page.click('#loginForm button[type="submit"]');
    await page.waitForSelector("#panelView:not([hidden])", { timeout: 3000 });
    assert(true, "usuario admin + contraseña admin123 permite ingresar al panel");
    assert(await page.isHidden("#loginView"), "vista de login se oculta tras loguear");

    // Sesión persiste tras recargar
    await page.reload();
    await page.waitForSelector("#panelView:not([hidden])", { timeout: 3000 });
    assert(true, "la sesión persiste tras recargar la página");

    // Logout
    await page.click("#btnLogout");
    await page.waitForSelector("#loginView:not([hidden])", { timeout: 3000 });
    assert(true, "logout vuelve a la pantalla de login");
    await page.reload();
    await page.waitForSelector("#loginView:not([hidden])", { timeout: 3000 });
    assert(true, "tras logout + reload, NO debe quedar sesión activa");

    await ctx.close();
  }

  // ============================================================
  // 2) PASO 1 INDEPENDIENTE DEL CATÁLOGO ADMIN (corrección crítica)
  // ============================================================
  console.log("\n== PASO 1: catálogo de canje independiente ==");
  const sharedCtx = await freshContext(browser, { width: 1280, height: 900 });
  {
    const page = await sharedCtx.newPage();
    ignoreNoise(page);
    await loginAdmin(page);
    await page.click('.admin-tab[data-tab="catalog"]');
    await page.waitForSelector('.admin-row[data-section="catalog"]');

    // Estado base del Paso 1, catálogo Admin recién cargado con sus 21 productos de ejemplo.
    const shop0 = await sharedCtx.newPage();
    shop0.on("pageerror", (err) => { fail++; console.error("  ✗ pageerror (shop0):", err.message); });
    await shop0.goto(BASE + "/index.html");
    await shop0.click("#btnStart");
    await shop0.waitForSelector("#modelGrid .model-card");
    const namesBefore = await shop0.locator("#modelGrid .model-card .m-name").allTextContents();
    assert(namesBefore.length === 21, "el paso 1 debe listar los 21 modelos de canje, listó " + namesBefore.length);
    assert(!namesBefore.some((n) => /mini|plus|\bair\b/i.test(n)), "no debe haber Mini/Plus/Air en el paso 1");
    for (const serie of ["11", "12", "13", "14", "15", "16", "17"]) {
      assert(namesBefore.includes(`iPhone ${serie}`) && namesBefore.includes(`iPhone ${serie} Pro`) && namesBefore.includes(`iPhone ${serie} Pro Max`),
        `deben estar los 3 variantes de la serie ${serie} en el paso 1`);
    }
    await shop0.close();

    // Ahora BORRAMOS TODO el catálogo Admin (venta) para simular el peor caso.
    let deleteBtn = page.locator('.admin-row[data-section="catalog"] [data-action="delete-model"]').first();
    let count = await page.locator('.admin-row[data-section="catalog"]').count();
    while (count > 0) {
      page.once("dialog", (d) => d.accept());
      await page.locator('.admin-row[data-section="catalog"] [data-action="delete-model"]').first().click();
      await page.waitForTimeout(30);
      count = await page.locator('.admin-row[data-section="catalog"]').count();
    }
    assert((await page.locator('.admin-row[data-section="catalog"]').count()) === 0, "el catálogo Admin debe quedar completamente vacío");

    // El Paso 1 tiene que seguir funcionando exactamente igual con el catálogo Admin vacío.
    const shop1 = await sharedCtx.newPage();
    shop1.on("pageerror", (err) => { fail++; console.error("  ✗ pageerror (shop1):", err.message); });
    await shop1.goto(BASE + "/index.html");
    await shop1.click("#btnStart");
    await shop1.waitForSelector("#modelGrid .model-card");
    const namesEmptyAdmin = await shop1.locator("#modelGrid .model-card .m-name").allTextContents();
    assert(namesEmptyAdmin.length === 21, "con el catálogo Admin vacío, el paso 1 debe seguir listando los 21 modelos, listó " + namesEmptyAdmin.length);

    // Y la cotización completa debe funcionar igual (usa el catálogo de canje fijo, no el Admin).
    await shop1.click('#modelGrid .model-card:has-text("iPhone 11"):not(:has-text("Pro"))');
    await shop1.click("#btnNext");
    await shop1.click('#capacityRow .chip:has-text("128 GB")');
    await shop1.click('#colorRow .chip:has-text("Negro")');
    await shop1.click("#btnNext");
    await shop1.click('#batteryList .battery-option:has-text("90% – 100%")');
    await shop1.click("#btnNext");
    await shop1.click("#btnNext");
    await shop1.waitForTimeout(1200);
    const amountEmptyAdmin = await shop1.locator("#resultAmount").textContent();
    assert(amountEmptyAdmin.trim() === "USD 110", `la cotización debe funcionar con el catálogo Admin vacío (USD 110 esperado), mostró "${amountEmptyAdmin.trim()}"`);
    // Sin productos publicados, no debe ofrecerse la opción de comprar otro equipo.
    const buyOptions = await shop1.locator("#buySelect option").count();
    assert(buyOptions === 1, "sin catálogo de venta, el selector de compra del paso 5 solo debe tener la opción 'No, solo quiero cotizar'");
    await shop1.close();

    // Restaurar el catálogo Admin de fábrica para el resto de las pruebas.
    await page.click('.admin-tab[data-tab="backups"]');
    await page.waitForSelector('[data-action="factory-reset"]');
    page.once("dialog", (d) => d.accept());
    await page.click('[data-action="factory-reset"]');
    await page.waitForTimeout(150);

    // Ahora ocultamos/despublicamos TODO (en vez de borrar) y el paso 1 tampoco debe cambiar.
    await page.click('.admin-tab[data-tab="catalog"]');
    await page.waitForSelector('.admin-row[data-section="catalog"]');
    const estadoSelects = page.locator('.admin-row[data-section="catalog"] select[data-field="estado"]');
    const totalRows = await estadoSelects.count();
    for (let i = 0; i < totalRows; i++) {
      await estadoSelects.nth(i).selectOption("draft");
    }
    await page.waitForTimeout(100);

    const shop2 = await sharedCtx.newPage();
    await shop2.goto(BASE + "/index.html");
    await shop2.click("#btnStart");
    await shop2.waitForSelector("#modelGrid .model-card");
    const namesHiddenAdmin = await shop2.locator("#modelGrid .model-card .m-name").allTextContents();
    assert(namesHiddenAdmin.length === 21, "con todo el catálogo Admin oculto/despublicado, el paso 1 debe seguir listando los 21 modelos, listó " + namesHiddenAdmin.length);
    await shop2.close();

    // Restaurar de nuevo para las pruebas siguientes.
    await page.click('.admin-tab[data-tab="backups"]');
    page.once("dialog", (d) => d.accept());
    await page.click('[data-action="factory-reset"]');
    await page.waitForTimeout(150);
    await page.close();
  }

  // ============================================================
  // 2b) PASO 5: EXCLUSIVO del catálogo Admin (precio, stock, estado, imagen)
  // ============================================================
  console.log("\n== PASO 5: exclusivo del catálogo Admin ==");
  {
    const page = await sharedCtx.newPage();
    ignoreNoise(page);
    await loginAdmin(page);
    await page.click('.admin-tab[data-tab="catalog"]');
    await page.waitForSelector('.admin-row[data-section="catalog"]');

    // Editar precio + imagen de un producto, y publicar otro que estaba "out".
    const row = page.locator('.admin-row[data-section="catalog"][data-id="ip11"]');
    const priceInput = row.locator('input[data-field="precioBaseUSD"]');
    await priceInput.fill("777");
    await priceInput.dispatchEvent("input");
    await page.waitForTimeout(150);
    const imgInput = row.locator('input[data-field="imagenUrl"]');
    await imgInput.click();
    await imgInput.fill("https://ejemplo.com/ip11.png");
    await imgInput.dispatchEvent("input");
    await page.waitForTimeout(100);

    const rowOut = page.locator('.admin-row[data-section="catalog"][data-id="ip13pro"]');
    await rowOut.locator('select[data-field="estado"]').selectOption("published");
    await rowOut.locator('label.admin-switch').click(); // activar stock
    await page.waitForTimeout(100);
    assert(await rowOut.locator('input[data-field="stock"]').isChecked(), "el stock de ip13pro debe quedar activado");

    const shop = await sharedCtx.newPage();
    shop.on("pageerror", (err) => { fail++; console.error("  ✗ pageerror (shop):", err.message); });
    await shop.goto(BASE + "/index.html");
    await shop.click("#btnStart");
    await shop.waitForSelector("#modelGrid .model-card");

    // El paso 1 NO debe verse afectado por estos cambios administrativos.
    const modelNames = await shop.locator("#modelGrid .model-card .m-name").allTextContents();
    assert(modelNames.length === 21, "editar el catálogo Admin no debe cambiar la cantidad de modelos del paso 1");

    // El buySelect del paso 5 SÍ debe reflejar el nuevo producto publicado.
    await shop.click('#modelGrid .model-card:has-text("iPhone 12"):not(:has-text("Pro"))'); // otro modelo, no ip11
    await shop.click("#btnNext");
    await shop.click('#capacityRow .chip:has-text("128 GB")');
    await shop.click('#colorRow .chip:has-text("Negro")');
    await shop.click("#btnNext");
    await shop.click('#batteryList .battery-option:has-text("90% – 100%")');
    await shop.click("#btnNext");
    await shop.click("#btnNext");
    await shop.waitForTimeout(1200);

    const buyOptionsText = await shop.locator("#buySelect option").allTextContents();
    assert(buyOptionsText.some((t) => t.includes("iPhone 13 Pro")), "un producto recién publicado en Admin debe aparecer en el selector de compra del paso 5");
    assert(buyOptionsText.some((t) => t.includes("iPhone 11") && t.includes("USD 777")), "el precio editado en Admin debe reflejarse en el paso 5, opciones: " + buyOptionsText.join(" | "));

    // Elegir el producto con imagen y verificar que se muestre.
    await shop.selectOption("#buySelect", "ip11");
    await shop.waitForSelector("#diffCard:not([hidden])");
    assert(await shop.isVisible("#diffProductImage"), "la imagen del producto (leída del catálogo Admin) debe mostrarse en el paso 5");
    const imgSrc = await shop.getAttribute("#diffProductImage", "src");
    assert(imgSrc === "https://ejemplo.com/ip11.png", "la imagen mostrada debe ser la cargada desde Admin, fue " + imgSrc);

    // Ocultar ese mismo producto y confirmar que desaparece del selector.
    await shop.close();
    const rowHide = page.locator('.admin-row[data-section="catalog"][data-id="ip11"]');
    await rowHide.locator('select[data-field="estado"]').selectOption("draft");
    await page.waitForTimeout(100);

    const shop2 = await sharedCtx.newPage();
    await shop2.goto(BASE + "/index.html");
    const buyOptionsAfterHide = await shop2.locator("#buySelect option").allTextContents();
    assert(!buyOptionsAfterHide.some((t) => t.includes("iPhone 11 —")), "un producto despublicado debe desaparecer del selector de compra del paso 5");
    await shop2.close();

    // Restaurar catálogo de fábrica para el resto de las pruebas.
    await page.click('.admin-tab[data-tab="backups"]');
    page.once("dialog", (d) => d.accept());
    await page.click('[data-action="factory-reset"]');
    await page.waitForTimeout(150);
    await page.close();
  }

  // ============================================================
  // 3) DESPERFECTOS: ocultos al cliente, afectan el cálculo, activo/inactivo
  // ============================================================
  console.log("\n== DESPERFECTOS ==");
  {
    const page = await sharedCtx.newPage();
    ignoreNoise(page);
    await loginAdmin(page);
    await page.click('.admin-tab[data-tab="damages"]');
    await page.waitForSelector('.admin-row[data-section="desperfectos"]');

    const rows = await page.locator('.admin-row[data-section="desperfectos"]').count();
    assert(rows === 10, "deben existir 10 desperfectos precargados, hay " + rows);

    // Desactivar "Face ID defectuoso"
    const faceRow = page.locator('.admin-row[data-section="desperfectos"][data-id="faceid"]');
    // El checkbox real está oculto visualmente dentro de un switch estilizado
    // (así lo toca un usuario real: en el área visible, no en el input crudo).
    await faceRow.locator('label.admin-switch').click();
    await page.waitForTimeout(100);

    const shop = await sharedCtx.newPage();
    await shop.goto(BASE + "/index.html");
    await shop.click("#btnStart");
    await shop.click('#modelGrid .model-card:has-text("iPhone 12"):not(:has-text("Pro"))');
    await shop.click("#btnNext");
    await shop.click('#capacityRow .chip:has-text("128 GB")');
    await shop.click('#colorRow .chip:has-text("Negro")');
    await shop.click("#btnNext");
    await shop.click('#batteryList .battery-option:has-text("90% – 100%")');
    await shop.click("#btnNext"); // paso 4

    const defectNames = await shop.locator("#defectList .defect-option .d-name").allTextContents();
    assert(!defectNames.includes("Face ID defectuoso"), "un desperfecto desactivado no debe aparecer en el paso 4");
    assert(defectNames.length === 9, "deben verse 9 desperfectos activos (10 - 1 desactivado), se vieron " + defectNames.length);

    const step4Text = await shop.locator("#defectList").textContent();
    assert(!/\$|USD/.test(step4Text), "el paso 4 NO debe mostrar ningún monto de descuento al cliente");

    // Marcar "Pantalla rota" y verificar que el resultado se reduzca (afecta el cálculo aunque no se vea)
    await shop.click('#defectList .defect-option:has-text("Pantalla rota")');
    await shop.click("#btnNext"); // paso 5
    await shop.waitForTimeout(1200);
    const amountWithDefect = await shop.locator("#resultAmount").textContent();
    // iPhone 12 128GB sin desperfectos = 150; con "Pantalla rota" (60 USD) = 90
    assert(amountWithDefect.trim() === "USD 90", `el desperfecto debe descontarse del total (USD 90 esperado), mostró "${amountWithDefect.trim()}"`);

    await shop.close();
    await page.close();
  }

  // ============================================================
  // 4) BATERÍA: reglas administrables impactan realmente la cotización
  // ============================================================
  console.log("\n== BATERÍA ==");
  {
    const page = await sharedCtx.newPage();
    ignoreNoise(page);
    await loginAdmin(page);
    await page.click('.admin-tab[data-tab="battery"]');
    await page.waitForSelector('.admin-row[data-section="bateria"]');

    const rows = await page.locator('.admin-row[data-section="bateria"]').count();
    assert(rows === 5, "deben existir 5 reglas de batería, hay " + rows);

    const b70Row = page.locator('.admin-row[data-section="bateria"][data-id="b70"]');
    const discountInput = b70Row.locator('input[data-field="descuentoUSD"]');
    await discountInput.fill("999");
    await discountInput.dispatchEvent("input");
    await page.waitForTimeout(100);

    const shop = await sharedCtx.newPage();
    await shop.goto(BASE + "/index.html");
    await shop.click("#btnStart");
    await shop.click('#modelGrid .model-card:has-text("iPhone 12"):not(:has-text("Pro"))'); // precioBase 150
    await shop.click("#btnNext");
    await shop.click('#capacityRow .chip:has-text("128 GB")');
    await shop.click('#colorRow .chip:has-text("Negro")');
    await shop.click("#btnNext");
    await shop.click('#batteryList .battery-option:has-text("70% – 79%")');
    await shop.click("#btnNext");
    await shop.click("#btnNext"); // sin desperfectos
    await shop.waitForTimeout(1200);
    const amount = await shop.locator("#resultAmount").textContent();
    assert(amount.trim() === "USD 0", `un descuento de batería mayor al precio base debe dar USD 0 (nunca negativo), mostró "${amount.trim()}"`);

    await shop.close();
    await page.close();
  }

  // ============================================================
  // 5) WHATSAPP
  // ============================================================
  console.log("\n== WHATSAPP ==");
  {
    const shop = await sharedCtx.newPage();
    await shop.goto(BASE + "/index.html");
    await shop.click("#btnStart");
    await shop.click('#modelGrid .model-card:has-text("iPhone 14"):not(:has-text("Pro"))');
    await shop.click("#btnNext");
    await shop.click('#capacityRow .chip:has-text("128 GB")');
    await shop.click('#colorRow .chip:has-text("Negro")');
    await shop.click("#btnNext");
    await shop.click('#batteryList .battery-option:has-text("90% – 100%")');
    await shop.click("#btnNext");
    await shop.click("#btnNext");
    await shop.waitForTimeout(1200);
    const href = await shop.locator("#btnWhatsapp").getAttribute("href");
    assert(href.startsWith("https://wa.me/5491159478541?text="), "el link de WhatsApp debe usar el número 5491159478541, fue: " + href);
    assert(decodeURIComponent(href).includes("USD"), "el mensaje de WhatsApp debe cotizar en USD");
    await shop.close();
  }

  // ============================================================
  // 6) BACKUPS: exportar / restaurar de fábrica
  // ============================================================
  console.log("\n== BACKUPS ==");
  {
    const page = await sharedCtx.newPage();
    ignoreNoise(page);
    await loginAdmin(page);
    await page.click('.admin-tab[data-tab="backups"]');
    await page.waitForSelector('[data-action="export-backup"]');

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click('[data-action="export-backup"]'),
    ]);
    const dlPath = await download.path();
    assert(!!dlPath, "el botón de exportar backup debe generar una descarga");
    const fs = require("fs");
    const content = fs.readFileSync(dlPath, "utf8");
    const parsed = JSON.parse(content);
    assert(parsed.store && Array.isArray(parsed.store.catalog), "el backup exportado debe traer el catálogo");
    assert(JSON.stringify(parsed).indexOf("admin123") === -1, "el backup NO debe incluir la contraseña");

    // Factory reset: el precio editado antes (ip11 = 777) debe volver a 110
    page.once("dialog", (d) => d.accept());
    await page.click('[data-action="factory-reset"]');
    await page.waitForTimeout(200);
    await page.click('.admin-tab[data-tab="catalog"]');
    await page.waitForSelector('.admin-row[data-section="catalog"][data-id="ip11"]');
    const priceAfterReset = await page.locator('.admin-row[data-section="catalog"][data-id="ip11"] input[data-field="precioBaseUSD"]').inputValue();
    assert(priceAfterReset === "110", "factory reset debe volver el precio de fábrica (110 USD), quedó " + priceAfterReset);

    await page.close();
  }

  // ============================================================
  // 7) SEGURIDAD: cambiar credenciales y restablecerlas
  // ============================================================
  console.log("\n== SEGURIDAD ==");
  {
    const page = await sharedCtx.newPage();
    ignoreNoise(page);
    await loginAdmin(page);
    await page.click('.admin-tab[data-tab="security"]');
    await page.waitForSelector("#securityForm");

    await page.fill("#secUser", "vendedor2");
    await page.fill("#secPass", "claveSegura9");
    await page.fill("#secPass2", "claveSegura9");
    await page.click('#securityForm button[type="submit"]');
    await page.waitForSelector("#securityMessage.is-success", { timeout: 3000 });
    assert(true, "cambiar usuario/contraseña debe confirmar éxito");

    await page.click("#btnLogout");
    await page.waitForSelector("#loginView:not([hidden])");
    await page.fill("#loginUser", "admin");
    await page.fill("#loginPass", "admin123");
    await page.click('#loginForm button[type="submit"]');
    await page.waitForTimeout(200);
    assert(await page.isHidden("#panelView"), "las credenciales viejas ya no deben servir tras cambiarlas");

    await page.fill("#loginUser", "vendedor2");
    await page.fill("#loginPass", "claveSegura9");
    await page.click('#loginForm button[type="submit"]');
    await page.waitForSelector("#panelView:not([hidden])", { timeout: 3000 });
    assert(true, "las credenciales nuevas deben funcionar");

    // Restablecer credenciales
    await page.click('.admin-tab[data-tab="security"]');
    page.once("dialog", (d) => d.accept());
    await page.click('[data-action="reset-credentials"]');
    await page.waitForSelector("#securityMessage.is-success", { timeout: 3000 });

    await page.click("#btnLogout");
    await page.waitForSelector("#loginView:not([hidden])");
    await page.fill("#loginUser", "admin");
    await page.fill("#loginPass", "admin123");
    await page.click('#loginForm button[type="submit"]');
    await page.waitForSelector("#panelView:not([hidden])", { timeout: 3000 });
    assert(true, "tras 'Restablecer credenciales', admin/admin123 debe volver a funcionar");

    await page.close();
  }

  await sharedCtx.close();

  // ============================================================
  // 8) RESPONSIVE (celular) — sin errores, elementos táctiles ok
  // ============================================================
  console.log("\n== RESPONSIVE MÓVIL ==");
  {
    const ctx = await freshContext(browser, { width: 375, height: 812 }); // iPhone-ish
    const page = await ctx.newPage();
    page.on("pageerror", (err) => { fail++; console.error("  ✗ pageerror (mobile):", err.message); });
    await page.goto(BASE + "/admin.html");
    await page.fill("#loginUser", "admin");
    await page.fill("#loginPass", "admin123");
    await page.click('#loginForm button[type="submit"]');
    await page.waitForSelector("#panelView:not([hidden])");
    await page.click('.admin-tab[data-tab="catalog"]');
    await page.waitForSelector('.admin-row[data-section="catalog"]');

    const box = await page.locator('.admin-row[data-section="catalog"]').first().locator('input[data-field="precioBaseUSD"]').boundingBox();
    assert(box && box.height >= 38, "los inputs deben tener alto táctil cómodo en mobile (>=38px), midió " + (box && box.height));

    const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    assert(!hasHorizontalScroll, "el panel admin no debe generar scroll horizontal en mobile (375px)");

    await page.goto(BASE + "/index.html");
    const hasHorizontalScrollShop = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    assert(!hasHorizontalScrollShop, "el cotizador no debe generar scroll horizontal en mobile (375px)");

    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} OK, ${fail} FALLOS`);
  process.exit(fail > 0 ? 1 : 0);
})();
