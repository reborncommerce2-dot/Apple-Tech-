# Apple Tech — Historial de iteraciones

## Versión 2.0.0 — Auditoría final y endurecimiento para producción

Auditoría completa del proyecto de la Iteración 5 y corrección de todo lo
que impedía usarlo en producción. Los pasos del cotizador y el diseño no
cambian; cambia la capa de datos, la seguridad y el panel.

### Errores graves encontrados (y corregidos)
- **Cualquier usuario registrado era administrador.** Las políticas RLS
  usaban `auth.role() = 'authenticated'`. Ahora solo escriben los usuarios
  de la tabla `public.admins` (función `is_admin()`), y el panel verifica
  esa condición al iniciar sesión.
- **`supabase_schema.sql` fallaba** (`alter publication … drop table if
  exists` no existe en PostgreSQL). Reescrito, idempotente y apto para
  actualizar bases ya creadas sin perder datos.
- **Ediciones que no se subían a Supabase.** El diff comparaba contra
  referencias a los mismos objetos que se editaban: desde el segundo
  cambio de una misma fila no se detectaba nada. Ahora se compara contra
  una foto (snapshot) de lo último confirmado por el servidor.
- **Un guardado por cada tecla** (y un registro de auditoría por tecla),
  con Realtime pudiendo pisar lo que se estaba escribiendo. Ahora cada
  campo se guarda una vez, al terminar de editarlo, y los cambios remotos
  nunca pisan cambios locales pendientes ni un campo en edición.
- **"Guardado ✓" decorativo.** El botón Guardar de Contacto no guardaba
  nada y los errores de red solo iban a la consola. Ahora hay una barra
  con el estado real (guardando / guardado / error con *Reintentar*), los
  permisos denegados se detectan y se avisa antes de cerrar la pestaña con
  cambios sin guardar.
- **Riesgo de pisar datos reales con datos de ejemplo** si fallaba la
  lectura de una tabla. Ahora, ante un error de lectura, no se muestran
  precios de ejemplo, no se permite guardar y se ofrece *Reintentar*.
- **Migración desde localStorage insegura.** Ahora solo corre desde un
  admin verificado, solo si la base sigue sin configurar
  (`app_meta.config_state = 'pristine'`), se reclama de forma atómica (dos
  dispositivos no pueden migrar a la vez), se deshace si falla a mitad,
  conserva las cotizaciones/leads que ya hubieran llegado y nunca borra los
  datos del navegador.
- **Cotizaciones/leads del público**: usaban `upsert` (requiere permisos
  que el público no tiene). Ahora son inserciones directas, con cola local
  y reenvío automático si no hay internet.
- **Recuperar contraseña no se podía completar** (y solo existía con la
  sesión iniciada). Ahora hay «¿Olvidaste tu contraseña?» en el login y
  pantalla para elegir la nueva.
- **Importar backup / restaurar de fábrica borraban cotizaciones, leads y
  actividad.** Ahora solo reemplazan la configuración, validan el archivo
  (sin aceptar datos corruptos), piden confirmación, y descargan antes una
  copia de lo actual.
- **Carrera en el panel**: iniciar sesión durante el arranque podía ser
  pisado, la contraseña tipeada se borraba al terminar de cargar y un
  `showPanel()` en curso repintaba datos privados después de cerrar sesión.
- Sin conexión, el cotizador mostraba **precios de ejemplo a los clientes**.
  Ahora muestra «Cotizador no disponible» con *Reintentar*.
- Un modelo/capacidad sin precio cargado se ofrecía al cliente y mostraba
  «USD 0». Ahora no se ofrece, y un resultado sin precio dice «A consultar».
- Textos de la base se insertaban sin escapar en `innerHTML` (XSS).
- Lectura limitada a 1000 filas por Supabase sin avisar: ahora se pagina; el
  panel carga las últimas 500 cotizaciones/leads y el backup trae todo.

### Cambios y agregados
- **Base de datos:** tabla `admins`, funciones `is_admin()`, `add_admin()`,
  `remove_admin()`; claves foráneas, restricciones de rango/tamaño, índice
  único modelo+capacidad, `updated_at` automático, freno anti-spam de
  escritura pública (no aplica a administradores), Realtime idempotente.
  Columnas nuevas: `catalog.detalle`, `quotes_history.color/bateria_label/
  desperfectos`, `leads.capacidad_nombre/producto_compra_nombre/
  diferencia_usd/quote_id`, `app_meta.config_state`.
- **Cotizador:** nombre y WhatsApp del cliente (opcionales) en el Paso 5
  para que los leads sirvan; la cotización se registra una sola vez por
  combinación; el resultado se actualiza en vivo si el admin cambia un
  precio; si el admin borra algo que el cliente eligió, se corrige solo.
- **Admin:** campo «Detalle» en los equipos en venta (capacidad, batería,
  estado), avisos de rangos de batería superpuestos o sin cubrir, aviso de
  modelos sin precio, historial/leads más completos (con link de WhatsApp),
  botón «Cargar datos de ejemplo» cuando la base está vacía.
- `supabase-config.js` separado (URL y clave pública) y rechazo de claves
  `service_role`/secretas.
- GitHub Actions: corre los tests antes de publicar y publica solo los
  archivos del sitio.
- Tests nuevos con un Supabase falso que aplica las mismas reglas de RLS
  (122 pruebas del motor + 86 de navegador sobre Chromium real).
- Orden natural de modelos (11, 11 Pro, …, 12) y de capacidades por tamaño.
- Eliminados `AUDITORIA_FINAL.md` y `ENTREGA_MIGRACION_SUPABASE.md` (sus
  afirmaciones ya no eran ciertas) y los tests viejos que no detectaban
  nada de lo anterior.

### Importante al actualizar una instalación existente
1. Volver a ejecutar `supabase_schema.sql` completo (no pierde datos).
2. Crear/confirmar el usuario administrador y ejecutar la línea final
   `select public.add_admin('email')`. **Sin este paso nadie puede guardar.**
3. Subir los archivos nuevos.

## Iteración 5 — Online (Supabase): sincronización real entre dispositivos

### Objetivo
Pasar de aplicación local (localStorage) a aplicación online sincronizada
(Supabase), preservando el 100% del diseño, el flujo de cotización y
las funcionalidades de la Iteración 4, sin reescribir el proyecto.

### Decisión de arquitectura (la única realmente nueva)
`StorageService` (en `services.js`) sigue siendo la ÚNICA puerta de
entrada/salida de datos, con la MISMA interfaz sincrónica de siempre
(`loadStore()`/`saveStore()`). Por eso los otros 12 servicios del
archivo (`catalogService`, `modeloService`, `capacidadService`,
`valuationService`, `batteryService`, `damageService`,
`contactService`, `quotesHistoryService`, `leadsService`,
`auditLogService`, `valuationBackupService`, `backupService`) quedaron
**byte a byte idénticos** — no fue necesario tocar ni una línea.

