/*
  script.js = EL COMPORTAMIENTO.
  Este archivo tiene dos partes bien separadas:

  1) CONFIG: los datos comerciales (modelos, precios, descuentos...).
     Esto es TODO EJEMPLO / FICTICIO para que puedas ver la app funcionando.
     Cuando tengas los precios reales, los cambiás acá — no hay que tocar
     el resto del archivo. Esta separación es justamente lo que pide el
     documento: "no hardcodear precios dentro del HTML/JS".

  2) LÓGICA: el motor que lee CONFIG, dibuja las pantallas y calcula
     la cotización.
*/

/* ============================================================
   1) CONFIG — DATOS COMERCIALES DE EJEMPLO (placeholder)
   ============================================================
   Todo lo que ves acá abajo es un valor DE EJEMPLO, inventado
   solamente para poder mostrar la app funcionando. Ningún precio
   acá es un precio real de Apple Tech.

   Más adelante, esto se puede mover a un archivo aparte (por ejemplo
   config.js) o a un panel de administración que escriba estos mismos
   datos — la lógica de abajo no necesita cambiar.
*/
const CONFIG = {

  // Ajuste según capacidad de almacenamiento. "factor" multiplica el
  // precio base del modelo (ej: 1 = precio base, 1.08 = +8%).
  capacidades: [
    { id: "64gb", nombre: "64 GB", factor: 0.92 },
    { id: "128gb", nombre: "128 GB", factor: 1.0 },
    { id: "256gb", nombre: "256 GB", factor: 1.12 },
    { id: "512gb", nombre: "512 GB", factor: 1.3 },
  ],

  // El color NO afecta el precio (según el documento). Se guarda
  // solo como dato del equipo.
  colores: [
    { id: "negro", nombre: "Negro", hex: "#1c1c1e" },
    { id: "blanco", nombre: "Blanco", hex: "#f5f5f0" },
    { id: "azul", nombre: "Azul", hex: "#5c7fa8" },
    { id: "dorado", nombre: "Dorado", hex: "#e8c88a" },
    { id: "verde", nombre: "Verde", hex: "#5c7a63" },
    { id: "rosa", nombre: "Rosa", hex: "#e6b4bb" },
  ],

  // Rangos de salud de batería. "ajuste" es un porcentaje que se
  // aplica sobre el valor ya calculado (negativo = descuento).
  // Se agregó el rango 60-69% como pide el documento.
  bateria: [
    { id: "b90", rango: "90% – 100%", desc: "Como nueva", ajuste: 0 },
    { id: "b80", rango: "80% – 89%", desc: "Buen estado", ajuste: -0.04 },
    { id: "b70", rango: "70% – 79%", desc: "Uso notorio", ajuste: -0.09 },
    { id: "b60", rango: "60% – 69%", desc: "Rendimiento reducido", ajuste: -0.16 },
    { id: "bmenos", rango: "Menos de 60%", desc: "Se recomienda cambio", ajuste: -0.25 },
  ],

  // Desperfectos comunes. "descuento" es un monto FIJO en pesos que
  // se resta del valor. Por ahora todos los seleccionados se suman
  // (según el documento, ninguno rechaza el equipo todavía).
  desperfectos: [
    { id: "pantalla", nombre: "Pantalla rota o con líneas", descuento: 45000 },
    { id: "tapa", nombre: "Tapa trasera dañada", descuento: 15000 },
    { id: "camara", nombre: "Cámara con fallas", descuento: 20000 },
    { id: "faceid", nombre: "Face ID no funciona", descuento: 30000 },
    { id: "puerto", nombre: "Puerto de carga dañado", descuento: 12000 },
    { id: "bateria_hincha", nombre: "Batería hinchada", descuento: 25000 },
    { id: "botones", nombre: "Botones físicos con fallas", descuento: 8000 },
  ],

  // Catálogo de modelos. "precioBase" es el valor de referencia para
  // la capacidad "128gb" (factor 1.0); el resto de las capacidades
  // se calculan a partir de este número.
  // "stock: true/false" es solo informativo — el documento pide que
  // TODOS los modelos se puedan cotizar, tengan o no stock.
  modelos: [
    { id: "ip11", nombre: "iPhone 11", precioBase: 210000, stock: true },
    { id: "ip12", nombre: "iPhone 12", precioBase: 260000, stock: true },
    { id: "ip13", nombre: "iPhone 13", precioBase: 320000, stock: true },
    { id: "ip13pro", nombre: "iPhone 13 Pro", precioBase: 380000, stock: false },
    { id: "ip14", nombre: "iPhone 14", precioBase: 420000, stock: true },
    { id: "ip14pro", nombre: "iPhone 14 Pro", precioBase: 500000, stock: false },
    { id: "ip15", nombre: "iPhone 15", precioBase: 560000, stock: true },
    { id: "ip15pro", nombre: "iPhone 15 Pro", precioBase: 660000, stock: false },
    { id: "ip16", nombre: "iPhone 16", precioBase: 720000, stock: true },
    { id: "ip16pro", nombre: "iPhone 16 Pro", precioBase: 860000, stock: false },
    { id: "ip16promax", nombre: "iPhone 16 Pro Max", precioBase: 950000, stock: false },
  ],

  // Productos a la venta (para calcular la diferencia en el paso 5).
  // Es un ejemplo simple: modelo + capacidad + precio de venta.
  productosVenta: [
    { id: "v_ip16_128", nombre: "iPhone 16 128 GB (nuevo)", precio: 1450000 },
    { id: "v_ip16pro_256", nombre: "iPhone 16 Pro 256 GB (nuevo)", precio: 1980000 },
    { id: "v_ip16promax_256", nombre: "iPhone 16 Pro Max 256 GB (nuevo)", precio: 2250000 },
    { id: "v_ip15_128", nombre: "iPhone 15 128 GB (seminuevo)", precio: 1100000 },
  ],

  // Datos de contacto usados para el botón de WhatsApp.
  whatsappNumero: "5491100000000", // <-- reemplazar por el número real, sin "+" ni espacios
};

