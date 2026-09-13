/*
  config.js = LOS DATOS DE EJEMPLO (semilla) + EL CATÁLOGO DE CANJE.
  ------------------------------------------------------------
  Acá conviven varias cosas de naturaleza distinta, a propósito:

  1) STATIC_CONFIG.modelosCanje: la IDENTIDAD del catálogo de CANJE
     del Paso 1 ("¿Qué iPhone tenés?") — solo id + nombre. Es una
     lista FIJA, no se persiste en localStorage y no la edita el
     Admin. Existe para que el Paso 1 nunca dependa de datos
     administrables (ni del catálogo de venta, ni de Valoración).

  2) STATIC_CONFIG.capacidades: lista fija de referencia (id +
     nombre, SIN factores ni multiplicadores) para pintar los chips
     de capacidad del Paso 2 y como opciones del formulario de
     Admin → Valoración.

  3) defaultTradeInValues(): los datos de ejemplo de Admin →
     Valoración (`tradeInValues`, persistido y 100% editable) — el
     valor de canje en USD de cada combinación modelo × capacidad.
     Acá vive el único lugar de todo el proyecto donde existe un
     precio de canje; no hay ningún cálculo de precio "hardcodeado"
     en el motor (services.js).

  4) defaultCatalog(): los datos de ejemplo del catálogo de VENTA
     (Admin → Catálogo), que también se guardan en localStorage y
     también los edita el administrador. Es exclusivo del Paso 5.

  El resto de este archivo (desperfectos, batería, contacto) son los
  datos de ejemplo del resto del STORE administrable, igual que
  antes. Todo lo de acá solo se usa la PRIMERA vez que se abre el
  sitio (o cuando falta algún dato administrable en localStorage,
  como migración); después todo vive en localStorage y lo lee
  services.js.

  Ningún valor de acá abajo es un precio real de Apple Tech — son
  valores de ejemplo en USD, 100% editables desde Admin.
*/

const STATIC_CONFIG = {
  // Capacidades: solo lista de referencia (id + nombre). Ya NO tienen
  // "factor" — cada combinación modelo/capacidad tiene su propio valor
  // de canje explícito en tradeInValues (ver más abajo), sin
  // multiplicadores. Se usan para pintar los chips del Paso 2 y como
  // opciones del formulario de Valoración en Admin.
  capacidades: [
    { id: "64gb", nombre: "64 GB" },
    { id: "128gb", nombre: "128 GB" },
    { id: "256gb", nombre: "256 GB" },
    { id: "512gb", nombre: "512 GB" },
  ],

  // El color no afecta el precio, es solo un dato del equipo.
  colores: [
    { id: "negro", nombre: "Negro", hex: "#1c1c1e" },
    { id: "blanco", nombre: "Blanco", hex: "#f5f5f0" },
    { id: "azul", nombre: "Azul", hex: "#5c7fa8" },
    { id: "dorado", nombre: "Dorado", hex: "#e8c88a" },
    { id: "verde", nombre: "Verde", hex: "#5c7a63" },
    { id: "rosa", nombre: "Rosa", hex: "#e6b4bb" },
  ],

  /* ------------------------------------------------------------
     CATÁLOGO DE CANJE (Paso 1 — "¿Qué iPhone tenés?").
     ------------------------------------------------------------
     A PROPÓSITO es una lista fija y completamente independiente
     del catálogo que administra el Admin (ese es el catálogo de
     VENTA, exclusivo del Paso 5 — ver catalogService/config
     "defaultCatalog" más abajo).

     Esta lista:
       - NO se guarda en localStorage.
       - NO se edita desde Admin.
       - NO depende de stock, estado ni disponibilidad de nada.
       - SIEMPRE contiene exactamente estos 21 modelos (11 al 17,
         con Pro y Pro Max), aunque el catálogo Admin esté vacío o
         todos sus productos estén ocultos/despublicados.

     precioBaseUSD acá es el valor de referencia de CANJE (lo que
     Apple Tech reconoce por el equipo usado), un concepto de
     negocio distinto del precio de VENTA del catálogo Admin.
     ------------------------------------------------------------ */
  /* ------------------------------------------------------------
     CATÁLOGO DE CANJE (Paso 1 — "¿Qué iPhone tenés?").
     ------------------------------------------------------------
     A PROPÓSITO es una lista fija y completamente independiente
     del catálogo que administra el Admin (ese es el catálogo de
     VENTA, exclusivo del Paso 5 — ver "defaultCatalog" más abajo) Y
     TAMBIÉN independiente de Valoración (ver "defaultTradeInValues"
     más abajo, administrable desde Admin → Valoración).

     Esta lista:
       - NO se guarda en localStorage.
       - NO se edita desde Admin.
       - NO depende de stock, estado, disponibilidad ni de que
         existan valoraciones cargadas para cada modelo.
       - SIEMPRE contiene exactamente estos 21 modelos (11 al 17,
         con Pro y Pro Max).

     Solo tiene id + nombre (identidad del modelo). Ya NO tiene
     precio: el valor de canje de cada modelo, por capacidad, vive
     en Admin → Valoración (tradeInValues) y lo busca pricingService
     por (modeloId, capacidadId) — sin ningún precio hardcodeado acá.
     ------------------------------------------------------------ */
  modelosCanje: [
    { id: "ip11", nombre: "iPhone 11" },
    { id: "ip11pro", nombre: "iPhone 11 Pro" },
    { id: "ip11promax", nombre: "iPhone 11 Pro Max" },
    { id: "ip12", nombre: "iPhone 12" },
    { id: "ip12pro", nombre: "iPhone 12 Pro" },
    { id: "ip12promax", nombre: "iPhone 12 Pro Max" },
    { id: "ip13", nombre: "iPhone 13" },
    { id: "ip13pro", nombre: "iPhone 13 Pro" },
    { id: "ip13promax", nombre: "iPhone 13 Pro Max" },
    { id: "ip14", nombre: "iPhone 14" },
    { id: "ip14pro", nombre: "iPhone 14 Pro" },
    { id: "ip14promax", nombre: "iPhone 14 Pro Max" },
    { id: "ip15", nombre: "iPhone 15" },
    { id: "ip15pro", nombre: "iPhone 15 Pro" },
    { id: "ip15promax", nombre: "iPhone 15 Pro Max" },
    { id: "ip16", nombre: "iPhone 16" },
    { id: "ip16pro", nombre: "iPhone 16 Pro" },
    { id: "ip16promax", nombre: "iPhone 16 Pro Max" },
    { id: "ip17", nombre: "iPhone 17" },
    { id: "ip17pro", nombre: "iPhone 17 Pro" },
    { id: "ip17promax", nombre: "iPhone 17 Pro Max" },
  ],
};

