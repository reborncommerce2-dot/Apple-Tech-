/*
  config.js = LOS DATOS DE EJEMPLO (semilla) + EL CATÁLOGO DE CANJE.
  ------------------------------------------------------------
  Acá conviven DOS cosas de naturaleza distinta, a propósito:

  1) STATIC_CONFIG.modelosCanje: el catálogo de CANJE del Paso 1
     ("¿Qué iPhone tenés?"). Es una lista FIJA, no se persiste en
     localStorage y no la edita el Admin. Existe para que el Paso 1
     nunca dependa del catálogo de venta (ver defaultCatalog más
     abajo) — ni de su stock, ni de su estado, ni de si está vacío.

  2) defaultCatalog(): los datos de ejemplo del catálogo de VENTA
     (Admin → Precios), que sí se guardan en localStorage y sí los
     edita el administrador. Es exclusivo del Paso 5.

  El resto de este archivo (desperfectos, batería, contacto) son los
  datos de ejemplo del resto del STORE administrable, igual que
  antes. Solo se usan la PRIMERA vez que se abre el sitio; después
  todo lo administrable vive en localStorage y lo lee services.js.

  Ningún precio de acá abajo es un precio real de Apple Tech — son
  valores de ejemplo en USD. Los de venta se cambian desde Admin →
  Precios; los de canje son de referencia fija en esta iteración.
*/

const STATIC_CONFIG = {
  // "factor" multiplica el precioBaseUSD del modelo (precio de
  // referencia = capacidad 128 GB, factor 1.0).
  capacidades: [
    { id: "64gb", nombre: "64 GB", factor: 0.92 },
    { id: "128gb", nombre: "128 GB", factor: 1.0 },
    { id: "256gb", nombre: "256 GB", factor: 1.12 },
    { id: "512gb", nombre: "512 GB", factor: 1.3 },
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
  modelosCanje: [
    { id: "ip11", nombre: "iPhone 11", precioBaseUSD: 110 },
    { id: "ip11pro", nombre: "iPhone 11 Pro", precioBaseUSD: 140 },
    { id: "ip11promax", nombre: "iPhone 11 Pro Max", precioBaseUSD: 155 },
    { id: "ip12", nombre: "iPhone 12", precioBaseUSD: 150 },
    { id: "ip12pro", nombre: "iPhone 12 Pro", precioBaseUSD: 190 },
    { id: "ip12promax", nombre: "iPhone 12 Pro Max", precioBaseUSD: 210 },
    { id: "ip13", nombre: "iPhone 13", precioBaseUSD: 200 },
    { id: "ip13pro", nombre: "iPhone 13 Pro", precioBaseUSD: 260 },
    { id: "ip13promax", nombre: "iPhone 13 Pro Max", precioBaseUSD: 290 },
    { id: "ip14", nombre: "iPhone 14", precioBaseUSD: 260 },
    { id: "ip14pro", nombre: "iPhone 14 Pro", precioBaseUSD: 340 },
    { id: "ip14promax", nombre: "iPhone 14 Pro Max", precioBaseUSD: 380 },
    { id: "ip15", nombre: "iPhone 15", precioBaseUSD: 340 },
    { id: "ip15pro", nombre: "iPhone 15 Pro", precioBaseUSD: 460 },
    { id: "ip15promax", nombre: "iPhone 15 Pro Max", precioBaseUSD: 510 },
    { id: "ip16", nombre: "iPhone 16", precioBaseUSD: 460 },
    { id: "ip16pro", nombre: "iPhone 16 Pro", precioBaseUSD: 580 },
    { id: "ip16promax", nombre: "iPhone 16 Pro Max", precioBaseUSD: 640 },
    { id: "ip17", nombre: "iPhone 17", precioBaseUSD: 560 },
    { id: "ip17pro", nombre: "iPhone 17 Pro", precioBaseUSD: 700 },
    { id: "ip17promax", nombre: "iPhone 17 Pro Max", precioBaseUSD: 780 },
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
  };
}