const DEFAULT_STORE = {
 contact:{businessName:"Apple Tech", phone:"", whatsapp:"", instagram:"", address:"", hours:""},
 catalog:[
 {id:"ip11",nombre:"iPhone 11",precioBase:210000,stock:1,estado:"published"},
 {id:"ip11pro",nombre:"iPhone 11 Pro",precioBase:210000,stock:1,estado:"published"},
 {id:"ip11promax",nombre:"iPhone 11 Pro Max",precioBase:210000,stock:1,estado:"published"},
 {id:"ip12",nombre:"iPhone 12",precioBase:260000,stock:1,estado:"published"},
 {id:"ip12mini",nombre:"iPhone 12 mini",precioBase:260000,stock:1,estado:"published"},
 {id:"ip12pro",nombre:"iPhone 12 Pro",precioBase:260000,stock:1,estado:"published"},
 {id:"ip12promax",nombre:"iPhone 12 Pro Max",precioBase:260000,stock:1,estado:"published"},
 {id:"ip13",nombre:"iPhone 13",precioBase:320000,stock:1,estado:"published"},
 {id:"ip13mini",nombre:"iPhone 13 mini",precioBase:320000,stock:1,estado:"published"},
 {id:"ip13pro",nombre:"iPhone 13 Pro",precioBase:380000,stock:0,estado:"out"},
 {id:"ip13promax",nombre:"iPhone 13 Pro Max",precioBase:380000,stock:0,estado:"out"},
 {id:"ip14",nombre:"iPhone 14",precioBase:420000,stock:1,estado:"published"},
 {id:"ip14plus",nombre:"iPhone 14 Plus",precioBase:420000,stock:1,estado:"published"},
 {id:"ip14pro",nombre:"iPhone 14 Pro",precioBase:500000,stock:0,estado:"out"},
 {id:"ip14promax",nombre:"iPhone 14 Pro Max",precioBase:500000,stock:0,estado:"out"},
 {id:"ip15",nombre:"iPhone 15",precioBase:560000,stock:1,estado:"published"},
 {id:"ip15plus",nombre:"iPhone 15 Plus",precioBase:560000,stock:1,estado:"published"},
 {id:"ip15pro",nombre:"iPhone 15 Pro",precioBase:660000,stock:0,estado:"out"},
 {id:"ip15promax",nombre:"iPhone 15 Pro Max",precioBase:660000,stock:1,estado:"published"},
 {id:"ip16",nombre:"iPhone 16",precioBase:720000,stock:1,estado:"published"},
 {id:"ip16plus",nombre:"iPhone 16 Plus",precioBase:720000,stock:1,estado:"published"},
 {id:"ip16pro",nombre:"iPhone 16 Pro",precioBase:860000,stock:0,estado:"out"},
 {id:"ip16promax",nombre:"iPhone 16 Pro Max",precioBase:950000,stock:1,estado:"published"},
 {id:"ip17",nombre:"iPhone 17",precioBase:950000,stock:0,estado:"draft"},
 {id:"ip17air",nombre:"iPhone 17 Air",precioBase:950000,stock:0,estado:"draft"},
 {id:"ip17pro",nombre:"iPhone 17 Pro",precioBase:950000,stock:0,estado:"draft"},
 {id:"ip17promax",nombre:"iPhone 17 Pro Max",precioBase:950000,stock:0,estado:"draft"}
 ]
};
const STORE=JSON.parse(localStorage.getItem('appletech_store')||JSON.stringify(DEFAULT_STORE));
CONFIG.modelos=STORE.catalog;
CONFIG.productosVenta=STORE.catalog.filter(p=>p.estado!=='draft').map(p=>({id:p.id,nombre:p.nombre,precio:p.precioBase||0}));
CONFIG.whatsappNumero=STORE.contact.whatsapp||"";



