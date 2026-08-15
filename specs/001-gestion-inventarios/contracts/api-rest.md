# Contracts — API REST del backend (NestJS)

**Fase 1** | [plan.md](../plan.md) | [data-model.md](../data-model.md) | Frontend: [rutas-frontend.md](./rutas-frontend.md)

Fuente de verdad del contrato entre frontend y backend. Convenciones aplicables a TODOS los
endpoints:

- **Prefijo**: `/api`. El navegador llega vía proxy del frontend (research R14), por lo que
  el origen es el mismo; el backend escucha en `:4000`.
- **Autenticación**: cookie httpOnly `trazo_sesion` (JWT 8 h deslizante). Todos los
  endpoints la exigen salvo `POST /api/auth/login`. Sin cookie válida → `401`.
- **Autorización**: decorador `@Roles(...)` por endpoint (`A` = Administrador, `G` =
  Gerente, `O` = Operario); el guard revalida en BD que el usuario siga ACTIVO. Rol
  insuficiente → `403`. (FR-002/FR-003)
- **Validación**: el body/query de cada endpoint se valida con el esquema Zod de
  `@trazo/compartido` indicado (`PipeValidacionZod`); error → `400` con el formato de
  abajo. (FR-016/FR-047)
- **Formato de error** (único en toda la API, mensajes en español):
  `{ "error": { "mensaje": string, "campos": { [nombreCampo]: string } | null } }`
  Errores de dominio (p. ej. disponibilidad insuficiente) → `409`; validación → `400`;
  no encontrado → `404`.
- **Paginación** (todos los listados): query `pagina` (≥1, default 1) y `porPagina`
  (≤100, default 20); respuesta `{ datos: T[], total: number, pagina: number,
  porPagina: number }`.
