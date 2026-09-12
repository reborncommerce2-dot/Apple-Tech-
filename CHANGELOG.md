# Apple Tech — Historial de iteraciones

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