/* ============================================================
   2) ESTADO — lo que el usuario va eligiendo en cada paso
   ============================================================ */
const state = {
  pasoActual: 1,
  modelo: null,
  capacidad: null,
  color: null,
  bateria: null,
  desperfectos: new Set(),
  productoCompra: "",
};

/* Elementos del DOM que vamos a usar varias veces. Buscarlos una sola
   vez acá arriba (en vez de repetir document.getElementById por todos
   lados) hace el código más corto y más rápido. */
const el = {
  screenIntro: document.getElementById("screen-intro"),
  stepsViewport: document.getElementById("stepsViewport"),
  stepsTrack: document.getElementById("stepsTrack"),
  actionBar: document.getElementById("actionBar"),
  progressTrack: document.getElementById("progressTrack"),

  btnStart: document.getElementById("btnStart"),
  btnBack: document.getElementById("btnBack"),
  btnNext: document.getElementById("btnNext"),
  btnRestart: document.getElementById("btnRestart"),
  btnWhatsapp: document.getElementById("btnWhatsapp"),

  modelGrid: document.getElementById("modelGrid"),
  capacityRow: document.getElementById("capacityRow"),
  colorRow: document.getElementById("colorRow"),
  batteryList: document.getElementById("batteryList"),
  defectList: document.getElementById("defectList"),

  resultAmount: document.getElementById("resultAmount"),
  resultSummary: document.getElementById("resultSummary"),
  buySelect: document.getElementById("buySelect"),
  diffCard: document.getElementById("diffCard"),
  diffBuyPrice: document.getElementById("diffBuyPrice"),
  diffTradeValue: document.getElementById("diffTradeValue"),
  diffTotal: document.getElementById("diffTotal"),
};

const TOTAL_PASOS = 5;

/* Formatea un número como pesos argentinos: 450000 -> "$450.000" */
function formatearPesos(numero) {
  return "$" + Math.round(numero).toLocaleString("es-AR");
}

/* ============================================================
   3) DIBUJAR LAS OPCIONES EN CADA PASO (a partir de CONFIG)
   ============================================================
   Estas funciones crean las tarjetas/chips de la pantalla leyendo
   los arrays de CONFIG, en vez de tenerlos escritos a mano en el
   HTML. Así, si mañana un modelo se agrega en CONFIG, aparece solo
   en la pantalla sin tocar el HTML.
*/

function pintarModelos() {
  el.modelGrid.innerHTML = "";
  CONFIG.modelos.forEach((m) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "model-card";
    if (state.modelo === m.id) card.classList.add("is-selected");
card.innerHTML = `<span class="m-name">${m.nombre}</span>`;
    card.addEventListener("click", () => {
      state.modelo = m.id;
      pintarModelos();
      actualizarBotonContinuar();
    });
    el.modelGrid.appendChild(card);
  });
}