/* Catálogo de VENTA Apple Tech (Admin → Precios), exclusivo del
   Paso 5 ("¿vas a comprar otro equipo?"). Son 21 productos de
   ejemplo para arrancar, pero a diferencia de "modelosCanje" de
   arriba, ESTE catálogo SÍ vive en localStorage y el administrador
   lo puede crear/editar/eliminar/ocultar/despublicar libremente —
   incluso vaciarlo por completo — sin que eso afecte al Paso 1.
   estado: "published" (visible y disponible), "out" (visible, sin
   stock, no se puede comprar), "draft" (oculto por completo).
   imagenUrl: opcional, foto del equipo a la venta. */
function defaultCatalog() {
  return [
    { id: "ip11", nombre: "iPhone 11", precioBaseUSD: 110, stock: 1, estado: "published", imagenUrl: "" },
    { id: "ip11pro", nombre: "iPhone 11 Pro", precioBaseUSD: 140, stock: 1, estado: "published", imagenUrl: "" },
    { id: "ip11promax", nombre: "iPhone 11 Pro Max", precioBaseUSD: 155, stock: 1, estado: "published", imagenUrl: "" },
    { id: "ip12", nombre: "iPhone 12", precioBaseUSD: 150, stock: 1, estado: "published", imagenUrl: "" },
    { id: "ip12pro", nombre: "iPhone 12 Pro", precioBaseUSD: 190, stock: 1, estado: "published", imagenUrl: "" },
    { id: "ip12promax", nombre: "iPhone 12 Pro Max", precioBaseUSD: 210, stock: 1, estado: "published", imagenUrl: "" },
    { id: "ip13", nombre: "iPhone 13", precioBaseUSD: 200, stock: 1, estado: "published", imagenUrl: "" },
    { id: "ip13pro", nombre: "iPhone 13 Pro", precioBaseUSD: 260, stock: 0, estado: "out", imagenUrl: "" },
    { id: "ip13promax", nombre: "iPhone 13 Pro Max", precioBaseUSD: 290, stock: 0, estado: "out", imagenUrl: "" },
    { id: "ip14", nombre: "iPhone 14", precioBaseUSD: 260, stock: 1, estado: "published", imagenUrl: "" },
    { id: "ip14pro", nombre: "iPhone 14 Pro", precioBaseUSD: 340, stock: 0, estado: "out", imagenUrl: "" },
    { id: "ip14promax", nombre: "iPhone 14 Pro Max", precioBaseUSD: 380, stock: 0, estado: "out", imagenUrl: "" },
    { id: "ip15", nombre: "iPhone 15", precioBaseUSD: 340, stock: 1, estado: "published", imagenUrl: "" },
    { id: "ip15pro", nombre: "iPhone 15 Pro", precioBaseUSD: 460, stock: 0, estado: "out", imagenUrl: "" },
    { id: "ip15promax", nombre: "iPhone 15 Pro Max", precioBaseUSD: 510, stock: 1, estado: "published", imagenUrl: "" },
    { id: "ip16", nombre: "iPhone 16", precioBaseUSD: 460, stock: 1, estado: "published", imagenUrl: "" },
    { id: "ip16pro", nombre: "iPhone 16 Pro", precioBaseUSD: 580, stock: 0, estado: "out", imagenUrl: "" },
    { id: "ip16promax", nombre: "iPhone 16 Pro Max", precioBaseUSD: 640, stock: 1, estado: "published", imagenUrl: "" },
    { id: "ip17", nombre: "iPhone 17", precioBaseUSD: 560, stock: 0, estado: "draft", imagenUrl: "" },
    { id: "ip17pro", nombre: "iPhone 17 Pro", precioBaseUSD: 700, stock: 0, estado: "draft", imagenUrl: "" },
    { id: "ip17promax", nombre: "iPhone 17 Pro Max", precioBaseUSD: 780, stock: 0, estado: "draft", imagenUrl: "" },
  ];
}

