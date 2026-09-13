/*
  admin.js = EL PANEL DE ADMINISTRACIÓN.
  ------------------------------------------------------------
  Igual que script.js, este archivo NO tiene datos propios ni
  lógica de cálculo: todo lo que lee o escribe pasa por los
  servicios de services.js (la misma "única fuente de datos" que
  usa el cotizador público). Lo único que vive acá es la parte
  visual del panel (pestañas, formularios, tablas).

  IMPORTANTE SOBRE SEGURIDAD:
  Este login sigue siendo un candado LOCAL AL NAVEGADOR (no hay
  backend, no hay servidor). La diferencia con la versión anterior
  es que ya no guarda la contraseña en texto plano: guarda un hash
  SHA-256 con sal (ver authService en services.js). Sigue sin ser
  "seguridad real" contra alguien con acceso físico al dispositivo,
  pero ya no expone la contraseña con solo abrir el localStorage.

  admin.html debe cargar, en este orden:
    config.js -> services.js -> admin.js
*/

let currentTab = "dashboard";
let catalogSearch = "";
let valuationSearch = "";
let valuationCapFilter = "";
let authUsernameCache = DEFAULT_ADMIN_USER;

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
};

/* ---------- Sesión ---------- */
async function showPanel() {
  el.loginView.hidden = true;
  el.panelView.hidden = false;
  authUsernameCache = await authService.getUsername();
  render();
}

function showLogin() {
  el.panelView.hidden = true;
  el.loginView.hidden = false;
  el.loginPass.value = "";
}

