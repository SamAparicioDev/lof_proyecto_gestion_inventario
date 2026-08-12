# Research: Sistema de Gestión de Inventarios (Trazo) — Fase 0

**Date**: 2026-08-10 (revisado tras la decisión de stack del dueño del proyecto) |
**Plan**: [plan.md](./plan.md)

Esta fase documenta las decisiones técnicas, su racional y alternativas. **Nota de
revisión**: la versión inicial de este documento proponía un monolito Next.js con Server
Actions; el dueño del proyecto decidió explícitamente **NestJS (backend) + Next.js
(frontend) con arquitectura hexagonal**, ratificado como Principio VI de la Constitución
v1.1.0. Las decisiones R1, R6, R7, R9, R10 fueron actualizadas; R2, R4, R5, R8, R11 y R12
conservan su lógica (ahora ejecutada por el backend).

## R1. Stack de aplicación: NestJS 11 (backend) + Next.js 15 (frontend)

- **Decision**: backend NestJS 11 (API REST, inyección de dependencias, guards) con
  arquitectura hexagonal; frontend Next.js 15 (App Router) exclusivamente de presentación;
  monorepo npm workspaces con paquete compartido `@trazo/compartido` (esquemas Zod + tipos
  del contrato). **Decisión explícita del dueño del proyecto** (2026-08-10).
- **Rationale**: separación clara de responsabilidades y del ciclo de vida de despliegue;
  NestJS aporta DI de primera clase (facilita puertos/adaptadores y SOLID), guards/pipes
  para el control de acceso y validación por endpoint, y un ecosistema de testing maduro.
  El dominio queda aislado de frameworks (Principio VI) y testeable sin BD ni HTTP.
- **Alternatives considered**:
  - *Monolito Next.js + Server Actions* (propuesta original): menos piezas, pero acopla
    las reglas de negocio al framework de UI — descartado por decisión del dueño.
  - *Express/Fastify a mano*: sin DI ni estructura de módulos; más código propio para
    lograr lo que NestJS trae resuelto.

## R2. Base de datos: PostgreSQL 16

- **Decision**: PostgreSQL 16. Desarrollo local con Docker Compose (BD `trazo` +
  `trazo_test`); producción en instancia gestionada o servidor propio.
- **Rationale**: los Principios I y IV exigen `CHECK` constraints, `UNIQUE`
  concurrentes-seguros y bloqueo de fila (`SELECT ... FOR UPDATE`) — todo de primera clase
  en PostgreSQL. Soporta las agregaciones de reportes sin capas extra.
- **Alternatives considered**: SQLite (serializa escrituras, semántica de bloqueo distinta
  a producción); MySQL 8 (viable; se prefiere la semántica transaccional/`RETURNING` de PG).

## R3. ORM y acceso a datos: Prisma dentro de los adaptadores

- **Decision**: Prisma ORM para esquema, migraciones y consultas, usado EXCLUSIVAMENTE en
  `backend/src/infraestructura/persistencia` (adaptadores que implementan los puertos del
  dominio). `$queryRaw`/`$executeRaw` dentro de `prisma.$transaction` para `FOR UPDATE` y
  `UPDATE ... RETURNING`. Los `CHECK` y triggers se versionan en las migraciones SQL.
- **Rationale**: migraciones reproducibles + tipos generados; el aislamiento en adaptadores
  cumple la regla de dependencia (el dominio nunca importa Prisma) y permite cambiar de ORM
  sin tocar reglas de negocio.
- **Alternatives considered**: TypeORM (integración Nest histórica pero migraciones y tipado
  más débiles); Drizzle (excelente SQL, tooling menos maduro); SQL a mano (más código propio).

## R4. Estrategia de atomicidad de stock (Principio I — crítico)

- **Decision**: el servicio de dominio `ServicioStock` define la lógica
  (`aplicarEntrada`/`aplicarSalida`: validar disponibilidad, calcular nuevo stock, producir
  el movimiento); el adaptador `UnidadDeTrabajo` (infraestructura) la ejecuta en
  `prisma.$transaction` con:
  1. `SELECT id, stock_actual FROM productos WHERE id IN (...) ORDER BY id FOR UPDATE`
     (orden fijo por id para evitar deadlocks).
  2. Revalidación de disponibilidad con los valores bloqueados; si una línea excede →
     excepción de dominio `DisponibilidadInsuficiente` → rollback y mensaje en español con
     el disponible real por producto.
  3. `UPDATE productos SET stock_actual = ...` + `INSERT movimientos_inventario` en la
     misma transacción.
  4. Red final: `CHECK (stock_actual >= 0)` en BD.