/* Desperfectos precargados (los 10 que pide el documento).
   descuentoUSD = monto fijo en USD que se resta si el cliente lo
   marca. activo = si aparece o no en el paso 4 del cotizador. */
function defaultDesperfectos() {
  return [
    { id: "pantalla", nombre: "Pantalla rota", descripcion: "Pantalla con rotura, rajaduras, manchas o líneas visibles.", descuentoUSD: 60, activo: true },
    { id: "faceid", nombre: "Face ID defectuoso", descripcion: "El reconocimiento facial no funciona o falla constantemente.", descuentoUSD: 40, activo: true },
    { id: "camara", nombre: "Cámara dañada", descripcion: "Alguna cámara no enfoca, no abre o tiene fallas visibles.", descuentoUSD: 30, activo: true },
    { id: "tapa", nombre: "Tapa trasera dañada", descripcion: "Vidrio trasero rajado, roto o con faltantes.", descuentoUSD: 20, activo: true },
    { id: "parlantes", nombre: "Parlantes defectuosos", descripcion: "El audio suena distorsionado, bajo o no funciona.", descuentoUSD: 15, activo: true },
    { id: "microfono", nombre: "Micrófono defectuoso", descripcion: "La otra persona no te escucha bien en llamadas.", descuentoUSD: 12, activo: true },
    { id: "botones", nombre: "Botones defectuosos", descripcion: "Volumen, silencio o botón lateral no responden bien.", descuentoUSD: 10, activo: true },
    { id: "truetone", nombre: "True Tone no funcional", descripcion: "La pantalla perdió la función True Tone (común al cambiar pantalla).", descuentoUSD: 15, activo: true },
    { id: "puerto", nombre: "Puerto de carga defectuoso", descripcion: "Carga lento, intermitente, o hay que acomodar el cable.", descuentoUSD: 15, activo: true },
    { id: "bateria_danada", nombre: "Batería dañada", descripcion: "Se descarga muy rápido, se apaga solo o está hinchada.", descuentoUSD: 25, activo: true },
  ];
}

/* Reglas de batería (5 rangos por defecto). El descuento es un
   MONTO FIJO en USD (no un porcentaje), como pide el documento. */