el.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = el.loginForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "Verificando…";
  try {
    const ok = await authService.verify(el.loginUser.value.trim(), el.loginPass.value);
    if (ok) {
      authService.startSession();
      el.loginError.hidden = true;
      await showPanel();
    } else {
      el.loginError.hidden = false;
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

el.btnLogout.addEventListener("click", () => {
  authService.endSession();
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
  el.adminTabs.querySelectorAll(".admin-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
  renderTabContent();
  el.tabContent.scrollTop = 0;
}

/* ---------- Render general ---------- */
function render() {
  el.adminBrandName.textContent = contactService.get().businessName || "Apple Tech";
  renderTabContent();
}

function renderTabContent() {
  if (currentTab === "dashboard") el.tabContent.innerHTML = tplDashboard();
  else if (currentTab === "catalog") el.tabContent.innerHTML = tplCatalog();
  else if (currentTab === "valuation") el.tabContent.innerHTML = tplValuation();
  else if (currentTab === "damages") el.tabContent.innerHTML = tplDamages();
  else if (currentTab === "battery") el.tabContent.innerHTML = tplBattery();
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
  const totalCombos = tradeInCatalogService.getAll().length * STATIC_CONFIG.capacidades.length;
  const lastModified = StorageService.loadStore().meta.lastModified;

  return `
    <div class="admin-block">
      <h2>Resumen del catálogo de venta</h2>
      <p class="admin-block-hint">Estado del catálogo que ve el cliente en el Paso 5 (comprar otro equipo). El Paso 1 ("¿Qué iPhone tenés?") no depende de este catálogo: siempre muestra los 21 modelos de canje fijos, aunque este catálogo esté vacío.</p>
      <div class="admin-stat-grid">
        <div class="admin-stat"><span class="stat-value">${c.length}</span><span class="stat-label">Productos totales</span></div>
        <div class="admin-stat"><span class="stat-value">${published}</span><span class="stat-label">Publicados</span></div>
        <div class="admin-stat"><span class="stat-value">${out}</span><span class="stat-label">Sin stock</span></div>
        <div class="admin-stat"><span class="stat-value">${draft}</span><span class="stat-label">Ocultos (borrador)</span></div>
      </div>
    </div>

    <div class="admin-block">
      <h2>Valoración, desperfectos y batería</h2>
      <p class="admin-block-hint">Reglas y valores activos que se aplican en la cotización del Paso 1 a 4.</p>
      <div class="admin-stat-grid">
        <div class="admin-stat"><span class="stat-value">${valoraciones.length}/${totalCombos}</span><span class="stat-label">Valoraciones cargadas</span></div>
        <div class="admin-stat"><span class="stat-value">${damagesActive}/${damages.length}</span><span class="stat-label">Desperfectos activos</span></div>
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
        <button class="admin-quicklink" data-goto="damages">Desperfectos</button>
        <button class="admin-quicklink" data-goto="battery">Reglas de batería</button>
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
    ? 'No hay productos en el catálogo de venta. El Paso 1 del cotizador sigue funcionando igual: usa su propia lista fija de 21 modelos, independiente de este catálogo.'
    : 'Ningún producto coincide con la búsqueda.';
  return `
    <div class="admin-block">
      <h2>Catálogo de venta (USD)</h2>
      <p class="admin-block-hint">Este catálogo es exclusivo del Paso 5 ("¿vas a comprar otro equipo?") del cotizador — precio, stock, estado e imagen se leen desde acá. <strong>No afecta al Paso 1</strong> ("¿Qué iPhone tenés?"), que usa una lista de modelos de canje fija e independiente. Un producto solo se ofrece para comprar si está "Publicado" <em>y</em> tiene stock.</p>
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
    <div class="admin-row admin-row-wrap" data-section="catalog" data-id="${m.id}">
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
        <label>Imagen (URL, opcional)</label>
        <input type="text" data-field="imagenUrl" value="${escapeHtml(m.imagenUrl || "")}" placeholder="https://…" style="width:100%;">
      </div>
    </div>
  `;
}

/* ---------- Valoración (canje: modelo + capacidad -> valor USD) ---------- */
function tplValuation() {
  const q = valuationSearch.trim().toLowerCase();
  const modelos = tradeInCatalogService.getAll().filter((m) => m.nombre.toLowerCase().includes(q));
  const capacidadesAMostrar = valuationCapFilter
    ? STATIC_CONFIG.capacidades.filter((c) => c.id === valuationCapFilter)
    : STATIC_CONFIG.capacidades;

  const total = tradeInCatalogService.getAll().length * STATIC_CONFIG.capacidades.length;
  const cargadas = valuationService.getAll().length;

  return `
    <div class="admin-block">
      <h2>Valoración (canje)</h2>
      <p class="admin-block-hint">Acá se carga el valor de canje en USD de cada combinación modelo + capacidad — sin fórmulas ni multiplicadores, cada casillero es un número independiente y editable. El Paso 1 (modelo) y el Paso 2 (capacidad) del cotizador siguen siendo listas fijas e independientes de Admin; lo único que se busca acá es <strong>el valor</strong> que usa la cotización. Cargadas: ${cargadas}/${total}.</p>
      <div class="admin-toolbar">
        <input id="valuationSearch" class="select-input" placeholder="Buscar modelo…" value="${escapeHtml(valuationSearch)}">
        <select id="valuationCapFilter" class="select-input">
          <option value="">Todas las capacidades</option>
          ${STATIC_CONFIG.capacidades.map((c) => `<option value="${c.id}" ${valuationCapFilter === c.id ? "selected" : ""}>${c.nombre}</option>`).join("")}
        </select>
      </div>
      <div class="admin-valuation-list">
        ${modelos.length ? modelos.map((m) => valuationGroup(m, capacidadesAMostrar)).join("") : '<p class="admin-empty">Ningún modelo coincide con la búsqueda.</p>'}
      </div>
    </div>
  `;
}

function valuationGroup(modelo, capacidades) {
  const entries = valuationService.getByModelo(modelo.id);
  return `
    <div class="admin-valuation-group">
      <h3 class="admin-valuation-model">${modelo.nombre}</h3>
      <div class="admin-valuation-caps">
        ${capacidades.map((c) => valuationCapRow(modelo, c, entries.find((e) => e.capacidadId === c.id))).join("")}
      </div>
    </div>
  `;
}

function valuationCapRow(modelo, capacidad, entry) {
  if (entry) {
    return `
      <div class="admin-row" data-section="valoracion" data-id="${entry.id}" data-modelo-id="${modelo.id}" data-capacidad-id="${capacidad.id}">
        <div class="admin-row-main"><span class="admin-row-cap-label">${capacidad.nombre}</span></div>
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
    <div class="admin-row admin-row-missing" data-modelo-id="${modelo.id}" data-capacidad-id="${capacidad.id}">
      <div class="admin-row-main">
        <span class="admin-row-cap-label">${capacidad.nombre}</span>
        <span class="admin-row-sub">Sin cargar</span>
      </div>
      <button class="admin-add-btn admin-add-btn-small" data-action="add-valuation">+ Cargar valor</button>
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
    <div class="admin-row admin-row-wrap" data-section="desperfectos" data-id="${d.id}">
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
      <div class="admin-row-list">
        ${items.length ? items.map(batteryRow).join("") : '<p class="admin-empty">No hay rangos configurados.</p>'}
      </div>
    </div>
  `;
}

function batteryRow(b) {
  return `
    <div class="admin-row admin-row-wrap" data-section="bateria" data-id="${b.id}">
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
      <p class="admin-block-hint">El nombre del negocio se muestra en el encabezado y el WhatsApp se usa para el botón de consulta del cotizador. Todo el sitio lee de acá — no hay otra fuente.</p>
      <div class="admin-form-grid" data-section="contact">
        ${fields.map(([key, label]) => `
          <div class="admin-field" style="width:100%;">
            <label>${label}</label>
            <input type="text" class="select-input" data-field="${key}" value="${escapeHtml(c[key] || "")}">
          </div>
        `).join("")}
        <div class="admin-save-row">
          <span class="admin-saved-tag" id="contactSaved">Guardado ✓</span>
          <button class="btn btn-primary" data-action="save-contact">Guardar</button>
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
      <p class="admin-block-hint">Descarga un archivo .json con el catálogo, los desperfectos, las reglas de batería y el contacto. No incluye el usuario/contraseña del panel por seguridad.</p>
      <button class="btn btn-secondary btn-full" data-action="export-backup">Descargar backup (.json)</button>
    </div>

    <div class="admin-block">
      <h2>Importar backup</h2>
      <p class="admin-block-hint">Reemplaza los datos actuales por los del archivo elegido. Esta acción no se puede deshacer.</p>
      <input type="file" id="importFile" accept="application/json,.json" class="admin-file-input">
      <button class="btn btn-secondary btn-full" data-action="import-backup" style="margin-top:10px;">Importar backup</button>
      <p class="admin-inline-message" id="backupMessage" hidden></p>
    </div>

    <div class="admin-block">
      <h2>Restaurar configuración de fábrica</h2>
      <p class="admin-block-hint">Vuelve el catálogo, los desperfectos, la batería y el contacto a los valores originales de ejemplo. No afecta el usuario/contraseña del panel.</p>
      <button class="btn btn-ghost btn-full" data-action="factory-reset">Restaurar configuración de fábrica</button>
    </div>
  `;
}

/* ---------- Seguridad ---------- */
function tplSecurity() {
  return `
    <div class="admin-block">
      <h2>Usuario y contraseña</h2>
      <p class="admin-block-hint">Usuario actual: <strong>${escapeHtml(authUsernameCache)}</strong>. Dejá la contraseña en blanco si solo querés cambiar el usuario.</p>
      <form id="securityForm" class="admin-form-grid" autocomplete="off">
        <div class="admin-field" style="width:100%;">
          <label>Nuevo usuario</label>
          <input type="text" class="select-input" id="secUser" value="${escapeHtml(authUsernameCache)}" autocomplete="off">
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
      <h2>Restablecer credenciales</h2>
      <p class="admin-block-hint">Vuelve el usuario y la contraseña a los valores iniciales: <strong>admin</strong> / <strong>admin123</strong>.</p>
      <button class="btn btn-ghost btn-full" data-action="reset-credentials">Restablecer credenciales</button>
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

/* ---------- Delegación de eventos: escritura continua (no rerenderiza) ---------- */
el.tabContent.addEventListener("input", (e) => {
  const t = e.target;

  if (t.id === "catalogSearch") {
    catalogSearch = t.value;
    renderPreserveFocus();
    return;
  }
  if (t.id === "valuationSearch") {
    valuationSearch = t.value;
    renderPreserveFocus();
    return;
  }

  const row = t.closest(".admin-row, [data-section=\"contact\"]");
  if (!row || !t.dataset.field) return;
  const section = row.dataset.section;
  const id = row.dataset.id;
  const field = t.dataset.field;

  if (section === "contact") {
    contactService.update({ [field]: t.value });
    return;
  }
  if (section === "catalog") {
    catalogService.update(id, { [field]: field === "precioBaseUSD" ? t.value : t.value });
  } else if (section === "desperfectos") {
    damageService.update(id, { [field]: t.value });
  } else if (section === "bateria") {
    batteryService.update(id, { [field]: t.value });
  } else if (section === "valoracion") {
    valuationService.update(id, { [field]: t.value });
  }
});

/* ---------- Delegación de eventos: cambios discretos (select / checkbox) ---------- */
el.tabContent.addEventListener("change", (e) => {
  const t = e.target;

  if (t.id === "valuationCapFilter") {
    valuationCapFilter = t.value;
    renderTabContent();
    return;
  }

  const row = t.closest(".admin-row");
  if (!row || !t.dataset.field) return;
  const section = row.dataset.section;
  const id = row.dataset.id;
  const field = t.dataset.field;
  const value = t.type === "checkbox" ? t.checked : t.value;

  if (section === "catalog") catalogService.update(id, { [field]: value });
  else if (section === "desperfectos") damageService.update(id, { [field]: value });
  else if (section === "bateria") batteryService.update(id, { [field]: value });
  else if (section === "valoracion") valuationService.update(id, { [field]: value });

  renderTabContent();
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
  } else if (action === "save-contact") {
    const tag = document.getElementById("contactSaved");
    if (tag) {
      tag.classList.add("is-visible");
      setTimeout(() => tag.classList.remove("is-visible"), 1600);
    }
  } else if (action === "export-backup") {
    const json = backupService.exportJSON();
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  } else if (action === "import-backup") {
    const input = document.getElementById("importFile");
    const file = input && input.files && input.files[0];
    if (!file) {
      showInlineMessage("backupMessage", "Elegí primero un archivo .json.", "error");
      return;
    }
    if (!confirm("Esto va a reemplazar el catálogo, los desperfectos, la batería y el contacto actuales. ¿Continuar?")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = backupService.importJSON(String(reader.result || ""));
      if (result.ok) {
        render(); // reconstruye todas las pestañas con los datos importados
        showInlineMessage("backupMessage", "Backup importado correctamente.", "success");
      } else {
        showInlineMessage("backupMessage", result.error || "No se pudo importar el archivo.", "error");
      }
    };
    reader.onerror = () => showInlineMessage("backupMessage", "No se pudo leer el archivo.", "error");
    reader.readAsText(file);
  } else if (action === "factory-reset") {
    if (confirm("Esto va a borrar todos los cambios de catálogo, desperfectos, batería y contacto, y volver a los valores de ejemplo originales. ¿Continuar?")) {
      backupService.restoreFactoryDefaults();
      render();
      goToTab("dashboard");
    }
  } else if (action === "reset-credentials") {
    if (confirm("Esto va a restablecer el usuario y la contraseña a admin / admin123. ¿Continuar?")) {
      authService.resetToDefault().then(() => {
        authUsernameCache = DEFAULT_ADMIN_USER;
        renderTabContent();
        showInlineMessage("securityMessage", "Credenciales restablecidas a admin / admin123.", "success");
      });
    }
  }
});

/* ---------- Formulario de seguridad (async: usa el hash SHA-256) ---------- */
el.tabContent.addEventListener("submit", async (e) => {
  if (e.target.id !== "securityForm") return;
  e.preventDefault();

  const newUser = document.getElementById("secUser").value.trim();
  const newPass = document.getElementById("secPass").value;
  const newPass2 = document.getElementById("secPass2").value;

  if (!newUser) {
    showInlineMessage("securityMessage", "El usuario no puede quedar vacío.", "error");
    return;
  }
  if (newPass || newPass2) {
    if (newPass.length < 4) {
      showInlineMessage("securityMessage", "La nueva contraseña debe tener al menos 4 caracteres.", "error");
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
    await authService.changeCredentials(newUser, newPass);
    authUsernameCache = newUser;
    renderTabContent();
    showInlineMessage("securityMessage", "Credenciales actualizadas correctamente.", "success");
  } finally {
    submitBtn.disabled = false;
  }
});

/* ---------- Arranque ---------- */
authService.init().then(() => {
  if (authService.isLoggedIn()) showPanel();
  else showLogin();
});