- **Cantidad comprometida**: agregado de líneas de salidas `PENDIENTE` (no materializada);
  evita dual-write y deriva. Se usa como señal de UX al crear/editar una salida
  (`disponible = stock_actual − comprometido`, excluyendo el compromiso propio al editar) —
  NO participa en la revalidación atómica de `confirmar`: esa revalida directamente contra
  el `stock_actual` bloqueado con `FOR UPDATE` (corrección T056, ver data-model.md §
  "Máquinas de estado" — restarle el compromiso de OTRAS salidas `PENDIENTE` en el paso
  atómico hacía que dos confirmaciones concurrentes se rechazaran mutuamente en vez de que
  exactamente una ganara, violando SC-002; el propio bloqueo de fila ya serializa
  correctamente el acceso al stock real).
- **Alternatives considered**: UPDATE condicional sin SELECT (no permite informar el
  disponible real por línea); columna materializada de comprometido (riesgo de deriva);
  aislamiento SERIALIZABLE (exige reintentos en toda mutación).

## R5. Números correlativos y unicidad concurrente

- **Decision**: número de salida vía tabla `contadores` con `UPDATE ... SET valor = valor+1
  ... RETURNING` dentro de la transacción de creación (puerto `Contadores`, adaptador
  Prisma) → correlativo sin huecos y seguro ante concurrencia. Número de factura: lo digita
  el usuario; unicidad por `UNIQUE` + traducción del error a mensaje de campo en español.
- **Alternatives considered**: secuencia PostgreSQL (huecos ante rollback);
  `MAX(numero)+1` (carrera clásica, descartado).

## R6. Autenticación y autorización: Passport-JWT en cookie httpOnly + guards

- **Decision**: módulo de seguridad NestJS con `passport-jwt`: `POST /api/auth/login`
  verifica credenciales (bcryptjs costo 12; usuario INACTIVO → mismo mensaje genérico),
  emite JWT (rol + debeCambiarPassword) en **cookie httpOnly/secure/SameSite=Lax** con
  expiración 8 h y renovación deslizante (re-emisión en actividad). `JwtAuthGuard` +
  `RolesGuard` globales con decorador `@Roles(...)` por endpoint; el guard revalida contra
  BD que el usuario siga ACTIVO. El frontend nunca ve el token (cookie first-party gracias
  al proxy same-origin, ver R14); su middleware consulta `GET /api/auth/perfil`.
- **Rationale**: cookie httpOnly elimina exposición del token a JS (XSS); guards por
  endpoint materializan FR-003 (autorización en servidor); bcryptjs es JS puro (sin
  fricción de compilación nativa en Windows).
- **Alternatives considered**: Auth.js (acoplado a Next: la autoridad debe vivir en el
  backend ahora); token en localStorage + header Bearer (expuesto a XSS); argon2 (binario
  nativo problemático en Windows); sesiones en BD (revocación fina innecesaria — la
  desactivación se chequea en el guard).

## R7. Validación compartida: Zod en `@trazo/compartido` + pipe propio

- **Decision**: un esquema Zod por operación, con mensajes en español, en
  `packages/compartido/src/esquemas/` — consumido por react-hook-form en el frontend
  (feedback inmediato) y por `PipeValidacionZod` (pipe NestJS propio, ~30 líneas
  comentadas) en cada endpoint (autoridad). Violaciones de constraint de BD (unicidad) se
  capturan en los adaptadores y se traducen a errores de campo en español.
- **Rationale**: una sola fuente de verdad de validación para ambos lados (FR-016/FR-047);
  el pipe propio evita depender de wrappers de terceros (Principio V) y es un ejemplar
  didáctico del patrón Adapter.
- **Alternatives considered**: class-validator + DTOs decorados (convención Nest, pero
  duplicaría las reglas que el frontend ya necesita en Zod); nestjs-zod (dependencia
  adicional para lo que resuelven 30 líneas propias).

## R8. Exportación PDF y Excel: puerto + patrón Strategy

- **Decision**: puerto `ExportadorReporte` (aplicación) con dos estrategias en
  infraestructura: `ExportadorExcel` (exceljs: encabezados, formatos COP, autofiltro) y
  `ExportadorPdf` (pdfmake: título, filtros aplicados, fecha de generación, tablas con
  totales). Los endpoints `GET /api/reportes/*/export?formato=pdf|xlsx` reutilizan
  EXACTAMENTE los mismos casos de uso de consulta que las vistas (garantiza SC-007) y
  responden streams con `Content-Disposition`. Impresión: vista del reporte con CSS
  `@media print` en el frontend.
