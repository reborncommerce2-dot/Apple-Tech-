/*
  supabaseClient.js = crea el cliente de Supabase a partir de
  supabase-config.js. Debe cargarse DESPUÉS de la librería (CDN) y de
  supabase-config.js, y ANTES de services.js:

    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
    <script src="supabase-config.js"></script>
    <script src="supabaseClient.js"></script>
    <script src="config.js"></script>
    <script src="services.js"></script>

  Expone:
    window.supabaseClient      -> el cliente (o null si no se pudo crear)
    window.supabaseClientError -> texto explicando por qué es null

  Si es null, StorageService (services.js) lo informa a la interfaz y el
  cotizador muestra un aviso de "no disponible" en vez de inventar
  precios: nunca se cotiza con datos de ejemplo.
*/
(function () {
  if (typeof window === "undefined") return;
  window.supabaseClient = null;

  function fail(msg) {
    window.supabaseClientError = msg;
    console.error("supabaseClient.js: " + msg);
  }

  // Decodifica el payload de una clave JWT (para detectar service_role).
  function jwtRole(key) {
    try {
      const part = String(key).split(".")[1];
      if (!part) return null;
      const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
      return (JSON.parse(json) || {}).role || null;
    } catch (err) {
      return null;
    }
  }

  const cfg = window.APPLETECH_CONFIG || {};
  const url = String(cfg.supabaseUrl || "").trim();
  const key = String(cfg.supabaseKey || "").trim();

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
    return fail("La URL de Supabase en supabase-config.js no es válida.");
  }
  if (!key || /^TU_|PEGAR/i.test(key)) {
    return fail("Falta la clave pública de Supabase en supabase-config.js.");
  }
  if (/^sb_secret_/i.test(key) || jwtRole(key) === "service_role") {
    return fail("Se detectó una clave SECRETA (service_role) en supabase-config.js. No se usa: pegá la clave pública (publishable/anon).");
  }
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    return fail("No se pudo cargar la librería de Supabase (¿sin internet o CDN bloqueado?).");
  }

  const isAdminPage = /(^|\/)admin(\.html)?$/i.test(window.location.pathname);
  window.supabaseClient = window.supabase.createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Solo el panel admin necesita leer el token del link de
      // "recuperar contraseña" que llega por email.
      detectSessionInUrl: isAdminPage,
    },
  });
})();
