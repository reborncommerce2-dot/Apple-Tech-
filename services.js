/*
  services.js = EL MOTOR COMPARTIDO.
  ------------------------------------------------------------
  Este archivo es IDÉNTICO en todos los puntos de entrada del
  sitio (cotizador público y panel admin). Es la única puerta de
  entrada y salida para leer o escribir datos: nadie lee o escribe
  localStorage directamente fuera de acá.

  Servicios expuestos:
    StorageService  -> leer/guardar el STORE completo
    catalogService   -> modelos (Admin → Precios / Paso 1 / Paso 5)
    batteryService   -> reglas de batería (Admin → Batería / Paso 3)
    damageService    -> desperfectos (Admin → Desperfectos / Paso 4)
    contactService   -> datos de contacto (Admin → Contacto)
    pricingService    -> cálculo de la cotización, 100% en USD
    authService      -> usuario/contraseña del panel admin
    backupService    -> exportar / importar / restaurar de fábrica

  Todo vive bajo estas keys de localStorage (versión "v2" porque
  esta iteración cambia la moneda a USD y la forma de las reglas de
  batería/desperfectos — los datos de una versión anterior del panel
  no migran automáticamente):
*/

const STORE_KEY = "appletech_store_v2";
const AUTH_KEY = "appletech_auth_v2";
const SESSION_KEY = "appletech_admin_session_v2";
const DEFAULT_ADMIN_USER = "admin";
const DEFAULT_ADMIN_PASS = "admin123";

/* ============================================================
   StorageService — leer/guardar el STORE completo
   ============================================================ */
function normalizeStore(raw) {
  const base = defaultStore();
  const s = Object.assign({}, base, raw || {});

  s.meta = Object.assign({}, base.meta, (raw && raw.meta) || {});
  s.contact = Object.assign({}, base.contact, (raw && raw.contact) || {});

  // Nota: un array VACÍO es un valor válido (el administrador puede
  // vaciar el catálogo de venta a propósito) — solo se cae a los
  // valores de fábrica si el dato ni siquiera es un array, o si
  // contiene elementos con forma inválida (dato corrupto).
  const catalogOk = Array.isArray(s.catalog) &&
    s.catalog.every((it) => it && it.id && it.nombre && typeof it.precioBaseUSD === "number");
  if (!catalogOk) s.catalog = base.catalog;
  // Compatibilidad: catálogos guardados antes de agregar "imagenUrl".
  s.catalog = s.catalog.map((it) => Object.assign({ imagenUrl: "" }, it));

  const damagesOk = Array.isArray(s.desperfectos) &&
    s.desperfectos.every((it) => it && it.id && typeof it.descuentoUSD === "number");
  if (!damagesOk) s.desperfectos = base.desperfectos;
  // Compatibilidad: si algún registro no trae "activo", se asume visible.
  s.desperfectos = s.desperfectos.map((d) => Object.assign({ activo: true, descripcion: "" }, d));

  const batteryOk = Array.isArray(s.bateria) &&
    s.bateria.every((it) => it && it.id && typeof it.descuentoUSD === "number");
  if (!batteryOk) s.bateria = base.bateria;

  return s;
}

const StorageService = {
  loadStore() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (err) { raw = null; }
    const normalized = normalizeStore(raw);
    // Si no había nada guardado (primera visita) o el formato era
    // inválido, se guarda ya normalizado para que quede consistente,
    // pero SIN tocar "lastModified" (no es una edición real).
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(normalized)); } catch (err) { /* localStorage lleno o bloqueado */ }
    }
    return normalized;
  },

  /* touch=true (default) actualiza meta.lastModified: usar SIEMPRE
     que el cambio venga de una edición real del administrador.
     touch=false se usa solo para restaurar backups con su propia
     fecha, o para el guardado silencioso de normalización. */
  saveStore(store, options) {
    const touch = !options || options.touch !== false;
    if (touch) {
      store.meta = store.meta || {};
      store.meta.lastModified = Date.now();
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    return store;
  },
};

