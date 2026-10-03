/*
  admin.js = EL PANEL DE ADMINISTRACIÓN.
  ------------------------------------------------------------
  Igual que script.js, este archivo NO tiene datos propios ni
  lógica de cálculo: todo lo que lee o escribe pasa por los
  servicios de services.js (la misma "única fuente de datos" que
  usa el cotizador público). Lo único que vive acá es la parte
  visual del panel (pestañas, formularios, tablas).

  IMPORTANTE SOBRE SEGURIDAD:
  El login ahora es real: Supabase Auth (email + password), con
  sesión persistida y recuperada automáticamente por el SDK. La
  protección de admin.html es la que se puede lograr en un sitio
  100% estático (GitHub Pages, sin servidor): si no hay sesión
  válida, el panel (panelView) nunca se muestra ni se cargan datos
  — y aunque alguien intentara forzarlo, Row Level Security en
  Supabase bloquea igual cualquier lectura/escritura sin sesión.
  Ver authService en services.js.

  Iteración 4 — pestañas nuevas: Capacidades, Historial, Leads y
  Actividad. La pestaña Valoración ahora también administra los
  MODELOS del Paso 1 (crear/renombrar/eliminar) y qué capacidades
  tiene cada uno — ver tplValuation() más abajo.

  Iteración "Online" — al arrancar se espera StorageService.init()
  (trae el store real desde Supabase), y tras un login exitoso se
  intenta la migración automática desde localStorage UNA sola vez
  (ver migrarSiHaceFalta() más abajo). StorageService.onChange()
  repinta la pestaña activa sola si otro admin cambia algo desde
  otro dispositivo, sin recargar la página (Parte 4 y 5 del pedido).

  admin.html debe cargar, en este orden:
    supabase-js (CDN) -> supabaseClient.js -> config.js -> services.js -> admin.js
*/

let currentTab = "dashboard";
let catalogSearch = "";
let valuationSearch = "";
let valuationCapFilter = "";
let historySearch = "";
let leadsSearch = "";
let authUsernameCache = DEFAULT_ADMIN_USER;
let adminNotice = null; // aviso destacado en el Resumen (ej. resultado de la migración)
let pendingRepaint = false;
const LIST_LIMIT = 200; // filas que se dibujan en Historial/Leads/Actividad

function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function formatDateTime(ts) {
  if (!ts) return "Sin cambios todavía";
  const d = new Date(ts);
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ---------- Elementos ---------- */
const el = {
  loginView: document.getElementById("loginView"),
  panelView: document.getElementById("panelView"),
  loginForm: document.getElementById("loginForm"),
  loginUser: document.getElementById("loginUser"),
  loginPass: document.getElementById("loginPass"),
  loginError: document.getElementById("loginError"),
  btnLogout: document.getElementById("btnLogout"),
  adminTabs: document.getElementById("adminTabs"),
  tabContent: document.getElementById("tabContent"),
  adminBrandName: document.getElementById("adminBrandName"),
  recoveryView: document.getElementById("recoveryView"),
  recoveryForm: document.getElementById("recoveryForm"),
  recoveryError: document.getElementById("recoveryError"),
  loginInfo: document.getElementById("loginInfo"),
  btnForgot: document.getElementById("btnForgot"),
  syncBanner: document.getElementById("syncBanner"),
  syncText: document.getElementById("syncText"),
  syncRetry: document.getElementById("syncRetry"),
};

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function today() { return new Date().toISOString().slice(0, 10); }

/* ---------- Estado de guardado (barra superior) ---------- */
let syncHideTimer = null;
function renderSync(st) {
  const b = el.syncBanner;
  clearTimeout(syncHideTimer);
  if (el.panelView.hidden || !st || st.state === "idle") { b.hidden = true; return; }
  b.hidden = false;
  b.className = "sync-banner is-" + st.state;
  el.syncText.textContent = st.state === "error" ? "⚠ " + st.message : st.message;
  el.syncRetry.hidden = !(st.state === "error" && (st.kind === "network" || st.kind === "other" || st.kind === "rate"));
  if (st.state === "saved") syncHideTimer = setTimeout(() => { if (StorageService.getStatus().state === "saved") b.hidden = true; }, 3500);
}
el.syncRetry.addEventListener("click", async () => {
  el.syncRetry.disabled = true;
  const r = await StorageService.flush();
  el.syncRetry.disabled = false;
  if (!r.ok) renderSync({ state: "error", message: r.message, kind: "network" });
});
window.addEventListener("beforeunload", (e) => {
  if (StorageService.hasPendingChanges()) { e.preventDefault(); e.returnValue = ""; }
});

/* ---------- Sesión ---------- */
async function showPanel() {
  el.loginView.hidden = true;
  el.recoveryView.hidden = true;
  el.panelView.hidden = false;
  el.tabContent.innerHTML = '<p class="admin-empty">Cargando datos…</p>';
  authUsernameCache = await authService.getUsername();
  // Después de iniciar sesión se vuelven a leer los datos CON permisos de
  // administrador (cotizaciones, leads y actividad).
  await StorageService.reload({ admin: true });
  render();
  await migrarSiHaceFalta();
}

/* Migración automática desde localStorage: StorageService la hace segura
   (solo si la base sigue "pristine", reclamo atómico, nunca borra
   cotizaciones/leads, nunca borra los datos locales). */
async function migrarSiHaceFalta() {
  try {
    const r = await StorageService.migrateFromLocalStorageIfNeeded();
    if (r && r.ok) {
      adminNotice = { kind: "success", text: "Se pasaron a Supabase los datos que tenías guardados en este navegador. Ya están disponibles desde cualquier dispositivo." };
      render();
      goToTab("dashboard");
    } else if (r && r.reason === "datos-locales-invalidos") {
      adminNotice = { kind: "error", text: "Este navegador tenía datos viejos, pero no eran válidos, así que NO se importaron (quedan intactos). Podés cargar tus datos con un backup en la pestaña Backups." };
      renderTabContent();
    }
  } catch (err) {
    console.warn("Migración automática desde localStorage falló", err);
    adminNotice = { kind: "error", text: "No se pudieron pasar a Supabase los datos de este navegador (" + describeError(err).text + "). No se perdió nada: se reintenta la próxima vez que entres." };
    renderTabContent();
  }
}

/* El botón de ingreso queda deshabilitado hasta que termina el arranque
   (si no, un login durante el arranque podía ser pisado por showLogin()). */
const loginSubmitBtn = el.loginForm.querySelector('button[type="submit"]');
loginSubmitBtn.disabled = true;
loginSubmitBtn.textContent = "Cargando…";

function showLogin(message) {
  loginSubmitBtn.disabled = false;
  loginSubmitBtn.textContent = "Ingresar";
  // Al salir no debe quedar nada de los datos privados (leads, historial…) en el DOM.
  el.tabContent.innerHTML = "";
  el.panelView.hidden = true;
  el.recoveryView.hidden = true;
  el.loginView.hidden = false;
  el.loginInfo.hidden = true;
  el.syncBanner.hidden = true;
  if (message) { el.loginError.textContent = message; el.loginError.hidden = false; }
  else el.loginError.hidden = true;
}

function showRecovery() {
  el.panelView.hidden = true;
  el.loginView.hidden = true;
  el.recoveryView.hidden = false;
}

el.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = el.loginForm.querySelector('button[type="submit"]');
  if (submitBtn.disabled) return; // doble clic
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "Verificando…";
  el.loginInfo.hidden = true;
  try {
    const r = await authService.verify(el.loginUser.value.trim(), el.loginPass.value);
    if (r.ok) {
      el.loginError.hidden = true;
      await showPanel();
    } else {
      el.loginError.textContent = r.message;
      el.loginError.hidden = false;
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

el.btnForgot.addEventListener("click", async () => {
  const email = el.loginUser.value.trim();
  el.loginError.hidden = true;
  el.loginInfo.hidden = true;
  if (!email) {
    el.loginError.textContent = "Escribí tu email arriba y volvé a tocar «¿Olvidaste tu contraseña?».";
    el.loginError.hidden = false;
    return;
  }
  el.btnForgot.disabled = true;
  const r = await authService.sendPasswordReset(email);
  el.btnForgot.disabled = false;
  if (r.ok) {
    // Mensaje neutro: no revela si el email existe.
    el.loginInfo.textContent = "Si ese email tiene una cuenta, te enviamos un link para elegir una contraseña nueva. Revisá también la carpeta de spam.";
    el.loginInfo.hidden = false;
  } else {
    el.loginError.textContent = r.error || "No se pudo enviar el email.";
    el.loginError.hidden = false;
  }
});

el.recoveryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const p1 = document.getElementById("recPass").value;
  const p2 = document.getElementById("recPass2").value;
  const showErr = (t) => { el.recoveryError.textContent = t; el.recoveryError.hidden = false; };
  el.recoveryError.hidden = true;
  if (p1.length < 8) return showErr("La contraseña debe tener al menos 8 caracteres.");
  if (p1 !== p2) return showErr("Las contraseñas no coinciden.");
  const btn = el.recoveryForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const r = await authService.updatePassword(p1);
    if (!r.ok) return showErr(r.error);
    try { history.replaceState(null, "", window.location.pathname); } catch (err) { /* ignorar */ }
    if (await authService.checkAdmin()) await showPanel();
    else { await authService.endSession(); showLogin("Contraseña cambiada, pero esta cuenta no tiene permiso de administrador."); }
  } finally {
    btn.disabled = false;
  }
});