- **Alternatives considered**: Puppeteer (dependencia pesada y frágil en Windows);
  @react-pdf/renderer (acoplaría la generación al runtime React en el servidor); CSV
  (no cumple el requisito de Excel con formato).

## R9. UI: sistema de diseño Nocturne + TanStack Table + Recharts

- **Decision (revisada 2026-08-10)**: el dueño del proyecto entregó un mockup completo de
  la aplicación (`Trazo Inventarios.dc.html`, proyecto de diseño
  `claude.ai/design/p/8015ddf5-9ef5-48d1-8857-b1eefaedb66b`) construido sobre un sistema de
  diseño propio, **Nocturne** (fondo oscuro, Inter, botones con borde de acento, radios de
  8px, iconos Phosphor). Nocturne **reemplaza** la decisión original de shadcn/ui: sus
  clases de componentes (`.btn`, `.field`/`.input`, `.card`, `.table`, `.tag`, `.dialog`) y
  tokens CSS (`var(--color-*)`, `var(--space-*)`, `var(--radius-*)`, `var(--shadow-*)`) se
  vendieron a `frontend/src/app/globals.css`; la guía completa vive en
  [docs/diseno-nocturne.md](../../docs/diseno-nocturne.md). Tailwind CSS 4 se conserva
  únicamente para utilidades de layout (flex/grid/spacing), nunca para los componentes
  visuales que Nocturne ya define. Iconos: `@phosphor-icons/react` (componentes React,
  autohospedados) en vez de la fuente-icono por CDN que usa el mockup original. Tipografía
  Inter autohospedada con `next/font/google` en vez del `@import` a Google Fonts del
  mockup. TanStack Table para listados con paginación server-side (datos vía API REST);
  react-hook-form + Zod compartido en formularios; Recharts para el gráfico de consumo;
  combobox dependiente cliente → proyectos activos (endpoint `proyectos-destino`).
- **Alcance implementado en la tanda Foundational**: solo el "shell" (login, cambiar
  contraseña, layout/sidebar/navegación) — las demás vistas del mockup (dashboard,
  inventario, ingresos, salidas, clientes, 4 reportes, usuarios, 5 diálogos) quedan como
  referencia visual para sus tandas correspondientes (US1–US7), conectadas a datos reales
  desde el principio (nunca los datos ficticios en memoria del mockup).
- **Alternatives considered originalmente (shadcn/ui sobre Tailwind)**: descartada por la
  decisión explícita del dueño del proyecto de usar Nocturne en su lugar. MUI/Ant (runtime
  mayor, menos personalizable); tablas a mano (reinventar paginación/orden).

## R10. Pruebas: Jest + Supertest (backend), Playwright (E2E)

- **Decision**:
  - *Unitarias (Jest, sin BD)*: dominio y aplicación puros — `ServicioStock`, cálculos de
    totales/margen, transiciones de estado, esquemas Zod. Posibles gracias a la
    arquitectura hexagonal (puertos falsos en memoria).
  - *Integración (Jest + Supertest, obligatorias por constitución)*: API completa contra
    PostgreSQL real (`trazo_test`): rechazo de salida > disponible, carrera de dos
    confirmaciones (solo una gana), unicidad de factura concurrente, correlativo sin
    duplicados, inmutabilidad de movimientos (trigger), anulaciones con reversa, guards
    401/403.
  - *E2E (Playwright)*: backend + frontend levantados; flujo completo login → ingreso →
    recibir → salida → confirmar → inventario/reporte cuadra; matriz de acceso por rol.
- **Rationale**: la semántica de `FOR UPDATE`/constraints SOLO se prueba con PG real;
  Jest es el estándar del ecosistema NestJS (tooling integrado).
- **Alternatives considered**: Vitest en backend (viable, pero Jest viene integrado con
  el tooling de Nest); pg-mem (no implementa fielmente bloqueos ni triggers).

## R11. Localización y formato

- **Decision**: un solo idioma (español) hardcodeado — sin framework i18n (Principio V).
  Moneda COP con `Intl.NumberFormat('es-CO', ...)` en el frontend; fechas con date-fns y
  zona `America/Bogota`; timestamps en UTC (`timestamptz`) en BD.
- **Alternatives considered**: next-intl / nestjs-i18n (infraestructura especulativa).

## R12. Datos semilla y arranque

- **Decision**: `backend/prisma/seed.ts` crea el Administrador inicial (credenciales por
  variables de entorno, `debe_cambiar_password=true`). Con flag `--demo` (solo
  desarrollo): usuarios `gerente.demo` y `operario.demo` (contraseña `SEED_DEMO_PASSWORD`)
  para operar el MVP con los tres roles antes de US6, y datos de demostración (productos,
  cliente "Jumbo" con 2 proyectos, ingresos y salidas con totales conocidos) para validar
  reportes.
