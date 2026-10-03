# Apple Tech — Cotizador de canje + panel de administración

Sitio web estático (HTML + CSS + JavaScript, **sin build**) que usa
**Supabase** como base de datos y para el login del administrador, y se
publica gratis con **GitHub Pages**.

- **`index.html`** — cotizador público: el cliente elige su iPhone, capacidad,
  color, batería y desperfectos, y obtiene un valor estimado de canje en USD.
  Puede compararlo con un equipo en venta y consultar por WhatsApp.
- **`admin.html`** — panel privado: se cargan y modifican precios, modelos,
  capacidades, reglas de batería, desperfectos, equipos en venta y datos de
  contacto, y se ven las cotizaciones, los leads y el historial de cambios.

Lo que se guarda en el panel queda en Supabase y **la página pública lo
refleja sola, sin recargar** (Realtime).

---

## 1. Cómo funciona

```
 Cliente (index.html) ──lee──▶  Supabase  ◀──lee/escribe── Administrador (admin.html)
        │                          ▲
        └─ inserta cotizaciones ───┘      (el público SOLO puede insertar cotizaciones y leads)
           y leads
```

- **Cálculo** (siempre en USD):
  `valor final = valor base (modelo + capacidad) − descuento de batería − suma de desperfectos`
  (nunca menor a 0). Un modelo/capacidad sin precio cargado **no se ofrece**
  al cliente. Si el resultado fuera 0, se muestra «A consultar».
- **Seguridad:** la clave que está en el sitio es *pública por diseño*. Quien
  protege los datos son las políticas RLS de `supabase_schema.sql`:
  - Visitantes: leen la configuración del cotizador e **insertan**
    cotizaciones/leads (con límites de tamaño y de frecuencia). Nada más.
  - Administradores: **solo** los usuarios listados en la tabla
    `public.admins`. Tener una cuenta de Supabase no alcanza. Si alguien se
    registrara desde afuera, no podría leer ni escribir nada.
- **Si Supabase no responde:** el cotizador **no inventa precios** (muestra
  «Cotizador no disponible» + *Reintentar*). En el panel, no se permite
  guardar con datos sin leer (para no pisar los reales) y una barra muestra
  el estado real del guardado, con *Reintentar* si falló. Las cotizaciones y
  leads de clientes sin internet quedan en cola local y se reenvían solos.

## 2. Archivos

| Archivo | Para qué sirve | ¿Se edita? |
|---|---|---|
| `supabase-config.js` | URL y clave **pública** de Supabase | **Sí** (solo este) |
| `supabase_schema.sql` | Crea tablas, seguridad y Realtime en Supabase | Solo el email del final |
| `config.js` | Datos de EJEMPLO (se cargan con un botón) y colores | No |
| `services.js` | Lógica y sincronización con Supabase | **No** |
| `script.js`, `index.html`, `style.css` | Cotizador público | No |
| `admin.js`, `admin.html`, `admin.css` | Panel de administración | No |
| `supabaseClient.js` | Crea el cliente de Supabase | No |
| `test/` | Pruebas automáticas | No |
| `.github/workflows/deploy-pages.yml` | Corre tests y publica en GitHub Pages | No |

## 3. Puesta en marcha (una sola vez)

### 3.1 Supabase
1. En <https://supabase.com> abrí tu proyecto (o creá uno).
2. **Authentication → Users → Add user → Create new user**: poné el email y la
   contraseña del administrador y marcá **Auto Confirm User**.
3. **SQL Editor → New query**: pegá **todo** `supabase_schema.sql`.
   Antes de ejecutar, en la **última línea** cambiá
   `reborncommerce2@gmail.com` por el email del paso 2 y tocá **Run**.
   - El resultado final debe decir `OK: … ahora es administrador.` Si dice
     `NO EXISTE el usuario…`, creá el usuario (paso 2) y volvé a ejecutar
     **solo esa línea**.
   - Se puede ejecutar de nuevo cuando quieras (no borra datos). Para sumar
     otro administrador: `select public.add_admin('otro@email.com');`
     Para quitarlo: `select public.remove_admin('otro@email.com');`
