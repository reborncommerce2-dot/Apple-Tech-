/*
  script.js = EL COMPORTAMIENTO DEL COTIZADOR PÚBLICO.
  ------------------------------------------------------------
  No tiene datos ni cálculos propios: todo (modelos, capacidades,
  batería, desperfectos, contacto, precios) lo pide a los servicios de
  services.js, que leen Supabase. Lo que carga el administrador en el
  panel es EXACTAMENTE lo que ve el cliente acá (y se actualiza solo,
  sin recargar, vía Realtime).

  Si no se pueden leer los datos de Supabase, el cotizador NO inventa
  precios: muestra un aviso con botón "Reintentar".

  index.html debe cargar, en este orden:
    supabase-js (CDN) -> supabase-config.js -> supabaseClient.js ->
    config.js -> services.js -> script.js
*/

/* ============================================================
   1) ESTADO — lo que el usuario va eligiendo en cada paso
   ============================================================ */
const state = {
  pasoActual: 1,
  modelo: null,
  capacidad: null,
  color: null,
  bateria: null,
  desperfectos: new Set(),
  productoCompra: "",
  quoteSig: "",   // firma de la última cotización registrada (evita duplicados)
  quoteId: "",
  lastLeadAt: 0,
  lastLeadSig: "",
};

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
  btnRetryLoad: document.getElementById("btnRetryLoad"),
  loadNote: document.getElementById("loadNote"),

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
  diffProductDetail: document.getElementById("diffProductDetail"),
  diffBuyPrice: document.getElementById("diffBuyPrice"),
  diffTradeValue: document.getElementById("diffTradeValue"),
  diffTotal: document.getElementById("diffTotal"),

  leadName: document.getElementById("leadName"),
  leadPhone: document.getElementById("leadPhone"),
  leadError: document.getElementById("leadError"),
};

const TOTAL_PASOS = 5;

/* Todo texto que viene de la base se escapa antes de ir a innerHTML. */
function esc(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function formatearUSD(numero) {
  return pricingService.formatUSD(numero);
}

/* ============================================================
   2) DIBUJAR LAS OPCIONES EN CADA PASO (siempre desde los servicios)
   ============================================================ */

function pintarModelos() {
  el.modelGrid.innerHTML = "";
  const modelos = modeloService.getPublic();
  if (!modelos.length) {
    el.modelGrid.innerHTML = '<p class="empty-note">Todavía no hay modelos con precio cargado. Escribinos por WhatsApp y te cotizamos.</p>';
    return;
  }
  modelos.forEach((m) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "model-card";
    if (state.modelo === m.id) card.classList.add("is-selected");
    card.innerHTML = `<span class="m-name">${esc(m.nombre)}</span>`;
    card.addEventListener("click", () => {
      state.modelo = m.id;
      // Las capacidades del Paso 2 dependen del modelo: si la ya elegida no aplica, se limpia.
      if (state.capacidad && !capacidadService.getForModelo(m.id).some((c) => c.id === state.capacidad)) {
        state.capacidad = null;
      }
      pintarModelos();
      pintarCapacidades();
      actualizarBotonContinuar();
    });
    el.modelGrid.appendChild(card);
  });
}