function pintarCapacidades() {
  el.capacityRow.innerHTML = "";
  CONFIG.capacidades.forEach((c) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    if (state.capacidad === c.id) chip.classList.add("is-selected");
    chip.textContent = c.nombre;
    chip.addEventListener("click", () => {
      state.capacidad = c.id;
      pintarCapacidades();
      actualizarBotonContinuar();
    });
    el.capacityRow.appendChild(chip);
  });
}

function pintarColores() {
  el.colorRow.innerHTML = "";
  CONFIG.colores.forEach((c) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip chip-color";
    if (state.color === c.id) chip.classList.add("is-selected");
    chip.innerHTML = `<span class="color-dot" style="background:${c.hex}"></span>${c.nombre}`;
    chip.addEventListener("click", () => {
      state.color = c.id;
      pintarColores();
      actualizarBotonContinuar();
    });
    el.colorRow.appendChild(chip);
  });
}

function pintarBateria() {
  el.batteryList.innerHTML = "";
  CONFIG.bateria.forEach((b) => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "battery-option";
    if (state.bateria === b.id) opt.classList.add("is-selected");
    opt.innerHTML = `
      <span class="b-radio"></span>
      <span class="b-text">
        <span class="b-range">${b.rango}</span>
        <span class="b-desc">${b.desc}</span>
      </span>
    `;
    opt.addEventListener("click", () => {
      state.bateria = b.id;
      pintarBateria();
      actualizarBotonContinuar();
    });
    el.batteryList.appendChild(opt);
  });
}

function pintarDesperfectos() {
  el.defectList.innerHTML = "";
  CONFIG.desperfectos.forEach((d) => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "defect-option";
    if (state.desperfectos.has(d.id)) opt.classList.add("is-selected");
    opt.innerHTML = `
      <span class="d-check">
        <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.2 12L13 4" stroke="#1a1200" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <span class="d-name">${d.nombre}</span>
      <span class="d-discount">−${formatearPesos(d.descuento)}</span>
    `;
    opt.addEventListener("click", () => {
      if (state.desperfectos.has(d.id)) {
        state.desperfectos.delete(d.id);
      } else {
        state.desperfectos.add(d.id);
      }
      pintarDesperfectos();
    });
    el.defectList.appendChild(opt);
  });

  // Barra con el descuento acumulado (suma de todos los desperfectos
  // tildados). Se recalcula cada vez que el usuario tilda/destilda algo.
  const totalDescuento = [...state.desperfectos].reduce((acc, id) => {
    const d = CONFIG.desperfectos.find((x) => x.id === id);
    return acc + (d ? d.descuento : 0);
  }, 0);

  const barra = document.createElement("div");
  barra.className = "running-total";
  barra.innerHTML = `
    <span>Descuento por desperfectos</span>
    <span class="rt-value">−${formatearPesos(totalDescuento)}</span>
  `;
  el.defectList.appendChild(barra);
}