Por dentro, `StorageService` ahora mantiene una caché completa del
store en memoria. `saveStore()` actualiza esa caché al instante (la UI
se sigue sintiendo tan instantánea como con localStorage) y en segundo
plano sincroniza a Supabase solo las filas que cambiaron (upsert/
delete puntual por `id`, no un reemplazo del store completo). Un nuevo
`StorageService.init()` (llamado una vez al arrancar `index.html`/
`admin.html`) trae el store real desde Supabase y se suscribe a
Realtime: un cambio hecho por otro administrador, en otro dispositivo,
llega solo y repinta sin recargar la página.

### Archivos nuevos
- `supabaseClient.js` — único lugar con las credenciales de Supabase;
  crea `window.supabaseClient` (o lo deja en `null` si el CDN no
  cargó, para que la app siga funcionando en memoria sin romperse).
- `supabase_schema.sql` — tablas 1:1 con el store existente, Row Level
  Security (visitantes: lectura + solo-insertar en cotizaciones/leads;
  administradores autenticados: acceso completo) y alta a la
  publicación de Realtime.
- `test/e2e_offline_smoke.js` — chequeo con Playwright de que
  index.html/admin.html cargan sin errores en modo sin-conexión.

### Archivos modificados
- `services.js` — `StorageService` reescrito por dentro (Supabase en
  vez de localStorage, con caché/diff/Realtime/migración);
  `authService` reescrito por dentro (Supabase Auth real en vez de
  hash local); comentarios de cabecera actualizados. El resto del
  archivo, sin cambios.
- `index.html` / `admin.html` — se agregaron dos `<script>` (CDN de
  `@supabase/supabase-js` + `supabaseClient.js`) ANTES de `config.js`.
  En `admin.html`, el campo de login pasa de "Usuario" (texto) a
  "Email" (`type="email"`), porque Supabase Auth es por email.
- `script.js` — el arranque ahora espera `StorageService.init()` antes
  de pintar, y se suscribe a `StorageService.onChange()` para repintar
  las 6 listas del cotizador si otro dispositivo cambia algo. El flujo
  de los 5 pasos no cambió.
- `admin.js` — el arranque espera `StorageService.init()`, dispara la
  migración automática una sola vez tras el login, y usa
  `renderPreserveFocus()` como callback de cambios remotos. El login
  ahora llama a Supabase Auth (mismo contrato `verify()`/`isLoggedIn()`
  hacia el resto del archivo). La pestaña "Seguridad" pasa de
  usuario/contraseña locales a email/contraseña reales, y "Restablecer
  credenciales" ahora envía un email de recuperación real (ya no existe
  una contraseña de fábrica con un backend real).
- `test/smoke_services.js` — se agregó un Supabase falso en memoria
  (mismo espíritu que el `localStorage`/`sessionStorage` falsos que ya
  usaba el archivo) para poder probar sincronización/migración/auth
  sin necesitar red. Las 2 secciones que testeaban la implementación
  VIEJA de `StorageService`/`authService` (localStorage directo, hash
  local) se reescribieron para probar la nueva; las otras 10 secciones
  (CRUD de cada servicio) no necesitaron cambios.
- `test/e2e.js` — adaptado para loguearse con email/password reales
  (por variables de entorno `ADMIN_EMAIL`/`ADMIN_PASS`) en vez de
  `admin`/`admin123`, y para leer/escribir el store real vía
  `StorageService` en vez de `localStorage` directo.

### Archivos SIN cambios (verificado con diff/cmp)
`config.js`, `style.css`, `admin.css`, `.github/workflows/deploy-pages.yml`,
`assets/logo.png`.

### Migración automática (una sola vez, Parte 3 del pedido)
`StorageService.migrateFromLocalStorageIfNeeded()` corre sola tras el
primer login exitoso de cualquier admin. Solo hace algo si: hay datos
viejos en el `localStorage` de ESE navegador, Y Supabase todavía está
vacío (para no pisar lo que otro admin ya haya subido desde otro
dispositivo). Es segura de llamar en cada login: si ya migró, o si no
hay nada para migrar, no hace nada.

### Limitación conocida, a propósito
`saveStore()` no espera a que Supabase confirme antes de devolver el
control (fire-and-forget): si la sincronización falla por red, queda
un `console.warn` y NO se reintenta hasta el próximo cambio en esa
misma tabla. Se eligió así para no tener que convertir en `async` a
los otros 12 servicios (que es exactamente la reescritura que el
pedido prohíbe). `StorageService.waitIdle()` (nuevo) permite esperar
explícitamente si hace falta.

---

## Iteración 4 — Plataforma 100% administrable (modelos, capacidades, historial, leads, actividad)

### 0) Análisis previo (antes de tocar nada)

Se releyó el proyecto completo (`config.js`, `services.js`, `script.js`,
`admin.js`, `admin.html`, `index.html`, `admin.css`, `style.css`,
`test/*.js`, `CHANGELOG.md`) para mapear exactamente qué dependía
todavía de listas fijas:

- `STATIC_CONFIG.modelosCanje` (21 modelos, id + nombre) — ya no tenía
  impacto en el precio desde la iteración 3, pero **seguía siendo la
  única fuente del Paso 1** del cotizador (`script.js: pintarModelos()`)
  y de `pricingService.calculateQuote()` vía `tradeInCatalogService`,
  un servicio de **solo lectura**, sin crear/editar/eliminar.
- `STATIC_CONFIG.capacidades` (4 capacidades, con `factor` ya sin uso
  real desde la iteración 3) — seguía siendo la única fuente del Paso 2
  (`script.js: pintarCapacidades()`), **igual para los 21 modelos**: no
  existía la posibilidad de que un modelo tuviera capacidades distintas
  de otro.
- `valuationService` (agregado en la iteración 3) ya tenía el valor de
  canje por combinación modelo+capacidad, pero la IDENTIDAD de modelo y
  capacidad seguía siendo fija y no administrable.
- Los 15 requerimientos del documento nuevo (`FASE 1` a `FASE 15`)
  pedían, en esencia, promover "modelo" y "capacidad" de listas fijas a
  entidades administrables con CRUD completo, agregar historial de
  cotizaciones, leads y auditoría de cambios, e import/export dedicado
  de Valoración — todo esto preservando el diseño, el login, el
  catálogo de venta, los desperfectos, la batería, el contacto, los

  backups, WhatsApp y GitHub Pages exactamente como estaban.

Con ese mapa hecho (y con **cero líneas tocadas** en `admin.css`,
`style.css`, `index.html`, `assets/logo.png` y
`.github/workflows/deploy-pages.yml` — se verificó al final con `cmp`
byte a byte contra el ZIP de entrada), recién ahí se modificó código.

### 1) Qué se agregó

