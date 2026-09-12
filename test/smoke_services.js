// Smoke test de services.js / config.js, corrido con Node (sin navegador).
// Simula localStorage/sessionStorage en memoria. crypto.subtle ya existe
// globalmente en Node 22+, así que authService funciona igual que en el navegador.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeStorage() {
  const data = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    _dump: () => data,
  };
}

const sandbox = {
  localStorage: makeStorage(),
  sessionStorage: makeStorage(),
  crypto,
  console,
  TextEncoder, // nativo en Node y en todos los navegadores modernos
};
vm.createContext(sandbox);

const configSrc = fs.readFileSync(path.join(__dirname, "..", "config.js"), "utf8");
const servicesSrc = fs.readFileSync(path.join(__dirname, "..", "services.js"), "utf8");
vm.runInContext(configSrc, sandbox, { filename: "config.js" });
vm.runInContext(servicesSrc, sandbox, { filename: "services.js" });

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error("FALLÓ:", msg); }
}

(async () => {
  // ---------- 1. Catálogo de CANJE (Paso 1): fijo e independiente ----------
  const canje = vm.runInContext("tradeInCatalogService.getAll()", sandbox);
  assert(canje.length === 21, "catálogo de canje debe tener 21 modelos, tiene " + canje.length);
  const canjeNames = canje.map((m) => m.nombre.toLowerCase()).join(" | ");
  assert(!/mini|plus|\bair\b/.test(canjeNames), "no debe haber Mini/Plus/Air en canje: " + canjeNames);
  assert(canje.every((m) => typeof m.precioBaseUSD === "number"), "cada modelo de canje debe tener precioBaseUSD numérico");
  assert(typeof vm.runInContext("catalogService.getTradeable", sandbox) === "undefined",
    "catalogService NO debe tener getTradeable (ese fue el bug: Paso 1 no puede depender del catálogo Admin)");

  // ---------- 2. Catálogo de VENTA (Admin, Paso 5): CRUD + filtros ----------
  const all = vm.runInContext("catalogService.getAll()", sandbox);
  assert(all.length === 21, "catálogo de venta debe tener 21 productos de ejemplo, tiene " + all.length);

  const forSale = vm.runInContext("catalogService.getForSale()", sandbox);
  assert(forSale.every((m) => m.estado === "published" && !!m.stock), "forSale debe exigir published Y stock");

  vm.runInContext("catalogService.update('ip11', {precioBaseUSD: 999})", sandbox);
  const ip11Venta = vm.runInContext("catalogService.getById('ip11')", sandbox);
  assert(ip11Venta.precioBaseUSD === 999, "update de precio de venta debe reflejarse, quedó " + ip11Venta.precioBaseUSD);

  vm.runInContext("catalogService.update('ip11', {imagenUrl: 'https://ejemplo.com/foto.jpg'})", sandbox);
  assert(vm.runInContext("catalogService.getById('ip11').imagenUrl", sandbox) === "https://ejemplo.com/foto.jpg",
    "el catálogo de venta debe poder guardar una imagenUrl");

  const created = vm.runInContext("catalogService.create({nombre:'iPhone Test', precioBaseUSD: 50, estado:'published', stock:1})", sandbox);
  assert(vm.runInContext("catalogService.getAll()", sandbox).length === 22, "create debe agregar 1 producto más");
  vm.runInContext(`catalogService.remove(${JSON.stringify(created.id)})`, sandbox);
  assert(vm.runInContext("catalogService.getAll()", sandbox).length === 21, "remove debe volver a 21");
  vm.runInContext("catalogService.update('ip11', {precioBaseUSD: 110, imagenUrl: ''})", sandbox); // restaurar

  // ---------- 2b. REGRESIÓN CRÍTICA: Paso 1 no depende del catálogo Admin ----------
  // Vaciamos por completo el catálogo de venta (como si el admin borrara todo)
  // y el catálogo de canje NO debe verse afectado en absoluto.
  const store = vm.runInContext("StorageService.loadStore()", sandbox);
  store.catalog = [];
  sandbox.__tmpStore = store;
  vm.runInContext("StorageService.saveStore(__tmpStore)", sandbox);
  delete sandbox.__tmpStore;
  assert(vm.runInContext("catalogService.getAll()", sandbox).length === 0, "el catálogo de venta debe poder quedar vacío");
  const canjeConVentaVacio = vm.runInContext("tradeInCatalogService.getAll()", sandbox);
  assert(canjeConVentaVacio.length === 21, "con el catálogo Admin vacío, el catálogo de canje debe seguir teniendo 21 modelos, tiene " + canjeConVentaVacio.length);
  const quoteConVentaVacio = vm.runInContext(`pricingService.calculateQuote({
    modeloId: 'ip11', capacidadId: '128gb', bateriaId: 'b90', desperfectoIds: []
  })`, sandbox);
  assert(quoteConVentaVacio && quoteConVentaVacio.valorFinalUSD === 110,
    "la cotización debe seguir funcionando con el catálogo Admin vacío (110 esperado), dio " + (quoteConVentaVacio && quoteConVentaVacio.valorFinalUSD));
  vm.runInContext("backupService.restoreFactoryDefaults()", sandbox); // restaurar catálogo de venta

  // Ocultar/despublicar TODOS los productos de venta tampoco debe afectar el Paso 1.
  vm.runInContext("catalogService.getAll().forEach(m => catalogService.update(m.id, {estado:'draft', stock:0}))", sandbox);
  assert(vm.runInContext("catalogService.getForSale()", sandbox).length === 0, "con todo oculto, forSale debe quedar vacío");
  assert(vm.runInContext("tradeInCatalogService.getAll()", sandbox).length === 21,
    "con todos los productos de venta ocultos, el catálogo de canje debe seguir teniendo 21 modelos");
  vm.runInContext("backupService.restoreFactoryDefaults()", sandbox); // restaurar

  // ---------- 3. Desperfectos: 10 precargados, CRUD, activo ----------
  const damages = vm.runInContext("damageService.getAll()", sandbox);
  assert(damages.length === 10, "10 desperfectos precargados, hay " + damages.length);
  assert(vm.runInContext("damageService.getActive()", sandbox).length === 10, "todos activos por defecto");

  vm.runInContext("damageService.toggleActive('pantalla')", sandbox);
  assert(vm.runInContext("damageService.getActive()", sandbox).length === 9, "toggleActive debe ocultar 1");
  assert(vm.runInContext("damageService.getById('pantalla').activo", sandbox) === false, "pantalla debe quedar inactiva");
  vm.runInContext("damageService.toggleActive('pantalla')", sandbox); // lo reactivamos para el resto de los tests

  const newDamage = vm.runInContext("damageService.create({nombre:'Test', descuentoUSD: 5})", sandbox);
  assert(vm.runInContext("damageService.getAll()", sandbox).length === 11, "create debe sumar 1 desperfecto");
  vm.runInContext(`damageService.remove(${JSON.stringify(newDamage.id)})`, sandbox);
  assert(vm.runInContext("damageService.getAll()", sandbox).length === 10, "remove debe volver a 10");

  // ---------- 4. Batería: reglas y CRUD ----------
  const battery = vm.runInContext("batteryService.getAll()", sandbox);
  assert(battery.length === 5, "5 reglas de batería por defecto, hay " + battery.length);
  assert(battery.every((b) => typeof b.porcentajeMinimo === "number" && typeof b.porcentajeMaximo === "number" && typeof b.descuentoUSD === "number"),
    "cada regla debe tener porcentajeMinimo, porcentajeMaximo y descuentoUSD numéricos");

  // ---------- 5. Pricing: la fórmula completa en USD (sobre el catálogo de canje) ----------
  // ip11 en el catálogo de canje vale 110 USD de forma fija (no editable).
  const quote1 = vm.runInContext(`pricingService.calculateQuote({
    modeloId: 'ip11', capacidadId: '128gb', bateriaId: 'b90', desperfectoIds: []
  })`, sandbox);
  assert(quote1.precioBaseUSD === 110, "precioBaseUSD 128gb factor 1.0 debe ser 110, fue " + quote1.precioBaseUSD);
  assert(quote1.descuentoBateriaUSD === 0, "batería 90-100% no descuenta, descontó " + quote1.descuentoBateriaUSD);
  assert(quote1.valorFinalUSD === 110, "valorFinalUSD debe ser 110, fue " + quote1.valorFinalUSD);

  const quote2 = vm.runInContext(`pricingService.calculateQuote({
    modeloId: 'ip11', capacidadId: '256gb', bateriaId: 'b70', desperfectoIds: ['pantalla','faceid']
  })`, sandbox);
  // 110 * 1.12 = 123.2; batería b70 = -35; desperfectos pantalla(60)+faceid(40) = -100 => 0 (nunca negativo)
  assert(quote2.precioBaseUSD === 123.2, "precioBase 256gb debe ser 123.2, fue " + quote2.precioBaseUSD);
  assert(quote2.descuentoBateriaUSD === 35, "batería b70 debe descontar 35, descontó " + quote2.descuentoBateriaUSD);
  assert(quote2.descuentoDesperfectosUSD === 100, "desperfectos deben sumar 100, sumaron " + quote2.descuentoDesperfectosUSD);
  assert(quote2.valorFinalUSD === 0, "valorFinalUSD nunca debe ser negativo, fue " + quote2.valorFinalUSD);

  // Con un modelo más caro, el mismo combo sí debe dar positivo.
  const quote2b = vm.runInContext(`pricingService.calculateQuote({
    modeloId: 'ip16promax', capacidadId: '256gb', bateriaId: 'b70', desperfectoIds: ['pantalla','faceid']
  })`, sandbox);
  // 640 * 1.12 = 716.8; -35 batería; -100 desperfectos => 581.8
  assert(quote2b.valorFinalUSD === 581.8, "valorFinalUSD debe ser 581.8, fue " + quote2b.valorFinalUSD);

  // Un desperfecto inactivo no debe descontar aunque se pase su id.
  vm.runInContext("damageService.toggleActive('faceid')", sandbox); // lo desactivamos
  const quote4 = vm.runInContext(`pricingService.calculateQuote({
    modeloId: 'ip11', capacidadId: '128gb', bateriaId: 'b90', desperfectoIds: ['faceid']
  })`, sandbox);
  assert(quote4.descuentoDesperfectosUSD === 0, "desperfecto inactivo no debe descontar, descontó " + quote4.descuentoDesperfectosUSD);
  vm.runInContext("damageService.toggleActive('faceid')", sandbox); // reactivar

  // ---------- 6. Reglas de batería impactan realmente (bug histórico) ----------
  vm.runInContext("batteryService.update('b80', {descuentoUSD: 999})", sandbox);
  const quote5 = vm.runInContext(`pricingService.calculateQuote({
    modeloId: 'ip11', capacidadId: '128gb', bateriaId: 'b80', desperfectoIds: []
  })`, sandbox);
  assert(quote5.descuentoBateriaUSD === 999, "cambiar una regla de batería en Admin debe reflejarse en el cálculo, fue " + quote5.descuentoBateriaUSD);
  vm.runInContext("batteryService.update('b80', {descuentoUSD: 15})", sandbox); // restaurar

  // ---------- 7. Contacto centralizado ----------
  const contact = vm.runInContext("contactService.get()", sandbox);
  assert(contact.whatsapp === "5491159478541", "whatsapp inicial debe ser 5491159478541, fue " + contact.whatsapp);
  vm.runInContext("contactService.update({businessName: 'Otro Nombre'})", sandbox);
  assert(vm.runInContext("contactService.get().businessName", sandbox) === "Otro Nombre", "update de contacto debe persistir");

  // ---------- 8. lastModified: solo se toca en ediciones reales ----------
  const metaBefore = vm.runInContext("StorageService.loadStore().meta.lastModified", sandbox);
  assert(metaBefore !== null, "lastModified debe haberse seteado tras las ediciones previas");

  // ---------- 9. authService: login con admin/admin123 debe funcionar ----------
  const okDefault = await vm.runInContext("authService.verify('admin', 'admin123')", sandbox);
  assert(okDefault === true, "login con admin/admin123 debe funcionar por defecto");
  const badPass = await vm.runInContext("authService.verify('admin', 'incorrecta')", sandbox);
  assert(badPass === false, "login con contraseña incorrecta debe fallar");

  await vm.runInContext("authService.changeCredentials('vendedor2', 'nuevaClave!9')", sandbox);
  const okNew = await vm.runInContext("authService.verify('vendedor2', 'nuevaClave!9')", sandbox);
  assert(okNew === true, "login con credenciales nuevas debe funcionar tras cambiarlas");
  const failOld = await vm.runInContext("authService.verify('admin', 'admin123')", sandbox);
  assert(failOld === false, "las credenciales viejas ya no deben servir tras cambiarlas");

  await vm.runInContext("authService.resetToDefault()", sandbox);
  const okAfterReset = await vm.runInContext("authService.verify('admin', 'admin123')", sandbox);
  assert(okAfterReset === true, "'Restablecer credenciales' debe volver a admin/admin123");

  // La contraseña jamás debe quedar en texto plano en localStorage.
  const rawAuth = sandbox.localStorage.getItem(AUTH_KEY_FOR_TEST(sandbox));
  assert(rawAuth && rawAuth.indexOf("admin123") === -1, "admin123 no debe aparecer en texto plano en localStorage");

  function AUTH_KEY_FOR_TEST(sb) { return vm.runInContext("AUTH_KEY", sb); }

  // ---------- 10. Sesión ----------
  assert(vm.runInContext("authService.isLoggedIn()", sandbox) === false, "no debe haber sesión iniciada al arrancar");
  vm.runInContext("authService.startSession()", sandbox);
  assert(vm.runInContext("authService.isLoggedIn()", sandbox) === true, "startSession debe dejar logueado");
  vm.runInContext("authService.endSession()", sandbox);
  assert(vm.runInContext("authService.isLoggedIn()", sandbox) === false, "endSession debe cerrar sesión");

  // ---------- 11. Backups: exportar / importar / factory reset ----------
  vm.runInContext("catalogService.update('ip11', {precioBaseUSD: 4242})", sandbox);
  const exportedJSON = vm.runInContext("backupService.exportJSON()", sandbox);
  assert(exportedJSON.indexOf("4242") !== -1, "el export debe incluir los cambios hechos");
  assert(exportedJSON.indexOf("admin123") === -1 && exportedJSON.toLowerCase().indexOf('"hash"') === -1,
    "el export NO debe incluir credenciales/contraseñas");

  vm.runInContext("backupService.restoreFactoryDefaults()", sandbox);
  const afterFactory = vm.runInContext("catalogService.getById('ip11').precioBaseUSD", sandbox);
  assert(afterFactory === 110, "factory reset debe volver el precio de fábrica (110), quedó " + afterFactory);

  const importResult = vm.runInContext(`backupService.importJSON(${JSON.stringify(exportedJSON)})`, sandbox);
  assert(importResult.ok === true, "importJSON debe aceptar un export propio");
  const afterImport = vm.runInContext("catalogService.getById('ip11').precioBaseUSD", sandbox);
  assert(afterImport === 4242, "tras importar debe volver el precio 4242, quedó " + afterImport);

  const badImport = vm.runInContext(`backupService.importJSON("esto no es json")`, sandbox);
  assert(badImport.ok === false, "importJSON debe rechazar un archivo inválido sin romper la app");

  // ---------- Resumen ----------
  console.log(`\n${pass} OK, ${fail} FALLOS`);
  process.exit(fail > 0 ? 1 : 0);
})();