4. **Authentication → Sign In / Providers (o "Providers → Email")**: desactivá
   **Allow new users to sign up** (nadie más debería registrarse; aunque lo
   hicieran, no tendrían permisos).
5. **Authentication → URL Configuration**:
   - *Site URL*: `https://TU_USUARIO.github.io/TU_REPO/`
   - *Redirect URLs*: agregá `https://TU_USUARIO.github.io/TU_REPO/admin.html`
     (necesario para el link de «¿Olvidaste tu contraseña?»).
6. **Project Settings → API** (o *API Keys*): copiá la **Project URL** y la
   clave **Publishable** (`sb_publishable_…`) o **anon public**.
   **Nunca** uses la clave `secret`/`service_role` en este proyecto.

### 3.2 Configurar el sitio
Abrí `supabase-config.js` y pegá la URL y la clave pública del paso 6.
(El archivo que viene en este ZIP ya trae los del proyecto de Apple Tech: si
usás ese mismo proyecto de Supabase, no hay que tocar nada.)

### 3.3 GitHub Pages
1. Creá un repositorio en GitHub y subí **todo el contenido de este ZIP** a la
   rama `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. En la pestaña **Actions** se ejecuta *Test and deploy to GitHub Pages*.
   Cuando termina en verde, el sitio queda en
   `https://TU_USUARIO.github.io/TU_REPO/` y el panel en `…/admin.html`.

### 3.4 Primer ingreso al panel
1. Abrí `…/admin.html` e ingresá con el email/contraseña del administrador.
2. Según el caso:
   - **Si ya usabas una versión anterior en ese mismo navegador**, los datos
     guardados en el navegador se pasan solos a Supabase (aparece un aviso
     verde). Se conservan en el navegador como respaldo.
   - **Si la base está vacía**, el Resumen muestra el botón **Cargar datos de
     ejemplo**. Úsalo y después reemplazá los precios de ejemplo por los reales.
     (También podés importar un backup en la pestaña *Backups*.)
3. Cargá los **datos de contacto** (WhatsApp con código de país, sin `+`,
   ej. `5491112345678`). Sin WhatsApp el botón de consulta no aparece.
4. Abrí `index.html` en otro dispositivo y probá una cotización.

## 4. Uso diario (para el administrador)

| Pestaña | Qué hacer |
|---|---|
| **Resumen** | Estado general y avisos. |
| **Catálogo** | Equipos que **vendés**: precio, stock, estado (Publicado / Sin stock / Borrador), detalle (ej. «128 GB · Batería 92%») y foto (link https). Solo se ofrecen los *Publicados con stock*. |
| **Valoración** | Modelos de **canje** y cuánto vale cada uno por capacidad. Un modelo solo se muestra al cliente si tiene al menos un valor mayor a 0. |
| **Capacidades** | Capacidades disponibles (se ordenan por tamaño). |
| **Desperfectos** | Qué descuenta cada desperfecto (el cliente nunca ve los montos). Se pueden desactivar. |
| **Batería** | Rangos de % y su descuento. Si se superponen o dejan huecos, el panel avisa. |
| **Historial / Leads** | Cotizaciones y consultas por WhatsApp. Si el cliente dejó nombre y WhatsApp, hay link para responderle. |
| **Actividad** | Quién cambió qué precio y cuándo. |
| **Contacto** | Nombre del negocio, WhatsApp, etc. Se aplica con **Guardar cambios**. |
| **Backups** | Exportar / importar / cargar datos de ejemplo. |
| **Seguridad** | Cambiar email/contraseña. |

- **Los campos se guardan al salir de ellos** (o al elegir una opción). La
  barra superior muestra «Guardando…» → «Todos los cambios guardados». Si
  aparece en rojo, **el cambio NO se guardó**: tocá *Reintentar*.
- Si cerrás la pestaña con cambios sin guardar, el navegador avisa.

### Qué NO modificar
- Los archivos `.js`, `.html`, `.css` y `supabase_schema.sql` (salvo el email del
  final del SQL) ni `supabase-config.js` sin necesidad.