el.btnLogout.addEventListener("click", async () => {
  if (StorageService.hasPendingChanges() && !confirm("Hay cambios que todavía NO se guardaron en Supabase. Si salís ahora se pierden. ¿Salir igual?")) return;
  await authService.endSession();
  await StorageService.reload(); // vuelve a datos públicos: la caché ya no conserva cotizaciones ni leads
  adminNotice = null;
  el.loginPass.value = ""; // la contraseña solo se borra al salir (no al arrancar, para no pisar lo que se está escribiendo)
  showLogin();
});

el.adminTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".admin-tab");
  if (!btn) return;
  goToTab(btn.dataset.tab);
});

function goToTab(tab) {
  currentTab = tab;
  catalogSearch = "";
  valuationSearch = "";
  valuationCapFilter = "";
  historySearch = "";
  leadsSearch = "";
  el.adminTabs.querySelectorAll(".admin-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
  renderTabContent();
  el.tabContent.scrollTop = 0;
}

/* ---------- Render general ---------- */
function render() {
  if (el.panelView.hidden) return; // sin sesión no se pinta nada del panel
  el.adminBrandName.textContent = contactService.get().businessName || "Apple Tech";
  renderTabContent();
}

function renderTabContent() {
  if (el.panelView.hidden) return;
  if (currentTab === "dashboard") el.tabContent.innerHTML = tplDashboard();
  else if (currentTab === "catalog") el.tabContent.innerHTML = tplCatalog();
  else if (currentTab === "valuation") el.tabContent.innerHTML = tplValuation();
  else if (currentTab === "capacities") el.tabContent.innerHTML = tplCapacities();
  else if (currentTab === "damages") el.tabContent.innerHTML = tplDamages();
  else if (currentTab === "battery") el.tabContent.innerHTML = tplBattery();
  else if (currentTab === "history") el.tabContent.innerHTML = tplHistory();
  else if (currentTab === "leads") el.tabContent.innerHTML = tplLeads();
  else if (currentTab === "activity") el.tabContent.innerHTML = tplActivity();
  else if (currentTab === "contact") el.tabContent.innerHTML = tplContact();
  else if (currentTab === "backups") el.tabContent.innerHTML = tplBackups();
  else if (currentTab === "security") el.tabContent.innerHTML = tplSecurity();
}

/* Vuelve a renderizar preservando foco y cursor del campo activo,
   para que buscar o tipear no "salte". */
function renderPreserveFocus() {
  const active = document.activeElement;
  const id = active && active.id;
  const start = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
  const end = active && typeof active.selectionEnd === "number" ? active.selectionEnd : null;
  renderTabContent();
  if (id) {
    const revived = document.getElementById(id);
    if (revived) {
      revived.focus();
      if (start !== null && revived.setSelectionRange) {
        try { revived.setSelectionRange(start, end); } catch (err) { /* inputs numéricos no soportan selección */ }
      }
    }
  }
}

/* ---------- Dashboard ---------- */
function tplDashboard() {
  const c = catalogService.getAll();
  const published = c.filter((x) => x.estado === "published").length;
  const out = c.filter((x) => x.estado === "out").length;
  const draft = c.filter((x) => x.estado === "draft").length;
  const damages = damageService.getAll();
  const damagesActive = damageService.getActive().length;
  const battery = batteryService.getAll();
  const valoraciones = valuationService.getAll();
  const modelos = modeloService.getAll();
  const capacidades = capacidadService.getAll();
  const capacidadesActivas = capacidadService.getActive().length;
  const totalCombos = modelos.reduce((acc, m) => acc + (m.capacidadIds || []).length, 0);
  const historyCount = quotesHistoryService.getAll().length;
  const leadsCount = leadsService.getAll().length;
  const lastModified = StorageService.loadStore().meta.lastModified;

  const loadError = StorageService.getLoadError();
  let avisos = "";
  if (loadError) {
    avisos += `<div class="admin-block"><div class="admin-warning" role="alert"><strong>No se pudieron leer los datos de Supabase.</strong> ${escapeHtml(loadError)}<br>Mientras tanto no se puede guardar nada, para no pisar tus datos reales.<br><button class="btn btn-secondary" data-action="retry-load" style="margin-top:10px;">Reintentar</button></div></div>`;
  } else if (backupService.isEmpty()) {
    avisos += `<div class="admin-block"><div class="admin-warning"><strong>La base está vacía.</strong> El cotizador público todavía no muestra ningún modelo. Podés cargar datos de EJEMPLO para empezar (y después reemplazar los precios por los reales), o importar un backup en la pestaña Backups.<br><button class="btn btn-primary" data-action="load-sample" style="margin-top:10px;">Cargar datos de ejemplo</button></div></div>`;
  }
  if (adminNotice) {
    avisos += `<div class="admin-block"><p class="admin-inline-message ${adminNotice.kind === "error" ? "is-error" : "is-success"}" role="status">${escapeHtml(adminNotice.text)}</p></div>`;
  }

  return `
    ${avisos}
    <div class="admin-block">
      <h2>Resumen del catálogo de venta</h2>
      <p class="admin-block-hint">Estado del catálogo que ve el cliente en el Paso 5 (comprar otro equipo). El Paso 1 ("¿Qué iPhone tenés?") no depende de este catálogo de venta: usa los modelos definidos en Admin → Valoración.</p>
      <div class="admin-stat-grid">
        <div class="admin-stat"><span class="stat-value">${c.length}</span><span class="stat-label">Productos totales</span></div>
        <div class="admin-stat"><span class="stat-value">${published}</span><span class="stat-label">Publicados</span></div>
        <div class="admin-stat"><span class="stat-value">${out}</span><span class="stat-label">Sin stock</span></div>
        <div class="admin-stat"><span class="stat-value">${draft}</span><span class="stat-label">Ocultos (borrador)</span></div>
      </div>
    </div>

    <div class="admin-block">
      <h2>Modelos, capacidades y valoración</h2>
      <p class="admin-block-hint">Todo lo que usa el Paso 1 y el Paso 2 del cotizador — 100% administrable, sin listas fijas ni multiplicadores.</p>
      <div class="admin-stat-grid">
        <div class="admin-stat"><span class="stat-value">${modelos.length}</span><span class="stat-label">Modelos (Paso 1)</span></div>
        <div class="admin-stat"><span class="stat-value">${capacidadesActivas}/${capacidades.length}</span><span class="stat-label">Capacidades activas</span></div>
        <div class="admin-stat"><span class="stat-value">${valoraciones.length}/${totalCombos}</span><span class="stat-label">Valoraciones cargadas</span></div>
        <div class="admin-stat"><span class="stat-value">${damagesActive}/${damages.length}</span><span class="stat-label">Desperfectos activos</span></div>
      </div>
    </div>

    <div class="admin-block">
      <h2>Actividad del cotizador</h2>
      <p class="admin-block-hint">Cotizaciones y leads generados por clientes en el sitio público, y reglas de batería vigentes.</p>
      <div class="admin-stat-grid">
        <div class="admin-stat"><span class="stat-value">${historyCount}</span><span class="stat-label">Cotizaciones en historial</span></div>
        <div class="admin-stat"><span class="stat-value">${leadsCount}</span><span class="stat-label">Leads</span></div>
        <div class="admin-stat"><span class="stat-value">${battery.length}</span><span class="stat-label">Reglas de batería</span></div>
      </div>
    </div>

    <div class="admin-block">
      <h2>Última modificación</h2>
      <p class="admin-block-hint">${formatDateTime(lastModified)}</p>
    </div>

    <div class="admin-block">
      <h2>Accesos rápidos</h2>
      <div class="admin-quicklinks">
        <button class="admin-quicklink" data-goto="catalog">Catálogo de venta</button>
        <button class="admin-quicklink" data-goto="valuation">Valoración</button>
        <button class="admin-quicklink" data-goto="capacities">Capacidades</button>
        <button class="admin-quicklink" data-goto="damages">Desperfectos</button>
        <button class="admin-quicklink" data-goto="battery">Reglas de batería</button>
        <button class="admin-quicklink" data-goto="history">Historial</button>
        <button class="admin-quicklink" data-goto="leads">Leads</button>
        <button class="admin-quicklink" data-goto="activity">Actividad</button>
        <button class="admin-quicklink" data-goto="contact">Contacto</button>
        <button class="admin-quicklink" data-goto="backups">Backups</button>
      </div>
    </div>
  `;
}

/* ---------- Catálogo / precios ---------- */
function estadoBadge(estado) {
  const map = {
    published: ["badge-published", "Publicado"],
    out: ["badge-out", "Sin stock"],
    draft: ["badge-draft", "Borrador"],
  };
  const [cls, label] = map[estado] || map.draft;
  return `<span class="admin-badge ${cls}">${label}</span>`;
}

function tplCatalog() {
  const q = catalogSearch.trim().toLowerCase();
  const all = catalogService.getAll();
  const items = all.filter((m) => m.nombre.toLowerCase().includes(q));
  const emptyMsg = all.length === 0
    ? 'No hay productos en el catálogo de venta. El Paso 1 del cotizador sigue funcionando igual: usa los modelos definidos en Admin → Valoración, independientes de este catálogo.'
    : 'Ningún producto coincide con la búsqueda.';
  return `
    <div class="admin-block">
      <h2>Catálogo de venta (USD)</h2>
      <p class="admin-block-hint">Este catálogo es exclusivo del Paso 5 ("¿vas a comprar otro equipo?") del cotizador — precio, stock, estado e imagen se leen desde acá. <strong>No afecta al Paso 1</strong> ("¿Qué iPhone tenés?"), que usa los modelos de Admin → Valoración. Un producto solo se ofrece para comprar si está "Publicado" <em>y</em> tiene stock.</p>
      <div class="admin-toolbar">
        <input id="catalogSearch" class="select-input" placeholder="Buscar modelo…" value="${escapeHtml(catalogSearch)}">
        <button class="admin-add-btn" data-action="add-model">+ Agregar modelo</button>
      </div>
      <div class="admin-row-list">
        ${items.length ? items.map(catalogRow).join("") : `<p class="admin-empty">${emptyMsg}</p>`}
      </div>
    </div>
  `;
}

function catalogRow(m) {
  return `
    <div class="admin-row admin-row-wrap" data-section="catalog" data-id="${escapeHtml(m.id)}">
      ${m.imagenUrl ? `<img class="admin-row-thumb" src="${escapeHtml(m.imagenUrl)}" alt="">` : ""}
      <div class="admin-row-main">
        <input type="text" class="admin-row-name-input" data-field="nombre" value="${escapeHtml(m.nombre)}">
        <div class="admin-row-sub">${estadoBadge(m.estado)}</div>
      </div>
      <div class="admin-field admin-field-price">
        <label>Precio (USD)</label>
        <input type="number" min="0" step="1" data-field="precioBaseUSD" value="${m.precioBaseUSD}">
      </div>
      <label class="admin-switch" title="Con stock para compra">
        <input type="checkbox" data-field="stock" ${m.stock ? "checked" : ""}>
        <span class="track"></span>
        <span class="thumb"></span>
      </label>
      <div class="admin-field">
        <label>Estado</label>
        <select data-field="estado">
          <option value="published" ${m.estado === "published" ? "selected" : ""}>Publicado</option>
          <option value="out" ${m.estado === "out" ? "selected" : ""}>Sin stock</option>
          <option value="draft" ${m.estado === "draft" ? "selected" : ""}>Borrador (oculto)</option>
        </select>
      </div>
      <button class="admin-icon-btn" data-action="delete-model" title="Eliminar modelo">${trashIcon()}</button>
      <div class="admin-field" style="flex:1 1 100%;">
        <label>Detalle (opcional: capacidad, batería, estado — se muestra al cliente)</label>
        <input type="text" data-field="detalle" maxlength="160" value="${escapeHtml(m.detalle || "")}" placeholder="Ej: 128 GB · Batería 92% · Impecable" style="width:100%;">
      </div>
      <div class="admin-field" style="flex:1 1 100%;">
        <label>Imagen (URL https, opcional)</label>
        <input type="text" data-field="imagenUrl" value="${escapeHtml(m.imagenUrl || "")}" placeholder="https://…" style="width:100%;">
      </div>
    </div>
  `;
}

/* ---------- Valoración (modelos + capacidades por modelo + valor USD) ---------- */
function tplValuation() {
  const q = valuationSearch.trim().toLowerCase();
  const todosLosModelos = modeloService.getAll();
  const modelos = todosLosModelos.filter((m) => m.nombre.toLowerCase().includes(q));
  const capacidadesGlobal = capacidadService.getAll();
  const capacidadesActivas = capacidadService.getActive();
  const capacidadesAMostrar = valuationCapFilter
    ? capacidadesGlobal.filter((c) => c.id === valuationCapFilter)
    : capacidadesGlobal;

  const totalCombos = todosLosModelos.reduce((acc, m) => acc + (m.capacidadIds || []).length, 0);
  const cargadas = valuationService.getAll().length;

  const emptyMsg = todosLosModelos.length === 0
    ? "No hay modelos cargados todavía. Usá \"+ Agregar modelo\" para crear el primero — aparecerá solo en el Paso 1 del cotizador."
    : "Ningún modelo coincide con la búsqueda.";

  return `
    <div class="admin-block">
      <h2>Valoración (modelos, capacidades y canje)</h2>
      <p class="admin-block-hint">
        Acá se administran los MODELOS del Paso 1 del cotizador, qué CAPACIDADES tiene cada uno
        (definidas en Admin → Capacidades) y el valor de canje en USD de cada combinación — sin
        fórmulas ni multiplicadores, cada casillero es un número independiente y editable. El
        Paso 1 y el Paso 2 del cotizador leen EXCLUSIVAMENTE de acá: si agregás un modelo, aparece
        solo; si lo eliminás, desaparece solo. Cargadas: ${cargadas}/${totalCombos}.
      </p>
      <div class="admin-toolbar">
        <input id="valuationSearch" class="select-input" placeholder="Buscar modelo…" value="${escapeHtml(valuationSearch)}">
        <select id="valuationCapFilter" class="select-input">
          <option value="">Todas las capacidades</option>
          ${capacidadesGlobal.map((c) => `<option value="${escapeHtml(c.id)}" ${valuationCapFilter === c.id ? "selected" : ""}>${escapeHtml(c.nombre)}</option>`).join("")}
        </select>
        <button class="admin-add-btn" data-action="add-modelo">+ Agregar modelo</button>
      </div>
      <p class="admin-inline-message" id="valuationMessage" hidden></p>
      <div class="admin-valuation-list">
        ${modelos.length ? modelos.map((m) => valuationGroup(m, capacidadesAMostrar, capacidadesActivas)).join("") : `<p class="admin-empty">${emptyMsg}</p>`}
      </div>
    </div>

    <div class="admin-block">
      <h2>Exportar / importar valoraciones</h2>
      <p class="admin-block-hint">Un archivo más chico que el backup completo (pestaña Backups): solo modelos, capacidades y valores de canje — útil para llevar la misma lista de precios a otro dispositivo. El backup general ya incluye esto también, como parte de todos los datos.</p>
      <button class="btn btn-secondary btn-full" data-action="export-valuation">Exportar valoraciones (.json)</button>
      <input type="file" id="importValuationFile" accept="application/json,.json" class="admin-file-input" style="margin-top:10px;">
      <button class="btn btn-secondary btn-full" data-action="import-valuation" style="margin-top:10px;">Importar valoraciones</button>
    </div>
  `;
}

function valuationGroup(modelo, capacidadesFiltro, capacidadesActivas) {
  const entries = valuationService.getByModelo(modelo.id);
  const idsAsociados = modelo.capacidadIds || [];

  // Chips para asociar/desasociar capacidades a este modelo (Fase 4).
  // Se ofrecen las activas + cualquiera ya asociada aunque esté
  // desactivada mientras tanto, para no "esconder" una asociación
  // existente sin que el admin se entere.
  const opcionesChip = capacidadesActivas.slice();
  idsAsociados.forEach((cid) => {
    if (!opcionesChip.some((c) => c.id === cid)) {
      const c = capacidadService.getById(cid);
      if (c) opcionesChip.push(c);
    }
  });

  // Solo se listan, en la grilla de valores, las capacidades
  // asociadas a ESTE modelo que además coincidan con el filtro global.
  const filtroIds = capacidadesFiltro.map((c) => c.id);
  const capsAMostrar = idsAsociados
    .filter((cid) => filtroIds.includes(cid))
    .map((cid) => capacidadService.getById(cid))
    .filter(Boolean);

  return `
    <div class="admin-valuation-group">
      <div class="admin-row" data-section="modelo" data-id="${escapeHtml(modelo.id)}" style="margin-bottom:10px;">
        <div class="admin-row-main">
          <input type="text" class="admin-row-name-input" data-field="nombre" maxlength="120" value="${escapeHtml(modelo.nombre)}">
          ${modeloService.getPublic().some((x) => x.id === modelo.id) ? "" : '<div class="admin-no-price">Sin precios cargados (mayores a 0): este modelo NO se muestra al público.</div>'}
        </div>
        <button class="admin-icon-btn" data-action="delete-modelo" title="Eliminar modelo">${trashIcon()}</button>
      </div>
      <div style="margin:0 2px 10px;">
        <p class="admin-row-sub" style="margin-bottom:6px;">Capacidades de este modelo:</p>
        <div class="chip-row">
          ${opcionesChip.length ? opcionesChip.map((c) => `
            <button type="button" class="chip${idsAsociados.includes(c.id) ? " is-selected" : ""}" data-action="toggle-modelo-capacidad" data-modelo-id="${escapeHtml(modelo.id)}" data-capacidad-id="${escapeHtml(c.id)}">${escapeHtml(c.nombre)}${c.activo === false ? " (inactiva)" : ""}</button>
          `).join("") : '<span class="admin-row-sub">No hay capacidades activas para asociar — creá una en Admin → Capacidades.</span>'}
        </div>
      </div>
      <div class="admin-valuation-caps">
        ${capsAMostrar.length ? capsAMostrar.map((c) => valuationCapRow(modelo, c, entries.find((e) => e.capacidadId === c.id))).join("") : '<p class="admin-empty">Este modelo no tiene capacidades asociadas (o ninguna coincide con el filtro).</p>'}
      </div>
    </div>
  `;
}

function valuationCapRow(modelo, capacidad, entry) {
  if (entry) {
    return `
      <div class="admin-row" data-section="valoracion" data-id="${escapeHtml(entry.id)}" data-modelo-id="${escapeHtml(modelo.id)}" data-capacidad-id="${escapeHtml(capacidad.id)}">
        <div class="admin-row-main"><span class="admin-row-cap-label">${escapeHtml(capacidad.nombre)}</span></div>
        <div class="admin-field admin-field-price">
          <label>Valor (USD)</label>
          <input type="number" min="0" step="1" data-field="valorUSD" value="${entry.valorUSD}">
        </div>
        <button class="admin-icon-btn" data-action="delete-valuation" title="Eliminar valoración">${trashIcon()}</button>
      </div>
    `;
  }
  // Esta combinación modelo+capacidad todavía no tiene valor cargado.
  return `
    <div class="admin-row admin-row-missing" data-modelo-id="${escapeHtml(modelo.id)}" data-capacidad-id="${escapeHtml(capacidad.id)}">
      <div class="admin-row-main">
        <span class="admin-row-cap-label">${escapeHtml(capacidad.nombre)}</span>
        <span class="admin-row-sub">Sin cargar</span>
      </div>
      <button class="admin-add-btn admin-add-btn-small" data-action="add-valuation">+ Cargar valor</button>
    </div>
  `;
}

/* ---------- Capacidades (catálogo global, Fase 3) ---------- */
function tplCapacities() {
  const items = capacidadService.getAll();
  return `
    <div class="admin-block">
      <h2>Capacidades</h2>
      <p class="admin-block-hint">Definí acá las capacidades de almacenamiento posibles (64 GB, 128 GB, etc.). Después, en Admin → Valoración, elegís cuáles aplican a cada modelo. Desactivar una capacidad la oculta del Paso 2 del cotizador sin borrar los valores ya cargados; eliminarla la quita de todos los modelos y borra sus valoraciones.</p>
      <div class="admin-toolbar">
        <button class="admin-add-btn" data-action="add-capacidad" style="margin-left:auto;">+ Agregar capacidad</button>
      </div>
      <p class="admin-inline-message" id="capacidadMessage" hidden></p>
      <div class="admin-row-list">
        ${items.length ? items.map(capacidadRow).join("") : '<p class="admin-empty">No hay capacidades configuradas.</p>'}
      </div>
    </div>
  `;
}

function capacidadRow(c) {
  return `
    <div class="admin-row admin-row-wrap" data-section="capacidad" data-id="${escapeHtml(c.id)}">
      <div class="admin-field" style="flex:1 1 160px;">
        <label>Nombre</label>
        <input type="text" data-field="nombre" value="${escapeHtml(c.nombre)}" style="width:100%;">
      </div>
      <label class="admin-switch" title="Visible para el cliente en el Paso 2">
        <input type="checkbox" data-field="activo" ${c.activo !== false ? "checked" : ""}>
        <span class="track"></span>
        <span class="thumb"></span>
      </label>
      <button class="admin-icon-btn" data-action="delete-capacidad" title="Eliminar">${trashIcon()}</button>
    </div>
  `;
}

/* ---------- Desperfectos ---------- */
function tplDamages() {
  const items = damageService.getAll();
  return `
    <div class="admin-block">
      <h2>Desperfectos</h2>
      <p class="admin-block-hint">Estas son las opciones que ve el cliente en el paso 4 (solo el nombre — el descuento en USD NUNCA se muestra al cliente, se aplica internamente). Desactivá un desperfecto para ocultarlo sin borrarlo.</p>
      <div class="admin-toolbar">
        <button class="admin-add-btn" data-action="add-damage" style="margin-left:auto;">+ Agregar desperfecto</button>
      </div>
      <div class="admin-row-list">
        ${items.length ? items.map(damageRow).join("") : '<p class="admin-empty">No hay desperfectos configurados.</p>'}
      </div>
    </div>
  `;
}

function damageRow(d) {
  return `
    <div class="admin-row admin-row-wrap" data-section="desperfectos" data-id="${escapeHtml(d.id)}">
      <div class="admin-field" style="flex:1 1 160px;">
        <label>Nombre</label>
        <input type="text" data-field="nombre" value="${escapeHtml(d.nombre)}" style="width:100%;">
      </div>
      <div class="admin-field admin-field-price">
        <label>Descuento (USD)</label>
        <input type="number" min="0" step="1" data-field="descuentoUSD" value="${d.descuentoUSD}">
      </div>
      <label class="admin-switch" title="Visible para el cliente">
        <input type="checkbox" data-field="activo" ${d.activo !== false ? "checked" : ""}>
        <span class="track"></span>
        <span class="thumb"></span>
      </label>
      <button class="admin-icon-btn" data-action="delete-damage" title="Eliminar">${trashIcon()}</button>
      <div class="admin-field" style="flex:1 1 100%;">
        <label>Descripción interna (opcional, no la ve el cliente)</label>
        <input type="text" data-field="descripcion" value="${escapeHtml(d.descripcion || "")}" style="width:100%;">
      </div>
    </div>
  `;
}

/* ---------- Batería ---------- */
function tplBattery() {
  const items = batteryService.getAll();
  return `
    <div class="admin-block">
      <h2>Reglas de batería</h2>
      <p class="admin-block-hint">Cada regla define un rango de salud de batería (%) y un descuento fijo en USD que se resta del valor cuando el cliente elige ese rango en el paso 3.</p>
      <div class="admin-toolbar">
        <button class="admin-add-btn" data-action="add-battery" style="margin-left:auto;">+ Agregar rango</button>
      </div>
      ${(() => { const av = batteryService.validateRanges(); return av.length ? `<div class="admin-warning"><strong>Revisá los rangos:</strong><ul>${av.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul></div>` : ""; })()}
      <div class="admin-row-list">
        ${items.length ? items.map(batteryRow).join("") : '<p class="admin-empty">No hay rangos configurados.</p>'}
      </div>
    </div>
  `;
}

function batteryRow(b) {
  return `
    <div class="admin-row admin-row-wrap" data-section="bateria" data-id="${escapeHtml(b.id)}">
      <div class="admin-field" style="flex:1 1 120px;">
        <label>Etiqueta</label>
        <input type="text" data-field="label" value="${escapeHtml(b.label)}" style="width:100%;">
      </div>
      <div class="admin-field" style="flex:1 1 120px;">
        <label>Descripción</label>
        <input type="text" data-field="desc" value="${escapeHtml(b.desc)}" style="width:100%;">
      </div>
      <div class="admin-field">
        <label>% mínimo</label>
        <input type="number" min="0" max="100" step="1" data-field="porcentajeMinimo" value="${b.porcentajeMinimo}">
      </div>
      <div class="admin-field">
        <label>% máximo</label>
        <input type="number" min="0" max="100" step="1" data-field="porcentajeMaximo" value="${b.porcentajeMaximo}">
      </div>
      <div class="admin-field admin-field-price">
        <label>Descuento (USD)</label>
        <input type="number" min="0" step="1" data-field="descuentoUSD" value="${b.descuentoUSD}">
      </div>
      <button class="admin-icon-btn" data-action="delete-battery" title="Eliminar">${trashIcon()}</button>
    </div>
  `;
}

/* ---------- Historial de cotizaciones (Fase 9) ---------- */
function tplHistory() {
  const q = historySearch.trim().toLowerCase();
  const all = quotesHistoryService.getAll();
  const filtered = all.filter((h) => (h.modeloNombre || "").toLowerCase().includes(q) || (h.capacidadNombre || "").toLowerCase().includes(q));
  const items = filtered.slice(0, LIST_LIMIT);
  return `
    <div class="admin-block">
      <h2>Historial de cotizaciones</h2>
      <p class="admin-block-hint">Cada vez que un cliente llega al resultado (Paso 5) con una combinación nueva se guarda acá: modelo, capacidad, color, batería, desperfectos y valores. Mostrando las últimas ${Math.min(all.length, LIST_LIMIT)} de ${all.length} cargadas (el panel carga hasta ${LOG_LIMITS.quotesHistory}; el backup completo trae todas).</p>
      <div class="admin-toolbar">
        <input id="historySearch" class="select-input" placeholder="Buscar por modelo o capacidad…" value="${escapeHtml(historySearch)}">
      </div>
      <div class="admin-row-list">
        ${items.length ? items.map(historyRow).join("") : `<p class="admin-empty">${all.length === 0 ? "Todavía no hay cotizaciones registradas." : "Ninguna coincide con la búsqueda."}</p>`}
      </div>
    </div>
  `;
}

function historyRow(h) {
  const extra = [h.color, h.bateriaLabel ? "batería " + h.bateriaLabel : "", (h.desperfectos && h.desperfectos.length) ? "desperfectos: " + h.desperfectos.join(", ") : "sin desperfectos"].filter(Boolean).join(" · ");
  return `
    <div class="admin-row admin-row-wrap" data-id="${escapeHtml(h.id)}">
      <div class="admin-row-main">
        <span class="admin-row-name">${escapeHtml(h.modeloNombre)} · ${escapeHtml(h.capacidadNombre)} → ${pricingService.formatUSD(h.valorFinalUSD)}</span>
        <div class="admin-row-sub">${formatDateTime(h.fecha)} — Base ${pricingService.formatUSD(h.valorBaseUSD)}, batería −${pricingService.formatUSD(h.descuentoBateriaUSD)}, desperfectos −${pricingService.formatUSD(h.descuentoDesperfectosUSD)}</div>
        <div class="admin-row-sub">${escapeHtml(extra)}</div>
      </div>
      <button class="admin-icon-btn" data-action="delete-history" title="Eliminar registro">${trashIcon()}</button>
    </div>
  `;
}

/* ---------- Leads ---------- */
function tplLeads() {
  const q = leadsSearch.trim().toLowerCase();
  const all = leadsService.getAll();
  const filtered = all.filter((l) => (l.modeloNombre || "").toLowerCase().includes(q) || (l.nombre || "").toLowerCase().includes(q) || (l.whatsapp || "").toLowerCase().includes(q) || (l.productoCompraNombre || "").toLowerCase().includes(q));
  const items = filtered.slice(0, LIST_LIMIT);
  return `
    <div class="admin-block">
      <h2>Leads</h2>
      <p class="admin-block-hint">Se registra un lead cada vez que un cliente toca «Consultar por WhatsApp». El nombre y el WhatsApp del cliente son opcionales (los completa él en el Paso 5): si los dejó, podés escribirle desde acá. Mostrando ${Math.min(all.length, LIST_LIMIT)} de ${all.length}.</p>
      <div class="admin-toolbar">
        <input id="leadsSearch" class="select-input" placeholder="Buscar por modelo, nombre, WhatsApp o equipo…" value="${escapeHtml(leadsSearch)}">
      </div>
      <div class="admin-row-list">
        ${items.length ? items.map(leadRow).join("") : `<p class="admin-empty">${all.length === 0 ? "Todavía no hay leads registrados." : "Ninguno coincide con la búsqueda."}</p>`}
      </div>
    </div>
  `;
}

function leadRow(l) {
  const compra = l.productoCompraNombre ? ` · quiere ${escapeHtml(l.productoCompraNombre)}${l.diferenciaUSD !== null && l.diferenciaUSD !== undefined ? " (diferencia " + pricingService.formatUSD(l.diferenciaUSD) + ")" : ""}` : "";
  const contacto = (l.nombre ? " · " + escapeHtml(l.nombre) : "") + (l.whatsapp ? ` · <a href="https://wa.me/${escapeHtml(l.whatsapp)}" target="_blank" rel="noopener">${escapeHtml(l.whatsapp)}</a>` : " · sin datos de contacto");
  return `
    <div class="admin-row admin-row-wrap" data-id="${escapeHtml(l.id)}">
      <div class="admin-row-main">
        <span class="admin-row-name">${escapeHtml(l.modeloNombre || "—")}${l.capacidadNombre ? " · " + escapeHtml(l.capacidadNombre) : ""}</span>
        <div class="admin-row-sub">${formatDateTime(l.fecha)} · ${l.resultadoUSD > 0 ? pricingService.formatUSD(l.resultadoUSD) : "a consultar"}${compra}${contacto}</div>
      </div>
      <button class="admin-icon-btn" data-action="delete-lead" title="Eliminar lead">${trashIcon()}</button>
    </div>
  `;
}

/* ---------- Actividad (auditLog, Fase 11) ---------- */
function tplActivity() {
  const all = auditLogService.getAll();
  const LIMITE = 200;
  const items = all.slice(0, LIMITE);
  return `
    <div class="admin-block">
      <h2>Actividad</h2>
      <p class="admin-block-hint">Historial de cambios de precios, batería, desperfectos, valoración, capacidades y modelos hechos desde este panel, con el valor anterior y el nuevo. Total: ${all.length}${all.length > items.length ? " (se muestran las últimas " + items.length + ")" : ""}.</p>
      <div class="admin-row-list">
        ${items.length ? items.map(activityRow).join("") : '<p class="admin-empty">Todavía no hay actividad registrada.</p>'}
      </div>
    </div>
  `;
}

function formatLogValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "sí" : "no";
  return String(v);
}

function activityRow(a) {
  const anterior = formatLogValue(a.valorAnterior);
  const nuevo = formatLogValue(a.valorNuevo);
  return `
    <div class="admin-row admin-row-wrap">
      <div class="admin-row-main">
        <span class="admin-row-name">${escapeHtml(a.accion)} — ${escapeHtml(a.entidad)}</span>
        <div class="admin-row-sub">${formatDateTime(a.fecha)}${anterior !== null ? " · antes: " + escapeHtml(anterior) : ""}${nuevo !== null ? " · ahora: " + escapeHtml(nuevo) : ""}</div>
      </div>
    </div>
  `;
}

/* ---------- Contacto ---------- */
function tplContact() {
  const c = contactService.get();
  const fields = [
    ["businessName", "Nombre del negocio"],
    ["phone", "Teléfono"],
    ["whatsapp", "WhatsApp (solo números, con código de país, sin +)"],
    ["instagram", "Instagram"],
    ["address", "Dirección"],
    ["hours", "Horario de atención"],
  ];
  return `
    <div class="admin-block">
      <h2>Datos de contacto</h2>
      <p class="admin-block-hint">El nombre del negocio se muestra en el encabezado y el WhatsApp se usa para el botón de consulta del cotizador (si lo dejás vacío, el botón no aparece). Los cambios se aplican cuando tocás «Guardar cambios».</p>
      <div class="admin-form-grid" data-section="contact">
        ${fields.map(([key, label]) => `
          <div class="admin-field" style="width:100%;">
            <label>${label}</label>
            <input type="text" class="select-input" data-field="${key}" value="${escapeHtml(c[key] || "")}">
          </div>
        `).join("")}
        <p class="admin-inline-message" id="contactMessage" role="status" hidden></p>
        <div class="admin-save-row">
          <button class="btn btn-primary" data-action="save-contact">Guardar cambios</button>
        </div>
      </div>
    </div>
  `;
}

/* ---------- Backups ---------- */
function tplBackups() {
  return `
    <div class="admin-block">
      <h2>Exportar backup</h2>
      <p class="admin-block-hint">Descarga un archivo .json con TODO: catálogo de venta, modelos, capacidades, valoraciones, desperfectos, batería, contacto, y todas las cotizaciones, leads y actividad. Hacelo seguido y guardalo en un lugar seguro.</p>
      <button class="btn btn-secondary btn-full" data-action="export-backup">Descargar backup (.json)</button>
    </div>

    <div class="admin-block">
      <h2>Importar backup</h2>
      <p class="admin-block-hint">Reemplaza la configuración actual (precios, modelos, catálogo, contacto…) por la del archivo. NO borra cotizaciones, leads ni actividad. Antes de importar se descarga automáticamente una copia de lo actual.</p>
      <input type="file" id="importFile" accept="application/json,.json" class="admin-file-input">
      <button class="btn btn-secondary btn-full" data-action="import-backup" style="margin-top:10px;">Importar backup</button>
      <p class="admin-inline-message" id="backupMessage" hidden></p>
    </div>

    <div class="admin-block">
      <h2>Restaurar datos de ejemplo</h2>
      <p class="admin-block-hint">Vuelve el catálogo, los modelos, las capacidades, las valoraciones, los desperfectos, la batería y el contacto a los datos de EJEMPLO (se pierden tus precios reales, por eso se pide confirmación escrita y se descarga antes una copia). Las cotizaciones, los leads y la actividad NO se borran.</p>
      <button class="btn btn-ghost btn-full" data-action="factory-reset">Restaurar datos de ejemplo</button>
    </div>
  `;
}

/* ---------- Seguridad ---------- */
function tplSecurity() {
  return `
    <div class="admin-block">
      <h2>Usuario y contraseña</h2>
      <p class="admin-block-hint">Email actual: <strong>${escapeHtml(authUsernameCache)}</strong>. Dejá la contraseña en blanco si solo querés cambiar el email.</p>
      <form id="securityForm" class="admin-form-grid" autocomplete="off">
        <div class="admin-field" style="width:100%;">
          <label>Nuevo email</label>
          <input type="email" class="select-input" id="secUser" value="${escapeHtml(authUsernameCache)}" autocomplete="off">
        </div>
        <div class="admin-field" style="width:100%;">
          <label>Nueva contraseña</label>
          <input type="password" class="select-input" id="secPass" placeholder="Dejar en blanco para no cambiarla" autocomplete="new-password">
        </div>
        <div class="admin-field" style="width:100%;">
          <label>Repetir nueva contraseña</label>
          <input type="password" class="select-input" id="secPass2" placeholder="Repetir nueva contraseña" autocomplete="new-password">
        </div>
        <p class="admin-inline-message" id="securityMessage" hidden></p>
        <div class="admin-save-row">
          <button type="submit" class="btn btn-primary">Guardar credenciales</button>
        </div>
      </form>
    </div>

    <div class="admin-block">
      <h2>Restablecer contraseña</h2>
      <p class="admin-block-hint">Envía un email de recuperación de contraseña a <strong>${escapeHtml(authUsernameCache)}</strong>. Ya no existe una contraseña de fábrica: la cuenta se gestiona en Supabase Auth.</p>
      <button class="btn btn-ghost btn-full" data-action="reset-credentials">Enviar email de recuperación</button>
    </div>
  `;
}

function trashIcon() {
  return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7h14Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function showInlineMessage(id, text, kind) {
  const tag = document.getElementById(id);
  if (!tag) return;
  tag.textContent = text;
  tag.hidden = false;
  tag.className = "admin-inline-message" + (kind === "error" ? " is-error" : " is-success");
}

/* ---------- Delegación de eventos: buscadores (no guardan nada) ---------- */
el.tabContent.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "catalogSearch") { catalogSearch = t.value; renderPreserveFocus(); }
  else if (t.id === "valuationSearch") { valuationSearch = t.value; renderPreserveFocus(); }
  else if (t.id === "historySearch") { historySearch = t.value; renderPreserveFocus(); }
  else if (t.id === "leadsSearch") { leadsSearch = t.value; renderPreserveFocus(); }
});