function pintarProductosVenta() {
  el.buySelect.querySelectorAll("option:not(:first-child)").forEach((o) => o.remove());
  CONFIG.productosVenta.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.nombre} — ${formatearPesos(p.precio)} (${p.stock>0?"Disponible":"Sin stock"})`;
    el.buySelect.appendChild(opt);
  });
}

/* ============================================================
   4) CÁLCULO DE LA COTIZACIÓN
   ============================================================ */
function calcularCotizacion() {
  const modelo = CONFIG.modelos.find((m) => m.id === state.modelo);
  const capacidad = CONFIG.capacidades.find((c) => c.id === state.capacidad);
  const bateria = CONFIG.bateria.find((b) => b.id === state.bateria);

  if (!modelo || !capacidad) return 0;

  // 1. precio base ajustado por capacidad
  let valor = modelo.precioBase * capacidad.factor;

  // 2. ajuste por batería (porcentaje sobre el valor actual)
  if (bateria) {
    valor = valor * (1 + bateria.ajuste);
  }

  // 3. se restan todos los desperfectos seleccionados (se suman los descuentos)
  const totalDesperfectos = [...state.desperfectos].reduce((acc, id) => {
    const d = CONFIG.desperfectos.find((x) => x.id === id);
    return acc + (d ? d.descuento : 0);
  }, 0);
  valor -= totalDesperfectos;

  return Math.max(0, Math.round(valor));
}

/* Animación de "conteo" del número final: sube desde 0 hasta el valor
   real en un ratito, con una curva que empieza rápido y frena suave.
   Es el único efecto "de impacto" de toda la app — se usa una sola vez,
   en el momento más importante (mostrar el resultado). */
function animarNumero(valorFinal) {
  const duracion = 900;
  const inicio = performance.now();

  function frame(ahora) {
    const t = Math.min(1, (ahora - inicio) / duracion);
    const easeOutQuint = 1 - Math.pow(1 - t, 5);
    const valorActual = Math.round(valorFinal * easeOutQuint);
    el.resultAmount.textContent = formatearPesos(valorActual);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function pintarResultado() {
  const modelo = CONFIG.modelos.find((m) => m.id === state.modelo);
  const capacidad = CONFIG.capacidades.find((c) => c.id === state.capacidad);
  const color = CONFIG.colores.find((c) => c.id === state.color);
  const bateria = CONFIG.bateria.find((b) => b.id === state.bateria);
  const valor = calcularCotizacion();

  const prefiereMenosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefiereMenosMovimiento) {
    el.resultAmount.textContent = formatearPesos(valor);
  } else {
    animarNumero(valor);
  }

  el.resultSummary.innerHTML = `
    <li><span>Modelo</span><span>${modelo ? modelo.nombre : "—"}</span></li>
    <li><span>Capacidad</span><span>${capacidad ? capacidad.nombre : "—"}</span></li>
    <li><span>Color</span><span>${color ? color.nombre : "—"}</span></li>
    <li><span>Batería</span><span>${bateria ? bateria.rango : "—"}</span></li>
    <li><span>Desperfectos</span><span>${state.desperfectos.size ? state.desperfectos.size + " seleccionado(s)" : "Ninguno"}</span></li>
  `;

  actualizarDiferencia();
}

function actualizarDiferencia() {
  const producto = CONFIG.productosVenta.find((p) => p.id === state.productoCompra);
  if (!producto) {
    el.diffCard.hidden = true;
    return;
  }
  const valorCanje = calcularCotizacion();
  const diferencia = producto.precio - valorCanje;

  el.diffBuyPrice.textContent = formatearPesos(producto.precio);
  el.diffTradeValue.textContent = "−" + formatearPesos(valorCanje);
  el.diffTotal.textContent = formatearPesos(Math.max(0, diferencia));
  el.diffCard.hidden = false;
}

/* Arma el link de WhatsApp con los datos de la cotización.
   OJO: a propósito NO incluye la advertencia de revisión física
   (el documento pide que esa aclaración quede solo en la pantalla). */
function actualizarLinkWhatsapp() {
  const modelo = CONFIG.modelos.find((m) => m.id === state.modelo);
  const capacidad = CONFIG.capacidades.find((c) => c.id === state.capacidad);
  const color = CONFIG.colores.find((c) => c.id === state.color);
  const bateria = CONFIG.bateria.find((b) => b.id === state.bateria);
  const producto = CONFIG.productosVenta.find((p) => p.id === state.productoCompra);
  const valor = calcularCotizacion();

  const nombresDesperfectos = [...state.desperfectos]
    .map((id) => CONFIG.desperfectos.find((d) => d.id === id)?.nombre)
    .filter(Boolean);

  let mensaje = `Hola Apple Tech! Quiero consultar por un canje:\n\n`;
  mensaje += `Equipo: ${modelo ? modelo.nombre : "-"}\n`;
  mensaje += `Capacidad: ${capacidad ? capacidad.nombre : "-"}\n`;
  mensaje += `Color: ${color ? color.nombre : "-"}\n`;
  mensaje += `Batería: ${bateria ? bateria.rango : "-"}\n`;
  mensaje += `Desperfectos: ${nombresDesperfectos.length ? nombresDesperfectos.join(", ") : "Ninguno"}\n`;
  mensaje += `Cotización estimativa: ${formatearPesos(valor)}\n`;

  if (producto) {
    const diferencia = Math.max(0, producto.precio - valor);
    mensaje += `\nQuiero comprar: ${producto.nombre}\n`;
    mensaje += `Diferencia estimativa: ${formatearPesos(diferencia)}\n`;
  }

  const url = `https://wa.me/${CONFIG.whatsappNumero}?text=${encodeURIComponent(mensaje)}`;
  el.btnWhatsapp.setAttribute("href", url);
}