/* ============================================================
   catalogService — CATÁLOGO DE VENTA (Admin → Precios).
   ------------------------------------------------------------
   Exclusivo del Paso 5 ("¿vas a comprar otro equipo?"). A
   propósito este servicio YA NO tiene ningún método para el Paso 1
   — el Paso 1 usa tradeInCatalogService, que es 100% independiente
   de este catálogo (ver más abajo). Mezclar ambos fue justamente el
   bug de la iteración anterior.
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
  create(data) {
    const store = StorageService.loadStore();
    const item = {
      id: data.id || ("m_" + Date.now()),
      nombre: data.nombre || "Nuevo modelo",
      precioBaseUSD: Math.max(0, Number(data.precioBaseUSD) || 0),
      stock: data.stock ? 1 : 0,
      estado: data.estado || "draft",
      imagenUrl: data.imagenUrl || "",
    };
    store.catalog.push(item);
    StorageService.saveStore(store);
    return item;
  },
  update(id, patch) {
    const store = StorageService.loadStore();
    const item = store.catalog.find((m) => m.id === id);
    if (!item) return null;
    if (patch.nombre !== undefined) item.nombre = String(patch.nombre);
    if (patch.precioBaseUSD !== undefined) item.precioBaseUSD = Math.max(0, Number(patch.precioBaseUSD) || 0);
    if (patch.stock !== undefined) item.stock = patch.stock ? 1 : 0;
    if (patch.estado !== undefined) item.estado = patch.estado;
    if (patch.imagenUrl !== undefined) item.imagenUrl = String(patch.imagenUrl);
    StorageService.saveStore(store);
    return item;
  },
  remove(id) {
    const store = StorageService.loadStore();
    store.catalog = store.catalog.filter((m) => m.id !== id);
    StorageService.saveStore(store);
  },
};

/* ============================================================
   tradeInCatalogService — CATÁLOGO DE CANJE (Paso 1).
   ------------------------------------------------------------
   Lee exclusivamente STATIC_CONFIG.modelosCanje (config.js): una
   lista fija que NO pasa por localStorage y NO la toca el Admin.
   Por diseño no tiene create/update/remove — es intencionalmente
   de solo lectura en esta iteración, para que sea IMPOSIBLE que
   quede vacía o dependa de ediciones del catálogo de venta.
   ============================================================ */