- **Filtros de listado** (US13, FR-075): todos son OPCIONALES, se combinan con Y lógico entre
  sí y con la paginación, y un valor vacío equivale a "no filtrar" (nunca a "no hay
  resultados"). Un filtro con formato inválido es un `400` de campo, como cualquier otra
  entrada. Cada listado declara los suyos en su propia sección; los que se agregaron en US13
  van marcados **(US13)**.
- **Auditoría**: toda mutación registra usuario/fecha del token autenticado (FR-045).
- **Trazabilidad**: cada controlador y caso de uso lleva TSDoc con los `FR-###` que
  implementa (Principio VI).

## Autenticación (`/api/auth`) — módulo seguridad

| Método y ruta | Roles | Body (Zod) | Respuesta OK | Errores |
|---|---|---|---|---|
| `POST /api/auth/login` | público | `esquemaLogin` {login, password} | `204` + set-cookie `trazo_sesion` | `401` "Usuario o contraseña incorrectos" (genérico; INACTIVO idéntico — US6-AS4) |
| `POST /api/auth/logout` | A,G,O | — | `204` + limpia cookie | — |
| `GET /api/auth/perfil` | A,G,O | — | `{ id, nombreCompleto, rol: {id, nombre}, permisos: string[], debeCambiarPassword }` (T106 — ver § Roles y permisos) | `401` |
| `PUT /api/auth/password` | A,G,O | `esquemaCambiarPassword` {passwordActual, passwordNueva} | `204`; limpia `debeCambiarPassword` | `400` campos; `409` password actual incorrecta |
| `PUT /api/auth/perfil` | A,G,O | `esquemaActualizarMiPerfil` {nombreCompleto, email} | `204` (US14, FR-080) | `400` email duplicado o campos inválidos |

**Por qué los datos propios viven en `/api/auth` y no en `/api/usuarios/:id`** (US14): son dos
capacidades distintas y conviene que no se confundan. `/api/usuarios` es ADMINISTRAR A OTROS y
exige el permiso `usuarios.gestionar`; `/api/auth/*` es SOBRE UNO MISMO y no exige ninguno —
igual que `PUT /api/auth/password`, que ya seguía este criterio desde la fase Foundational.

Reglas de `PUT /api/auth/perfil`, todas verificadas en el servidor:
- El usuario afectado sale SIEMPRE del token de sesión, nunca del cuerpo ni de la URL
  (FR-081). Por eso la ruta no lleva `:id`: no hay forma de dirigirla a otra persona.
- Solo se aplican `nombreCompleto` y `email`. `login`, `rol` y `estado` NO son editables por
  esta vía (FR-082) y el esquema Zod ni siquiera los admite, así que enviarlos no tiene efecto:
  cambiar el propio rol sería escalada de privilegios y cambiar el propio estado, darse de baja.
- `email` conserva su unicidad (FR-083): duplicado → `400` con el campo señalado, sin aplicar
  nada, mismo criterio que el alta de usuarios en US6.
- La contraseña NO se toca aquí: ya existe `PUT /api/auth/password`, que exige la contraseña
  actual. Duplicarla en este endpoint la debilitaría (permitiría cambiarla sin conocer la
  anterior).

## Usuarios (`/api/usuarios`) — solo Administrador (FR-005…FR-009)

| Método y ruta | Roles | Body (Zod) | Respuesta OK | Errores |
|---|---|---|---|---|
| `GET /api/usuarios?estado=&rolId=` | A | `esquemaFiltroUsuarios` {estado?, **rolId?** (US13), pagina, porPagina} | página de usuarios (sin `password_hash` — FR-007); cada fila lleva `rol: {id, nombre}` (T106) | — |
| `POST /api/usuarios` | A | `esquemaCrearUsuario` {nombreCompleto, email, login, passwordTemporal, rolId} | `201` {id}; usuario nace con `debeCambiarPassword=true` | `400` login/email duplicado, `rolId` inexistente, o `rolId` que concede permisos que el solicitante no tiene (error de campo `rolId`) |
| `PUT /api/usuarios/:id` | A | `esquemaActualizarUsuario` {nombreCompleto, email, rolId} | `204` | `400` email duplicado, `rolId` inexistente, o `rolId` que concede permisos que el solicitante no tiene; `404`; `409` el cambio dejaría al sistema sin ningún usuario activo capaz de administrar roles o usuarios (FR-057) |
| `PUT /api/usuarios/:id/restablecer-password` | A | {passwordTemporal} | `204`; marca `debeCambiarPassword` | `400` el usuario objetivo tiene un rol que concede permisos que el solicitante no tiene; `404` |
| `PUT /api/usuarios/:id/estado` | A | {estado: ACTIVO\|INACTIVO} | `204` (baja lógica — FR-008) | `409` no puede desactivarse a sí mismo, o la baja dejaría al sistema sin ningún usuario activo capaz de administrar roles o usuarios (FR-057) |

**`rolId` (US13, FR-075/FR-076)**: entero positivo, igualdad exacta contra `usuarios.rol_id`. Un
`rolId` inexistente devuelve una página vacía, no un `400`: el filtro de un listado acota, no
valida la existencia del recurso (mismo criterio que `clienteId` en `/api/salidas`). El selector
que lo alimenta en el frontend sale de `GET /api/roles`, NUNCA de una lista fija de nombres —
desde US9 los roles son datos y un rol propio como "Bodeguero" debe poder filtrarse sin tocar
código (FR-054/FR-058). Ese endpoint exige `roles.gestionar`, que es un permiso DISTINTO de
`usuarios.gestionar`: si la sesión no lo tiene, la pantalla simplemente no ofrece el filtro (la
misma degradación que ya aplica al selector de rol del alta, T108) — el listado nunca se cae.

**Anotación de la revisión adversarial de la Tanda 13** (los errores nuevos de esta tabla se
agregaron ANTES de tocar el código, no después). La sección "Roles y permisos" declara tres
invariantes de FR-057 sobre `/api/roles`, pero FR-057 habla de **cualquier** operación, y se
demostró contra la API viva que `/api/usuarios` llegaba al mismo estado prohibido —o a su
contrario— sin pasar por ninguno de ellos:

- **Escalada (`400`)**: `usuarios.gestionar` sin `roles.gestionar` es en la práctica
  Administrador total mientras pueda asignarse el rol Administrador (o crear un usuario con
  él, o fijarle una contraseña temporal al Administrador y entrar con ella). El alta y la
  edición solo comprobaban que el `rolId` EXISTIERA. La regla nueva es la mínima que cierra
  las tres puertas: **nadie concede permisos que no tiene, ni administra a un usuario cuyo rol
  concede más que el suyo**. Es un `400` con error de campo —no un `403`— porque lo que se
  rechaza es un VALOR del cuerpo, igual que un `rolId` inexistente; el `403` de este sistema
  significa "no puedes usar este endpoint" y lo decide `PermisosGuard`.
- **Bloqueo (`409`)**: cambiarle el rol al último usuario capaz de administrar, o desactivarlo,
  dejaba el sistema irrecuperable por HTTP (restaurarlo exigía SQL a mano). La verificación es
  TRANSACCIONAL (bloqueo `FOR UPDATE` de sus titulares + revalidación en la misma transacción),
  porque dos administradores desactivándose MUTUAMENTE esquivan cualquier comprobación previa:
  cada petición ve un objetivo distinto de sí misma y ninguna se bloquea.

Con los tres roles del sistema nada de esto cambia el comportamiento observable (SC-013):
Administrador es hoy el único con `usuarios.gestionar` y concede los 30 permisos del catálogo,
así que ningún rol excede el suyo. Solo restringe lo que US9 hizo posible por primera vez:
roles propios con `usuarios.gestionar` y un subconjunto del resto.

## Exportación de procesos y logo institucional (US11, FR-064…FR-069)

**Exportaciones nuevas** — todas reutilizan el MISMO caso de uso y los MISMOS filtros que su
pantalla (criterio SC-007 ya establecido para reportes) y el mismo puerto `ExportadorReporte`
con sus estrategias Excel/PDF (research R8):

| Método y ruta | Roles | Query | Respuesta OK |
|---|---|---|---|
| `GET /api/ingresos/export?formato=pdf\|xlsx&…` | A,G,O | mismos filtros que `GET /api/ingresos` | stream con TODAS las filas que cumplen el filtro (FR-064: sin paginar — la paginación es de lectura, no un recorte de datos), `filename="ingresos-<fecha>.<ext>"` |
| `GET /api/salidas/export?formato=pdf\|xlsx&…` | A,G,O | mismos filtros que `GET /api/salidas` | ídem, `filename="salidas-<fecha>.<ext>"` |
| `GET /api/ingresos/:id/export?formato=pdf\|xlsx` | A,G,O | — | documento completo del ingreso (cabecera, líneas, totales, auditoría — FR-065), `filename="ingreso-<numeroFactura>.<ext>"` |
| `GET /api/salidas/:id/export?formato=pdf\|xlsx` | A,G,O | — | documento completo de la salida, `filename="salida-<numero>.<ext>"` |

**Permisos de las cuatro rutas** (anotado al implementar T120/T121): exigen `ingresos.ver` y
`salidas.ver`, los MISMOS del listado y el detalle que exportan (que es lo que produce la
columna "A,G,O" de la tabla). NO se creó un `ingresos.exportar`/`salidas.exportar`: a diferencia
de los reportes —donde `reportes.ver`/`reportes.exportar` ya venían separados de T103— aquí
ningún rol distinguiría las dos capacidades, así que serían dos casillas más del catálogo sin
consumidor (Principio V). Los `pagina`/`porPagina` que llegan con el resto de filtros se validan
con el MISMO esquema Zod que la pantalla —para que los filtros no puedan divergir— y se IGNORAN:
el archivo trae todas las filas (FR-064).

**Logo institucional de LOF** (US11, FR-067/FR-068 — reescrito el 2026-08-15):

| Método y ruta | Permiso | Body | Respuesta OK | Errores |
|---|---|---|---|---|
| `GET /api/marca/logo` | **público** (sin sesión) | — | `200` con los bytes del logotipo, `Content-Type: image/png`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` y `Cache-Control` largo | `404` si el despliegue no trae el archivo |

Reglas del contrato:

- **Es público a propósito**: lo pinta la pantalla de login, que por definición no tiene sesión.
  Es la identidad de la empresa, el mismo dato que aparece impreso en cada documento que sale
  del sistema — no hay nada que proteger. `nosniff` se mantiene igual: son bytes servidos desde
  el mismo origen de la aplicación.
- **Un solo archivo, un solo dueño**: el logotipo vive en `backend/assets/marca/logo-lof.png` del
  repositorio y lo sirve el backend. El frontend lo consume por esta ruta en vez de tener su
  propia copia en `public/`, para que cambiarlo sea cambiar UN archivo y no dos que se
  desincronizan.

**Las tres rutas de `/api/clientes/:id/logo` (GET/PUT/DELETE) fueron ELIMINADAS** junto con
`Cliente.tieneLogo`. Un documento lo firma quien lo emite, no su destinatario (ver FR-066).

Reglas de la exportación con logo (FR-067/FR-068):
- **TODO archivo exportado lleva el logotipo**, sin excepción y sin depender de su contenido.
  No lo pone cada endpoint: lo inyecta `responderConArchivoExportado`, el único punto por el que
  pasan las doce rutas `/export` del sistema. Es una garantía por CONSTRUCCIÓN — una exportación
  futura no puede nacer sin logo por olvido, porque nadie lo añade a mano.
- `DocumentoReporte` (puerto `ExportadorReporte`) tiene un campo **opcional** `logo`; ambas
  estrategias lo pintan en la esquina del encabezado (exceljs `addImage`, pdfmake vía imagen
  embebida). Si falta o falla su lectura, **el archivo se genera igual, sin logo** — nunca un
  error: el contenido de datos manda sobre la decoración (FR-068).
- `DocumentoReporte` gana además un segundo campo **opcional**, `encabezado` (pares
  etiqueta→valor), anotado al implementar T119/T121: es donde viajan la CABECERA y la AUDITORÍA
  de un documento individual (FR-065). No podían ir en `filtrosAplicados` porque
  `ExportadorExcel` a propósito NO escribe ese campo (desplazaría su fila de encabezados, ver su
  TSDoc), y un ingreso exportado a Excel sin cabecera no sería "el documento completo" que
  FR-065 exige, sino una lista de líneas huérfana. Los 4 reportes no lo declaran, así que su
  salida no cambia.

## Panel de control (`/api/panel`) (US10, FR-060…FR-063)

| Método y ruta | Roles | Query | Respuesta OK |
|---|---|---|---|
| `GET /api/panel` | A,G,O | — | `200` `ResumenPanel` — SOLO las secciones que el usuario puede consultar (FR-062) |

```json
{
  "inventario":  { "productosActivos": 20, "bajoUmbral": 8, "valorTotal": 10846500 },
  "pendientes":  { "salidasPendientes": 3, "ingresosPendientes": 2 },
  "consumoMes":  { "desde": "2026-08-01", "total": 4900000 },
  "movimientosRecientes": [ { "fechaHora": "…", "tipo": "SALIDA", "producto": "…", "cantidad": 100, "usuario": "…" } ]
}
```

Reglas de la respuesta:
- **Composición, nunca recálculo** (FR-063): cada bloque sale del MISMO caso de uso que ya
  alimenta su pantalla (`listar-inventario`/`reporte-inventario-actual` para las cifras de
  stock, los listados de salidas/ingresos filtrados por estado `PENDIENTE`,
  `reporte-consumo-*` para el consumo del mes, `RepositorioMovimientos.listar` para la
  actividad reciente). El panel no introduce ninguna consulta agregada propia.
- **Recorte por permisos en el SERVIDOR** (FR-062): `valorTotal` y `consumoMes` son
  información de reportes (hoy A,G) — para un Operario esas claves **se omiten del JSON**,
  no viajan con valor `null` ni ocultas en el cliente. Tras US9 el recorte se resuelve con
  los permisos efectivos del rol, no con su nombre.
- `movimientosRecientes` se limita a los 10 más recientes (el detalle completo vive en
  `/api/reportes/movimientos`).

**Anotaciones de la implementación (T114/T115)** — tres precisiones que el contrato no fijaba y
que se anotan aquí ANTES de que existan como código, no después:

- **Autorización**: `GET /api/panel` es el ÚNICO endpoint de negocio que NO declara
  `@RequierePermiso`. La columna "Roles A,G,O" se cumple dejándolo abierto a toda sesión
  autenticada porque cada sección de la respuesta ya está gateada por dentro contra el permiso
  de su pantalla de detalle (`inventario.ver`, `salidas.ver`, `ingresos.ver`, `reportes.ver`):
  una sesión sin ninguno recibe `200 {}`, sin filtrar nada porque no se calculó nada. Un permiso
  propio (`panel.ver`) solo habría agregado una casilla capaz de dejar a un rol sin portada —un
  `403` en `/`, el problema que US10 viene a resolver— sin proteger un solo dato adicional.
  Mismo criterio con el que `PermisosGuard` deja sin permiso las rutas que un usuario ejerce
  sobre sí mismo (`GET /api/auth/perfil`).
- **`productosActivos`** es el `total` del listado `GET /api/inventario`, es decir el catálogo
  tal como esa pantalla lo muestra — que desde T111 incluye los productos dados de baja con su
  etiqueta de estado. Se cuenta así, y no solo los `ACTIVO`, porque la tarjeta enlaza a ese
  listado y una cifra que no cuadrara con su destino sería exactamente la discrepancia que
  FR-063 prohíbe; el panel la rotula "Productos en inventario" para no prometer un filtro que
  su destino no aplica.
- **`consumoMes`** no sale de `reporte-consumo-cliente`/`-proyecto` (ambos EXIGEN el id de un
  cliente o un proyecto): suma las líneas de las salidas que devuelve
  `RepositorioSalidas.listarParaConsumo` —el mismo método del puerto que alimenta esos dos
  reportes y el que fija internamente `CONFIRMADA`/`COMPLETADA` (FR-044)— con
  `fechaSalida >= desde`. `desde` es el primer día del mes en curso decidido en hora de Bogotá
  y enviado como `AAAA-MM-DD`. La tarjeta enlaza al reporte de consumo, que es donde el sistema
  define y desglosa el consumo; el listado de salidas no serviría de detalle porque suma
  también pendientes y anuladas.

## Roles y permisos (`/api/roles`, `/api/permisos`) — solo Administrador (US9, FR-054…FR-059)

| Método y ruta | Permiso | Body (Zod) | Respuesta OK | Errores |
|---|---|---|---|---|
| `GET /api/permisos` | `roles.gestionar` | — | `200` catálogo completo agrupado por módulo: `[{modulo, permisos:[{id, clave, descripcion}]}]` — SOLO LECTURA (FR-056) | — |
| `GET /api/roles` | `roles.gestionar` | `esquemaFiltroRoles` {estado?, pagina, porPagina} | página de roles con su conteo de usuarios y sus permisos | — |
| `GET /api/roles/:id` | `roles.gestionar` | — | rol con el detalle de sus permisos asignados | `404` |
| `POST /api/roles` | `roles.gestionar` | `esquemaCrearRol` {nombre, descripcion?, permisoIds[]} | `201` {id}; nace `es_sistema=false`, `estado=ACTIVO` | `400` nombre duplicado / permiso inexistente |
| `PUT /api/roles/:id` | `roles.gestionar` | `esquemaActualizarRol` {nombre, descripcion?, permisoIds[]} | `204`; reemplaza el conjunto completo de permisos del rol | `400`; `404`; `409` rol de sistema (nombre no editable) / quitaría un permiso CRÍTICO (`roles.gestionar` o `usuarios.gestionar`) al último rol activo que lo concede, o a los únicos usuarios que podían ejercerlo (FR-057) |
| `PUT /api/roles/:id/estado` | `roles.gestionar` | {estado: ACTIVO\|INACTIVO} | `204` (baja lógica, nunca DELETE) | `409` rol de sistema / mismo invariante de FR-057, para cualquiera de los dos permisos críticos |
| `DELETE /api/roles/:id` | `roles.gestionar` | — | `204` | `409` rol de sistema, rol con usuarios asignados (mensaje indica cuántos), o último rol activo con un permiso crítico — FR-057 |

**Anotación T105 sobre el `DELETE`**: la tabla original enumeraba solo las dos primeras causas
de `409`. Se agregó la tercera —el último rol activo con `roles.gestionar`— ANTES de escribir el
caso de uso, porque eliminar al último rol que concede ese permiso es la forma más definitiva
(y la única irreversible) de "quitárselo al último rol que lo tiene", que es literalmente lo que
FR-057 prohíbe: sin él, recuperar el sistema exige tocar la base de datos a mano. No es un caso
frecuente —un rol con usuarios ya no se puede eliminar, así que el solicitante no puede ser
usuario del rol objetivo— pero es alcanzable, y así queda cubierto por la misma verificación que
la edición y el cambio de estado.

**Anotación de la revisión adversarial de la Tanda 13 — qué se CUENTA en el invariante**. Se
demostró contra la API viva que las tres verificaciones anteriores dejaban pasar el bloqueo por
dos motivos, y ambos se corrigieron:

1. **Contaban ROLES ACTIVOS que conceden el permiso, no USUARIOS que pueden ejercerlo.** Un rol
   con el permiso y CERO usuarios satisface ese conteo pero no administra nada: bastaba
   `POST /api/roles` (rol huérfano con `roles.gestionar`) + `PUT /api/roles/1` (quitárselo al rol
   que sí tenía gente) para dejar el sistema sin nadie capaz de administrarlo, sin tocar
   `/api/usuarios` y sin condición de carrera. `PUT /api/roles/:id` verifica ahora AMBAS cosas:
   que quede un rol ACTIVO que lo conceda (un rol INACTIVO ya no se ofrece en el selector de
   usuarios, así que no sirve de suplente) **y** que quede al menos un usuario ACTIVO capaz de
   ejercerlo. `PUT /estado` y `DELETE` solo necesitan la primera: desactivar un rol no le retira
   permisos a nadie (ver más abajo qué significa `estado` en un rol) y un rol eliminable ya
   tiene cero usuarios por el invariante anterior.
2. **Solo protegían `roles.gestionar`.** FR-057 dice "administrar roles **o usuarios**", y
   quitarle `usuarios.gestionar` al único rol que lo tenía respondía `204`. Los dos permisos son
   ahora igual de críticos; `roles.gestionar` se evalúa primero porque es el más grave (quien lo
   conserva puede devolverse el otro, no al revés).

`POST/PUT /api/usuarios` pasan a recibir `rolId` (número) en vez de `rol` (enum) — ver § Usuarios.
`GET /api/auth/perfil` incorpora `permisos: string[]` (las claves efectivas del rol) además de
`rol: {id, nombre}`, para que el frontend filtre la navegación por permiso (FR-058); esa lista
es informativa para la UI — la autoridad sigue siendo el guard del servidor en cada petición.

**Qué significa `estado` en un rol** (decisión T105, ningún artefacto la fijaba): `INACTIVO` es
"ya no se ofrece para asignar" —el selector de la pantalla de usuarios lista solo roles
ACTIVOS—, **no** "sus usuarios pierden el acceso". `PermisosGuard` no consulta el estado del rol:
US9-AS5 presenta desactivar como la ALTERNATIVA a eliminar un rol con usuarios, así que si
desactivarlo dejara a esa gente sin permisos no sería una alternativa sino un bloqueo masivo
silencioso. Quien deba perder el acceso se desactiva como USUARIO (FR-008), que es la baja que
la spec sí define. Asignar un rol INACTIVO no está prohibido en el servidor por la misma razón:
ningún requisito lo pide y el recorte correcto vive en el selector.

## Productos (`/api/productos`) (FR-010…FR-012)

| Método y ruta | Roles | Body/Query (Zod) | Respuesta OK | Errores |
|---|---|---|---|---|
| `GET /api/productos?buscar=` | A,G,O | `esquemaListarProductos` {buscar?} | `200` `ProductoResumen[]` {id,sku,descripcion,ultimoCosto,disponible} — listado simple SIN paginar, solo para poblar selectores (extensión T035; `ultimoCosto`/`disponible` añadidos en T052 para el formulario de salidas — `disponible = stockActual − comprometidoPorProducto` de TODAS las salidas PENDIENTE, sin excluir nada, ver TSDoc de `listar-resumen-productos.caso-uso.ts`) | — |
| `POST /api/productos` | A,G,O | `esquemaCrearProducto` {sku, descripcion, categoriaId?, ubicacion?, umbralStockBajo?} | `201` {id} (alta rápida desde ingresos — FR-011) | `400` SKU duplicado; `400` categoría inexistente o inactiva |
| `PUT /api/productos/:id` | A,G | `esquemaActualizarProducto` {descripcion, categoriaId?, ubicacion?, umbralStockBajo?, ultimoCosto?} | `204` | `404`; `400` categoría inexistente o inactiva |
| `PUT /api/productos/:id/estado` | A,G | {estado} | `204` (nunca DELETE — FR-012) | `404` |

`categoria` nació en US8 (FR-052) como texto libre. **Desde US15 es una referencia al catálogo**:
el cuerpo lleva `categoriaId` (numérico, opcional, `null` para desclasificar) y las respuestas
devuelven el objeto `categoria: { id, nombre } | null`, que es lo que la pantalla necesita
mostrar sin una segunda petición. Se acepta una categoría INACTIVA solo si el producto ya la
tenía: reasignar a una inactiva se rechaza (FR-086).

## Categorías (`/api/categorias`) (US15, FR-084…FR-088)

| Método y ruta | Permiso | Body/Query (Zod) | Respuesta OK | Errores |
|---|---|---|---|---|
| `GET /api/categorias` | `categorias.ver` | `esquemaListarCategorias` {buscar?, estado?} | `200` `Categoria[]` {id, nombre, descripcion, estado} ordenadas por nombre | — |
| `POST /api/categorias` | `categorias.gestionar` | `esquemaCrearCategoria` {nombre, descripcion?} | `201` {id} | `400` nombre duplicado (campo `nombre`) |
| `PUT /api/categorias/:id` | `categorias.gestionar` | `esquemaCrearCategoria` | `204` | `404`; `400` duplicado |
| `PUT /api/categorias/:id/estado` | `categorias.gestionar` | {estado: `ACTIVA\|INACTIVA`} | `204` | `404` |
| `DELETE /api/categorias/:id` | `categorias.gestionar` | — | `204` SOLO si no tiene productos | `409` con el número de productos que la usan (FR-087) |

Reglas del contrato:

- **`categorias.ver` lo tienen los tres roles semilla**, no solo quien administra: sin él no se
  puede clasificar un producto ni usar el filtro por categoría, que es trabajo diario (FR-088).
  `categorias.gestionar` es lo restringido.
- **El duplicado se decide ignorando mayúsculas y espacios** (FR-085) y se responde `400` con
  `campos: { nombre: … }`, no un `409` genérico: es un error de un campo del formulario.
- **`DELETE` es la excepción a "nunca se borra"**: una categoría recién creada por error y sin
  usar sí puede eliminarse. En cuanto la usa un producto, `409` y la vía es desactivarla.

## Proveedores (`/api/proveedores`) (US15, FR-091…FR-093)

Mismo contrato que categorías —FR-091 extiende FR-084…FR-088 íntegras— con las diferencias que
la propia historia marca y que se listan bajo la tabla.

| Método y ruta | Permiso | Body/Query (Zod) | Respuesta OK | Errores |
|---|---|---|---|---|
| `GET /api/proveedores` | `proveedores.ver` | `esquemaListarProveedores` {buscar?, estado?} | `200` `Proveedor[]` {id, nombre, nit, telefono, email, estado, esSistema, cantidadIngresos} ordenados por nombre | — |
| `POST /api/proveedores` | `proveedores.gestionar` | `esquemaCrearProveedor` {nombre, nit?, telefono?, email?} | `201` {id} | `400` nombre duplicado (campo `nombre`) |
| `PUT /api/proveedores/:id` | `proveedores.gestionar` | `esquemaCrearProveedor` | `204` | `404`; `400` duplicado; `409` renombrar el proveedor del sistema (FR-093) |
| `PUT /api/proveedores/:id/estado` | `proveedores.gestionar` | {estado: `ACTIVO\|INACTIVO`} | `204` | `404` |
| `DELETE /api/proveedores/:id` | `proveedores.gestionar` | — | `204` SOLO si no tiene ingresos | `409` con el número de ingresos que lo usan; `409` si es el proveedor del sistema (FR-093) |

Reglas del contrato:

- **`proveedores.ver` lo tienen los tres roles semilla**: sin él no se puede registrar un
  ingreso —el proveedor es OBLIGATORIO (FR-091)— ni usar el filtro del listado.
  `proveedores.gestionar` es lo restringido, igual que en categorías.
- **El duplicado se decide ignorando mayúsculas y espacios, NO tildes** (FR-091 remite a
  FR-085): "Ferreteria" y "Ferretería" son dos proveedores distintos. Se responde `400` con
  `campos: { nombre: … }`.
- **El proveedor del sistema** ("Carga masiva de inventario", FR-093) admite que se corrijan
  sus datos de contacto, pero NO que se le cambie el nombre ni que se elimine: la importación
  lo resuelve POR NOMBRE. Se responde `409`, no `403`: no es una cuestión de permisos sino del
  estado de ese registro. Se distingue en el listado con `esSistema: true` para que la pantalla
  pueda deshabilitar los controles en vez de dejar que el usuario descubra el error al guardar.
- **Un proveedor INACTIVO no se ofrece** para registrar ingresos nuevos, pero los ingresos que
  ya lo referencian lo conservan — mismo criterio que FR-086 para categorías.

## Carga masiva de inventario (`/api/productos/importar*`) — solo A,G (US8, FR-048…FR-051)

| Método y ruta | Roles | Body/Query | Respuesta OK | Errores |
|---|---|---|---|---|
| `GET /api/productos/plantilla-importacion` | A,G | — | `200` stream `.xlsx` (plantilla con encabezados + hoja de instrucciones), `Content-Disposition: attachment; filename="plantilla-inventario.xlsx"` | — |
| `GET /api/productos/catalogo-importacion` | A,G | — | `200` stream `.xlsx` con la MISMA estructura de columnas que la plantilla, una fila por producto existente del catálogo (FR-053), `filename="catalogo-inventario-<fecha>.xlsx"`. `Cantidad inicial` viaja VACÍA siempre (si trajera el stock, re-subir el archivo lo sumaría otra vez); `Valor unitario` trae el COSTO ACTUAL de cada producto y es editable (FR-070/FR-071) | — |
| `POST /api/productos/importar` | A,G | `multipart/form-data`, campo `archivo` (`.xlsx`, máx. 5 MB, máx. 2.000 filas de datos — ver spec.md § Assumptions) | `200` `ResumenImportacion` (ver abajo) | `400` archivo ausente/no es `.xlsx`/vacío (sin filas de datos) — ningún producto se toca |

**Corrección US12 sobre FR-053**: en la especificación original ambas columnas viajaban
vacías. `Cantidad inicial` debe seguir vacía (evita duplicar stock), pero vaciar también
`Valor unitario` ocultaba un dato que el usuario ya posee, sin ganar nada a cambio: ese campo
solo se consume cuando hay cantidad, así que traerlo lleno nunca pudo alterar el stock. Desde
US12 además es editable, y todo cambio real de costo queda registrado (ver § Historial de
costos).

**`ResumenImportacion`** (todo fila-por-fila, PARCIAL a propósito — FR-051, nunca un `409`/`400`
por errores de fila individual, esos van dentro de `errores`):
```json
{
  "creados": 3,
  "actualizados": 1,
  "conStockInicial": 2,
  "costosActualizados": 2,
  "errores": [
    { "fila": 5, "mensaje": "El SKU es obligatorio" },
    { "fila": 8, "mensaje": "La cantidad inicial requiere un valor unitario mayor a 0" }
  ]
}
```
Fila = número de fila del Excel (1 = encabezado; la primera fila de datos es la 2), para que
el usuario la ubique directo en su archivo sin contar filas a mano.

Por cada fila válida con SKU existente → `PUT` equivalente (actualiza); SKU nuevo → `POST`
equivalente (crea). Si la fila trae `cantidadInicial > 0`, esa cantidad se agrupa con las de
las demás filas válidas del mismo archivo en un único `Ingreso` sintético
(`RepositorioIngresos.crear` + `.recibir`, ver data-model.md § Carga masiva de inventario) —
mismo movimiento `ENTRADA`/misma auditoría que un ingreso manual, `conStockInicial` cuenta
las filas que dispararon esa entrada.

`costosActualizados` (US12) cuenta las filas cuyo `Valor unitario` difería del costo vigente del
producto: es lo único que cambia el costo en esta carga. Una fila con el MISMO costo, o con la
columna vacía, no suma aquí ni deja registro (FR-074) — por eso re-subir el catálogo recién
descargado sin editarlo devuelve siempre `costosActualizados: 0`.

## Historial de costos del producto (US12, FR-071…FR-074)

| Método y ruta | Roles | Respuesta OK |
|---|---|---|
| `GET /api/inventario/:productoId/historial-costos` | A,G | página de `{fechaHora, costoAnterior, costoNuevo, origen, usuarioNombre, documentoId}`, más reciente primero |

- `PUT /api/productos/:id` acepta `ultimoCosto` opcional: si difiere del actual, lo actualiza
  y registra el cambio (`origen: EDICION_MANUAL`) en la MISMA transacción (FR-072). Si el cuerpo
  NO lo trae, el costo queda intacto y no se registra nada: `undefined` significa "no lo toques",
  nunca "ponlo en cero" (anotación T126).
- `POST /api/productos/importar` aplica el mismo criterio con `origen: IMPORTACION`, solo
  cuando el valor recibido difiere del actual (FR-074); el `ResumenImportacion` incorpora
  `costosActualizados: number` para que el usuario vea cuántos precios cambió su archivo.
- Recibir un ingreso (`POST /api/ingresos/:id/recibir`), que ya actualizaba `ultimo_costo`,
  registra el cambio con `origen: RECEPCION_INGRESO` y el id del ingreso en `documentoId`.
- **Un cambio de costo NUNCA escribe en `movimientos_inventario`** (FR-073): no altera
  cantidades y rompería el invariante `stock = Σ movimientos`.

**Permiso** (anotación T127 — el contrato solo fijaba la columna "Roles"): la ruta declara
`@RequierePermiso('inventario.ver_costos')`, un permiso NUEVO del catálogo, y NO el
`inventario.ver` que comparten las otras tres rutas de `/api/inventario`. Motivo: `inventario.ver`
lo tienen los tres roles del sistema, Operario incluido, así que colgarla de ahí habría abierto el
historial de precios a todo Operario y contradicho la columna "Roles" de esta misma tabla. La
evolución del costo es información de valorización — mismo alcance que `reportes.ver`. Lo reciben
Administrador y Gerente; la migración `20260812150000_historial_costos_producto` lo inserta con esa
matriz y `prisma/seed.ts` la mantiene. Es un permiso ADITIVO: ningún rol pierde capacidades, así
que SC-013 se conserva sin tocar una sola aserción de autorización existente.

## Inventario (`/api/inventario`) — lectura (FR-020…FR-024)

| Método y ruta | Roles | Query (Zod) | Respuesta OK |
|---|---|---|---|
| `GET /api/inventario` | A,G,O | `esquemaFiltroInventario` {buscar?, soloStockBajo?, **categoriaId?** (US15), ubicacion?, estado?, disponibleMin?, disponibleMax?, pagina, porPagina} | página de `{ producto, stock, comprometido, disponible, stockBajo }` |
| `GET /api/inventario/opciones-filtro` | A,G,O | — | `200` `{ categorias: {id, nombre}[], ubicaciones: string[] }` — **desde US15 las categorías salen del CATÁLOGO** (todas las activas, más las inactivas que algún producto siga usando, para que un listado filtrado por una categoría dada de baja siga siendo reproducible), no de un `DISTINCT` sobre productos (FR-088). `ubicaciones` sigue siendo el `DISTINCT` de texto libre de US13/FR-076 |
| `GET /api/inventario/:productoId` | A,G,O | — | ficha del producto con cifras actuales (mismo shape que una fila) — `404` si no existe |
| `GET /api/inventario/:productoId/movimientos` | A,G,O | {desde?, hasta?, pagina…} | página de movimientos (fecha, tipo, documento, cantidad, usuario, cliente/proyecto) |

**Filtros nuevos de US13** (anotados ANTES de implementarlos, T130):

- **`ubicacion`**: igualdad EXACTA contra el valor guardado, no subcadena. Es texto libre, así que
  el usuario no puede adivinar cómo se escribió: por eso el filtro se ofrece como SELECCIÓN de lo
  que existe, alimentado por `GET /api/inventario/opciones-filtro` (FR-076), y con valores
  tomados de esa lista la igualdad es lo correcto (una subcadena haría que "Bodega 1" arrastrara
  "Bodega 10").
- **`categoriaId`** (US15): ya no es un texto sino el id del catálogo, así que el problema de
  "cómo se escribió" desaparece de raíz — el filtro compara claves, no cadenas. Sustituye al
  parámetro `categoria` de US13.
- **`estado`** (`ACTIVO|INACTIVO`): OMITIRLO sigue devolviendo AMBOS, que es lo que esta pantalla
  hace desde T111 y lo que el panel cuenta como "Productos en inventario" (ver § Panel de
  control). El filtro solo agrega la capacidad de acotar; no cambia el default de nadie.
- **`disponibleMin`/`disponibleMax`** (≥0, inclusive ambos extremos): rango sobre **`disponible`**
  (= `stock` − `comprometido`), NUNCA sobre el stock crudo (FR-077) — mismo criterio que
  `soloStockBajo` y que el `cantidadMin`/`cantidadMax` del reporte de inventario (FR-041). Se
  llaman distinto que en el reporte a propósito: ahí solo hay una cifra de cantidad, aquí hay
  tres en pantalla (stock, comprometido, disponible) y un `cantidadMin` no diría cuál. Se aplica
  en el caso de uso, en memoria, DESPUÉS de componer `comprometido` (que exige el JOIN a
  `salidas` que `RepositorioProductos` no puede resolver solo).
- **`opciones-filtro` va declarada ANTES de `@Get(':productoId')`** en el controlador: Express
  resuelve por orden de declaración, mismo cuidado que `@Get('export')` en T120.

`producto` (en ambas respuestas) = `{ id, sku, descripcion, categoria, ubicacion, umbralStockBajo,
ultimoCosto, estado, fechaUltimoMovimiento }`, donde desde US15 `categoria` es
`{ id, nombre } | null` en lugar de una cadena. **Anotación T128 (US12)**: `ultimoCosto` se añade
por el MISMO motivo que `umbralStockBajo` en T062 — el costo pasa a ser editable desde la ficha
(FR-071) y el formulario debe precargar el vigente; enviarlo vacío registraría un cambio que nadie
pidió. No expone nada nuevo: `GET /api/productos` ya devuelve `ultimoCosto` con el mismo alcance de
roles. **Anotación T062**: `umbralStockBajo` y `estado` se añadieron a esta
fila (T059 solo tenía `id/sku/descripcion/ubicacion/fechaUltimoMovimiento`) porque la ficha de
producto del frontend (T062) necesita precargar el umbral en el formulario de edición y conocer
el estado actual para el botón activar/desactivar — sin un GET adicional a `/api/productos/:id`
que el contrato no define. `construirFilaInventario` ya recibía la entidad `Producto` completa
(`dominio/entidades/producto.ts`), así que es una extensión aditiva sin nuevo endpoint ni
cálculo adicional.

## Ingresos (`/api/ingresos`) (FR-013…FR-019)

| Método y ruta | Roles | Body (Zod) | Respuesta OK | Errores |
|---|---|---|---|---|
| `GET /api/ingresos?buscar=&estado=&desde=&hasta=&proveedorId=` | A,G,O | `esquemaFiltroIngresos` {buscar?, estado?, desde?, hasta?, **proveedorId?** (US13/US15), pagina, porPagina} | página de cabeceras con totales | — |
| `GET /api/ingresos/:id` | A,G,O | — | ingreso con líneas | `404` |
| `POST /api/ingresos` | A,G,O | `esquemaCrearIngreso` {numeroFactura, fechaFactura, **proveedorId**, fechaRecepcion, observaciones?, **ordenCompraId?** (US16), lineas[≥1]{productoId, cantidad>0, precioUnitario>0}} | `201` {id} en PENDIENTE; totales calculados (FR-014) | `400` factura duplicada (FR-015)/validación (FR-016)/proveedor inexistente o inactivo |
| `PUT /api/ingresos/:id` | A,G,O | mismo esquema | `204` (solo PENDIENTE — US1-AS5) | `409` estado no editable |
| `POST /api/ingresos/:id/recibir` | A,G,O | — | `204`; transacción atómica suma stock + movimientos ENTRADA (FR-017/FR-021) | `409` estado inválido |
| `POST /api/ingresos/:id/verificar` | A,G | — | `204` (RECIBIDO→VERIFICADO, inmutable) | `409` |
| `POST /api/ingresos/:id/anular` | A,G | {motivo} (obligatorio) | `204`; RECIBIDO genera reversa AJUSTE_SALIDA (FR-019) | `409` disponible insuficiente para revertir / VERIFICADO no anulable |

**El proveedor es un objeto, no un texto (US15, FR-091)**: tanto el listado como el detalle
devuelven `proveedor: { id, nombre }` —lo que la pantalla necesita mostrar sin una segunda
petición—, y al crear o editar se envía `proveedorId`. Es OBLIGATORIO, a diferencia de la
categoría de un producto: una factura sin saber a quién se le compró no es trazable. Se acepta
un proveedor INACTIVO solo si el ingreso ya lo tenía; asignar uno inactivo se rechaza.

**`proveedorId` (US13/FR-075, reescrito en US15/FR-091)**: el filtro del listado nació en US13
como subcadena sobre la columna de texto; desde US15 se elige del CATÁLOGO y es una coincidencia
EXACTA por id, que es lo que hace el resultado reproducible (FR-088 aplicado a proveedores).
`buscar` NO cambia: sigue cruzando `numero_factura` OR el NOMBRE del proveedor, así que teclear
"3M" trae también las facturas cuyo número contiene "3M" — por eso los dos filtros siguen sin
ser redundantes y se combinan con Y lógico. Como todo filtro del listado, viaja también al
export (`GET /api/ingresos/export`) por construcción: vive en `CriteriosIngresos`, que
`FiltrosListarIngresos` extiende.

## Órdenes de compra (`/api/ordenes-compra`) (US16, FR-094…FR-100)

| Método y ruta | Permiso | Body/Query (Zod) | Respuesta OK | Errores |
|---|---|---|---|---|
| `GET /api/ordenes-compra?buscar=&proveedorId=&estado=&desde=&hasta=` | `ordenes_compra.ver` | `esquemaFiltroOrdenesCompra` {buscar?, proveedorId?, estado?, desde?, hasta?, pagina, porPagina} | página de cabeceras con `proveedor: {id, nombre}` y totales | — |
| `GET /api/ordenes-compra/sugerencias?proveedorId=` | `ordenes_compra.crear` | `proveedorId` obligatorio | `200` `SugerenciaCompra[]` (ver abajo) | `404` proveedor inexistente |
| `GET /api/ordenes-compra/export?formato=pdf\|xlsx&…` | `ordenes_compra.ver` | mismos filtros que el listado | stream con TODAS las filas del filtro (FR-064) | — |
| `GET /api/ordenes-compra/:id` | `ordenes_compra.ver` | — | orden con líneas | `404` |
| `GET /api/ordenes-compra/:id/export?formato=pdf\|xlsx` | `ordenes_compra.ver` | — | documento completo: número, proveedor con contacto, líneas, total y auditoría (FR-097) | `404` |
| `POST /api/ordenes-compra` | `ordenes_compra.crear` | `esquemaCrearOrdenCompra` {proveedorId, fechaOrden, fechaEntregaEsperada?, observaciones?, lineas[≥1]{productoId, cantidad>0, precioUnitario>0}} | `201` {id, numero} en BORRADOR; total calculado (FR-094) | `400` validación / proveedor inexistente o inactivo |
| `PUT /api/ordenes-compra/:id` | `ordenes_compra.editar` | mismo esquema | `204` — **solo en BORRADOR** (FR-096) | `409` estado no editable; `404` |
| `POST /api/ordenes-compra/:id/enviar` | `ordenes_compra.enviar` | — | `204` BORRADOR→ENVIADA; deja de ser editable | `409` estado inválido |
| `POST /api/ordenes-compra/:id/anular` | `ordenes_compra.anular` | {motivo} (obligatorio) | `204` desde BORRADOR o ENVIADA | `409` una orden RECIBIDA o ya ANULADA no se anula |

**`SugerenciaCompra`** (FR-098) — `{ productoId, sku, descripcion, disponible, umbralStockBajo, cantidadSugerida, precioSugerido }`:

- Solo productos ACTIVOS **bajo umbral** (`disponible <= umbralStockBajo`, misma regla que el
  inventario) **que ese proveedor ya haya suministrado** en algún ingreso anterior. No se
  sugiere cemento a quien vende compresores.
- `cantidadSugerida` = `umbral × 2 − disponible`, redondeada hacia arriba. Reponer justo hasta
  el umbral dejaría el producto en alerta permanente (la alerta es `disponible <= umbral`), así
  que la sugerencia lleva el stock al primer valor con margen real. Es una propuesta editable.
- `precioSugerido` = el `ultimo_costo` del producto, que es lo último que se pagó por él.
- Una lista vacía es una respuesta legítima (`200 []`), no un error: significa que a ese
  proveedor no hay nada que pedirle hoy.

Reglas del contrato:

- **La orden NO mueve stock en ningún estado** (FR-096). El único efecto de inventario del ciclo
  de compra sigue siendo `POST /api/ingresos/:id/recibir`.
- **`ordenes_compra.ver`/`.crear`/`.editar` los tienen los tres roles**; `.enviar` y `.anular`
  quedan en Administrador y Gerente: son las dos acciones que comprometen o liberan un gasto
  frente a un tercero (FR-100).
- **El número se muestra como `OC-000042`** (formato de presentación); en la API viaja como
  entero en `numero`, igual que el de las salidas.
- **Enlace con el ingreso (FR-099)**: `POST /api/ingresos` acepta `ordenCompraId` OPCIONAL. Si
  viene, la orden debe estar ENVIADA y ser del MISMO proveedor del ingreso (si no, `400` con
  `campos.ordenCompraId`). Cuando ese ingreso se RECIBE, la orden pasa a `RECIBIDA` en la MISMA
  transacción que mueve el stock.

## Clientes y proyectos (`/api/clientes`, `/api/proyectos`) (FR-034…FR-038)

| Método y ruta | Roles | Body (Zod) | Respuesta OK | Errores |
|---|---|---|---|---|
| `GET /api/clientes?buscar=&estado=&ciudad=` | A,G,O | `esquemaFiltroClientes` {buscar?, estado?, **ciudad?** (US13), pagina, porPagina} | página de clientes | — |
| `GET /api/clientes/opciones-filtro` | A,G,O | — | `200` `{ ciudades: string[] }` — las ciudades que EXISTEN hoy entre los clientes, sin repetir y ordenadas (US13, FR-076) | — |
| `GET /api/clientes/:id` | A,G,O | — | cliente + proyectos + resumen de salidas (FR-037) | `404` |
| `POST /api/clientes` | A,G | `esquemaCrearCliente` {nombre, nit, telefono?, email?, direccion?, ciudad?} | `201` {id} | `400` NIT duplicado (FR-035) |
| `PUT /api/clientes/:id` | A,G | mismo esquema | `204` | `400`/`404` |
| `PUT /api/clientes/:id/estado` | A,G | {estado} | `204` | `404` |
| `GET /api/clientes/:id/proyectos-destino` | A,G,O | — | proyectos ACTIVOS del cliente ACTIVO (combobox de salidas — FR-038) | `404` |
| `POST /api/clientes/:id/proyectos` | A,G | `esquemaCrearProyecto` {nombre, descripcion?, fechaInicio?, fechaCierreEstimada?, responsable?, presupuestoEstimado?} | `201` {id} | `400` nombre repetido en el cliente / fechas incoherentes |
| `PUT /api/proyectos/:id` | A,G | mismo esquema | `204` | `400`/`404` |
| `PUT /api/proyectos/:id/estado` | A,G | {estado: ACTIVO\|COMPLETADO\|SUSPENDIDO} | `204` (US2-AS4) | `404` |

Desde US11 (T118), la forma de `Cliente` que devuelven el listado y la ficha incluye
`tieneLogo: boolean` (los BYTES del logo NUNCA viajan aquí — ver § Exportación de procesos y
logo del cliente, donde viven las tres rutas de `/api/clientes/:id/logo`).

**`ciudad` (US13, FR-075/FR-076)**: igualdad EXACTA, alimentada por
`GET /api/clientes/opciones-filtro`, mismo criterio que `categoria`/`ubicacion` de inventario —
es texto libre que capturó un humano, así que el usuario elige de lo que existe en vez de
adivinar la ortografía. Los tres permisos siguen siendo los del listado (`clientes.ver`): las
opciones de filtro no exponen ningún dato que la propia página no muestre ya en su columna
"Ciudad". `opciones-filtro` va declarada ANTES de `@Get(':id')` (orden de Express).

## Salidas (`/api/salidas`) (FR-025…FR-033)

| Método y ruta | Roles | Body (Zod) | Respuesta OK | Errores |
|---|---|---|---|---|
| `GET /api/salidas?clienteId=&proyectoId=&estado=&desde=&hasta=&numero=&usuarioAutorizaId=` | A,G,O | `esquemaFiltroSalidas` {clienteId?, proyectoId?, estado?, desde?, hasta?, **numero?, usuarioAutorizaId?** (US13), pagina, porPagina} | página con número, cliente/proyecto, estado, total (FR-033) | — |
| `GET /api/salidas/:id` | A,G,O | — | salida con líneas y auditoría | `404` |
| `POST /api/salidas` | A,G,O | `esquemaCrearSalida` {proyectoId (obligatorio — FR-027), fechaSalida, observaciones?, lineas[≥1]{productoId, cantidad>0, precioUnitario≥0}} | `201` {id, numero} correlativo (FR-026); PENDIENTE compromete disponibilidad | `400` sin proyecto/validación; `409` proyecto no activo (FR-038) o disponibilidad insuficiente con disponible real |
| `PUT /api/salidas/:id` | A,G,O | mismo esquema | `204` (solo PENDIENTE; revalida disponibilidad) | `409` |
| `POST /api/salidas/:id/confirmar` | A,G,O | — | `204`; transacción atómica descuenta stock, fija autorizante y fecha (FR-028/029/030). Ante carrera solo una gana (US3-AS5) | `409` disponibilidad insuficiente (disponible real) / estado inválido |
| `POST /api/salidas/:id/completar` | A,G,O | — | `204` (cierre de entrega) | `409` |
| `POST /api/salidas/:id/cancelar` | A,G,O | {motivo} | `204` (PENDIENTE→ANULADA, libera compromiso) | `409` |
| `POST /api/salidas/:id/anular` | A,G | {motivo} (obligatorio) | `204`; reversa AJUSTE_ENTRADA (FR-032) | `409` COMPLETADA no anulable |

**Filtros nuevos de US13** (anotados ANTES de implementarlos, T130):

- **`numero`**: el correlativo de negocio (FR-026), entero positivo, igualdad exacta — NO el `id`
  técnico. Es el número que el usuario tiene escrito en el papel que sostiene, y hasta US13 la
  única forma de llegar a una salida por su número era paginar hasta verla. Un número
  inexistente devuelve una página vacía (`total: 0`), no un `404`: sigue siendo un LISTADO
  filtrado, no la lectura de un recurso.
- **`usuarioAutorizaId`**: id del usuario que autorizó la salida (`salidas.usuario_autoriza_id`,
  FR-030). Las salidas PENDIENTE/ANULADA-desde-pendiente NO tienen autorizante, así que jamás
  aparecen bajo este filtro por ningún valor — es la semántica correcta ("qué autorizó esta
  persona"), no una omisión.
- Ambos viven en `CriteriosSalidas`, así que el export (`GET /api/salidas/export`) los respeta
  por construcción (FR-064/SC-007). La regla del logo no cambia: lo lleva el archivo filtrado
  por `clienteId`, y `numero`/`usuarioAutorizaId` no acotan a un único cliente por sí mismos.

## Reportes (`/api/reportes`) — solo A,G (FR-039…FR-044)

Los endpoints de datos y los de exportación comparten esquema de filtros y caso de uso
(garantiza SC-007). Consumo = salidas CONFIRMADA/COMPLETADA (FR-044).

| Método y ruta | Query (Zod) | Respuesta OK |
|---|---|---|
| `GET /api/reportes/consumo-cliente` | `esquemaFiltroConsumoCliente` {clienteId (req.), desde?, hasta?} | proyectos→productos con cantidades/valores, totales por proyecto y cliente (FR-039) |
| `GET /api/reportes/consumo-proyecto` | {proyectoId (req.), desde?, hasta?} | detalle de salidas, total, margen vs presupuesto, serie para gráfico (FR-040) |
| `GET /api/reportes/inventario` | {buscar?, cantidadMin?, cantidadMax?} | stock/comprometido/disponible, valor total, bajo umbral (FR-041) |
| `GET /api/reportes/movimientos` | {desde?, hasta?, tipo?, usuarioId?, clienteId?, proyectoId?} | movimientos con documento y cliente/proyecto (FR-042) |
| `GET /api/reportes/{tipo}/export?formato=pdf\|xlsx&…` | mismos filtros + formato | stream `application/pdf` o xlsx con `Content-Disposition: attachment; filename="<reporte>-<fecha>.<ext>"`; sin datos → archivo válido con encabezados y cero filas (FR-043) |

El PDF incluye encabezado con nombre del reporte, filtros aplicados y fecha/hora; el Excel
incluye formatos COP y autofiltro. Implementación vía puerto `ExportadorReporte` con
estrategias Excel/Pdf (research R8).

### Maqueta del PDF — garantías de FR-043 «el reporte sale completo»

«Exportable» no basta: un PDF cuyo contenido no se ve no cumple FR-043. La estrategia
`ExportadorPdf` garantiza, para CUALQUIER reporte o documento:

1. **Tamaño y orientación**: A4; **apaisado** a partir de 7 columnas (inventario y movimientos
   tienen 9), **vertical** por debajo. En vertical caben 515 pt útiles: con 9 columnas tocarían
   a ~57 pt, donde no entra una descripción de producto.
2. **La tabla nunca excede el ancho imprimible.** Los anchos de columna se calculan en puntos
   —nunca `auto`— descontando el relleno de celda, que en `pdfmake` se suma POR FUERA del
   `width`. Es el invariante que vigila `backend/test/unit/maqueta-pdf.spec.ts`.
3. **Los importes no se parten**: las columnas numéricas reciben el ancho que su valor más
   largo necesita para caber en una línea; solo las columnas de texto se ajustan en varias.
   Una cifra partida en dos renglones es un dato que hay que recomponer a mano.
4. **Continuidad legible**: la fila de encabezados se repite en cada página, ninguna fila se
   parte entre dos páginas, y el pie muestra «Página X de Y» para que quien reciba el archivo
   sepa si le falta una hoja.
5. **Totales junto a su cifra**: la etiqueta del total ocupa el ancho de la fila y termina
   pegada al importe que describe, en la misma columna de importes.

Estas garantías aplican igual a los documentos individuales de US11 (FR-065), que usan la
misma estrategia con `encabezado` y `logo`.
