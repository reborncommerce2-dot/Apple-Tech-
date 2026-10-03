/*
  config.js = LOS DATOS DE EJEMPLO (semilla) del STORE administrable.
  ------------------------------------------------------------
  Iteración 4: ya no existe NINGUNA lista fija de identidad (ni
  modelos de canje ni capacidades). Todo lo que antes vivía en
  STATIC_CONFIG como lista fija ahora es un dato semilla que se
  persiste en localStorage y el Admin puede crear, editar y
  eliminar libremente. Este archivo solo define los valores de
  ejemplo con los que arranca el sitio la PRIMERA vez (o cuando
  falta algún dato administrable en localStorage, como migración);
  después todo vive en localStorage y lo lee servicios.js.

  Qué hay acá:

  1) defaultModelos(): identidad administrable de los modelos de
     CANJE del Paso 1 ("¿Qué iPhone tenés?") — id + nombre +
     capacidadIds (qué capacidades tiene ESE modelo en particular).
     Se persiste en el STORE bajo "modelos" y lo administra
     modeloService (Admin → Valoración). Si se crea un modelo,
     aparece solo en el Paso 1; si se elimina, desaparece solo.

  2) defaultCapacidades(): catálogo administrable de capacidades de
     almacenamiento (64GB, 128GB, etc.) — id + nombre + activo. Se
     persiste bajo "capacidades" y lo administra capacidadService
     (Admin → Capacidades). Cada modelo elige, de esta lista, cuáles
     le corresponden (ver "capacidadIds" en defaultModelos()).

  3) defaultTradeInValues(): los datos de ejemplo de Admin →
     Valoración ("valoraciones", persistido y 100% editable) — el
     valor de canje en USD de cada combinación modelo × capacidad.
     Acá vive el único lugar de todo el proyecto donde existe un
     precio de canje; no hay ningún cálculo de precio "hardcodeado"
     en el motor (services.js), ni fórmulas, ni multiplicadores.

  4) defaultCatalog(): los datos de ejemplo del catálogo de VENTA
     (Admin → Catálogo), que también se guardan en localStorage y
     también los edita el administrador. Es exclusivo del Paso 5 y
     es una estructura totalmente distinta de "modelos" (canje) —
     no se tocó en esta iteración.

  El resto de este archivo (desperfectos, batería, contacto) son los
  datos de ejemplo del resto del STORE administrable, igual que
  antes.

  Ningún valor de acá abajo es un precio real de Apple Tech — son
  valores de ejemplo en USD, 100% editables desde Admin.
*/

const STATIC_CONFIG = {
  // El color no afecta el precio, es solo un dato del equipo. No lo
  // pidió administrable el documento de esta iteración, así que se
  // mantiene como lista fija de referencia (sin impacto en precios).
  colores: [
    { id: "negro", nombre: "Negro", hex: "#1c1c1e" },
    { id: "blanco", nombre: "Blanco", hex: "#f5f5f0" },
    { id: "azul", nombre: "Azul", hex: "#5c7fa8" },
    { id: "dorado", nombre: "Dorado", hex: "#e8c88a" },
    { id: "verde", nombre: "Verde", hex: "#5c7a63" },
    { id: "rosa", nombre: "Rosa", hex: "#e6b4bb" },
  ],
};

/* ------------------------------------------------------------
   CAPACIDADES (Admin → Capacidades): catálogo administrable de
   capacidades de almacenamiento posibles. Cada una tiene:
     id     -> identificador estable (lo referencian modelos y valoraciones)
     nombre -> lo que ve el admin y el cliente
     activo -> si aparece o no como opción en el Paso 2 del cotizador
   Estos 4 son los de ejemplo con los que arranca el sitio; el Admin
   puede agregar, renombrar, desactivar o eliminar cualquiera.
   ------------------------------------------------------------ */
function defaultCapacidades() {
  return [
    { id: "64gb", nombre: "64 GB", activo: true },
    { id: "128gb", nombre: "128 GB", activo: true },
    { id: "256gb", nombre: "256 GB", activo: true },
    { id: "512gb", nombre: "512 GB", activo: true },
  ];
}