/* ---------- Delegación de eventos: guardado de campos ----------
   Un campo se guarda UNA vez, cuando el administrador termina de
   editarlo (sale del campo / elige una opción) — no en cada tecla.
   Así cada cambio es un guardado real, un solo registro de auditoría y
   no hay nada a medio escribir que Realtime pueda pisar. */
el.tabContent.addEventListener("change", (e) => {
  const t = e.target;

  if (t.id === "valuationCapFilter") {
    valuationCapFilter = t.value;
    renderTabContent();
    return;
  }

  const row = t.closest("[data-section]");
  if (!row || !t.dataset.field) return;
  const section = row.dataset.section;
  if (section === "contact") return; // Contacto se guarda con su botón
  const id = row.dataset.id;
  const field = t.dataset.field;
  const value = t.type === "checkbox" ? t.checked : t.value;

  let error = null;
  let item = null;
  if (section === "catalog") item = catalogService.update(id, { [field]: value });
  else if (section === "desperfectos") item = damageService.update(id, { [field]: value });
  else if (section === "bateria") item = batteryService.update(id, { [field]: value });
  else if (section === "valoracion") item = valuationService.update(id, { [field]: value });
  else if (section === "modelo") {
    const r = modeloService.update(id, { [field]: value });
    if (!r.ok) error = { id: "valuationMessage", text: r.error };
    item = r.item;
  } else if (section === "capacidad") {
    const r = capacidadService.update(id, { [field]: value });
    if (!r.ok) error = { id: "capacidadMessage", text: r.error };
    item = r.item;
  }

  if (error) {
    // Se rechazó: se vuelve a dibujar con el último valor válido y se explica por qué.
    renderTabContent();
    showInlineMessage(error.id, error.text, "error");
    return;
  }
  if (t.tagName === "SELECT" || t.type === "checkbox") {
    renderTabContent(); // cambia badges/contadores
  } else if (item && field in item) {
    // Se muestra lo que realmente quedó guardado (recortado/corregido), sin redibujar
    // todo (así un clic siguiente en "eliminar" no se pierde).
    t.value = item[field];
  }
});

