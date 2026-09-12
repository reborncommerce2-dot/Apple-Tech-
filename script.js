/*
  script.js = EL COMPORTAMIENTO DEL COTIZADOR PÚBLICO.
  ------------------------------------------------------------
  Este archivo YA NO tiene datos hardcodeados ni cálculos propios:
  todo lo que necesita (modelos, batería, desperfectos, contacto,
  precios) lo pide a los servicios de services.js, que a su vez leen
  la ÚNICA fuente de datos (el STORE en localStorage, editado desde
  Admin). Si algo se ve distinto acá que en Admin, es un bug — no
  debería poder pasar, porque los dos leen exactamente lo mismo.

  index.html debe cargar, en este orden:
    config.js -> services.js -> script.js
*/

/* ============================================================
   1) DATOS DE ARRANQUE (leídos de los servicios, no inventados acá)
   ============================================================ */
const contact = contactService.get();
document.title = (contact.businessName || "Apple Tech") + " — Cotizador de canje";
const brandNameEl = document.getElementById("brandName");
if (brandNameEl) brandNameEl.textContent = contact.businessName || "Apple Tech";

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

/* Elementos del DOM que vamos a usar varias veces. */
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
  diffProductImage: document.getElementById("diffProductImage"),
  diffBuyPrice: document.getElementById("diffBuyPrice"),
  diffTradeValue: document.getElementById("diffTradeValue"),
  diffTotal: document.getElementById("diffTotal"),
};

const TOTAL_PASOS = 5;

/* Formatea un número como USD: 450 -> "USD 450" (moneda única de
   toda la lógica y de toda la pantalla, como pide el documento). */
function formatearUSD(numero) {
  return pricingService.formatUSD(numero);
}

/* ============================================================
   3) DIBUJAR LAS OPCIONES EN CADA PASO (siempre desde los servicios)
   ============================================================ */