/* ------------------------------------------------------------
   MODELOS (Admin → Valoración): identidad administrable de los
   modelos de CANJE del Paso 1. Reemplaza a la vieja lista fija
   STATIC_CONFIG.modelosCanje (eliminada en esta iteración). Cada
   modelo tiene:
     id            -> identificador estable (lo referencian las valoraciones)
     nombre        -> lo que ve el cliente en el Paso 1
     capacidadIds  -> qué capacidades (de defaultCapacidades) tiene ESTE
                      modelo — no todos los modelos tienen las mismas.

   Estos 21 son los de ejemplo con los que arranca el sitio (mismos
   21 modelos e ids que la vieja lista fija, para que la migración
   automática desde una instalación anterior no pierda ningún dato:
   ver normalizeStore() en services.js). El Admin puede agregar,
   renombrar, eliminar modelos y asociarles/quitarles capacidades
   libremente desde acá en adelante.
   ------------------------------------------------------------ */
function defaultModelos() {
  // Los 21 modelos de ejemplo arrancan con las 4 capacidades de
  // ejemplo asociadas (así se preserva 1:1 el comportamiento que ya
  // tenía el sitio antes de esta iteración, donde las 4 capacidades
  // aplicaban por igual a los 21 modelos).
  const TODAS_LAS_CAPACIDADES = ["64gb", "128gb", "256gb", "512gb"];
  function mkModelo(id, nombre) {
    return { id, nombre, capacidadIds: TODAS_LAS_CAPACIDADES.slice() };
  }
  return [
    mkModelo("ip11", "iPhone 11"),
    mkModelo("ip11pro", "iPhone 11 Pro"),
    mkModelo("ip11promax", "iPhone 11 Pro Max"),
    mkModelo("ip12", "iPhone 12"),
    mkModelo("ip12pro", "iPhone 12 Pro"),
    mkModelo("ip12promax", "iPhone 12 Pro Max"),
    mkModelo("ip13", "iPhone 13"),
    mkModelo("ip13pro", "iPhone 13 Pro"),
    mkModelo("ip13promax", "iPhone 13 Pro Max"),
    mkModelo("ip14", "iPhone 14"),
    mkModelo("ip14pro", "iPhone 14 Pro"),
    mkModelo("ip14promax", "iPhone 14 Pro Max"),
    mkModelo("ip15", "iPhone 15"),
    mkModelo("ip15pro", "iPhone 15 Pro"),
    mkModelo("ip15promax", "iPhone 15 Pro Max"),
    mkModelo("ip16", "iPhone 16"),
    mkModelo("ip16pro", "iPhone 16 Pro"),
    mkModelo("ip16promax", "iPhone 16 Pro Max"),
    mkModelo("ip17", "iPhone 17"),
    mkModelo("ip17pro", "iPhone 17 Pro"),
    mkModelo("ip17promax", "iPhone 17 Pro Max"),
  ];
}

/* Catálogo de VENTA Apple Tech (Admin → Precios), exclusivo del
   Paso 5 ("¿vas a comprar otro equipo?"). Son 21 productos de
   ejemplo para arrancar, pero a diferencia de "modelos" (canje) de
   arriba, este catálogo es una entidad de negocio totalmente
   distinta: el administrador lo puede crear/editar/eliminar/
   ocultar/despublicar libremente — incluso vaciarlo por completo —
   sin que eso afecte al Paso 1.
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
   Esta es la migración automática de lo que en su momento se
   calculaba como "precioBaseUSD del modelo × factor de la
   capacidad" (ver CHANGELOG.md — iteración 3). Se generaron estos
   84 valores UNA SOLA VEZ, reproduciendo exactamente esa fórmula
   vieja, para no perder ningún dato: a partir de acá son valores
   comunes, 100% editables desde Admin → Valoración.
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

/* Estructura completa que se guarda en localStorage la primera vez.
   quotesHistory, leads y auditLog arrancan vacíos: son datos que
   genera el USO del sitio (clientes cotizando, admin editando), no
   datos de ejemplo. */
function defaultStore() {
  return {
    meta: { lastModified: null },
    contact: defaultContact(),
    catalog: defaultCatalog(),
    desperfectos: defaultDesperfectos(),
    bateria: defaultBateria(),
    modelos: defaultModelos(),
    capacidades: defaultCapacidades(),
    valoraciones: defaultTradeInValues(),
    quotesHistory: [],
    leads: [],
    auditLog: [],
  };
}