/* ============================================================
   5) NAVEGACIÓN ENTRE PASOS
   ============================================================ */
function irAPaso(numero) {
  state.pasoActual = numero;

  // Mover el carril de pasos: cada paso ocupa el 100% del ancho,
  // así que para mostrar el paso N corremos el carril N-1 veces
  // ese ancho hacia la izquierda.
  el.stepsTrack.style.transform = `translateX(-${(numero - 1) * 100}%)`;

  // Actualizar la barra de progreso
  document.querySelectorAll(".progress-seg").forEach((seg) => {
    const pasoSeg = Number(seg.dataset.step);
    seg.classList.toggle("is-done", pasoSeg < numero);
    seg.classList.toggle("is-active", pasoSeg === numero);
  });
  el.progressTrack.setAttribute("aria-valuenow", numero);

  // Marcar cuál pantalla está "activa" (para la animación de entrada)
  document.querySelectorAll(".step-screen").forEach((s) => {
    s.classList.toggle("is-active", Number(s.dataset.step) === numero);
  });

  // Mostrar u ocultar la barra de botones fija: en el paso 5 no hace
  // falta, porque esa pantalla tiene sus propios botones (WhatsApp / reiniciar).
  el.actionBar.hidden = numero === TOTAL_PASOS;

  if (numero === TOTAL_PASOS) {
    pintarResultado();
    actualizarLinkWhatsapp();
  }

  actualizarBotonContinuar();
}

/* Habilita "Continuar" solo si el paso actual tiene lo mínimo elegido.
   Así evitamos que alguien avance sin seleccionar modelo, capacidad, etc. */
function actualizarBotonContinuar() {
  let habilitado = true;
  switch (state.pasoActual) {
    case 1: habilitado = !!state.modelo; break;
    case 2: habilitado = !!state.capacidad && !!state.color; break;
    case 3: habilitado = !!state.bateria; break;
    case 4: habilitado = true; break; // los desperfectos son opcionales
  }
  el.btnNext.disabled = !habilitado;
  el.btnBack.style.visibility = state.pasoActual === 1 ? "hidden" : "visible";
  el.btnNext.textContent = state.pasoActual === 4 ? "Ver cotización" : "Continuar";
}

/* ============================================================
   6) EVENTOS
   ============================================================ */
el.btnStart.addEventListener("click", () => {
  el.screenIntro.hidden = true;
  el.stepsViewport.hidden = false;
  el.actionBar.hidden = false;
  irAPaso(1);
});

el.btnNext.addEventListener("click", () => {
  if (state.pasoActual < TOTAL_PASOS) irAPaso(state.pasoActual + 1);
});

el.btnBack.addEventListener("click", () => {
  if (state.pasoActual > 1) irAPaso(state.pasoActual - 1);
});

el.btnRestart.addEventListener("click", () => {
  state.pasoActual = 1;
  state.modelo = null;
  state.capacidad = null;
  state.color = null;
  state.bateria = null;
  state.desperfectos.clear();
  state.productoCompra = "";
  el.buySelect.value = "";

  pintarModelos();
  pintarCapacidades();
  pintarColores();
  pintarBateria();
  pintarDesperfectos();

  el.stepsViewport.hidden = true;
  el.actionBar.hidden = true;
  el.screenIntro.hidden = false;
  irAPaso(1);
});

el.buySelect.addEventListener("change", (e) => {
  state.productoCompra = e.target.value;
  actualizarDiferencia();
  actualizarLinkWhatsapp();
});

/* ============================================================
   7) ARRANQUE: dibujar todo una primera vez al cargar la página
   ============================================================ */
pintarModelos();
pintarCapacidades();
pintarColores();
pintarBateria();
pintarDesperfectos();
pintarProductosVenta();
actualizarBotonContinuar();