function defaultBateria() {
  return [
    { id: "b90", porcentajeMinimo: 90, porcentajeMaximo: 100, descuentoUSD: 0, label: "90% – 100%", desc: "Como nueva" },
    { id: "b80", porcentajeMinimo: 80, porcentajeMaximo: 89, descuentoUSD: 15, label: "80% – 89%", desc: "Buen estado" },
    { id: "b70", porcentajeMinimo: 70, porcentajeMaximo: 79, descuentoUSD: 35, label: "70% – 79%", desc: "Uso notorio" },
    { id: "b60", porcentajeMinimo: 60, porcentajeMaximo: 69, descuentoUSD: 60, label: "60% – 69%", desc: "Rendimiento reducido" },
    { id: "bmenos", porcentajeMinimo: 0, porcentajeMaximo: 59, descuentoUSD: 100, label: "Menos de 60%", desc: "Se recomienda cambio" },
  ];
}

/* ------------------------------------------------------------
   VALORACIÓN (Admin → Valoración): valor de canje por cada
   combinación modelo/capacidad, en USD, SIN multiplicadores.
   ------------------------------------------------------------
   Esta es la migración automática de lo que antes se calculaba
   como "precioBaseUSD del modelo × factor de la capacidad" (ver
   CHANGELOG.md — iteración anterior). Se generaron estos 84
   valores UNA SOLA VEZ, reproduciendo exactamente esa fórmula
   vieja, para no perder ningún dato: a partir de acá son valores
   comunes, 100% editables desde Admin → Valoración, y la fórmula
   de multiplicar por capacidad ya NO EXISTE en ningún lado del
   código — cada fila de acá abajo es un valor independiente.
   ------------------------------------------------------------ */