- **`modeloService`** (`services.js`) — reemplaza a
  `tradeInCatalogService` (que se eliminó). Identidad administrable de
  los modelos del Paso 1: `getAll/getById/create/update/remove` +
  `toggleCapacidad(modeloId, capacidadId)`. `create()` sin nombre
  genera uno único ("Nuevo modelo", "Nuevo modelo (2)", …) para que el
  botón "+ Agregar modelo" nunca falle; `update()`/`create()` con un
  nombre explícito duplicado se **rechaza** con
  `{ok:false, error:"..."}`. `remove()` elimina en cascada todas las
  valoraciones de ese modelo.
- **`capacidadService`** (`services.js`) — reemplaza a
  `STATIC_CONFIG.capacidades`. Catálogo administrable de capacidades:
  `getAll/getActive/getById/create/update/remove`. `update()` maneja
  tanto el renombrado (con la misma validación de duplicados) como
  activar/desactivar. `remove()` elimina en cascada la capacidad de
  **todos** los modelos que la tuvieran asociada y todas sus
  valoraciones.
- **Pestaña Admin → Capacidades** — alta, edición de nombre,
  activar/desactivar (switch) y eliminación (con confirmación).
- **Pestaña Admin → Valoración, rediseñada** — además de la grilla de
  valores que ya existía (iteración 3), ahora cada grupo de modelo
  tiene: un campo de nombre editable (con validación de duplicados en
  vivo), un botón de eliminar modelo, un botón "+ Agregar modelo", y
  una fila de chips (reutilizando `.chip`/`.chip-row` de `style.css`,
  cero CSS nuevo) para asociar/desasociar qué capacidades tiene *ese*
  modelo en particular — la grilla de valores solo muestra las
  capacidades efectivamente asociadas a él.
- **`quotesHistoryService`** (`services.js`) + pestaña **Admin →
  Historial** — cada vez que el cliente llega al Paso 5,
  `script.js: pintarResultado()` llama a
  `quotesHistoryService.record(...)` con modelo, capacidad, valor
  base, descuento de batería, descuento de desperfectos y resultado
  final. Se guarda con `{touch:false}` (no es una edición del admin,
  no debe pisar "última modificación"). Admin puede buscar y eliminar
  registros.
- **`leadsService`** (`services.js`) + pestaña **Admin → Leads** —
  cada vez que el cliente toca "Consultar por WhatsApp",
  `script.js` llama a `leadsService.record(...)` (sin `preventDefault`:
  el link a WhatsApp sigue abriendo normal, esto es un efecto
  adicional). El cotizador no tiene ningún formulario para pedirle
  nombre/WhatsApp al cliente (no se agregó — hubiera cambiado la
  experiencia actual), así que esos dos campos quedan vacíos; se
  documentó como pendiente más abajo. Admin puede buscar y eliminar.
- **`auditLogService`** (`services.js`) + pestaña **Admin →
  Actividad** — registra cambios de precio de venta, batería,
  desperfectos, valoración, capacidades y modelos (alta, baja,
  renombrado, activar/desactivar, asociar/desasociar), con el valor
  anterior y el nuevo. Se decidió enganchar el registro en el
  delegado `change` de `admin.js` (no dentro de cada `services.js:
  update()`) para que quede **una sola entrada por edición real**
  (al terminar de escribir/salir del campo) y no una por cada tecla
  presionada durante el `input` en vivo.
- **`valuationBackupService`** (`services.js`) + bloque "Exportar /
  importar valoraciones" dentro de la pestaña Valoración — un JSON
  más chico que el backup completo, con solo `modelos` + `capacidades`
  + `valoraciones`, para migrar la lista de precios de canje a otro
  dispositivo. El backup general (`backupService`) sigue incluyendo
  esto mismo automáticamente, como parte de todo el store (no hizo
  falta tocar `backupService` para esto: ya opera sobre el store
  completo).
- **`defaultModelos()` y `defaultCapacidades()`** (`config.js`) —
  semillas administrables que reemplazan a las listas fijas
  eliminadas, con los mismos 21 ids/nombres y las mismas 4
  capacidades de siempre, para que la migración automática (ver
  punto 3) no pierda ningún dato.

### 2) Qué se modificó

- **`config.js`** — se eliminaron `STATIC_CONFIG.modelosCanje` y
  `STATIC_CONFIG.capacidades`; se agregaron `defaultModelos()`,
  `defaultCapacidades()` y los campos `modelos`/`capacidades`/
  `quotesHistory`/`leads`/`auditLog` en `defaultStore()`.
  `STATIC_CONFIG` ahora solo tiene `colores` (no administrable, sin
  impacto en precio, no lo pedía el documento).
- **`services.js`** — `normalizeStore()` migra automáticamente un
  store de la iteración anterior (sin `modelos`/`capacidades`/
  `quotesHistory`/`leads`/`auditLog`) reconstruyendo esos campos sin
  perder ninguna valoración ya editada por el admin (ver pruebas más
  abajo). `pricingService.calculateQuote()` ahora resuelve modelo y
  capacidad vía `modeloService`/`capacidadService` en vez de
  `tradeInCatalogService`/`STATIC_CONFIG.capacidades`; si la
  combinación no tiene valor cargado, cotiza USD 0 en vez de romperse.
  `catalogService.update()`, `capacidadService.update()`,
  `valuationService.update()`, `batteryService.update()` y
  `damageService.update()` se reordenaron para guardar el dato
  **antes** de registrar en `auditLogService` (ver "bug encontrado y
  corregido" más abajo).
- **`script.js`** — `pintarModelos()` lee de `modeloService` en vez de
  `tradeInCatalogService`. `pintarCapacidades()` ahora filtra por
  `capacidadService.getActive()` **∩** las capacidades asociadas al
  modelo elegido (`modelo.capacidadIds`), no una lista fija global; al
  elegir un modelo distinto en el Paso 1 se vuelve a pintar el Paso 2 y,
  si la capacidad ya elegida no aplica al nuevo modelo, se limpia la
  selección. Se agregó el registro de historial (en `pintarResultado()`)
  y de leads (listener adicional en `btnWhatsapp`), ambos aditivos, sin
  tocar el flujo ni el diseño existentes.
- **`admin.js`** — se agregaron las plantillas y el manejo de eventos
  de las 4 pestañas nuevas (Capacidades, Historial, Leads, Actividad);
  se reescribió `tplValuation()`/`valuationGroup()` para el CRUD de
  modelos y la asociación de capacidades; se actualizó `tplDashboard()`
  con las nuevas métricas y accesos rápidos; se generalizó el selector
  de los delegados `input`/`change` de `t.closest(".admin-row, [data-section=\"contact\"]")`
  a `t.closest("[data-section]")` (todo `.admin-row` ya tenía
  `data-section` en el mismo elemento, así que esto no cambia ningún
  comportamiento existente y de paso simplifica el código); se
  actualizaron los textos de `tplDashboard()`, `tplCatalog()` y
  `tplBackups()` que hacían referencia a la vieja "lista fija de 21
  modelos" (ya no es cierto, y dejarlo así hubiera sido información
  incorrecta en la propia UI del panel).