- **Rationale**: cumple el supuesto de la spec (admin semilla), habilita la demo por roles
  del MVP y da fixtures estables para quickstart y pruebas de reportes.

## R13. Arquitectura hexagonal: mapa de capas, patrones y SOLID (Principio VI)

- **Decision**: cuatro capas en `backend/src` con regla de dependencia estricta
  (verificada por lint de fronteras):
  | Capa | Contenido | Puede importar de |
  |---|---|---|
  | `dominio` | entidades, errores tipados, puertos (interfaces), `ServicioStock` | nada externo (ni NestJS, ni Prisma) |
  | `aplicacion` | un caso de uso por operación de la spec + DTOs de entrada/salida | `dominio` |
  | `infraestructura` | adaptadores: repositorios Prisma, hash bcrypt, exportadores, reloj | `dominio`, `aplicacion` (implementa sus puertos) |
  | `interfaces/http` | controladores REST, guards, pipes, filtros de excepciones | `aplicacion` (invoca casos de uso), `@trazo/compartido` |
  Patrones aplicados y su porqué: **Repository** (puertos de persistencia — DIP),
  **Use Case / Command** (una operación de negocio por clase — SRP), **Strategy**
  (exportadores PDF/Excel — OCP), **Adapter** (PipeValidacionZod, AdaptadorHashBcrypt),
  **Unit of Work** (transacciones atómicas de stock), **Guard/Decorator** (@Roles — control
  de acceso declarativo). Convención de comentarios: TSDoc obligatorio en casos de uso,
  puertos y controladores con referencia `FR-###` (trazabilidad spec ↔ código, requisito
  del dueño). Reglas completas y ejemplos en [docs/arquitectura.md](../../docs/arquitectura.md).
- **Alternatives considered**: estructura por módulos técnicos Nest clásica
  (controllers/services/entities por módulo — mezcla reglas de negocio con framework);
  clean architecture de 5+ anillos (más ceremonia sin beneficio a esta escala).

## R14. Monorepo y comunicación frontend ↔ backend

- **Decision**: npm workspaces (`backend/`, `frontend/`, `packages/compartido`).
  `@trazo/compartido` se compila a `dist/` (script `postinstall` de la raíz) y lo importan
  ambas apps. El frontend NO llama al backend directamente desde el navegador: Next.js
  define `rewrites` de `/api/*` → `http://localhost:4000/api/*` (configurable con
  `BACKEND_URL`), de modo que las cookies httpOnly son first-party y no hay CORS. Puertos:
  frontend :3000, backend :4000.
- **Rationale**: un solo repositorio y un `npm install` (desarrollador solo); contrato
  compartido sin publicar paquetes; el proxy elimina la clase entera de bugs de
  CORS/SameSite.
- **Alternatives considered**: repos separados (fricción de sincronización del contrato);
  CORS con credenciales (funciona, pero exige configuración fina en cada despliegue);
  Turborepo/Nx (tooling extra innecesario a esta escala — Principio V).

## R15. Carga masiva de inventario (US8): reutilizar el flujo de ingresos, no un movimiento nuevo

- **Decision** (agregada 2026-08-11, a pedido directo del dueño del proyecto — fuera del
  plan original de historias): la carga masiva desde Excel, cuando trae cantidad inicial
  para un producto, NO introduce un tercer `documento_tipo`/tipo de movimiento propio.
  Compone el flujo atómico YA EXISTENTE de `RepositorioIngresos` (`crear` + `.recibir`,
  research R4): agrupa todas las filas válidas con `cantidadInicial > 0` del archivo en un
  único `Ingreso` sintético (`proveedor = 'Carga masiva de inventario'`) y lo recibe como
  cualquier ingreso manual — mismo `FOR UPDATE`, mismo movimiento `ENTRADA`, misma
  auditoría. El alta/actualización del catálogo (SKU/descripción/categoría/ubicación/
  umbral) es una escritura aparte, no transaccional, idéntica en espíritu al alta rápida de
  producto que ya existe desde ingresos (US1) — ocurre ANTES de armar el `Ingreso` sintético.
- **Rationale**: `movimientos_inventario.documento_tipo` es `ENUM INGRESO/SALIDA`
  (data-model.md) — cerrado a propósito porque cada fila de ese historial debe señalar un
  documento real y consultable, no un movimiento huérfano. Reutilizar el camino de US1 evita
  duplicar la lógica de bloqueo de filas / cálculo de `ultimo_costo` / inserción de
  movimientos que ya está implementada y probada (Principio V, YAGNI: ningún requisito pide
  un mecanismo de mutación de stock distinto, solo un origen de captura distinto —Excel en
  vez de un formulario—).