function defaultTradeInValues() {
  return [
    { id: "tv_ip11_64gb", modeloId: "ip11", modeloNombre: "iPhone 11", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 101 },
    { id: "tv_ip11_128gb", modeloId: "ip11", modeloNombre: "iPhone 11", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 110 },
    { id: "tv_ip11_256gb", modeloId: "ip11", modeloNombre: "iPhone 11", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 123 },
    { id: "tv_ip11_512gb", modeloId: "ip11", modeloNombre: "iPhone 11", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 143 },
    { id: "tv_ip11pro_64gb", modeloId: "ip11pro", modeloNombre: "iPhone 11 Pro", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 129 },
    { id: "tv_ip11pro_128gb", modeloId: "ip11pro", modeloNombre: "iPhone 11 Pro", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 140 },
    { id: "tv_ip11pro_256gb", modeloId: "ip11pro", modeloNombre: "iPhone 11 Pro", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 157 },
    { id: "tv_ip11pro_512gb", modeloId: "ip11pro", modeloNombre: "iPhone 11 Pro", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 182 },
    { id: "tv_ip11promax_64gb", modeloId: "ip11promax", modeloNombre: "iPhone 11 Pro Max", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 143 },
    { id: "tv_ip11promax_128gb", modeloId: "ip11promax", modeloNombre: "iPhone 11 Pro Max", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 155 },
    { id: "tv_ip11promax_256gb", modeloId: "ip11promax", modeloNombre: "iPhone 11 Pro Max", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 174 },
    { id: "tv_ip11promax_512gb", modeloId: "ip11promax", modeloNombre: "iPhone 11 Pro Max", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 202 },
    { id: "tv_ip12_64gb", modeloId: "ip12", modeloNombre: "iPhone 12", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 138 },
    { id: "tv_ip12_128gb", modeloId: "ip12", modeloNombre: "iPhone 12", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 150 },
    { id: "tv_ip12_256gb", modeloId: "ip12", modeloNombre: "iPhone 12", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 168 },
    { id: "tv_ip12_512gb", modeloId: "ip12", modeloNombre: "iPhone 12", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 195 },
    { id: "tv_ip12pro_64gb", modeloId: "ip12pro", modeloNombre: "iPhone 12 Pro", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 175 },
    { id: "tv_ip12pro_128gb", modeloId: "ip12pro", modeloNombre: "iPhone 12 Pro", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 190 },
    { id: "tv_ip12pro_256gb", modeloId: "ip12pro", modeloNombre: "iPhone 12 Pro", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 213 },
    { id: "tv_ip12pro_512gb", modeloId: "ip12pro", modeloNombre: "iPhone 12 Pro", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 247 },
    { id: "tv_ip12promax_64gb", modeloId: "ip12promax", modeloNombre: "iPhone 12 Pro Max", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 193 },
    { id: "tv_ip12promax_128gb", modeloId: "ip12promax", modeloNombre: "iPhone 12 Pro Max", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 210 },
    { id: "tv_ip12promax_256gb", modeloId: "ip12promax", modeloNombre: "iPhone 12 Pro Max", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 235 },
    { id: "tv_ip12promax_512gb", modeloId: "ip12promax", modeloNombre: "iPhone 12 Pro Max", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 273 },
    { id: "tv_ip13_64gb", modeloId: "ip13", modeloNombre: "iPhone 13", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 184 },
    { id: "tv_ip13_128gb", modeloId: "ip13", modeloNombre: "iPhone 13", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 200 },
    { id: "tv_ip13_256gb", modeloId: "ip13", modeloNombre: "iPhone 13", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 224 },
    { id: "tv_ip13_512gb", modeloId: "ip13", modeloNombre: "iPhone 13", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 260 },
    { id: "tv_ip13pro_64gb", modeloId: "ip13pro", modeloNombre: "iPhone 13 Pro", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 239 },
    { id: "tv_ip13pro_128gb", modeloId: "ip13pro", modeloNombre: "iPhone 13 Pro", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 260 },
    { id: "tv_ip13pro_256gb", modeloId: "ip13pro", modeloNombre: "iPhone 13 Pro", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 291 },
    { id: "tv_ip13pro_512gb", modeloId: "ip13pro", modeloNombre: "iPhone 13 Pro", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 338 },
    { id: "tv_ip13promax_64gb", modeloId: "ip13promax", modeloNombre: "iPhone 13 Pro Max", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 267 },
    { id: "tv_ip13promax_128gb", modeloId: "ip13promax", modeloNombre: "iPhone 13 Pro Max", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 290 },
    { id: "tv_ip13promax_256gb", modeloId: "ip13promax", modeloNombre: "iPhone 13 Pro Max", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 325 },
    { id: "tv_ip13promax_512gb", modeloId: "ip13promax", modeloNombre: "iPhone 13 Pro Max", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 377 },
    { id: "tv_ip14_64gb", modeloId: "ip14", modeloNombre: "iPhone 14", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 239 },
    { id: "tv_ip14_128gb", modeloId: "ip14", modeloNombre: "iPhone 14", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 260 },
    { id: "tv_ip14_256gb", modeloId: "ip14", modeloNombre: "iPhone 14", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 291 },
    { id: "tv_ip14_512gb", modeloId: "ip14", modeloNombre: "iPhone 14", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 338 },
    { id: "tv_ip14pro_64gb", modeloId: "ip14pro", modeloNombre: "iPhone 14 Pro", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 313 },
    { id: "tv_ip14pro_128gb", modeloId: "ip14pro", modeloNombre: "iPhone 14 Pro", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 340 },
    { id: "tv_ip14pro_256gb", modeloId: "ip14pro", modeloNombre: "iPhone 14 Pro", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 381 },
    { id: "tv_ip14pro_512gb", modeloId: "ip14pro", modeloNombre: "iPhone 14 Pro", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 442 },
    { id: "tv_ip14promax_64gb", modeloId: "ip14promax", modeloNombre: "iPhone 14 Pro Max", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 350 },
    { id: "tv_ip14promax_128gb", modeloId: "ip14promax", modeloNombre: "iPhone 14 Pro Max", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 380 },
    { id: "tv_ip14promax_256gb", modeloId: "ip14promax", modeloNombre: "iPhone 14 Pro Max", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 426 },
    { id: "tv_ip14promax_512gb", modeloId: "ip14promax", modeloNombre: "iPhone 14 Pro Max", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 494 },
    { id: "tv_ip15_64gb", modeloId: "ip15", modeloNombre: "iPhone 15", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 313 },
    { id: "tv_ip15_128gb", modeloId: "ip15", modeloNombre: "iPhone 15", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 340 },
    { id: "tv_ip15_256gb", modeloId: "ip15", modeloNombre: "iPhone 15", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 381 },
    { id: "tv_ip15_512gb", modeloId: "ip15", modeloNombre: "iPhone 15", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 442 },
    { id: "tv_ip15pro_64gb", modeloId: "ip15pro", modeloNombre: "iPhone 15 Pro", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 423 },
    { id: "tv_ip15pro_128gb", modeloId: "ip15pro", modeloNombre: "iPhone 15 Pro", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 460 },
    { id: "tv_ip15pro_256gb", modeloId: "ip15pro", modeloNombre: "iPhone 15 Pro", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 515 },
    { id: "tv_ip15pro_512gb", modeloId: "ip15pro", modeloNombre: "iPhone 15 Pro", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 598 },
    { id: "tv_ip15promax_64gb", modeloId: "ip15promax", modeloNombre: "iPhone 15 Pro Max", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 469 },
    { id: "tv_ip15promax_128gb", modeloId: "ip15promax", modeloNombre: "iPhone 15 Pro Max", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 510 },
    { id: "tv_ip15promax_256gb", modeloId: "ip15promax", modeloNombre: "iPhone 15 Pro Max", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 571 },
    { id: "tv_ip15promax_512gb", modeloId: "ip15promax", modeloNombre: "iPhone 15 Pro Max", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 663 },
    { id: "tv_ip16_64gb", modeloId: "ip16", modeloNombre: "iPhone 16", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 423 },
    { id: "tv_ip16_128gb", modeloId: "ip16", modeloNombre: "iPhone 16", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 460 },
    { id: "tv_ip16_256gb", modeloId: "ip16", modeloNombre: "iPhone 16", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 515 },
    { id: "tv_ip16_512gb", modeloId: "ip16", modeloNombre: "iPhone 16", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 598 },
    { id: "tv_ip16pro_64gb", modeloId: "ip16pro", modeloNombre: "iPhone 16 Pro", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 534 },
    { id: "tv_ip16pro_128gb", modeloId: "ip16pro", modeloNombre: "iPhone 16 Pro", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 580 },
    { id: "tv_ip16pro_256gb", modeloId: "ip16pro", modeloNombre: "iPhone 16 Pro", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 650 },
    { id: "tv_ip16pro_512gb", modeloId: "ip16pro", modeloNombre: "iPhone 16 Pro", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 754 },
    { id: "tv_ip16promax_64gb", modeloId: "ip16promax", modeloNombre: "iPhone 16 Pro Max", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 589 },
    { id: "tv_ip16promax_128gb", modeloId: "ip16promax", modeloNombre: "iPhone 16 Pro Max", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 640 },
    { id: "tv_ip16promax_256gb", modeloId: "ip16promax", modeloNombre: "iPhone 16 Pro Max", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 717 },
    { id: "tv_ip16promax_512gb", modeloId: "ip16promax", modeloNombre: "iPhone 16 Pro Max", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 832 },
    { id: "tv_ip17_64gb", modeloId: "ip17", modeloNombre: "iPhone 17", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 515 },
    { id: "tv_ip17_128gb", modeloId: "ip17", modeloNombre: "iPhone 17", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 560 },
    { id: "tv_ip17_256gb", modeloId: "ip17", modeloNombre: "iPhone 17", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 627 },
    { id: "tv_ip17_512gb", modeloId: "ip17", modeloNombre: "iPhone 17", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 728 },
    { id: "tv_ip17pro_64gb", modeloId: "ip17pro", modeloNombre: "iPhone 17 Pro", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 644 },
    { id: "tv_ip17pro_128gb", modeloId: "ip17pro", modeloNombre: "iPhone 17 Pro", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 700 },
    { id: "tv_ip17pro_256gb", modeloId: "ip17pro", modeloNombre: "iPhone 17 Pro", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 784 },
    { id: "tv_ip17pro_512gb", modeloId: "ip17pro", modeloNombre: "iPhone 17 Pro", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 910 },
    { id: "tv_ip17promax_64gb", modeloId: "ip17promax", modeloNombre: "iPhone 17 Pro Max", capacidadId: "64gb", capacidadNombre: "64 GB", valorUSD: 718 },
    { id: "tv_ip17promax_128gb", modeloId: "ip17promax", modeloNombre: "iPhone 17 Pro Max", capacidadId: "128gb", capacidadNombre: "128 GB", valorUSD: 780 },
    { id: "tv_ip17promax_256gb", modeloId: "ip17promax", modeloNombre: "iPhone 17 Pro Max", capacidadId: "256gb", capacidadNombre: "256 GB", valorUSD: 874 },
    { id: "tv_ip17promax_512gb", modeloId: "ip17promax", modeloNombre: "iPhone 17 Pro Max", capacidadId: "512gb", capacidadNombre: "512 GB", valorUSD: 1014 },
  ];
}

function defaultContact() {
  return {
    businessName: "Apple Tech",
    phone: "",
    whatsapp: "5491159478541",
    instagram: "",
    address: "",
    hours: "",
  };
}

/* Estructura completa que se guarda en localStorage la primera vez. */
function defaultStore() {
  return {
    meta: { lastModified: null },
    contact: defaultContact(),
    catalog: defaultCatalog(),
    desperfectos: defaultDesperfectos(),
    bateria: defaultBateria(),
    valoraciones: defaultTradeInValues(),
  };
}