- **`admin.html`** — se agregaron los botones de pestaña Capacidades,
  Historial, Leads y Actividad al `<nav>` existente (ya soportaba
  scroll horizontal para más pestañas, cero CSS nuevo necesario).
- **`admin.css` / `style.css` / `index.html` / `assets/logo.png` /
  `.github/workflows/deploy-pages.yml` — SIN CAMBIOS.** Todo lo nuevo
  se construyó reutilizando clases ya existentes (`.admin-row`,
  `.admin-field`, `.admin-switch`, `.admin-badge`, `.chip`/`.chip-row`,
  `.admin-row-name`, `.admin-row-sub`, `.admin-quicklink`, etc.) — no
  hizo falta ni una sola clase CSS nueva.

### 3) Bug encontrado y corregido durante el desarrollo (no llegó a producción)

Al escribir por primera vez `auditLogService`, se detectó con los
tests (no a simple vista) que varias entradas de Actividad
**desaparecían silenciosamente**: `catalogService.update()`,
`capacidadService.update()`, `valuationService.update()`,
`batteryService.update()` y `damageService.update()` llamaban a
`auditLogService.record(...)` **antes** de su propio
`StorageService.saveStore(store)` final. Como `auditLogService.record()`
hace su propio ciclo independiente de `loadStore()+saveStore()`, ese
`saveStore()` final terminaba pisando (sobreescribiendo) la entrada de
auditoría recién guardada — el dato en sí quedaba bien guardado, pero
el registro en Actividad se perdía. Se corrigió reordenando los 5
métodos para guardar primero y registrar en el log después. Se agregó
una prueba específica para este caso (`test/smoke_services.js`,
sección 9) para que no pueda volver a pasar sin que un test lo marque.

### 4) Verificaciones obligatorias (todas OK)

✅ Login funciona · ✅ Cambio de contraseña funciona (hash SHA-256 +
sal, no texto plano) · ✅ Catálogo de venta funciona · ✅ Desperfectos
funcionan (nunca se muestra el monto al cliente) · ✅ Batería funciona
· ✅ Contacto funciona (persiste, se refleja en el encabezado y en
WhatsApp) · ✅ Backups funcionan (export/import/factory-reset, incluyen
todo el store nuevo, nunca incluyen la contraseña) · ✅ WhatsApp
funciona (número configurable, mensaje sin desglose de descuentos) ·
✅ Valoración funciona (modelo+capacidad, sin multiplicadores) · ✅
Capacidades funcionan (CRUD + activar/desactivar) · ✅ Historial
funciona (registro automático, buscar, eliminar) · ✅ Leads funcionan
(registro automático, buscar, eliminar) · ✅ Actividad funciona
(antes/después de cada cambio relevante) · ✅ Paso 1 usa exclusivamente
`modeloService` (Valoración) · ✅ Paso 2 usa exclusivamente
`capacidadService` filtrado por el modelo elegido · ✅ Resultado usa
`pricingService.calculateQuote()`, sin valores hardcodeados · ✅ No hay
errores de consola propios del sitio (el único "error" que aparece en
este sandbox de pruebas — carga de Google Fonts sin acceso a internet —
ya existía IDÉNTICO en el proyecto original sin modificar; se confirmó
corriendo el mismo chequeo contra el ZIP de entrada) · ✅ No quedan
dependencias funcionales a `STATIC_CONFIG.modelosCanje` (la propiedad
ni siquiera existe más — se agregó una prueba explícita que lo
confirma) ni a `STATIC_CONFIG.capacidades`.

### 5) Pruebas realizadas (con resultados reales, no teóricos)

- **`node test/smoke_services.js` → 82/82 OK.** Motor de datos y
  cálculo puro (sin navegador): forma del store por defecto,
  migración automática desde un store de la iteración anterior sin
  perder valoraciones ya editadas, `catalogService`, `modeloService`
  (con duplicados, cascada de borrado, asociar/desasociar capacidad),
  `capacidadService` (con duplicados, activar/desactivar, cascada de
  borrado), `valuationService`, `batteryService`/`damageService`,
  `pricingService` (incluye combinación sin valor cargado y
  modelo/capacidad inexistente), `quotesHistoryService`/`leadsService`
  (no pisan "última modificación"), `auditLogService`,
  `valuationBackupService`/`backupService`/factory-reset, `authService`
  (hash+sal, no texto plano), y la verificación explícita de que
  `STATIC_CONFIG.modelosCanje`, `STATIC_CONFIG.capacidades` y
  `tradeInCatalogService` ya no existen.
- **`node test/e2e.js` (Playwright + Chromium real, sitio servido con
  `python3 -m http.server 8791`) → 52/52 OK.** Navegador real de punta
  a punta: login (correcto/incorrecto, persistencia de sesión, logout),
  catálogo de venta ↔ Paso 5 (crear/editar/publicar/despublicar/
  eliminar, HTML en un nombre se escapa y no se interpreta, catálogo
  vacío no rompe nada), modelos del Paso 1 (crear aparece solo,
  renombrar a un duplicado se rechaza, eliminar desaparece solo),
  capacidades (duplicados, asociar a un modelo, una capacidad
  desactivada sigue visible en Admin pero no en el Paso 2 público,
  eliminar hace cascada completa), valores de canje (editar en Admin
  se refleja en la cotización real del cliente), desperfectos y
  batería (el cambio se ve en Actividad, el monto nunca se muestra al
  cliente, el resultado nunca es negativo), historial y leads
  (registro automático al llegar al resultado / al tocar WhatsApp, sin
  pisar "última modificación"), actividad (orden más reciente primero),
  exportar/importar valoraciones, backups completos y factory reset
  (incluyen todo, nunca la contraseña), seguridad (cambiar y
  restablecer credenciales), contacto y WhatsApp (el número
  configurado se usa realmente), y casos límite (buscar sin perder el
  foco, un modelo sin capacidades asociadas no rompe el Paso 2).
- Se corrieron manualmente, además, varios recorridos exploratorios
  adicionales con Playwright (creación/eliminación cruzada entre
  pestañas, XSS en catálogo, import de un backup con catálogo vacío y
  un modelo sin capacidades) antes de consolidar todo en los dos
  archivos de test de arriba.

### 6) Archivos creados / modificados / eliminados

**Creados:** ninguno.
**Eliminados:** ninguno.
**Modificados (7):** `config.js`, `services.js`, `script.js`,
`admin.js`, `admin.html`, `test/smoke_services.js`, `test/e2e.js`.
**Sin cambios (verificado byte a byte con `cmp` contra el ZIP de
entrada):** `admin.css`, `style.css`, `index.html`, `assets/logo.png`,
`.github/workflows/deploy-pages.yml`.

### 7) Pendiente / a tener en cuenta

- **Leads sin nombre/WhatsApp del cliente**: el cotizador público no
  tiene ningún campo para pedirle esos datos al cliente (agregarlo
  hubiera cambiado la experiencia/diseño actual, fuera del alcance de
  este pedido). El lead se registra igual (modelo, resultado, fecha),
  con esos dos campos vacíos.