function pintarCapacidades() {
  el.capacityRow.innerHTML = "";
  const capacidades = state.modelo ? capacidadService.getForModelo(state.modelo) : [];
  if (state.modelo && !capacidades.length) {
    el.capacityRow.innerHTML = '<p class="empty-note">Este modelo no tiene capacidades disponibles por ahora.</p>';
    return;
  }
  capacidades.forEach((c) => {
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
    chip.innerHTML = `<span class="color-dot" style="background:${esc(c.hex)}"></span>${esc(c.nombre)}`;
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
  const reglas = batteryService.getAll();
  if (!reglas.length) {
    el.batteryList.innerHTML = '<p class="empty-note">No hay opciones de batería configuradas.</p>';
    return;
  }
  reglas.forEach((b) => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "battery-option";
    if (state.bateria === b.id) opt.classList.add("is-selected");
    opt.innerHTML = `
      <span class="b-radio"></span>
      <span class="b-text">
        <span class="b-range">${esc(b.label)}</span>
        <span class="b-desc">${esc(b.desc)}</span>
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

/* Paso 4: el cliente ve el nombre del desperfecto, NUNCA el monto del descuento. */
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
      <span class="d-name">${esc(d.nombre)}</span>
    `;
    opt.addEventListener("click", () => {
      if (state.desperfectos.has(d.id)) state.desperfectos.delete(d.id);
      else state.desperfectos.add(d.id);
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
    opt.textContent = `${p.nombre}${p.detalle ? " · " + p.detalle : ""} — ${formatearUSD(p.precioBaseUSD)}`;
    el.buySelect.appendChild(opt);
  });
  el.buySelect.value = catalogService.getForSale().some((p) => p.id === state.productoCompra) ? state.productoCompra : "";
  state.productoCompra = el.buySelect.value;
}

/* ============================================================
   3) CÁLCULO DE LA COTIZACIÓN (100% en pricingService)
   ============================================================ */
function cotizacionActual() {
  const q = pricingService.calculateQuote({
    modeloId: state.modelo,
    capacidadId: state.capacidad,
    bateriaId: state.bateria,
    desperfectoIds: [...state.desperfectos],
  });
  // Sin precio cargado (o regla borrada) no hay cotización válida.
  if (!q || !q.valoracionEncontrada || q.precioBaseUSD <= 0) return null;
  return q;
}

/* Valor a mostrar: número, o null si hay que "consultar". Un final en 0
   (los descuentos igualan o superan el valor) también se consulta. */
function valorMostrable() {
  const q = cotizacionActual();
  return q && q.valorFinalUSD > 0 ? q.valorFinalUSD : null;
}

function animarNumero(valorFinal) {
  const duracion = 900;
  const inicio = performance.now();
  function frame(ahora) {
    const t = Math.min(1, (ahora - inicio) / duracion);
    const easeOutQuint = 1 - Math.pow(1 - t, 5);
    el.resultAmount.textContent = formatearUSD(Math.round(valorFinal * easeOutQuint));
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function firmaCotizacion() {
  return [state.modelo, state.capacidad, state.color, state.bateria, [...state.desperfectos].sort().join(",")].join("|");
}

/* registrar=true solo al LLEGAR al resultado; si los precios cambian en
   vivo mientras el cliente mira su resultado, solo se repinta. */
function pintarResultado(registrar) {
  const modelo = modeloService.getById(state.modelo);
  const capacidad = pricingService.getCapacidad(state.capacidad);
  const color = pricingService.getColor(state.color);
  const bateria = state.bateria ? batteryService.getById(state.bateria) : null;
  const q = cotizacionActual();
  const valor = valorMostrable();

  if (valor === null) {
    el.resultAmount.textContent = "A consultar";
  } else if (registrar && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    animarNumero(valor);
  } else {
    el.resultAmount.textContent = formatearUSD(valor);
  }

  el.resultSummary.innerHTML = `
    <li><span>Modelo</span><span>${esc(modelo ? modelo.nombre : "—")}</span></li>
    <li><span>Capacidad</span><span>${esc(capacidad ? capacidad.nombre : "—")}</span></li>
    <li><span>Color</span><span>${esc(color ? color.nombre : "—")}</span></li>
    <li><span>Batería</span><span>${esc(bateria ? bateria.label : "—")}</span></li>
    <li><span>Desperfectos</span><span>${state.desperfectos.size ? state.desperfectos.size + " seleccionado(s)" : "Ninguno"}</span></li>
  `;

  // Registro en el historial: una vez por combinación distinta (ir y volver no duplica).
  const sig = firmaCotizacion();
  if (registrar && q && modelo && capacidad && sig !== state.quoteSig) {
    const nombresDesperfectos = [...state.desperfectos]
      .map((id) => damageService.getActive().find((d) => d.id === id))
      .filter(Boolean).map((d) => d.nombre);
    const item = quotesHistoryService.record({
      modeloId: modelo.id,
      modeloNombre: modelo.nombre,
      capacidadId: capacidad.id,
      capacidadNombre: capacidad.nombre,
      valorBaseUSD: q.precioBaseUSD,
      descuentoBateriaUSD: q.descuentoBateriaUSD,
      descuentoDesperfectosUSD: q.descuentoDesperfectosUSD,
      valorFinalUSD: q.valorFinalUSD,
      color: color ? color.nombre : "",
      bateriaLabel: bateria ? bateria.label : "",
      desperfectos: nombresDesperfectos,
    });
    state.quoteSig = sig;
    state.quoteId = item.id;
  }

  actualizarDiferencia();
  actualizarLinkWhatsapp();
}

function productoElegido() {
  return catalogService.getForSale().find((p) => p.id === state.productoCompra) || null;
}

function actualizarDiferencia() {
  const producto = productoElegido();
  const valorCanje = valorMostrable();
  if (!producto || valorCanje === null) {
    el.diffCard.hidden = true;
    return;
  }
  const diferencia = producto.precioBaseUSD - valorCanje;

  if (producto.imagenUrl) {
    el.diffProductImage.src = producto.imagenUrl;
    el.diffProductImage.alt = producto.nombre;
    el.diffProductImage.hidden = false;
  } else {
    el.diffProductImage.hidden = true;
    el.diffProductImage.removeAttribute("src");
  }
  el.diffProductDetail.textContent = producto.detalle || "";
  el.diffProductDetail.hidden = !producto.detalle;

  el.diffBuyPrice.textContent = formatearUSD(producto.precioBaseUSD);
  el.diffTradeValue.textContent = "−" + formatearUSD(valorCanje);
  el.diffTotal.textContent = diferencia > 0 ? formatearUSD(diferencia) : "Sin diferencia a pagar";
  el.diffCard.hidden = false;
}

/* ============================================================
   4) WHATSAPP + LEAD
   ============================================================ */
function datosLead() {
  const nombre = (el.leadName.value || "").trim().slice(0, 80);
  const digitos = (el.leadPhone.value || "").replace(/\D/g, "");
  const telefonoVacio = digitos.length === 0;
  const telefonoValido = telefonoVacio || (digitos.length >= 8 && digitos.length <= 15);
  return { nombre, whatsapp: telefonoValido ? digitos : "", telefonoValido, telefonoVacio };
}

function actualizarLinkWhatsapp() {
  const contacto = contactService.get();
  const numero = String(contacto.whatsapp || "").replace(/\D/g, "");
  // Sin número de WhatsApp configurado en el panel, el botón se oculta (no hay a dónde enviar).
  el.btnWhatsapp.hidden = !numero;
  if (!numero) return;

  const modelo = modeloService.getById(state.modelo);
  const capacidad = pricingService.getCapacidad(state.capacidad);
  const color = pricingService.getColor(state.color);
  const bateria = state.bateria ? batteryService.getById(state.bateria) : null;
  const producto = productoElegido();
  const valor = valorMostrable();
  const lead = datosLead();

  const nombresDesperfectos = [...state.desperfectos]
    .map((id) => damageService.getActive().find((d) => d.id === id))
    .filter(Boolean).map((d) => d.nombre);

  let mensaje = `Hola ${contacto.businessName || "Apple Tech"}! Quiero consultar por un canje:\n\n`;
  if (lead.nombre) mensaje += `Mi nombre: ${lead.nombre}\n`;
  mensaje += `Equipo: ${modelo ? modelo.nombre : "-"}\n`;
  mensaje += `Capacidad: ${capacidad ? capacidad.nombre : "-"}\n`;
  mensaje += `Color: ${color ? color.nombre : "-"}\n`;
  mensaje += `Batería: ${bateria ? bateria.label : "-"}\n`;
  mensaje += `Desperfectos: ${nombresDesperfectos.length ? nombresDesperfectos.join(", ") : "Ninguno"}\n`;
  mensaje += `Cotización estimativa: ${valor === null ? "a consultar" : formatearUSD(valor)}\n`;

  if (producto && valor !== null) {
    const diferencia = Math.max(0, producto.precioBaseUSD - valor);
    mensaje += `\nQuiero comprar: ${producto.nombre}${producto.detalle ? " (" + producto.detalle + ")" : ""}\n`;
    mensaje += `Diferencia estimativa: ${formatearUSD(diferencia)}\n`;
  }
  el.btnWhatsapp.setAttribute("href", `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`);
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
  if (numero === TOTAL_PASOS) pintarResultado(true);
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
  if (el.btnStart.disabled) return;
  el.screenIntro.hidden = true;
  el.stepsViewport.hidden = false;
  el.actionBar.hidden = false;
  irAPaso(1);
});

el.btnNext.addEventListener("click", () => {
  if (el.btnNext.disabled) return;
  if (state.pasoActual < TOTAL_PASOS) irAPaso(state.pasoActual + 1);
});

el.btnBack.addEventListener("click", () => {
  if (state.pasoActual > 1) irAPaso(state.pasoActual - 1);
});

function reiniciar() {
  state.pasoActual = 1;
  state.modelo = null;
  state.capacidad = null;
  state.color = null;
  state.bateria = null;
  state.desperfectos.clear();
  state.productoCompra = "";
  state.quoteSig = "";
  state.quoteId = "";
  el.buySelect.value = "";
  el.leadName.value = "";
  el.leadPhone.value = "";
  el.leadError.hidden = true;

  pintarListasDelCotizador();

  el.stepsViewport.hidden = true;
  el.actionBar.hidden = true;
  el.screenIntro.hidden = false;
  irAPaso(1);
}
el.btnRestart.addEventListener("click", reiniciar);

el.buySelect.addEventListener("change", (e) => {
  state.productoCompra = e.target.value;
  actualizarDiferencia();
  actualizarLinkWhatsapp();
});

[el.leadName, el.leadPhone].forEach((input) => {
  input.addEventListener("input", () => {
    el.leadError.hidden = true;
    actualizarLinkWhatsapp();
  });
});

/* Registra un lead cuando el cliente toca "Consultar por WhatsApp". El
   link sigue abriendo WhatsApp normalmente. Si escribió un teléfono
   inválido, se frena para avisarle (puede borrarlo: es opcional). */
el.btnWhatsapp.addEventListener("click", (e) => {
  const lead = datosLead();
  if (!lead.telefonoValido) {
    e.preventDefault();
    el.leadError.textContent = "Revisá tu WhatsApp (entre 8 y 15 números) o dejá el campo vacío.";
    el.leadError.hidden = false;
    el.leadPhone.focus();
    return;
  }
  const modelo = modeloService.getById(state.modelo);
  if (!modelo) return;
  // Doble toque: no registrar el mismo lead dos veces en pocos segundos.
  const sig = firmaCotizacion() + "|" + state.productoCompra + "|" + lead.nombre + "|" + lead.whatsapp;
  const ahora = Date.now();
  if (sig === state.lastLeadSig && ahora - state.lastLeadAt < 8000) return;
  state.lastLeadSig = sig;
  state.lastLeadAt = ahora;

  const capacidad = pricingService.getCapacidad(state.capacidad);
  const producto = productoElegido();
  const valor = valorMostrable();
  leadsService.record({
    nombre: lead.nombre,
    whatsapp: lead.whatsapp,
    modeloId: modelo.id,
    modeloNombre: modelo.nombre,
    resultadoUSD: valor === null ? 0 : valor,
    capacidadNombre: capacidad ? capacidad.nombre : "",
    productoCompraNombre: producto ? producto.nombre : "",
    diferenciaUSD: producto && valor !== null ? Math.max(0, producto.precioBaseUSD - valor) : null,
    quoteId: state.quoteId,
  });
});

/* ============================================================
   7) ARRANQUE Y ACTUALIZACIÓN EN VIVO
   ============================================================ */
function aplicarDatosDeContacto() {
  const contact = contactService.get();
  document.title = (contact.businessName || "Apple Tech") + " — Cotizador de canje";
  const brandNameEl = document.getElementById("brandName");
  if (brandNameEl) brandNameEl.textContent = contact.businessName || "Apple Tech";
}

/* Si lo que eligió el cliente ya no existe (el admin lo borró o lo
   desactivó mientras cotizaba), se limpia esa elección. */
function sanitizarEstado() {
  const hadStep = state.pasoActual;
  if (state.modelo && !modeloService.getPublic().some((m) => m.id === state.modelo)) {
    state.modelo = null; state.capacidad = null;
  }
  if (state.capacidad && !capacidadService.getForModelo(state.modelo).some((c) => c.id === state.capacidad)) state.capacidad = null;
  if (state.bateria && !batteryService.getById(state.bateria)) state.bateria = null;
  const activos = new Set(damageService.getActive().map((d) => d.id));
  [...state.desperfectos].forEach((id) => { if (!activos.has(id)) state.desperfectos.delete(id); });
  // Si quedó sin elección necesaria para el paso en el que está, vuelve al paso correcto.
  if (!el.stepsViewport.hidden) {
    let paso = hadStep;
    if (!state.modelo) paso = 1;
    else if (!state.capacidad && paso > 2) paso = 2;
    else if (!state.bateria && paso > 3) paso = 3;
    if (paso !== hadStep) irAPaso(paso);
  }
}

function pintarListasDelCotizador() {
  aplicarDatosDeContacto();
  sanitizarEstado();
  pintarModelos();
  pintarCapacidades();
  pintarColores();
  pintarBateria();
  pintarDesperfectos();
  pintarProductosVenta();
  actualizarBotonContinuar();
  if (state.pasoActual === TOTAL_PASOS && !el.stepsViewport.hidden) pintarResultado(false);
}

/* Estado de la pantalla de inicio: cargando / error / vacío / listo. */
function mostrarEstadoDeCarga() {
  const error = StorageService.getLoadError();
  const hayDatos = modeloService.getPublic().length > 0;
  el.btnRetryLoad.hidden = !error;
  if (error) {
    el.btnStart.disabled = true;
    el.btnStart.textContent = "Cotizador no disponible";
    el.loadNote.hidden = false;
    el.loadNote.className = "intro-note load-note is-error";
    el.loadNote.textContent = "No pudimos cargar los precios. Revisá tu conexión e intentá de nuevo.";
  } else if (!hayDatos) {
    el.btnStart.disabled = true;
    el.btnStart.textContent = "Cotizador en preparación";
    el.loadNote.hidden = false;
    el.loadNote.className = "intro-note load-note";
    el.loadNote.textContent = "Estamos actualizando los precios. Volvé a intentar en un rato.";
  } else {
    el.btnStart.disabled = false;
    el.btnStart.textContent = "Empezar cotización";
    el.loadNote.hidden = true;
  }
}

async function arrancar() {
  el.btnStart.disabled = true;
  el.btnStart.textContent = "Cargando precios…";
  el.btnRetryLoad.hidden = true;
  el.loadNote.hidden = true;
  await StorageService.init();
  pintarListasDelCotizador();
  mostrarEstadoDeCarga();
}

el.btnRetryLoad.addEventListener("click", async () => {
  el.btnRetryLoad.disabled = true;
  el.btnStart.textContent = "Cargando precios…";
  await StorageService.reload();
  el.btnRetryLoad.disabled = false;
  pintarListasDelCotizador();
  mostrarEstadoDeCarga();
});

StorageService.onChange(() => {
  pintarListasDelCotizador();
  mostrarEstadoDeCarga();
});

arrancar();