function pintarModelos() {
  el.modelGrid.innerHTML = "";
  // Catálogo de CANJE: lista fija e independiente del catálogo Admin
  // (no depende de stock, estado, ni de si el catálogo Admin está
  // vacío u oculto — ver tradeInCatalogService en services.js).
  tradeInCatalogService.getAll().forEach((m) => {
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
  STATIC_CONFIG.capacidades.forEach((c) => {
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
  STATIC_CONFIG.colores.forEach((c) => {
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
  batteryService.getAll().forEach((b) => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "battery-option";
    if (state.bateria === b.id) opt.classList.add("is-selected");
    opt.innerHTML = `
      <span class="b-radio"></span>
      <span class="b-text">
        <span class="b-range">${b.label}</span>
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

/* Paso 4: el cliente ve el nombre del desperfecto y lo puede tildar,
   pero NUNCA el monto del descuento (ni individual ni acumulado) —
   los descuentos se siguen aplicando internamente en el cálculo. */
function pintarDesperfectos() {
  el.defectList.innerHTML = "";
  damageService.getActive().forEach((d) => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "defect-option";
    if (state.desperfectos.has(d.id)) opt.classList.add("is-selected");
    opt.innerHTML = `
      <span class="d-check">
        <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.2 12L13 4" stroke="#1a1200" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <span class="d-name">${d.nombre}</span>
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
}

function pintarProductosVenta() {
  el.buySelect.querySelectorAll("option:not(:first-child)").forEach((o) => o.remove());
  catalogService.getForSale().forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.nombre} — ${formatearUSD(p.precioBaseUSD)}`;
    el.buySelect.appendChild(opt);
  });
}

/* ============================================================
   4) CÁLCULO DE LA COTIZACIÓN (delegado 100% a pricingService)
   ============================================================ */
function calcularCotizacion() {
  const quote = pricingService.calculateQuote({
    modeloId: state.modelo,
    capacidadId: state.capacidad,
    bateriaId: state.bateria,
    desperfectoIds: [...state.desperfectos],
  });
  return quote ? quote.valorFinalUSD : 0;
}

/* Animación de "conteo" del número final. */
function animarNumero(valorFinal) {
  const duracion = 900;
  const inicio = performance.now();

  function frame(ahora) {
    const t = Math.min(1, (ahora - inicio) / duracion);
    const easeOutQuint = 1 - Math.pow(1 - t, 5);
    const valorActual = Math.round(valorFinal * easeOutQuint);
    el.resultAmount.textContent = formatearUSD(valorActual);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* Paso 5: cotización final LIMPIA. Solo el valor estimado y un
   resumen del equipo — nada de precio base, descuentos ni cálculos
   internos (como pide el documento). */
function pintarResultado() {
  const modelo = tradeInCatalogService.getById(state.modelo);
  const capacidad = pricingService.getCapacidad(state.capacidad);
  const color = pricingService.getColor(state.color);
  const bateria = state.bateria ? batteryService.getById(state.bateria) : null;
  const valor = calcularCotizacion();

  const prefiereMenosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefiereMenosMovimiento) {
    el.resultAmount.textContent = formatearUSD(valor);
  } else {
    animarNumero(valor);
  }

  el.resultSummary.innerHTML = `
    <li><span>Modelo</span><span>${modelo ? modelo.nombre : "—"}</span></li>
    <li><span>Capacidad</span><span>${capacidad ? capacidad.nombre : "—"}</span></li>
    <li><span>Color</span><span>${color ? color.nombre : "—"}</span></li>
    <li><span>Batería</span><span>${bateria ? bateria.label : "—"}</span></li>
    <li><span>Desperfectos</span><span>${state.desperfectos.size ? state.desperfectos.size + " seleccionado(s)" : "Ninguno"}</span></li>
  `;

  actualizarDiferencia();
}

function actualizarDiferencia() {
  // Paso 5: exclusivamente catálogo Admin (precio, stock, estado, imagen).
  const producto = catalogService.getForSale().find((p) => p.id === state.productoCompra);
  if (!producto) {
    el.diffCard.hidden = true;
    return;
  }
  const valorCanje = calcularCotizacion();
  const diferencia = producto.precioBaseUSD - valorCanje;

  if (producto.imagenUrl) {
    el.diffProductImage.src = producto.imagenUrl;
    el.diffProductImage.alt = producto.nombre;
    el.diffProductImage.hidden = false;
  } else {
    el.diffProductImage.hidden = true;
    el.diffProductImage.removeAttribute("src");
  }

  el.diffBuyPrice.textContent = formatearUSD(producto.precioBaseUSD);
  el.diffTradeValue.textContent = "−" + formatearUSD(valorCanje);
  el.diffTotal.textContent = formatearUSD(Math.max(0, diferencia));
  el.diffCard.hidden = false;
}

/* Arma el link de WhatsApp con los datos de la cotización.
   A propósito NO incluye el desglose de descuentos (solo el total),
   igual que en la pantalla. */
function actualizarLinkWhatsapp() {
  const modelo = tradeInCatalogService.getById(state.modelo);
  const capacidad = pricingService.getCapacidad(state.capacidad);
  const color = pricingService.getColor(state.color);
  const bateria = state.bateria ? batteryService.getById(state.bateria) : null;
  const producto = catalogService.getForSale().find((p) => p.id === state.productoCompra);
  const valor = calcularCotizacion();
  const contactoActual = contactService.get();

  const nombresDesperfectos = [...state.desperfectos]
    .map((id) => damageService.getActive().find((d) => d.id === id)?.nombre)
    .filter(Boolean);

  let mensaje = `Hola ${contactoActual.businessName || "Apple Tech"}! Quiero consultar por un canje:\n\n`;
  mensaje += `Equipo: ${modelo ? modelo.nombre : "-"}\n`;
  mensaje += `Capacidad: ${capacidad ? capacidad.nombre : "-"}\n`;
  mensaje += `Color: ${color ? color.nombre : "-"}\n`;
  mensaje += `Batería: ${bateria ? bateria.label : "-"}\n`;
  mensaje += `Desperfectos: ${nombresDesperfectos.length ? nombresDesperfectos.join(", ") : "Ninguno"}\n`;
  mensaje += `Cotización estimativa: ${formatearUSD(valor)}\n`;

  if (producto) {
    const diferencia = Math.max(0, producto.precioBaseUSD - valor);
    mensaje += `\nQuiero comprar: ${producto.nombre}\n`;
    mensaje += `Diferencia estimativa: ${formatearUSD(diferencia)}\n`;
  }

  const numero = contactoActual.whatsapp || "5491159478541";
  const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
  el.btnWhatsapp.setAttribute("href", url);
}

/* ============================================================
   5) NAVEGACIÓN ENTRE PASOS
   ============================================================ */
function irAPaso(numero) {
  state.pasoActual = numero;

  el.stepsTrack.style.transform = `translateX(-${(numero - 1) * 100}%)`;

  document.querySelectorAll(".progress-seg").forEach((seg) => {
    const pasoSeg = Number(seg.dataset.step);
    seg.classList.toggle("is-done", pasoSeg < numero);
    seg.classList.toggle("is-active", pasoSeg === numero);
  });
  el.progressTrack.setAttribute("aria-valuenow", numero);

  document.querySelectorAll(".step-screen").forEach((s) => {
    s.classList.toggle("is-active", Number(s.dataset.step) === numero);
  });

  el.actionBar.hidden = numero === TOTAL_PASOS;

  if (numero === TOTAL_PASOS) {
    pintarResultado();
    actualizarLinkWhatsapp();
  }

  actualizarBotonContinuar();
}

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