- **`quotesHistory`/`leads` sin límite ni purga automática**: cada
  visita al Paso 5 y cada click en WhatsApp agrega un registro; con
  mucho tráfico, el tamaño del `localStorage` puede crecer con el
  tiempo. No se agregó una purga automática porque no la pedía el
  documento ("guardar automáticamente" está cubierto); si en el futuro
  hace falta, sería un buen candidato para cuando `storageService` se
  reemplace por un backend real (ver punto siguiente).
- **`StorageService` sigue siendo la capa `storageService` pedida en
  la Fase 13** (hoy sobre `localStorage`, mañana reemplazable por un
  backend sin reescribir el resto de la app), sin cambios de
  arquitectura respecto a la iteración 3 — ya cumplía ese rol.
- Se mantienen los mismos pendientes de higiene ya documentados en
  iteraciones anteriores (usuario/contraseña por defecto visibles en
  este mismo archivo, recomendable cambiarlos antes de operar con
  clientes reales; sin backend real, es seguridad "local al
  dispositivo").

---



Se revisaron `admin.html`, `admin.js`, `script.js`, `services.js` y
`config.js` en busca de toda referencia a `STATIC_CONFIG.modelosCanje`,
`STATIC_CONFIG.capacidades` y cualquier precio de canje hardcodeado.
Mapa de dependencias encontrado:

- `STATIC_CONFIG.modelosCanje` (config.js) — antes tenía id + nombre +
  **precioBaseUSD** por modelo. Lo leía `tradeInCatalogService`
  (services.js), y de ahí lo consumían `script.js` (Paso 1, resultado,
  WhatsApp) y `pricingService.calculateQuote()`.
- `STATIC_CONFIG.capacidades` (config.js) — tenía un **factor**
  multiplicador (0.92 / 1.0 / 1.12 / 1.3) por capacidad. Lo usaba
  `script.js` (chips del Paso 2, solo para nombre) y
  `pricingService.calculateQuote()` (`precioBaseUSD × factor`).
- El catálogo de **venta** (`catalogService`, Admin → Catálogo, Paso 5)
  es una estructura totalmente distinta y no se tocó.

Con ese mapa hecho, recién ahí se modificó código.

### 1) Qué se agregó

- **Nuevo módulo persistente `tradeInValues`** (`valuationService` en
  `services.js`, pestaña **Valoración** en Admin, junto a Catálogo,
  Desperfectos y Batería como pedía el documento). Cada fila es
  `{ id, modeloId, modeloNombre, capacidadId, capacidadNombre,
  valorUSD }` — un valor en USD por cada combinación modelo+capacidad,
  **sin fórmulas ni multiplicadores**. Permite crear, editar, eliminar,
  buscar (por modelo) y filtrar (por capacidad), tal como pedía el
  documento.
- Vista agrupada por modelo (21 grupos × 4 capacidades) con buscador y
  filtro de capacidad, mismo estilo visual que el resto del Admin.
- Si falta una combinación puntual (el admin la borró), se muestra
  "Sin cargar" con un botón **+ Cargar valor** para completarla sin
  perder las demás.
- Dashboard actualizado: nueva métrica "Valoraciones cargadas" (ej.
  84/84) y acceso rápido a la pestaña Valoración.
- `.github/workflows/deploy-pages.yml`: publica el sitio en GitHub
  Pages automáticamente en cada push a `main` (sin paso de build,
  porque el sitio es HTML/CSS/JS plano).

### 2) Qué se migró

- Se generaron los **84 valores** (21 modelos × 4 capacidades)
  reproduciendo **exacto** el resultado de la fórmula vieja
  (`precioBaseUSD del modelo × factor de la capacidad`, redondeado),
  para no perder ningún dato. Se verificó de forma automática, valor
  por valor, que coinciden con 0 diferencias antes de escribirlos como
  datos de fábrica de `defaultTradeInValues()`.
- **Migración automática también en tiempo de ejecución**:
  `normalizeStore()` detecta si a un STORE guardado en localStorage le
  falta `valoraciones` (por ejemplo, alguien que ya venía usando una
  iteración anterior) y la completa sola con esos mismos 84 valores,
  sin tocar el resto de los datos ya guardados (catálogo, desperfectos,
  batería, contacto). Probado con un store simulado "viejo" sin ese
  campo.

### 3) Qué se eliminó (hardcodeos)

- El **factor** de las capacidades (`STATIC_CONFIG.capacidades`) — ya
  no existe en ningún lado del código. Ahora `capacidades` solo tiene
  `id` + `nombre` (lista de referencia fija para los chips del Paso 2 y
  el formulario de Valoración).
- El **precioBaseUSD** de `STATIC_CONFIG.modelosCanje` — ya no existe.
  Ese catálogo ahora solo tiene identidad (`id` + `nombre`) para el
  Paso 1; el valor vive exclusivamente en Valoración.
- La fórmula `precioBaseUSD × factor` — ya no está en ningún lugar de
  `services.js`. `pricingService.calculateQuote()` ahora busca el valor
  exacto de la combinación elegida en `valuationService.getValue()`.

### 4) Qué se mantuvo sin cambios (a propósito)

- **`script.js` no se modificó** — cero líneas tocadas. El Paso 1 sigue
  usando `tradeInCatalogService` (lista fija e independiente de 21
  modelos, sin precios) para saber QUÉ modelos mostrar; el Paso 2 sigue
  usando `STATIC_CONFIG.capacidades` para los chips. Lo único que
  cambió es de dónde sale el número: antes de un cálculo con factor,
  ahora de una búsqueda directa en Valoración. Esto es intencional para
  no romper ni cambiar el flujo ni el diseño del cotizador, y para no
  reintroducir la dependencia frágil que se corrigió en la iteración 2
  (el Paso 1 sigue sin depender de que exista o no un dato administrado
  — si falta una valoración puntual, la cotización cae a USD 0 en vez
  de romperse, nunca deja de funcionar).
- Batería y Desperfectos: sin cambios de comportamiento — se revisó
  que no tuvieran hardcodeos de valoración y no los tenían (ya eran
  100% administrables desde la iteración anterior).
- Login, Seguridad, Catálogo de venta, Contacto, Backups, WhatsApp: sin
  cambios de código más allá de que Backups ahora también exporta e
  importa `valoraciones` automáticamente (es parte del mismo STORE).

### 5) Pruebas realizadas realmente

- **Smoke test** (`test/smoke_services.js`, Node puro): **73/73 OK.**
  Se agregaron pruebas específicas de esta iteración: migración
  automática desde un store "viejo" sin `valoraciones`; que
  `modelosCanje` y `capacidades` ya no tengan precios ni factor; los 84
  valores migrados verificados uno por uno; CRUD completo de
  `valuationService` (crear, no permitir duplicados, editar, eliminar);
  que borrar una valoración puntual no rompe `pricingService` (cae a
  USD 0 con `valoracionEncontrada:false`); y que Backups exporta e
  importa Valoración junto con el resto.
- **E2E con navegador real** (`test/e2e.js`, Playwright + Chromium):
  **58/58 OK.** Se agregó una sección completa "VALORACIÓN" que, en un
  navegador de verdad: entra a la pestaña nueva, cuenta 21 grupos × 4
  filas = 84 valoraciones cargadas, busca por modelo, filtra por
  capacidad, edita un valor y confirma que el cotizador público lo usa
  (Paso 1 a 5 completo), elimina esa valoración puntual y confirma que
  el cotizador **no se rompe** (da USD 0 en vez de tirar un error), y
  la vuelve a cargar con el botón "+ Cargar valor". Se volvió a correr
  el resto de las secciones ya existentes (login, cambio de contraseña,
  catálogo, Paso 1 independiente, Paso 5, desperfectos, batería,
  cotizador completo, WhatsApp, backups, responsive) contra el código
  de esta iteración y todas siguen pasando.

### 6) Resultado de cada verificación pedida

✓ Login funciona (admin/admin123, sesión persiste, logout) · ✓ Cambio
de contraseña funciona (y su restablecimiento) · ✓ Catálogo (venta)
funciona igual que antes · ✓ Desperfectos funcionan igual que antes ·
✓ Batería funciona igual que antes · ✓ Contacto funciona igual que
antes · ✓ Backups funcionan (ahora incluyen Valoración) · ✓ WhatsApp
funciona (número `5491159478541`, mensaje en USD) · ✓ Valoración
funciona (crear/editar/eliminar/buscar/filtrar) · ✓ Paso 1 usa
Valoración para el valor (y sigue siendo independiente del catálogo
Admin para la lista de modelos) · ✓ Capacidades funcionan (chips
fijos, sin factor) · ✓ Sin errores de consola de la aplicación en
ninguna de las pruebas (se filtró únicamente el bloqueo de Google
Fonts, propio de este entorno de pruebas sin internet, no de la app) ·
✓ No se rompió el diseño (mismos tokens de color/tipografía/CSS; el
único CSS nuevo es el de la pestaña Valoración, con la misma estética).

### 7) Qué sigue pendiente

- Los 84 valores de Valoración siguen siendo de ejemplo (migrados 1:1
  desde los datos de ejemplo anteriores) — hay que cargar los precios
  de canje reales desde Admin → Valoración antes de operar con
  clientes.
- El workflow de GitHub Pages requiere una única configuración manual
  en el repositorio real (Settings → Pages → Source → "GitHub Actions"),
  detallada como comentario en el propio archivo `.yml`. No se pudo
  probar contra un repositorio de GitHub real desde este entorno (sin
  acceso a internet); si se quiere, se puede verificar subiendo el ZIP
  a un repo y mirando la pestaña "Actions".
- Seguimos sin backend: el login es un candado local al dispositivo, y
  cada dispositivo tiene su propio localStorage (los datos no se
  sincronizan solos entre celular y notebook — para eso están los
  Backups).

No se afirma que algo funcione si no fue efectivamente corrido y
comprobado — los 73 + 58 resultados de arriba se pueden reproducir en
cualquier momento con:
```bash
node test/smoke_services.js
python3 -m http.server 8791   # en otra terminal, o en background
node test/e2e.js
```

---

## Iteración 2 — Corrección crítica: Paso 1 independiente del catálogo Admin

### 1) Qué errores se encontraron

- **🔴 Regresión arquitectónica confirmada**: el Paso 1 ("¿Qué iPhone
  tenés?") usaba `catalogService.getTradeable()`, es decir, dependía
  directamente del catálogo que administra el Admin — de su `estado`
  (publicado/sin stock/borrador). Esto significaba que si el
  administrador ocultaba, despublicaba o directamente vaciaba el
  catálogo de venta, el Paso 1 se quedaba con menos de 21 modelos (o
  sin ninguno), rompiendo la identificación del equipo del cliente.
  Esto es exactamente lo que describe el documento como "posible
  regresión" — confirmado con una prueba automática que lo reproduce.
- **Bug nuevo encontrado durante la corrección**: al vaciar
  completamente el catálogo de venta desde Admin, `normalizeStore()`
  (en `services.js`) trataba un array vacío como "dato corrupto" y lo
  pisaba con los 21 productos de ejemplo de fábrica. Es decir, el
  catálogo NUNCA podía quedar realmente vacío aunque el admin borrara
  todo — se "regeneraba solo". Esto no estaba pedido explícitamente en
  el documento, pero lo detectó la batería de pruebas al intentar
  vaciar el catálogo para validar la independencia del Paso 1.

### 2) Qué errores se corrigieron

- **Se separaron dos catálogos de naturaleza distinta**, tal como pide
  el documento:
  - `tradeInCatalogService` (nuevo, en `services.js`, datos en
    `config.js → STATIC_CONFIG.modelosCanje`): catálogo de canje del
    **Paso 1**. Es una lista fija de 21 modelos (11 al 17, Pro y Pro
    Max, sin Mini/Plus/Air), **no vive en localStorage y no la edita
    el Admin**. No depende de stock, estado ni disponibilidad de nada.
  - `catalogService` (el que ya existía, en Admin → Catálogo): catálogo
    de **venta**, exclusivo del **Paso 5**. Sigue viviendo en
    localStorage y el Admin lo sigue administrando por completo
    (crear/editar/eliminar/ocultar/despublicar).
  - `pricingService.calculateQuote()` ahora calcula el valor de canje
    siempre sobre `tradeInCatalogService`, nunca sobre `catalogService`.
- **Se eliminó `catalogService.getTradeable()`** por completo (no solo
  se dejó de usar: se borró del código) para que sea imposible volver
  a cometer el mismo error por accidente en el futuro.
- **`normalizeStore()` corregido**: un catálogo vacío ahora es un
  estado válido y se respeta tal cual — ya no se regenera solo con los
  datos de fábrica. (Mismo criterio aplicado a desperfectos y batería,
  por consistencia.)
- **Paso 5 ahora también lee "imagen"**, como pide el documento: se
  agregó el campo `imagenUrl` al catálogo Admin (con vista previa en
  la fila del panel) y se muestra en la tarjeta de diferencia del Paso
  5 cuando el producto elegido tiene una imagen cargada.
- **`catalogService.getForSale()` ahora exige `estado === "published"`
  Y `stock` a la vez** (antes solo miraba el estado) — así "stock" deja
  de ser un campo decorativo y el documento pide explícitamente que el
  Paso 5 lea el stock desde Admin.

### 3) Qué pruebas se realizaron realmente

Se ampliaron los dos suites de pruebas automáticas ya existentes
(quedan en `test/`, se pueden volver a correr en cualquier momento):

- **Smoke test** (`test/smoke_services.js`, Node puro): **51/51 OK.**
  Incluye una prueba de regresión específica: vaciar por completo el
  catálogo de venta y confirmar que `tradeInCatalogService` sigue
  teniendo 21 modelos y que `pricingService.calculateQuote()` sigue
  funcionando y da el resultado correcto.
- **E2E con navegador real** (`test/e2e.js`, Playwright + Chromium):
  **48/48 OK.** Se agregó una sección completa "PASO 1: catálogo de
  canje independiente" que, en un navegador de verdad:
  1. Confirma que el Paso 1 lista los 21 modelos (las 3 variantes de
     cada serie 11 a 17), sin Mini/Plus/Air.
  2. **Borra uno por uno todos los productos** del catálogo Admin desde
     la interfaz real (botón eliminar + confirmación) y confirma que el
     Paso 1 sigue mostrando los 21 modelos y que la cotización completa
     (Paso 1 a 5) sigue funcionando y da el valor correcto.
  3. Restaura el catálogo, **despublica los 21 productos** (los pasa a
     "Borrador" uno por uno desde el select real del panel) y confirma
     de nuevo que el Paso 1 no se mueve ni un pelo.
  4. Verifica, por separado, que el **Paso 5 sí depende exclusivamente**
     del catálogo Admin: un producto recién publicado aparece en el
     selector de compra, el precio editado se refleja, la imagen
     cargada se muestra, y un producto despublicado desaparece.
  - El resto de las secciones ya existentes (login, desperfectos,
    batería, cotizador completo, WhatsApp, backups, seguridad,
    responsive) se volvieron a correr contra el código corregido y
    siguen pasando.

### 4) Resultado de cada prueba

**LOGIN ADMIN** — ✓ usuario/contraseña correctos ingresan, ✓ incorrectos
muestran error, ✓ sesión persiste al recargar, ✓ logout funciona.

**CATÁLOGO ADMIN** — ✓ crear, ✓ editar (nombre/precio/imagen), ✓
eliminar, ✓ ocultar (borrador), ✓ despublicar (sin stock), ✓ persiste
en localStorage.

**PASO 1** — ✓ muestra los 21 modelos 11–17, ✓ sin Mini, ✓ sin Plus, ✓
sin Air, ✓ sigue funcionando con el catálogo Admin completamente vacío,
✓ sigue funcionando con todos los productos del catálogo Admin ocultos.

**PASO 5** — ✓ usa exclusivamente el catálogo Admin, ✓ refleja cambios
de precio, ✓ refleja cambios de stock, ✓ refleja cambios de estado, ✓
refleja la imagen cargada, ✓ los productos ocultos/despublicados
desaparecen del selector.

**DESPERFECTOS** — ✓ crear, ✓ editar, ✓ eliminar, ✓ activar/desactivar,
✓ persistencia, ✓ el cliente no ve ningún monto de descuento.

**BATERÍA** — ✓ crear/editar/eliminar regla, ✓ persistencia, ✓ una
regla editada cambia realmente el resultado final de la cotización.

**COTIZADOR COMPLETO** — ✓ Paso 1 a 5 sin errores de consola/JS
(verificado con listeners de error en el navegador real), resultado
final coherente con la fórmula.

**WHATSAPP** — ✓ genera el mensaje, ✓ el link abre `wa.me` con el
número `5491159478541`, ✓ el mensaje cotiza en USD.

**DASHBOARD** — ✓ productos publicados/ocultos/sin stock, ✓
desperfectos activos, ✓ reglas de batería, ✓ última modificación,
todos calculados en vivo desde los servicios (no hardcodeado).

**GITHUB PAGES** — ✓ sigue siendo HTML/CSS/JS estático sin build step;
la única dependencia externa es Google Fonts (ya existía antes de esta
iteración); sin frameworks ni paquetes que requieran Node en producción.

### 5) Qué sigue pendiente

- El valor base de canje (`tradeInCatalogService`) es fijo en esta
  iteración — no hay una pantalla de Admin para editarlo, a propósito,
  porque el documento pide que el Paso 1 sea completamente independiente
  del Admin. Si en el futuro el negocio necesita ajustar esos 21
  valores de referencia sin tocar código, habría que agregar una
  sección Admin nueva y separada (por ejemplo "Admin → Valores de
  canje") que escriba a su propio storage, sin technically volver a
  mezclarla con el catálogo de venta.
- Seguimos sin backend: el login es un candado local al dispositivo.
- Los precios de ejemplo (tanto de canje como de venta) siguen siendo
  valores inventados para la demo — hay que cargar los reales antes de
  operar con clientes.

No se afirma que algo funcione si no fue efectivamente corrido y
comprobado con las pruebas automáticas de arriba — los 51 + 48
resultados se pueden reproducir en cualquier momento con:
```bash
node test/smoke_services.js
python3 -m http.server 8791   # en otra terminal, o en background
node test/e2e.js
```

---

## Iteración 1 — Consolidación operativa inicial

## Cómo probar en local

```bash
python3 -m http.server 8791
# abrir http://localhost:8791/index.html  (cotizador)
# abrir http://localhost:8791/admin.html  (panel, usuario: admin / contraseña: admin123)
```

Para correr las pruebas automáticas (necesitan Node.js; el smoke test
no necesita nada más, el E2E necesita `npm install playwright` y el
sitio servido en el puerto 8791):

```bash
node test/smoke_services.js   # 44 verificaciones del motor de datos/cálculo
node test/e2e.js              # 34 verificaciones de navegador real (login, cotizador, admin)
```

## 1) Qué se modificó

- **Arquitectura**: se separó todo en `config.js` (datos de ejemplo) +
  `services.js` (motor único: `catalogService`, `batteryService`,
  `damageService`, `contactService`, `pricingService`, `authService`,
  `backupService`). `script.js` y `admin.js` ya no tienen datos propios
  ni cálculos propios: todo pasa por esos servicios.
- **Moneda**: toda la lógica pasó a USD (`precioBaseUSD`,
  `descuentoBateriaUSD`, `descuentoDesperfectosUSD`, `valorFinalUSD`).
  No queda ningún cálculo ni descuento interno en ARS.
- **Catálogo único**: el paso 1 (elegir modelo) y el paso 5 (comprar
  otro equipo) leen exactamente el mismo catálogo que edita el Admin.
  Ya no hay listas de modelos hardcodeadas en `script.js`.
- **Batería administrable**: nueva sección Admin → Batería con reglas
  CRUD (`porcentajeMinimo`, `porcentajeMaximo`, `descuentoUSD`). El
  cotizador usa esas reglas para descontar un monto fijo en USD — antes
  la batería no impactaba realmente el cálculo.
- **Desperfectos**: se agregó el campo `activo` (para poder ocultar sin
  borrar) y `descripcion` (nota interna). Se recargaron los 10
  desperfectos pedidos por el documento. El cliente solo ve el nombre,
  nunca el monto — ni individual ni el total acumulado (se sacó la
  barra de "total de descuentos" que existía en el paso 4).
- **Panel Admin**: se agregaron las pestañas **Backups** (exportar,
  importar, restaurar de fábrica) y **Seguridad** (cambiar
  usuario/contraseña, restablecer a admin/admin123). El Dashboard ahora
  muestra estadísticas reales del catálogo/desperfectos/batería, la
  última modificación, y accesos rápidos a cada sección.
- **Responsive**: se agregaron reglas `@media (max-width: 480px)` en
  `admin.css` — inputs más grandes (16px, evita el zoom automático de
  Safari), filas que se apilan en columna, botones e íconos con
  objetivo táctil más grande, toolbar y accesos rápidos que se adaptan.
- **Catálogo con CRUD completo**: además de precio/stock/estado, ahora
  se pueden crear y eliminar modelos desde Admin → Precios (antes solo
  se podía editar).

## 2) Qué se corrigió

- **🔴 Bug crítico: el login del Admin estaba roto.** `admin.js`
  comparaba `el.loginUser.value === ADMIN_USER` pero esa variable
  **nunca estaba definida** en ningún archivo del ZIP recibido (existía
  `DEFAULT_ADMIN_USER`, pero no `ADMIN_USER`). Cualquier intento de
  entrar al panel tiraba un `ReferenceError` y el formulario no hacía
  nada. Esto se corrigió de raíz con `authService`, que además ya no
  guarda la contraseña en texto plano (usa SHA-256 con sal).
- La batería se podía "elegir" en el paso 3 pero no afectaba el
  resultado final del paso 5 — ahora sí, y se comprobó con una prueba
  automática que cambia una regla desde Admin y verifica que el número
  final cambie.
- El paso 1 tenía una lista de 21 modelos hardcodeada por separado del
  catálogo del Admin (podían desincronizarse). Ahora hay una sola
  fuente.

## 3) Qué fue probado realmente (automatizado)

- **Smoke test** (`test/smoke_services.js`, Node puro, sin navegador):
  44 verificaciones sobre `catalogService`, `batteryService`,
  `damageService`, `contactService`, `pricingService`, `authService` y
  `backupService` — CRUD, fórmula de cotización, hashing de
  contraseñas, export/import/factory-reset. **44/44 OK.**
- **E2E con navegador real** (`test/e2e.js`, Playwright + Chromium,
  servido con `python3 -m http.server 8791`): login (usuario/contraseña
  correctos e incorrectos, persistencia de sesión tras recargar,
  logout), catálogo Admin ↔ cotizador (editar precio en Admin y verlo
  reflejado en el resultado del cliente; publicar un modelo y verlo
  aparecer en el paso 1; confirmar que un modelo en borrador no
  aparece), desperfectos (desactivar uno y verificar que desaparece del
  paso 4, que ningún monto se muestra al cliente, que igual descuenta
  del total), batería (cambiar una regla y ver el impacto real; que el
  resultado nunca sea negativo), WhatsApp (número correcto, mensaje en
  USD), backups (exportar sin credenciales, importar, factory reset),
  seguridad (cambiar credenciales, que las viejas dejen de funcionar,
  restablecer a admin/admin123) y responsive (sin scroll horizontal en
  375px, inputs con alto táctil ≥38px). **34/34 OK.**
- Verificación explícita y automatizada de que **usuario `admin` /
  contraseña `admin123` funcionan** apenas se abre el panel por
  primera vez (sin storage previo).

## 4) Qué fue validado funcionando

Todo lo listado en la sección "VALIDACIÓN FINAL" del documento fue
comprobado, salvo lo indicado como pendiente abajo:

✓ Paso 5 usa exclusivamente catálogo Admin · ✓ No existen Mini/Plus/Air
· ✓ USD en toda la lógica · ✓ Batería afecta realmente la cotización ·
✓ Reglas de batería administrables · ✓ Desperfectos administrables ·
✓ Cliente no ve descuentos internos · ✓ Dashboard funcional · ✓ Admin
usable desde celular · ✓ WhatsApp sigue funcionando (número
5491159478541) · ✓ Usuario y contraseña modificables · ✓ Credenciales
iniciales admin/admin123 verificadas.

## 5) Qué sigue pendiente / decisiones que conviene revisar

- **Números de WhatsApp inconsistentes en el propio documento**: la
  sección 12 pide `1159478541` como número inicial, pero la sección de
  validación exige explícitamente `5491159478541`. Se dejó
  `5491159478541` (formato internacional, el que efectivamente hace
  funcionar el link `wa.me`) porque es el que la validación pide probar
  — si el negocio prefiere otro número, se cambia en un campo de texto
  en Admin → Contacto.
- **Precios de ejemplo**: los 21 precios en USD del catálogo son
  valores inventados para que la demo funcione (igual que en el ZIP
  original, que también traía precios de ejemplo). Hay que cargar los
  precios reales desde Admin → Precios antes de operar con clientes.
- **"Diferencia a pagar" (paso 5)** sigue usando el mismo catálogo
  tanto para el valor de canje como para el precio del equipo nuevo a
  comprar (heredado del diseño original). Si el negocio necesita un
  precio de venta distinto al precio de referencia de canje para el
  mismo modelo, hace falta un catálogo de venta aparte — no estaba
  pedido en este documento, así que no se agregó, pero es la próxima
  mejora natural.
- **Dashboard**: el documento pide 4 categorías de estado de producto
  (publicados / ocultos / sin stock / despublicados). El catálogo solo
  tiene 3 estados (`published`, `out`, `draft`), heredados del diseño
  original — "ocultos" y "despublicados" son la misma categoría
  (`draft`) en este modelo de datos. Separarlos en dos estados distintos
  es posible pero no estaba claramente especificado y se prefirió no
  inventar semántica de negocio.
- **Sin backend**: el login sigue siendo un candado local al
  navegador/dispositivo (localStorage), como pide el documento — no es
  autenticación real contra un servidor. Cualquiera con acceso físico al
  dispositivo y conocimientos técnicos podría, en teoría, restablecer las
  credenciales manipulando el `localStorage`. Para uso con datos
  realmente sensibles (varios vendedores, distintos permisos) haría
  falta un backend.
- **Los datos de cada dispositivo son independientes**: como todo se
  guarda en `localStorage` del navegador, si el Admin se abre desde el
  celular y desde la notebook, son dos catálogos separados que no se
  sincronizan solos — hay que usar Backups (exportar en uno, importar
  en el otro) para mantenerlos iguales.

## Antes de operar con clientes reales, faltaría

1. Cargar los precios reales de cada modelo (Admin → Precios).
2. Revisar/ajustar los montos de descuento por desperfecto y por rango
   de batería según la política real del local.
3. Completar los datos de contacto reales (WhatsApp, Instagram,
   dirección, horarios) en Admin → Contacto.
4. Decidir el usuario/contraseña definitivos del panel (Admin →
   Seguridad) y no dejar admin/admin123 en un dispositivo que use el
   negocio día a día.
5. Hacer un primer backup (Admin → Backups → Descargar backup) apenas
   se cargan los datos reales, para no perderlos si se borra el
   navegador o se cambia de dispositivo.