- **Alternatives considered**: nuevo tipo `AJUSTE_CARGA_MASIVA` en el ENUM de movimientos
  (duplica la orquestación transaccional de `RepositorioIngresos.recibir` casi línea por
  línea, sin beneficio real); una tabla `documento_tipo = 'IMPORTACION'` con su propia
  cabecera (sobre-ingeniería para lo que en esencia ES un ingreso — mismo criterio contable:
  entra mercancía, sube el stock, alguien lo autoriza); background job/cola de procesamiento
  para el archivo (innecesario a la escala documentada, spec.md § Assumptions: máx. 2.000
  filas — procesamiento síncrono dentro del propio request es suficiente).
- **Trade-off aceptado, documentado**: si el catálogo se actualiza pero `recibir()` falla
  por una causa ajena a mitad de archivo, los productos quedan creados/actualizados sin su
  stock de esa corrida — recuperable resubiendo el mismo archivo (ver data-model.md §
  Carga masiva de inventario para el detalle).

## R16. Permisos como datos (US9): catálogo sembrado + roles administrables

- **Decision** (agregada 2026-08-11, a pedido directo del dueño del proyecto): el control de
  acceso deja de basarse en una lista de roles fija en el código (`@Roles('ADMINISTRADOR',
  'GERENTE')`) y pasa a resolverse contra PERMISOS almacenados en BD
  (`roles` ⋈ `roles_permisos` ⋈ `permisos`), con `usuarios.rol_id` como FK. Tres decisiones
  finas dentro de esa dirección:
  1. **El catálogo de `permisos` se siembra desde el código y es de solo lectura en la UI**;
     lo que el Administrador gestiona es la MATRIZ rol↔permiso y el CRUD de roles.
  2. **`@Roles(...)` se reemplaza por completo** por `@RequierePermiso('modulo.accion')` en
     una sola pasada — no se mantienen los dos mecanismos en paralelo.
  3. **Los 3 roles actuales se siembran como roles del sistema** (`es_sistema = true`) con
     EXACTAMENTE los permisos que hoy concede su decorador, de modo que el comportamiento
     observable no cambie el día de la migración (FR-059/SC-013).
- **Rationale**:
  1. Un permiso sin código detrás es una casilla que el usuario marca creyendo que concede
     algo, y no concede nada — peor que no ofrecer la opción. La lista de permisos es, en
     esencia, una enumeración del código; su ciclo de vida es el del despliegue, no el de la
     operación diaria. El valor real que pidió el dueño ("asignar permisos a un rol") está
     100% cubierto por la matriz rol↔permiso, que sí es dato operativo.
  2. Convivir `@Roles` y `@RequierePermiso` dejaría dos fuentes de verdad de autorización y
     la duda permanente de cuál gana en cada endpoint — exactamente el tipo de ambigüedad que
     la constitución prohíbe en el control de acceso (Principio III). La red de seguridad
     para hacer el reemplazo de una sola vez ya existe: las suites de integración cubren
     401/403 endpoint por endpoint y rol por rol (SC-013 exige que pasen SIN tocar sus
     aserciones).
  3. Sembrar los 3 roles con sus permisos actuales convierte una migración de seguridad
     (peligrosa por naturaleza) en un cambio de mecanismo verificable: si algún permiso
     quedó mal mapeado, una prueba de 403 existente falla inmediatamente.
- **Alternatives considered**: *CRUD libre de permisos* (descartado, ver rationale 1);
  *permisos directamente por usuario, sin roles* (más granular pero inmanejable a mano en una
  organización pequeña, y el requisito pedido es explícitamente "asignar permisos a un rol");
  *mantener `@Roles` y añadir permisos solo para los módulos nuevos* (deja el sistema con dos
  modelos de autorización conviviendo, ver rationale 2); *cachear los permisos en el JWT*
  (descartado: haría que un cambio de permisos no surtiera efecto hasta el siguiente login,
  violando US9-AS3 — el guard ya consulta el usuario en BD en cada petición para revalidar su
  estado, así que resolver ahí también sus permisos no agrega una consulta nueva).
- **Riesgo principal y su mitigación**: dejar la organización sin nadie que pueda administrar
  (rol borrado, permiso de gestión removido del último rol que lo tenía). Se mitiga con los
  invariantes de FR-057, verificados en el caso de uso y cubiertos por pruebas de integración
  dedicadas — misma familia que el bloqueo de auto-desactivación de US6.