/* Repintar por Realtime mientras alguien escribe en un campo borraría lo
   tipeado: se pospone hasta que el administrador termine de editar. */
function editandoUnCampo() {
  const a = document.activeElement;
  return !!(a && el.tabContent.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}
el.tabContent.addEventListener("focusout", () => {
  if (!pendingRepaint) return;
  setTimeout(() => {
    if (!editandoUnCampo() && !el.panelView.hidden) { pendingRepaint = false; renderPreserveFocus(); }
  }, 300);
});

/* ---------- Delegación de eventos: botones (agregar / eliminar / guardar / backups) ---------- */
el.tabContent.addEventListener("click", (e) => {
  const gotoBtn = e.target.closest("[data-goto]");
  if (gotoBtn) {
    goToTab(gotoBtn.dataset.goto);
    return;
  }

  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "add-model") {
    catalogService.create({ nombre: "Nuevo modelo", precioBaseUSD: 0, estado: "draft", stock: 0 });
    renderTabContent();
  } else if (action === "delete-model") {
    const id = btn.closest(".admin-row").dataset.id;
    if (confirm("¿Eliminar este modelo del catálogo?")) {
      catalogService.remove(id);
      renderTabContent();
    }
  } else if (action === "add-modelo") {
    const r = modeloService.create({});
    renderTabContent();
    if (!r.ok) showInlineMessage("valuationMessage", r.error, "error");
  } else if (action === "delete-modelo") {
    const id = btn.closest(".admin-row").dataset.id;
    const modelo = modeloService.getById(id);
    if (confirm(`¿Eliminar el modelo "${modelo ? modelo.nombre : ""}"? También se eliminarán sus valoraciones cargadas. El Paso 1 del cotizador dejará de mostrarlo.`)) {
      modeloService.remove(id);
      renderTabContent();
    }
  } else if (action === "toggle-modelo-capacidad") {
    modeloService.toggleCapacidad(btn.dataset.modeloId, btn.dataset.capacidadId);
    renderTabContent();
  } else if (action === "add-capacidad") {
    const r = capacidadService.create({});
    renderTabContent();
    if (!r.ok) showInlineMessage("capacidadMessage", r.error, "error");
  } else if (action === "delete-capacidad") {
    const id = btn.closest(".admin-row").dataset.id;
    const capacidad = capacidadService.getById(id);
    if (confirm(`¿Eliminar la capacidad "${capacidad ? capacidad.nombre : ""}"? Se quitará de todos los modelos y se eliminarán sus valoraciones cargadas.`)) {
      capacidadService.remove(id);
      renderTabContent();
    }
  } else if (action === "add-damage") {
    damageService.create({ nombre: "Nuevo desperfecto", descuentoUSD: 0, activo: true });
    renderTabContent();
  } else if (action === "add-valuation") {
    const row = btn.closest(".admin-row-missing");
    valuationService.create({ modeloId: row.dataset.modeloId, capacidadId: row.dataset.capacidadId, valorUSD: 0 });
    renderTabContent();
  } else if (action === "delete-valuation") {
    const id = btn.closest(".admin-row").dataset.id;
    if (confirm("¿Eliminar esta valoración? El Paso 1 dejará de tener un valor para esa combinación (se tomará como USD 0).")) {
      valuationService.remove(id);
      renderTabContent();
    }
  } else if (action === "delete-damage") {
    const id = btn.closest(".admin-row").dataset.id;
    if (confirm("¿Eliminar este desperfecto?")) {
      damageService.remove(id);
      renderTabContent();
    }
  } else if (action === "add-battery") {
    batteryService.create({ label: "Nuevo rango", desc: "", porcentajeMinimo: 0, porcentajeMaximo: 0, descuentoUSD: 0 });
    renderTabContent();
  } else if (action === "delete-battery") {
    const id = btn.closest(".admin-row").dataset.id;
    if (confirm("¿Eliminar este rango de batería?")) {
      batteryService.remove(id);
      renderTabContent();
    }
  } else if (action === "delete-history") {
    const id = btn.closest(".admin-row").dataset.id;
    if (confirm("¿Eliminar este registro del historial?")) {
      quotesHistoryService.remove(id);
      renderTabContent();
    }
  } else if (action === "delete-lead") {
    const id = btn.closest(".admin-row").dataset.id;
    if (confirm("¿Eliminar este lead?")) {
      leadsService.remove(id);
      renderTabContent();
    }
  } else if (action === "save-contact") {
    const form = btn.closest('[data-section="contact"]');
    const patch = {};
    form.querySelectorAll("[data-field]").forEach((i) => { patch[i.dataset.field] = i.value; });
    const r = contactService.update(patch);
    if (!r.ok) { showInlineMessage("contactMessage", r.error, "error"); return; }
    btn.disabled = true;
    showInlineMessage("contactMessage", "Guardando…", "success");
    StorageService.flush().then((res) => {
      btn.disabled = false;
      if (res.ok) {
        showInlineMessage("contactMessage", "Guardado en Supabase ✓", "success");
        el.adminBrandName.textContent = contactService.get().businessName || "Apple Tech";
      } else {
        showInlineMessage("contactMessage", "No se pudo guardar: " + res.message, "error");
      }
    });
  } else if (action === "retry-load") {
    btn.disabled = true;
    StorageService.reload({ admin: true }).then(() => render());
  } else if (action === "load-sample") {
    if (confirm("Se cargan los modelos, precios, desperfectos y reglas de EJEMPLO. Después tenés que reemplazarlos por los precios reales. ¿Continuar?")) {
      backupService.restoreFactoryDefaults();
      StorageService.flush().then(() => { adminNotice = { kind: "success", text: "Datos de ejemplo cargados. Revisá y actualizá los precios reales en cada pestaña." }; render(); goToTab("dashboard"); });
    }
  } else if (action === "export-valuation") {
    const json = valuationBackupService.exportJSON();
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "valoraciones-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  } else if (action === "import-valuation") {
    const input = document.getElementById("importValuationFile");
    const file = input && input.files && input.files[0];
    if (!file) {
      showInlineMessage("valuationMessage", "Elegí primero un archivo .json.", "error");
      return;
    }
    if (!confirm("Esto va a reemplazar los modelos, las capacidades y las valoraciones actuales. ¿Continuar?")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = valuationBackupService.importJSON(String(reader.result || ""));
      renderTabContent();
      showInlineMessage("valuationMessage", result.ok ? "Valoraciones importadas correctamente." : (result.error || "No se pudo importar el archivo."), result.ok ? "success" : "error");
    };
    reader.onerror = () => showInlineMessage("valuationMessage", "No se pudo leer el archivo.", "error");
    reader.readAsText(file);
  } else if (action === "export-backup") {
    btn.disabled = true;
    backupService.exportFullJSON().then((json) => {
      downloadText("backup-" + today() + ".json", json);
      showInlineMessage("backupMessage", "Backup descargado (incluye todas las cotizaciones, leads y actividad).", "success");
    }).catch((err) => {
      downloadText("backup-parcial-" + today() + ".json", backupService.exportJSON());
      showInlineMessage("backupMessage", "Se descargó un backup PARCIAL (sin todo el historial) porque no se pudo leer el historial completo: " + describeError(err).text, "error");
    }).finally(() => { btn.disabled = false; });
  } else if (action === "import-backup") {
    const input = document.getElementById("importFile");
    const file = input && input.files && input.files[0];
    if (!file) {
      showInlineMessage("backupMessage", "Elegí primero un archivo .json.", "error");
      return;
    }
    if (!confirm("Esto reemplaza el catálogo, los modelos, las capacidades, las valoraciones, los desperfectos, la batería y el contacto actuales por los del archivo. Las cotizaciones, leads y actividad NO se borran. Antes se descarga una copia de lo actual por si querés volver atrás. ¿Continuar?")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = backupService.importJSON(String(reader.result || ""));
      if (!result.ok) { showInlineMessage("backupMessage", result.error || "No se pudo importar el archivo.", "error"); return; }
      showInlineMessage("backupMessage", "Importando…", "success");
      render();
      StorageService.flush().then((res) => {
        showInlineMessage("backupMessage", res.ok ? "Backup importado y guardado en Supabase ✓" : "Se importó en pantalla pero NO se pudo guardar: " + res.message, res.ok ? "success" : "error");
      });
    };
    reader.onerror = () => showInlineMessage("backupMessage", "No se pudo leer el archivo.", "error");
    // Copia de seguridad automática de lo actual ANTES de reemplazar nada.
    downloadText("backup-antes-de-importar-" + today() + ".json", backupService.exportJSON());
    reader.readAsText(file);
  } else if (action === "factory-reset") {
    const typed = prompt("Esto vuelve la CONFIGURACIÓN (modelos, precios, desperfectos, batería, catálogo y contacto) a los datos de EJEMPLO. Se pierden tus precios reales. Las cotizaciones y leads NO se borran.\n\nSe descargará antes una copia de lo actual. Para confirmar escribí: RESTAURAR");
    if (typed === null) return;
    if (String(typed).trim().toUpperCase() !== "RESTAURAR") {
      showInlineMessage("backupMessage", "No se restauró nada (no escribiste RESTAURAR).", "error");
      return;
    }
    downloadText("backup-antes-de-restaurar-" + today() + ".json", backupService.exportJSON());
    backupService.restoreFactoryDefaults();
    render();
    StorageService.flush().then((res) => {
      showInlineMessage("backupMessage", res.ok ? "Datos de ejemplo cargados y guardados en Supabase ✓" : "Se restauró en pantalla pero NO se pudo guardar: " + res.message, res.ok ? "success" : "error");
    });
  } else if (action === "reset-credentials") {
    if (confirm(`Esto va a enviar un email de recuperación de contraseña a ${authUsernameCache}. ¿Continuar?`)) {
      authService.sendPasswordReset(authUsernameCache).then((r) => {
        showInlineMessage("securityMessage", r.ok ? "Te enviamos un email para restablecer la contraseña." : (r.error || "No se pudo enviar el email."), r.ok ? "success" : "error");
      });
    }
  }
});