const tradeInCatalogService = {
  getAll() {
    return STATIC_CONFIG.modelosCanje.slice();
  },
  getById(id) {
    return STATIC_CONFIG.modelosCanje.find((m) => m.id === id) || null;
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
  create(data) {
    const store = StorageService.loadStore();
    const item = {
      id: data.id || ("b_" + Date.now()),
      porcentajeMinimo: Math.max(0, Math.min(100, Number(data.porcentajeMinimo) || 0)),
      porcentajeMaximo: Math.max(0, Math.min(100, Number(data.porcentajeMaximo) || 0)),
      descuentoUSD: Math.max(0, Number(data.descuentoUSD) || 0),
      label: data.label || "Nuevo rango",
      desc: data.desc || "",
    };
    store.bateria.push(item);
    StorageService.saveStore(store);
    return item;
  },
  update(id, patch) {
    const store = StorageService.loadStore();
    const item = store.bateria.find((b) => b.id === id);
    if (!item) return null;
    if (patch.porcentajeMinimo !== undefined) item.porcentajeMinimo = Math.max(0, Math.min(100, Number(patch.porcentajeMinimo) || 0));
    if (patch.porcentajeMaximo !== undefined) item.porcentajeMaximo = Math.max(0, Math.min(100, Number(patch.porcentajeMaximo) || 0));
    if (patch.descuentoUSD !== undefined) item.descuentoUSD = Math.max(0, Number(patch.descuentoUSD) || 0);
    if (patch.label !== undefined) item.label = String(patch.label);
    if (patch.desc !== undefined) item.desc = String(patch.desc);
    StorageService.saveStore(store);
    return item;
  },
  remove(id) {
    const store = StorageService.loadStore();
    store.bateria = store.bateria.filter((b) => b.id !== id);
    StorageService.saveStore(store);
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
      id: data.id || ("d_" + Date.now()),
      nombre: data.nombre || "Nuevo desperfecto",
      descripcion: data.descripcion || "",
      descuentoUSD: Math.max(0, Number(data.descuentoUSD) || 0),
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
    if (patch.nombre !== undefined) item.nombre = String(patch.nombre);
    if (patch.descripcion !== undefined) item.descripcion = String(patch.descripcion);
    if (patch.descuentoUSD !== undefined) item.descuentoUSD = Math.max(0, Number(patch.descuentoUSD) || 0);
    if (patch.activo !== undefined) item.activo = !!patch.activo;
    StorageService.saveStore(store);
    return item;
  },
  toggleActive(id) {
    const store = StorageService.loadStore();
    const item = store.desperfectos.find((d) => d.id === id);
    if (!item) return null;
    item.activo = !item.activo;
    StorageService.saveStore(store);
    return item;
  },
  remove(id) {
    const store = StorageService.loadStore();
    store.desperfectos = store.desperfectos.filter((d) => d.id !== id);
    StorageService.saveStore(store);
  },
};

/* ============================================================
   contactService — datos de contacto centralizados
   ============================================================ */
const contactService = {
  get() {
    return Object.assign({}, StorageService.loadStore().contact);
  },
  update(patch) {
    const store = StorageService.loadStore();
    store.contact = Object.assign({}, store.contact, patch);
    StorageService.saveStore(store);
    return store.contact;
  },
};

/* ============================================================
   pricingService — TODO el cálculo de la cotización, en USD
   ============================================================
   Fórmula (según el documento):
     precioBaseUSD           = precio del modelo * factor de capacidad
     descuentoBateriaUSD     = monto fijo de la regla de batería elegida
     descuentoDesperfectosUSD = suma de los desperfectos tildados (solo activos)
     valorFinalUSD           = precioBaseUSD - descuentoBateriaUSD - descuentoDesperfectosUSD (mínimo 0)
*/
const pricingService = {
  getCapacidad(id) {
    return STATIC_CONFIG.capacidades.find((c) => c.id === id) || null;
  },
  getColor(id) {
    return STATIC_CONFIG.colores.find((c) => c.id === id) || null;
  },
  calculateQuote({ modeloId, capacidadId, bateriaId, desperfectoIds }) {
    // El valor de canje se calcula SIEMPRE sobre tradeInCatalogService
    // (independiente del catálogo Admin), nunca sobre catalogService.
    const modelo = tradeInCatalogService.getById(modeloId);
    const capacidad = this.getCapacidad(capacidadId);
    if (!modelo || !capacidad) return null;

    const precioBaseUSD = round2(modelo.precioBaseUSD * capacidad.factor);

    const bateria = bateriaId ? batteryService.getById(bateriaId) : null;
    const descuentoBateriaUSD = bateria ? round2(Number(bateria.descuentoUSD) || 0) : 0;

    const activos = damageService.getActive();
    const descuentoDesperfectosUSD = round2((desperfectoIds || []).reduce((acc, id) => {
      const d = activos.find((x) => x.id === id);
      return acc + (d ? Number(d.descuentoUSD) || 0 : 0);
    }, 0));

    const valorFinalUSD = Math.max(0, round2(precioBaseUSD - descuentoBateriaUSD - descuentoDesperfectosUSD));

    return { precioBaseUSD, descuentoBateriaUSD, descuentoDesperfectosUSD, valorFinalUSD };
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
   authService — usuario/contraseña del panel admin
   ============================================================
   Seguridad real de este esquema: como pide el documento, el
   candado es LOCAL AL DISPOSITIVO (no hay backend). Igual se
   evita guardar la contraseña en texto plano: se guarda un hash
   SHA-256 con "sal" (salt) aleatoria, para que abrir el
   localStorage del navegador no muestre la contraseña directamente.
*/
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSaltHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bufferToHex(bytes.buffer);
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(digest);
}

const authService = {
  _initPromise: null,

  /* Se puede llamar varias veces: la primera vez crea las
     credenciales por defecto (admin / admin123) si no existen
     todavía; el resto de las veces devuelve la misma promesa. */
  init() {
    if (!this._initPromise) {
      this._initPromise = (async () => {
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch (err) { raw = null; }
        if (!raw || !raw.user || !raw.hash || !raw.salt) {
          await this.resetToDefault();
        }
      })();
    }
    return this._initPromise;
  },

  async resetToDefault() {
    const salt = randomSaltHex();
    const hash = await sha256Hex(salt + DEFAULT_ADMIN_PASS);
    const auth = { user: DEFAULT_ADMIN_USER, salt, hash };
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    return auth;
  },

  _load() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch (err) { return null; }
  },

  async getUsername() {
    await this.init();
    const auth = this._load();
    return auth ? auth.user : DEFAULT_ADMIN_USER;
  },

  async verify(user, pass) {
    await this.init();
    const auth = this._load();
    if (!auth) return false;
    if (String(user) !== String(auth.user)) return false;
    const hash = await sha256Hex(auth.salt + String(pass));
    return hash === auth.hash;
  },

  /* Cambia usuario y/o contraseña. Si newPass viene vacío, se
     mantiene la contraseña actual (solo cambia el usuario). */
  async changeCredentials(newUser, newPass) {
    await this.init();
    const auth = this._load() || { user: DEFAULT_ADMIN_USER };
    const user = (newUser || "").trim() || auth.user;
    let salt = auth.salt;
    let hash = auth.hash;
    if (newPass) {
      salt = randomSaltHex();
      hash = await sha256Hex(salt + newPass);
    }
    const next = { user, salt, hash };
    localStorage.setItem(AUTH_KEY, JSON.stringify(next));
    return next;
  },

  isLoggedIn() {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  },
  startSession() {
    sessionStorage.setItem(SESSION_KEY, "1");
  },
  endSession() {
    sessionStorage.removeItem(SESSION_KEY);
  },
};

/* ============================================================
   backupService — exportar / importar / restaurar de fábrica
   ============================================================
   Por seguridad, el backup NO incluye usuario/contraseña (eso se
   administra aparte, desde Admin → Seguridad, con su propio botón
   de "Restablecer credenciales").
*/
const backupService = {
  exportJSON() {
    const store = StorageService.loadStore();
    const payload = {
      tipo: "appletech-backup",
      version: 2,
      exportadoEl: new Date().toISOString(),
      store,
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
    const rawStore = parsed && parsed.store ? parsed.store : parsed;
    if (!rawStore || typeof rawStore !== "object") {
      return { ok: false, error: "El archivo no tiene el formato esperado." };
    }
    const normalized = normalizeStore(rawStore);
    StorageService.saveStore(normalized, { touch: true });
    return { ok: true };
  },

  restoreFactoryDefaults() {
    const fresh = defaultStore();
    StorageService.saveStore(fresh, { touch: true });
    return fresh;
  },
};