- No subir nunca a GitHub una clave `secret`/`service_role`.
- No borrar usuarios/tablas desde Supabase a mano sin hacer backup antes.
- No usar «Restaurar datos de ejemplo» salvo que quieras perder los precios
  reales (pide escribir RESTAURAR y descarga antes una copia).

## 5. Backups y recuperación

- **Hacer backup**: Admin → Backups → *Descargar backup*. El archivo incluye
  toda la configuración **y** todas las cotizaciones, leads y actividad.
  Hacelo seguido y guardalo fuera de GitHub (contiene datos de clientes; el
  `.gitignore` ya ignora `backup-*.json`).
- **Recuperar**: Admin → Backups → *Importar backup*. Reemplaza la
  configuración por la del archivo (valida que no esté corrupto) y **no borra**
  cotizaciones/leads existentes. Antes de importar se descarga una copia de
  lo actual por si querés volver atrás.
- Supabase además tiene sus propios backups automáticos
  (Database → Backups; los diarios dependen del plan).

## 6. Pruebas

```bash
node test/services.test.js          # motor: sin dependencias (Node 18+), 122 pruebas
npm install && npx playwright install chromium
node test/e2e.js                     # navegador real (Chromium), 86 pruebas
npm run test:all                     # ambas
```

Usan un Supabase **falso** (`test/helpers/fake_supabase.js`) que replica las
reglas de RLS, restricciones, paginación, errores de red y Realtime, de modo
que se prueba todo sin tocar tu base real. **Qué no cubren:** no se conectan
al Supabase real ni ejecutan `supabase_schema.sql` en PostgreSQL; eso hay que
comprobarlo una vez con la lista de la sección 8.

## 7. Solución de problemas

| Síntoma | Causa probable |
|---|---|
| «Cotizador no disponible» | Sin internet, URL/clave mal puestas en `supabase-config.js`, o no se ejecutó el SQL. Abrí la consola del navegador (F12). |
| «Cotizador en preparación» | La base está vacía: entrá al admin y cargá datos (sección 3.4). |
| Entra al login pero dice «no tiene permiso de administrador» | Falta ejecutar `select public.add_admin('email')` con ese email exacto. |
| Barra roja «El servidor rechazó el cambio por permisos» | La cuenta ya no está en `admins`, o se ejecutó una versión vieja del SQL. Reejecutá `supabase_schema.sql`. |
| Barra roja «Tu sesión venció» | Volvé a ingresar; los cambios sin guardar hay que repetirlos. |
| El link del email de contraseña no abre el panel | Falta agregar `…/admin.html` en *Redirect URLs* (3.1, paso 5). |
| Los cambios del admin no aparecen solos en la web pública | Realtime no activo: el SQL agrega las tablas a la publicación `supabase_realtime`; revisá Database → Replication. De todos modos, al recargar se ven. |
| Un modelo no aparece al cliente | No tiene ninguna capacidad activa con valor mayor a 0. |

## 8. Lista de verificación antes de usarlo con clientes

- [ ] El SQL se ejecutó sin errores y terminó con `OK: … ahora es administrador.`
- [ ] *Allow new users to sign up* está desactivado.
- [ ] Entrás a `admin.html` con el administrador; con otro usuario cualquiera **no** se entra.
- [ ] Cambiaste un precio en el panel y, **sin recargar**, lo viste cambiar en `index.html` abierto en otro dispositivo.
- [ ] Hiciste una cotización de prueba: aparece en *Historial*; tocaste WhatsApp: aparece en *Leads*.
- [ ] Reemplazaste los datos de ejemplo por los precios reales y cargaste el contacto.
- [ ] Descargaste un primer backup.

## 9. Limitaciones conocidas

- Si dos administradores editan **la misma fila a la vez**, gana el último
  guardado (no hay bloqueo de edición).
- El cliente no puede enviar cotizaciones sin internet *en ese momento*, pero
  quedan en cola y se reenvían al volver; no hay captcha (hay un tope de 120
  registros por minuto por tabla y límites de tamaño).
- La librería de Supabase se carga desde un CDN (jsDelivr, versión mayor 2).
  Si querés fijarla/alojarla vos, descargá el archivo y cambiá el `<script>`.
- Todo está en USD.