/* ---------- Formulario de seguridad ---------- */
el.tabContent.addEventListener("submit", async (e) => {
  if (e.target.id !== "securityForm") return;
  e.preventDefault();

  const newUser = document.getElementById("secUser").value.trim();
  const newPass = document.getElementById("secPass").value;
  const newPass2 = document.getElementById("secPass2").value;

  if (!newUser) {
    showInlineMessage("securityMessage", "El email no puede quedar vacío.", "error");
    return;
  }
  if (newPass || newPass2) {
    if (newPass.length < 8) {
      showInlineMessage("securityMessage", "La nueva contraseña debe tener al menos 8 caracteres.", "error");
      return;
    }
    if (newPass !== newPass2) {
      showInlineMessage("securityMessage", "Las contraseñas nuevas no coinciden.", "error");
      return;
    }
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const r = await authService.changeCredentials(newUser, newPass);
    if (!r.ok) {
      showInlineMessage("securityMessage", r.error || "No se pudieron actualizar las credenciales.", "error");
      return;
    }
    authUsernameCache = (r.user || newUser);
    renderTabContent();
    showInlineMessage("securityMessage", "Credenciales actualizadas correctamente.", "success");
  } finally {
    submitBtn.disabled = false;
  }
});

/* ---------- Arranque ---------- */
// Si la sesión se cierra sola (venció, o se cerró en otra pestaña), se
// vuelve al login sin recargar. Los cambios sin guardar se avisan.
window.__appletechOnLoggedOut = (reason) => {
  if (el.panelView.hidden) return;
  el.loginPass.value = "";
  showLogin(reason === "expired" ? "Tu sesión venció. Ingresá de nuevo (los cambios sin guardar no se pudieron enviar)." : "Tu sesión se cerró. Ingresá de nuevo.");
};
window.__appletechOnRecovery = () => showRecovery();

(async () => {
  const esLinkDeRecuperacion = /type=recovery/.test(window.location.hash || "");
  await StorageService.init({ admin: true });
  // Repintar si otro admin (o un cliente) cambia algo, sin pisar lo que se está escribiendo.
  StorageService.onChange(() => {
    if (el.panelView.hidden) return;
    if (editandoUnCampo()) { pendingRepaint = true; return; }
    renderPreserveFocus();
  });
  StorageService.onStatus(renderSync);

  const modo = await authService.init(); // "admin" | "not-admin" | "none"
  if (esLinkDeRecuperacion && modo !== "none") showRecovery();
  else if (modo === "admin") await showPanel();
  else if (modo === "not-admin") {
    await authService.endSession();
    showLogin("Esta cuenta existe pero no tiene permiso de administrador.");
  } else showLogin();
})();
