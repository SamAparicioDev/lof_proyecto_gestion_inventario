/**
 * Semilla de datos de Trazo (tareas T017/T018/T067/T100 — research.md R12/R16, FR-005,
 * FR-039…FR-044, FR-054…FR-059).
 *
 * Qué hace y por qué:
 * - SIEMPRE siembra el CATÁLOGO DE PERMISOS y los TRES ROLES DEL SISTEMA con su matriz de
 *   permisos (T100) — ver `sembrarRolesYPermisos`, que lleva la tabla rol→permisos completa.
 *   Va primero que nada: `usuarios.rol_id` es NOT NULL, así que sin roles no hay usuarios.
 * - SIEMPRE crea (o actualiza, vía upsert por `login`) el usuario Administrador inicial a
 *   partir de variables de entorno (`SEED_ADMIN_LOGIN`/`SEED_ADMIN_PASSWORD`, ver
 *   `backend/.env.example`) — es el único punto de entrada a un despliegue nuevo: el alta
 *   de usuarios es exclusiva del rol Administrador (FR-005), así que el primero debe
 *   existir de antemano. Nace con `debeCambiarPassword = true`: la contraseña definitiva
 *   se fija en el primer login (middleware de frontend + `PUT /api/auth/password`, T016).
 * - Con el flag `--demo` (SOLO desarrollo — jamás en producción) crea además:
 *   1. `gerente.demo` (GERENTE) y `operario.demo` (OPERARIO) con la contraseña
 *      `SEED_DEMO_PASSWORD`, para poder operar el MVP con los tres roles antes de que exista
 *      la administración de usuarios (US6).
 *   2. (T067) El escenario de negocio "Jumbo": 2 productos, 2 ingresos RECIBIDOS, un cliente
 *      con 2 proyectos y 5 salidas repartidas en sus 4 estados posibles — ver
 *      `sembrarDatosNegocioDemo` para los totales EXACTOS que `T073`
 *      (`backend/test/integracion/reportes-consumo.spec.ts`) asertará contra este seed.
 *
 * Idempotencia — usuarios: `upsert` por `login` — correr el seed varias veces (p. ej. tras
 * `prisma migrate reset` en integración/E2E) nunca duplica usuarios ni falla por violar la
 * UNIQUE de `login`. Cada corrida resincroniza el hash/nombre/email/rol al valor de las
 * variables de entorno vigentes; NO vuelve a forzar `debeCambiarPassword = true` en un
 * usuario ya existente (solo se fija así en la creación) para no invalidar el cambio de
 * contraseña que un administrador real ya haya hecho.
 *
 * Idempotencia — datos de negocio ("Jumbo", T067): a diferencia de los usuarios, este bloque
 * NO usa upsert campo a campo. Son ~15 filas entrelazadas (productos, cliente, proyectos,
 * ingresos+detalles, salidas+detalles, movimientos INMUTABLES — Principio II) con varias
 * UNIQUE (sku, nit, numeroFactura, numero de salida) y un correlativo compartido
 * (`contadores.salida`) que NO debe incrementarse de más si el bloque se reintenta. La
 * decisión (tomada aquí, documentada porque no había un patrón previo para este caso): un
 * ÚNICO guard de idempotencia AL INICIO del bloque — si el producto `CEM-001` ya existe, se
 * asume que todo el escenario "Jumbo" ya se sembró antes y se omite el bloque COMPLETO (log
 * informativo, sin error). Esto evita tanto duplicar filas como "quemar" correlativos de
 * salida de más en corridas repetidas contra la misma BD de desarrollo — el escenario nunca
 * cambia entre corridas, así que "ya existe" y "está completo" son equivalentes en la
 * práctica. Todo el bloque va dentro de un único `prisma.$transaction` (todo o nada): si algo
 * falla a la mitad, no queda un "Jumbo" parcial que el guard de idempotencia no reconozca en
 * el siguiente intento.
 */
import { Prisma, PrismaClient, type Usuario } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Costo de bcrypt para todas las contraseñas semilla (research R6/R12: bcryptjs costo 12). */
const COSTO_BCRYPT = 12;

interface UsuarioSemilla {
  login: string;
  password: string;
  nombreCompleto: string;
  email: string;
  /** Nombre del rol en `roles` — uno de los tres del sistema (ver `ROLES_DEL_SISTEMA`). */
  rol: string;
}

// ============================================================================
// T100 — Catálogo de permisos y roles del sistema (US9, FR-054…FR-059, research R16)
// ============================================================================

/**
 * CATÁLOGO DE PERMISOS — de SOLO LECTURA desde la aplicación (FR-056): se define aquí, en el
 * código, y se versiona con él. Cada entrada corresponde a UNA verificación real de
 * `backend/src/interfaces/http/*` — no hay permisos sin endpoint detrás, porque una casilla
 * que no concede nada es peor que no ofrecerla (research R16).
 *
 * Nomenclatura: `clave = modulo + '.' + accion`; `modulo` es además la clave de agrupación de
 * la pantalla de roles (T107) y la que usa `GET /api/permisos` para armar sus grupos.
 * `descripcion` es el texto en español que el Administrador lee al marcar la casilla.
 */
const PERMISOS_DEL_SISTEMA = [
  { clave: 'inventario.ver', modulo: 'inventario', descripcion: 'Consultar el inventario, la ficha de un producto y su historial de movimientos.' },
  { clave: 'inventario.ver_costos', modulo: 'inventario', descripcion: 'Consultar el historial de cambios de costo de un producto.' },

  { clave: 'productos.ver', modulo: 'productos', descripcion: 'Consultar el catálogo de productos para seleccionarlos en documentos.' },
  { clave: 'productos.crear', modulo: 'productos', descripcion: 'Dar de alta productos en el catálogo.' },
  { clave: 'productos.editar', modulo: 'productos', descripcion: 'Editar los datos de un producto del catálogo.' },
  { clave: 'productos.cambiar_estado', modulo: 'productos', descripcion: 'Activar o desactivar un producto del catálogo.' },
  { clave: 'productos.importar', modulo: 'productos', descripcion: 'Descargar la plantilla y el catálogo, y hacer carga masiva de inventario.' },

  { clave: 'clientes.ver', modulo: 'clientes', descripcion: 'Consultar clientes, su ficha y sus proyectos.' },
  { clave: 'clientes.crear', modulo: 'clientes', descripcion: 'Registrar clientes nuevos.' },
  { clave: 'clientes.editar', modulo: 'clientes', descripcion: 'Editar los datos de un cliente.' },
  { clave: 'clientes.cambiar_estado', modulo: 'clientes', descripcion: 'Activar o desactivar un cliente.' },

  { clave: 'proyectos.crear', modulo: 'proyectos', descripcion: 'Crear proyectos para un cliente.' },
  { clave: 'proyectos.editar', modulo: 'proyectos', descripcion: 'Editar los datos de un proyecto.' },
  { clave: 'proyectos.cambiar_estado', modulo: 'proyectos', descripcion: 'Cambiar el estado de un proyecto (activo, completado o suspendido).' },

  { clave: 'ingresos.ver', modulo: 'ingresos', descripcion: 'Consultar los ingresos de mercancía y su detalle.' },
  { clave: 'ingresos.crear', modulo: 'ingresos', descripcion: 'Registrar ingresos de mercancía por factura.' },
  { clave: 'ingresos.editar', modulo: 'ingresos', descripcion: 'Editar un ingreso mientras sigue pendiente.' },
  { clave: 'ingresos.recibir', modulo: 'ingresos', descripcion: 'Recibir un ingreso: suma la mercancía al inventario.' },
  { clave: 'ingresos.verificar', modulo: 'ingresos', descripcion: 'Verificar un ingreso ya recibido.' },
  { clave: 'ingresos.anular', modulo: 'ingresos', descripcion: 'Anular un ingreso, revirtiendo el stock que hubiera sumado.' },

  { clave: 'salidas.ver', modulo: 'salidas', descripcion: 'Consultar las salidas de mercancía y su detalle.' },
  { clave: 'salidas.crear', modulo: 'salidas', descripcion: 'Registrar salidas de mercancía hacia un proyecto.' },
  { clave: 'salidas.editar', modulo: 'salidas', descripcion: 'Editar una salida mientras sigue pendiente.' },
  { clave: 'salidas.confirmar', modulo: 'salidas', descripcion: 'Confirmar una salida: descuenta la mercancía del inventario.' },
  { clave: 'salidas.completar', modulo: 'salidas', descripcion: 'Marcar como completada una salida ya confirmada.' },
  { clave: 'salidas.cancelar', modulo: 'salidas', descripcion: 'Cancelar una salida pendiente, que nunca tocó el inventario.' },
  { clave: 'salidas.anular', modulo: 'salidas', descripcion: 'Anular una salida confirmada, devolviendo la mercancía al inventario.' },

  { clave: 'reportes.ver', modulo: 'reportes', descripcion: 'Consultar los reportes de consumo, inventario y movimientos.' },
  { clave: 'reportes.exportar', modulo: 'reportes', descripcion: 'Exportar los reportes a PDF y Excel.' },

  { clave: 'usuarios.gestionar', modulo: 'usuarios', descripcion: 'Administrar usuarios: alta, edición, estado y restablecimiento de contraseña.' },

  { clave: 'roles.gestionar', modulo: 'roles', descripcion: 'Administrar roles y los permisos de cada rol.' },

  // US15 (FR-088): VER el catálogo es trabajo diario —sin él no se clasifica un producto ni se
  // usa el filtro por categoría—, así que lo tienen los tres roles; administrarlo, no.
  { clave: 'categorias.ver', modulo: 'categorias', descripcion: 'Consultar el catálogo de categorías para clasificar productos y filtrar.' },
  { clave: 'categorias.gestionar', modulo: 'categorias', descripcion: 'Administrar el catálogo de categorías: alta, edición y estado.' },

  // US15 (FR-091): mismo reparto que categorías, y aquí VER pesa todavía más — el proveedor es
  // OBLIGATORIO al registrar un ingreso, así que sin este permiso el Operario no podría hacer su
  // trabajo diario. Administrar el catálogo (FR-093 incluido) sigue siendo lo restringido.
  { clave: 'proveedores.ver', modulo: 'proveedores', descripcion: 'Consultar el catálogo de proveedores para registrar ingresos y filtrar.' },
  { clave: 'proveedores.gestionar', modulo: 'proveedores', descripcion: 'Administrar el catálogo de proveedores: alta, edición y estado.' },

  // US17 (FR-101/FR-102): VER lo tienen los tres roles porque los tres pueden crear productos,
  // y desde esta historia no se crea uno sin elegir su unidad de medida.
  { clave: 'unidades_medida.ver', modulo: 'unidades_medida', descripcion: 'Consultar las unidades de medida para dar de alta productos.' },
  { clave: 'unidades_medida.gestionar', modulo: 'unidades_medida', descripcion: 'Administrar el catálogo de unidades de medida: alta, edición y estado.' },

  // US16 (FR-100): consultar y ARMAR pedidos lo pueden los tres roles —quien ve faltar la
  // mercancía es quien arma la orden—, pero enviar y anular comprometen o liberan un gasto
  // frente a un tercero, así que quedan en Administrador y Gerente.
  { clave: 'ordenes_compra.ver', modulo: 'ordenes_compra', descripcion: 'Consultar las órdenes de compra y su detalle.' },
  { clave: 'ordenes_compra.crear', modulo: 'ordenes_compra', descripcion: 'Crear órdenes de compra en borrador.' },
  { clave: 'ordenes_compra.editar', modulo: 'ordenes_compra', descripcion: 'Editar una orden de compra mientras sigue en borrador.' },
  { clave: 'ordenes_compra.enviar', modulo: 'ordenes_compra', descripcion: 'Marcar una orden como enviada al proveedor: compromete el gasto.' },
  { clave: 'ordenes_compra.anular', modulo: 'ordenes_compra', descripcion: 'Anular una orden de compra indicando el motivo.' },
  // US21 (FR-117) — cotizaciones: el espejo de las órdenes de compra mirando al cliente.
  { clave: 'cotizaciones.ver', modulo: 'cotizaciones', descripcion: 'Consultar las cotizaciones y su detalle.' },
  { clave: 'cotizaciones.crear', modulo: 'cotizaciones', descripcion: 'Crear cotizaciones en borrador.' },
  { clave: 'cotizaciones.editar', modulo: 'cotizaciones', descripcion: 'Editar una cotización mientras sigue en borrador.' },
  { clave: 'cotizaciones.enviar', modulo: 'cotizaciones', descripcion: 'Marcar una cotización como enviada al cliente: compromete el precio ofrecido.' },
  { clave: 'cotizaciones.cerrar', modulo: 'cotizaciones', descripcion: 'Registrar la respuesta del cliente: aceptar (genera la salida) o rechazar.' },
  { clave: 'cotizaciones.anular', modulo: 'cotizaciones', descripcion: 'Anular una cotización indicando el motivo.' },
] as const;

/**
 * Permisos del rol OPERARIO: EXACTAMENTE los endpoints que hoy declaran
 * `@Roles('ADMINISTRADOR','GERENTE','OPERARIO')`. Se enumera este rol (y no los otros dos)
 * porque es el único cuyo conjunto no se deduce por diferencia — ver la tabla de abajo.
 */
const PERMISOS_OPERARIO = [
  'inventario.ver',
  'productos.ver',
  'productos.crear',
  'categorias.ver',
  'proveedores.ver',
  'unidades_medida.ver',
  'ordenes_compra.ver',
  'ordenes_compra.crear',
  'ordenes_compra.editar',
  'cotizaciones.ver',
  'cotizaciones.crear',
  'cotizaciones.editar',
  'clientes.ver',
  'ingresos.ver',
  'ingresos.crear',
  'ingresos.editar',
  'ingresos.recibir',
  'salidas.ver',
  'salidas.crear',
  'salidas.editar',
  'salidas.confirmar',
  'salidas.completar',
  'salidas.cancelar',
] as const;

/** Permisos que el rol GERENTE NO tiene: la administración del sistema es del Administrador
 *  (hoy, `@Roles('ADMINISTRADOR')` a nivel de clase en `ControladorUsuarios`). */
const PERMISOS_EXCLUSIVOS_ADMINISTRADOR = ['usuarios.gestionar', 'roles.gestionar'] as const;

/**
 * ════════════════════════════════════════════════════════════════════════════════════════
 * TABLA DE MAPEO ROL → PERMISOS (base de SC-013 — auditar aquí)
 * ════════════════════════════════════════════════════════════════════════════════════════
 *
 * Cada rol del sistema recibe EXACTAMENTE los permisos que su `@Roles(...)` concedía el día
 * de la migración (FR-059): si una sola casilla quedara mal, una prueba de 403 preexistente
 * fallaría — y la conclusión correcta sería corregir ESTA tabla, nunca la prueba (SC-013).
 *
 * Leyenda: A = Administrador · G = Gerente · O = Operario
 *
 * | Permiso                    | A | G | O | Endpoint(s) que lo consumen                                        |
 * |----------------------------|---|---|---|--------------------------------------------------------------------|
 * | inventario.ver             | ✔ | ✔ | ✔ | GET /api/inventario · /:productoId · /:productoId/movimientos       |
 * | inventario.ver_costos      | ✔ | ✔ | — | GET /api/inventario/:productoId/historial-costos (US12)             |
 * | productos.ver              | ✔ | ✔ | ✔ | GET /api/productos                                                 |
 * | productos.crear            | ✔ | ✔ | ✔ | POST /api/productos                                                |
 * | productos.editar           | ✔ | ✔ | — | PUT /api/productos/:id                                             |
 * | productos.cambiar_estado   | ✔ | ✔ | — | PUT /api/productos/:id/estado                                      |
 * | productos.importar         | ✔ | ✔ | — | GET plantilla-importacion · GET catalogo-importacion · POST importar|
 * | clientes.ver               | ✔ | ✔ | ✔ | GET /api/clientes · /:id · /:id/proyectos-destino                   |
 * | clientes.crear             | ✔ | ✔ | — | POST /api/clientes                                                 |
 * | clientes.editar            | ✔ | ✔ | — | PUT /api/clientes/:id                                              |
 * | clientes.cambiar_estado    | ✔ | ✔ | — | PUT /api/clientes/:id/estado                                       |
 * | proyectos.crear            | ✔ | ✔ | — | POST /api/clientes/:id/proyectos                                   |
 * | proyectos.editar           | ✔ | ✔ | — | PUT /api/proyectos/:id                                             |
 * | proyectos.cambiar_estado   | ✔ | ✔ | — | PUT /api/proyectos/:id/estado                                      |
 * | ingresos.ver               | ✔ | ✔ | ✔ | GET /api/ingresos · /:id                                           |
 * | ingresos.crear             | ✔ | ✔ | ✔ | POST /api/ingresos                                                 |
 * | ingresos.editar            | ✔ | ✔ | ✔ | PUT /api/ingresos/:id                                              |
 * | ingresos.recibir           | ✔ | ✔ | ✔ | POST /api/ingresos/:id/recibir                                     |
 * | ingresos.verificar         | ✔ | ✔ | — | POST /api/ingresos/:id/verificar                                   |
 * | ingresos.anular            | ✔ | ✔ | — | POST /api/ingresos/:id/anular                                      |
 * | salidas.ver                | ✔ | ✔ | ✔ | GET /api/salidas · /:id                                            |
 * | salidas.crear              | ✔ | ✔ | ✔ | POST /api/salidas                                                  |
 * | salidas.editar             | ✔ | ✔ | ✔ | PUT /api/salidas/:id                                               |
 * | salidas.confirmar          | ✔ | ✔ | ✔ | POST /api/salidas/:id/confirmar                                    |
 * | salidas.completar          | ✔ | ✔ | ✔ | POST /api/salidas/:id/completar                                    |
 * | salidas.cancelar           | ✔ | ✔ | ✔ | POST /api/salidas/:id/cancelar                                     |
 * | salidas.anular             | ✔ | ✔ | — | POST /api/salidas/:id/anular                                       |
 * | reportes.ver               | ✔ | ✔ | — | GET /api/reportes/{consumo-cliente,consumo-proyecto,inventario,movimientos} |
 * | reportes.exportar          | ✔ | ✔ | — | GET /api/reportes/**\/export (los 4)                                |
 * | usuarios.gestionar         | ✔ | — | — | TODO /api/usuarios (@Roles a nivel de clase)                        |
 * | roles.gestionar            | ✔ | — | — | /api/roles (CRUD) · GET /api/permisos — los crea T106               |
 * | categorias.ver             | ✔ | ✔ | ✔ | GET /api/categorias (US15 — clasificar y filtrar es trabajo diario) |
 * | categorias.gestionar       | ✔ | ✔ | — | POST/PUT/DELETE /api/categorias (US15)                              |
 * | proveedores.ver            | ✔ | ✔ | ✔ | GET /api/proveedores (US15 — el proveedor es OBLIGATORIO al ingresar)|
 * | proveedores.gestionar      | ✔ | ✔ | — | POST/PUT/DELETE /api/proveedores (US15)                             |
 * | unidades_medida.ver        | ✔ | ✔ | ✔ | GET /api/unidades-medida (US17 — obligatoria al crear un producto)  |
 * | unidades_medida.gestionar  | ✔ | ✔ | — | POST/PUT/DELETE /api/unidades-medida (US17)                         |
 * | ordenes_compra.ver         | ✔ | ✔ | ✔ | GET /api/ordenes-compra · /:id · /export (US16)                     |
 * | ordenes_compra.crear       | ✔ | ✔ | ✔ | POST /api/ordenes-compra · GET /sugerencias (US16)                  |
 * | ordenes_compra.editar      | ✔ | ✔ | ✔ | PUT /api/ordenes-compra/:id (US16)                                  |
 * | ordenes_compra.enviar      | ✔ | ✔ | — | POST /api/ordenes-compra/:id/enviar (US16)                          |
 * | ordenes_compra.anular      | ✔ | ✔ | — | POST /api/ordenes-compra/:id/anular (US16)                          |
 * | cotizaciones.ver           | ✔ | ✔ | ✔ | GET /api/cotizaciones · /:id · /export (US21)                       |
 * | cotizaciones.crear         | ✔ | ✔ | ✔ | POST /api/cotizaciones (US21)                                       |
 * | cotizaciones.editar        | ✔ | ✔ | ✔ | PUT /api/cotizaciones/:id (US21)                                    |
 * | cotizaciones.enviar        | ✔ | ✔ | — | POST /api/cotizaciones/:id/enviar (US21)                            |
 * | cotizaciones.cerrar        | ✔ | ✔ | — | POST /api/cotizaciones/:id/{aceptar,rechazar} (US21)                |
 * | cotizaciones.anular        | ✔ | ✔ | — | POST /api/cotizaciones/:id/anular (US21)                            |
 *
 * TOTALES: Administrador 48 · Gerente 46 · Operario 23 (de 48 permisos del catálogo).
 * (Eran 31/29/14 sobre 31 hasta US12; US15 agrega los cuatro de los catálogos, US16 los cinco
 * de órdenes de compra y US17 los dos de unidades de medida. Ninguno recorta nada de lo que ya tenía un rol — SC-013 se conserva
 * intacto, misma lectura que la nota de `inventario.ver_costos` de más abajo.)
 *
 * Nota sobre `roles.gestionar`: es el único permiso cuyo endpoint todavía no existe (llega en
 * T106). No es un permiso especulativo — el contrato ya lo exige para toda la sección "Roles y
 * permisos" de api-rest.md y FR-057 lo nombra como el permiso que no puede quedarse sin dueño.
 *
 * Nota sobre `inventario.ver_costos` (US12/T127, el único permiso agregado DESPUÉS de la
 * migración de US9): es nuevo, no un recorte de nada — no le quita capacidades a ningún rol
 * existente, así que SC-013 se conserva intacto. Lo reciben Administrador y Gerente por la
 * regla general de esta tabla (todo lo que no es exclusivo del Administrador), que es
 * exactamente lo que el contrato pide (A,G); Operario NO lo recibe: el historial de precios es
 * información de valorización, mismo alcance que `reportes.ver`. La migración
 * `20260812150000_historial_costos_producto` inserta el permiso y esta misma matriz en las
 * bases ya existentes.
 * ════════════════════════════════════════════════════════════════════════════════════════
 */
const ROLES_DEL_SISTEMA: { nombre: string; descripcion: string; permisos: readonly string[] }[] = [
  {
    nombre: 'Administrador',
    descripcion: 'Gestión total del sistema, incluidos usuarios, roles y permisos.',
    permisos: PERMISOS_DEL_SISTEMA.map((permiso) => permiso.clave),
  },
  {
    nombre: 'Gerente',
    descripcion: 'Operación completa de inventario, clientes, proyectos y reportes.',
    permisos: PERMISOS_DEL_SISTEMA.map((permiso) => permiso.clave).filter(
      (clave) => !(PERMISOS_EXCLUSIVOS_ADMINISTRADOR as readonly string[]).includes(clave),
    ),
  },
  {
    nombre: 'Operario',
    descripcion: 'Registro de entradas y salidas de mercancía y consultas básicas.',
    permisos: PERMISOS_OPERARIO,
  },
];

/**
 * Siembra el catálogo de permisos, los tres roles del sistema y su matriz rol↔permiso
 * (T100/FR-056/FR-059). La migración `20260812090000_roles_permisos_como_datos` ya insertó
 * exactamente lo mismo; esta función es la que MANTIENE ese estado al día cuando el código
 * agrega endpoints (permiso nuevo → siguiente corrida del seed lo inserta) y la que garantiza
 * el resultado en una base recreada desde cero.
 *
 * IDEMPOTENCIA (el seed se corre varias veces):
 * - Permisos: `upsert` por `clave` — resincroniza `modulo`/`descripcion` con el código, que es
 *   su fuente de verdad (FR-056), sin duplicar filas ni cambiar ids ya referenciados.
 * - Roles del sistema: `upsert` por `nombre`, forzando `esSistema = true`. NO toca `estado`
 *   en un rol ya existente: desactivar un rol es una decisión operativa legítima del
 *   Administrador (baja lógica, data-model.md § roles) y el seed no debe revertirla a
 *   espaldas de nadie.
 * - Matriz: ADITIVA (`createMany` + `skipDuplicates`), nunca borra. Dos consecuencias
 *   deliberadas: (1) los permisos que un Administrador AGREGÓ a un rol del sistema se
 *   conservan; (2) los que QUITÓ se restauran en la siguiente corrida, porque esta tabla es
 *   la definición de fábrica de esos tres roles (FR-059) y correr el seed es pedir esa línea
 *   base. Los roles creados por el Administrador (`esSistema = false`) no se tocan jamás.
 */
async function sembrarRolesYPermisos(): Promise<void> {
  for (const permiso of PERMISOS_DEL_SISTEMA) {
    await prisma.permiso.upsert({
      where: { clave: permiso.clave },
      update: { modulo: permiso.modulo, descripcion: permiso.descripcion },
      create: { clave: permiso.clave, modulo: permiso.modulo, descripcion: permiso.descripcion },
    });
  }

  for (const rolSemilla of ROLES_DEL_SISTEMA) {
    const rol = await prisma.rol.upsert({
      where: { nombre: rolSemilla.nombre },
      update: { descripcion: rolSemilla.descripcion, esSistema: true },
      create: { nombre: rolSemilla.nombre, descripcion: rolSemilla.descripcion, esSistema: true },
    });

    const permisos = await prisma.permiso.findMany({
      where: { clave: { in: [...rolSemilla.permisos] } },
      select: { id: true },
    });
    if (permisos.length !== rolSemilla.permisos.length) {
      throw new Error(
        `El rol semilla "${rolSemilla.nombre}" referencia ${rolSemilla.permisos.length} permisos ` +
          `pero solo ${permisos.length} existen en el catálogo: revisa PERMISOS_DEL_SISTEMA.`,
      );
    }

    await prisma.rolPermiso.createMany({
      data: permisos.map((permiso) => ({ rolId: rol.id, permisoId: permiso.id })),
      skipDuplicates: true,
    });
  }

  console.log(
    `Roles y permisos listos: ${PERMISOS_DEL_SISTEMA.length} permisos y ${ROLES_DEL_SISTEMA.length} ` +
      `roles del sistema (${ROLES_DEL_SISTEMA.map((rol) => `${rol.nombre}=${rol.permisos.length}`).join(', ')}).`,
  );
}

/** Lee y valida las variables de entorno del Administrador semilla. */
function leerVariablesAdmin(): UsuarioSemilla {
  const login = process.env.SEED_ADMIN_LOGIN;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!login || !password) {
    throw new Error(
      'SEED_ADMIN_LOGIN y SEED_ADMIN_PASSWORD son obligatorias para crear el Administrador ' +
        'semilla (copia backend/.env.example a backend/.env y ajusta los valores).',
    );
  }
  return {
    login,
    password,
    nombreCompleto: process.env.SEED_ADMIN_NOMBRE ?? 'Administrador',
    email: process.env.SEED_ADMIN_EMAIL ?? `${login}@trazo.local`,
    rol: 'Administrador',
  };
}

/** Arma los dos usuarios de demostración (Gerente y Operario) a partir de `SEED_DEMO_PASSWORD`. */
function leerUsuariosDemo(): UsuarioSemilla[] {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) {
    throw new Error(
      'SEED_DEMO_PASSWORD es obligatoria para usar --demo (ver backend/.env.example).',
    );
  }
  return [
    {
      login: 'gerente.demo',
      password,
      nombreCompleto: 'Gerente Demo',
      email: 'gerente.demo@trazo.local',
      rol: 'Gerente',
    },
    {
      login: 'operario.demo',
      password,
      nombreCompleto: 'Operario Demo',
      email: 'operario.demo@trazo.local',
      rol: 'Operario',
    },
  ];
}

/**
 * Crea o actualiza (upsert por `login`) un usuario semilla con la contraseña ya hasheada.
 * `debeCambiarPassword` solo se fija en `true` al CREAR — un usuario existente conserva su
 * estado real (pudo haberlo cambiado ya en el primer login). Devuelve el registro (T067 lo
 * usa para leer el `id` del Administrador y poblar la auditoría del escenario "Jumbo").
 */
async function upsertUsuarioSemilla(datos: UsuarioSemilla): Promise<Usuario> {
  const passwordHash = await bcrypt.hash(datos.password, COSTO_BCRYPT);
  // `connect` por `roles.nombre` (UNIQUE): resuelve la FK `usuarios.rol_id` en la misma
  // sentencia, sin consultar el id por separado (US9/T099 — el enum `rol` ya no existe).
  const rol = { connect: { nombre: datos.rol } };
  const usuario = await prisma.usuario.upsert({
    where: { login: datos.login },
    update: {
      passwordHash,
      nombreCompleto: datos.nombreCompleto,
      email: datos.email,
      rol,
    },
    create: {
      login: datos.login,
      passwordHash,
      nombreCompleto: datos.nombreCompleto,
      email: datos.email,
      rol,
      debeCambiarPassword: true,
    },
  });
  console.log(`Usuario semilla listo: ${datos.login} (${datos.rol})`);
  return usuario;
}

// ============================================================================
// T067 — Escenario de negocio demo "Jumbo" (US4: reportes de consumo, FR-039…FR-044)
// ============================================================================

/**
 * Datos fijos del escenario "Jumbo" — agrupados aquí para no repetir números mágicos sueltos
 * en `sembrarDatosNegocioDemo`. Los precios de línea de SALIDA (25000/18000) y las cantidades
 * son los que fija el enunciado de T067; el precio de INGRESO es solo una referencia de costo
 * (no participa en ningún cálculo de reporte de consumo — FR-044 solo mira salidas).
 */
const DEMO_JUMBO = {
  cliente: { nombre: 'Jumbo', nit: '900123456-1' },
  proyectoNorte: { nombre: 'Remodelación Bodega Norte', presupuestoEstimado: 10_000_000 },
  proyectoSur: { nombre: 'Instalación Bodega Sur', presupuestoEstimado: null as number | null },
  cemento: {
    sku: 'CEM-001',
    descripcion: 'Cemento gris 50kg',
    umbralStockBajo: 50,
    cantidadIngreso: 500,
    precioIngreso: 20_000,
    precioSalida: 25_000,
  },
  varilla: {
    sku: 'VAR-001',
    descripcion: 'Varilla 3/8 x 6m',
    umbralStockBajo: 30,
    cantidadIngreso: 200,
    precioIngreso: 15_000,
    precioSalida: 18_000,
  },
} as const;

// Fechas fijas del escenario (todas en el pasado respecto a cualquier corrida real de este
// seed) — en orden cronológico: ingresos primero, luego las salidas de cada proyecto.
const FECHA_INGRESOS = new Date('2026-07-10');
const FECHA_SALIDA_CONFIRMADA_NORTE = new Date('2026-07-15');
const FECHA_SALIDA_ANULADA_NORTE = new Date('2026-07-16');
const FECHA_SALIDA_CONFIRMADA_SUR = new Date('2026-07-18');
const FECHA_SALIDA_COMPLETADA_NORTE = new Date('2026-07-20');
const FECHA_SALIDA_PENDIENTE_NORTE = new Date('2026-07-25');

// ============================================================================
// Catálogo de proveedores (US15, FR-091…FR-093)
// ============================================================================

/**
 * Proveedor del sistema (FR-093): el que la carga masiva usa para su ingreso sintético.
 *
 * La migración `20260815010000_proveedores_como_catalogo` ya lo crea en toda base que estuviera
 * EN USO, pero en una base recién creada las migraciones corren antes que la semilla y todavía
 * no hay ningún usuario al que apuntar en `usuario_creacion_id`. Ese caso lo cubre esta función:
 * sin ella, la primera carga masiva de una instalación nueva fallaría diciendo que el proveedor
 * no existe. Idempotente — si ya está, solo se asegura de que quede marcado como del sistema.
 */
const PROVEEDOR_DEL_SISTEMA = 'Carga masiva de inventario';

/**
 * Busca un proveedor por nombre NORMALIZADO y lo crea si no existe (US15, FR-091).
 *
 * Se busca con SQL crudo por el mismo motivo que en `sembrarDemoFormex` con las categorías: el
 * índice único de la tabla es funcional (`lower(btrim(nombre))`) y Prisma no sabe consultar por
 * una expresión indexada, así que un `findUnique` por nombre literal no encontraría "formex " y
 * el `create` posterior chocaría contra el índice.
 */
async function asegurarProveedor(nombre: string, adminId: bigint, esSistema = false): Promise<bigint> {
  const normalizado = nombre.trim().toLocaleLowerCase('es');
  const existentes = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM proveedores WHERE lower(btrim(nombre)) = ${normalizado} LIMIT 1
  `;
  if (existentes[0]) return existentes[0].id;

  const creado = await prisma.proveedor.create({
    data: { nombre, esSistema, usuarioCreacionId: adminId },
    select: { id: true },
  });
  return creado.id;
}

async function sembrarProveedorDelSistema(adminId: bigint): Promise<void> {
  const id = await asegurarProveedor(PROVEEDOR_DEL_SISTEMA, adminId, true);
  // Si la fila venía de la migración (creada al convertir ingresos previos) puede existir sin la
  // marca; se fija aquí para que el bloqueo de FR-093 aplique en cualquier camino de llegada.
  await prisma.proveedor.update({ where: { id }, data: { esSistema: true } });
  console.log(`Proveedor del sistema "${PROVEEDOR_DEL_SISTEMA}" listo (FR-093).`);
}

// ============================================================================
// Escenario demo "Formex / Compresores" (US15) — catálogo de categorías en uso
// ============================================================================

/**
 * Segundo escenario demo, añadido con US15 para que el catálogo de categorías tenga datos
 * reales con los que probarse: una categoría ("Compresores"), un proveedor ("Formex") y cinco
 * productos clasificados con ella, que entran al inventario por un ingreso RECIBIDO real.
 *
 * Entran por un ingreso y no con `stockActual` a mano a propósito: el stock de este sistema
 * solo se mueve con documentos (Principio I), así que sembrar existencias por la puerta de
 * atrás produciría productos cuyo stock no cuadra con sus movimientos — justo el invariante
 * que las pruebas de conciliación verifican.
 *
 * Desde T157-T163 el proveedor es una fila del CATÁLOGO, no un texto: "Formex" se resuelve (o
 * se crea) con `asegurarProveedor` y el ingreso apunta a su id (FR-091). En las bases que ya
 * tenían este escenario sembrado, la migración `20260815010000_proveedores_como_catalogo`
 * convirtió ese texto en la fila equivalente sin intervención (FR-092).
 *
 * Idempotente por SKU, mismo criterio que `sembrarDatosNegocioDemo`.
 */
const DEMO_FORMEX = {
  categoria: 'Compresores',
  proveedor: 'Formex',
  numeroFactura: 'FC-FORMEX-0001',
  productos: [
    { sku: 'CMP-100', descripcion: 'Compresor de pistón 100 L 2 HP', umbral: 2, cantidad: 12, precio: 1_850_000 },
    { sku: 'CMP-200', descripcion: 'Compresor de tornillo 7.5 HP', umbral: 1, cantidad: 4, precio: 12_400_000 },
    { sku: 'CMP-300', descripcion: 'Compresor portátil 24 L 1 HP', umbral: 5, cantidad: 20, precio: 690_000 },
    { sku: 'CMP-400', descripcion: 'Compresor de tornillo 15 HP con secador', umbral: 1, cantidad: 2, precio: 23_900_000 },
    { sku: 'CMP-500', descripcion: 'Compresor odontológico libre de aceite 50 L', umbral: 2, cantidad: 6, precio: 3_150_000 },
  ],
} as const;

const FECHA_INGRESO_FORMEX = new Date('2026-08-01');

async function sembrarDemoFormex(adminId: bigint): Promise<void> {
  const yaExiste = await prisma.producto.findUnique({ where: { sku: DEMO_FORMEX.productos[0].sku } });
  if (yaExiste) {
    console.log(`Datos demo "${DEMO_FORMEX.proveedor}/${DEMO_FORMEX.categoria}" ya existían — se omite el bloque.`);
    return;
  }

  // La categoría se busca por nombre normalizado antes de crearla: el índice funcional
  // `lower(btrim(nombre))` rechazaría un duplicado si alguien ya la dio de alta a mano.
  const normalizado = DEMO_FORMEX.categoria.trim().toLocaleLowerCase('es');
  const existentes = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM categorias WHERE lower(btrim(nombre)) = ${normalizado} LIMIT 1
  `;
  const categoriaId =
    existentes[0]?.id ??
    (
      await prisma.categoria.create({
        data: {
          nombre: DEMO_FORMEX.categoria,
          descripcion: 'Equipos de aire comprimido',
          usuarioCreacionId: adminId,
        },
        select: { id: true },
      })
    ).id;

  const proveedorId = await asegurarProveedor(DEMO_FORMEX.proveedor, adminId);

  const productos = await Promise.all(
    DEMO_FORMEX.productos.map((producto) =>
      prisma.producto.create({
        data: {
          sku: producto.sku,
          descripcion: producto.descripcion,
          categoriaId,
          ubicacion: 'Bodega Central',
          umbralStockBajo: producto.umbral,
          usuarioCreacionId: adminId,
        },
        select: { id: true, sku: true },
      }),
    ),
  );
  const idPorSku = new Map(productos.map((producto) => [producto.sku, producto.id]));

  const valorTotal = DEMO_FORMEX.productos.reduce((suma, p) => suma + p.cantidad * p.precio, 0);

  await prisma.$transaction(async (tx) => {
    const ingreso = await tx.ingreso.create({
      data: {
        numeroFactura: DEMO_FORMEX.numeroFactura,
        proveedorId,
        fechaFactura: FECHA_INGRESO_FORMEX,
        fechaRecepcion: FECHA_INGRESO_FORMEX,
        estado: 'RECIBIDO',
        valorTotal,
        usuarioRegistraId: adminId,
        usuarioCreacionId: adminId,
        detalles: {
          create: DEMO_FORMEX.productos.map((producto) => ({
            productoId: idPorSku.get(producto.sku)!,
            cantidad: producto.cantidad,
            precioUnitario: producto.precio,
            valorTotal: producto.cantidad * producto.precio,
          })),
        },
      },
      select: { id: true },
    });

    // Stock + movimiento + costo, en la MISMA transacción que el documento (Principio I).
    for (const producto of DEMO_FORMEX.productos) {
      const productoId = idPorSku.get(producto.sku)!;
      await tx.producto.update({
        where: { id: productoId },
        data: {
          stockActual: producto.cantidad,
          ultimoCosto: producto.precio,
          fechaUltimoMovimiento: FECHA_INGRESO_FORMEX,
        },
      });
      await tx.movimientoInventario.create({
        data: {
          productoId,
          tipo: 'ENTRADA',
          cantidad: producto.cantidad,
          // Los productos nacen en 0 en este mismo bloque, así que el stock resultante ES la
          // cantidad recibida — el invariante `stock_actual = Σ movimientos` queda cuadrado.
          stockResultante: producto.cantidad,
          fechaHora: FECHA_INGRESO_FORMEX,
          documentoTipo: 'INGRESO',
          documentoId: ingreso.id,
          usuarioId: adminId,
        },
      });
    }
  });

  console.log(
    `Demo "${DEMO_FORMEX.proveedor}": categoría "${DEMO_FORMEX.categoria}" + ` +
      `${DEMO_FORMEX.productos.length} productos con stock por el ingreso ${DEMO_FORMEX.numeroFactura}.`,
  );
}


/**
 * Siembra el escenario de negocio "Jumbo" (T067, US4): 2 productos, 2 ingresos RECIBIDOS,
 * 1 cliente con 2 proyectos y 5 salidas (2 CONFIRMADA, 1 COMPLETADA, 1 PENDIENTE, 1 ANULADA)
 * con movimientos de inventario coherentes entre sí.
 *
 * Totales EXACTOS (ya cuadrados a mano — si cambian, actualizar T073 en consecuencia):
 *
 * - CEM-001 (Cemento gris 50kg): ingreso RECIBIDO +500 → stock 500. Proyecto "Remodelación
 *   Bodega Norte": salida CONFIRMADA 100u + salida COMPLETADA 60u (ambas a 25 000/u) = 160u
 *   consumidas → stock final = 500 − 160 = 340. La salida PENDIENTE (20u) y la ANULADA (10u,
 *   llegó ahí directo desde PENDIENTE vía "cancelar") NUNCA tocaron stock (FR-044: pendientes
 *   y anuladas no cuentan como consumo, ni de valor ni de stock).
 *   Consumo del proyecto = 100×25 000 + 60×25 000 = 2 500 000 + 1 500 000 = 4 000 000.
 *   margen = 4 000 000 / presupuestoEstimado (10 000 000) = 0.4 → el frontend lo muestra "40%".
 * - VAR-001 (Varilla 3/8 x 6m): ingreso RECIBIDO +200 → stock 200. Proyecto "Instalación
 *   Bodega Sur": salida CONFIRMADA 50u a 18 000/u → stock final = 200 − 50 = 150.
 *   Consumo del proyecto = 50×18 000 = 900 000. `presupuestoEstimado = null` → margen = null
 *   (el frontend muestra "Sin presupuesto asignado", nunca "0%").
 * - Consumo TOTAL del cliente "Jumbo" = 4 000 000 + 900 000 = 4 900 000.
 *
 * Implementa: FR-039 (reporte de consumo por cliente), FR-040 (por proyecto, con margen),
 * FR-044 (solo CONFIRMADA/COMPLETADA cuentan como consumo) — datos base para T073.
 */
async function sembrarDatosNegocioDemo(adminId: bigint): Promise<void> {
  const yaExiste = await prisma.producto.findUnique({ where: { sku: DEMO_JUMBO.cemento.sku } });
  if (yaExiste) {
    console.log(
      `Datos demo de negocio ("Jumbo", ${DEMO_JUMBO.cemento.sku}/${DEMO_JUMBO.varilla.sku}) ` +
        'ya existían — se omite el bloque completo para no duplicar filas ni correlativos ' +
        '(idempotencia por SKU, ver TSDoc de sembrarDatosNegocioDemo).',
    );
    return;
  }

  // Los proveedores se resuelven ANTES de abrir la transacción: `asegurarProveedor` consulta
  // por el índice funcional del nombre y crea la fila si falta, y meterlo dentro obligaría a
  // duplicarlo con el cliente transaccional sin ganar nada — el catálogo no participa de la
  // atomicidad del escenario (US15, FR-091).
  const proveedorCemento = await asegurarProveedor('Ferretería Central Demo S.A.S.', adminId);
  const proveedorVarilla = await asegurarProveedor('Aceros y Perfiles Demo Ltda.', adminId);

  await prisma.$transaction(
    async (tx) => {
      // --- Productos (stock ya en su valor FINAL: ver totales en el TSDoc de cabecera) ---
      const cemento = await tx.producto.create({
        data: {
          sku: DEMO_JUMBO.cemento.sku,
          descripcion: DEMO_JUMBO.cemento.descripcion,
          umbralStockBajo: DEMO_JUMBO.cemento.umbralStockBajo,
          stockActual: 340,
          ultimoCosto: DEMO_JUMBO.cemento.precioIngreso,
          fechaUltimoMovimiento: FECHA_SALIDA_COMPLETADA_NORTE,
          usuarioCreacionId: adminId,
        },
      });
      const varilla = await tx.producto.create({
        data: {
          sku: DEMO_JUMBO.varilla.sku,
          descripcion: DEMO_JUMBO.varilla.descripcion,
          umbralStockBajo: DEMO_JUMBO.varilla.umbralStockBajo,
          stockActual: 150,
          ultimoCosto: DEMO_JUMBO.varilla.precioIngreso,
          fechaUltimoMovimiento: FECHA_SALIDA_CONFIRMADA_SUR,
          usuarioCreacionId: adminId,
        },
      });

      // --- Cliente y proyectos ---
      const cliente = await tx.cliente.create({
        data: {
          nombre: DEMO_JUMBO.cliente.nombre,
          nit: DEMO_JUMBO.cliente.nit,
          usuarioCreacionId: adminId,
        },
      });
      const proyectoNorte = await tx.proyecto.create({
        data: {
          clienteId: cliente.id,
          nombre: DEMO_JUMBO.proyectoNorte.nombre,
          presupuestoEstimado: DEMO_JUMBO.proyectoNorte.presupuestoEstimado,
          usuarioCreacionId: adminId,
        },
      });
      const proyectoSur = await tx.proyecto.create({
        data: {
          clienteId: cliente.id,
          nombre: DEMO_JUMBO.proyectoSur.nombre,
          presupuestoEstimado: DEMO_JUMBO.proyectoSur.presupuestoEstimado,
          usuarioCreacionId: adminId,
        },
      });

      // --- Ingresos RECIBIDOS (estado final insertado directo — sin pasar por PENDIENTE) ---
      const ingresoCemento = await tx.ingreso.create({
        data: {
          numeroFactura: 'FC-DEMO-CEM-001',
          fechaFactura: FECHA_INGRESOS,
          proveedorId: proveedorCemento,
          fechaRecepcion: FECHA_INGRESOS,
          estado: 'RECIBIDO',
          valorTotal: DEMO_JUMBO.cemento.cantidadIngreso * DEMO_JUMBO.cemento.precioIngreso,
          usuarioRegistraId: adminId,
          usuarioCreacionId: adminId,
          detalles: {
            create: [
              {
                productoId: cemento.id,
                cantidad: DEMO_JUMBO.cemento.cantidadIngreso,
                precioUnitario: DEMO_JUMBO.cemento.precioIngreso,
                valorTotal: DEMO_JUMBO.cemento.cantidadIngreso * DEMO_JUMBO.cemento.precioIngreso,
              },
            ],
          },
        },
      });
      await tx.movimientoInventario.create({
        data: {
          fechaHora: FECHA_INGRESOS,
          tipo: 'ENTRADA',
          productoId: cemento.id,
          cantidad: DEMO_JUMBO.cemento.cantidadIngreso,
          stockResultante: DEMO_JUMBO.cemento.cantidadIngreso, // stock partía en 0
          documentoTipo: 'INGRESO',
          documentoId: ingresoCemento.id,
          usuarioId: adminId,
        },
      });

      const ingresoVarilla = await tx.ingreso.create({
        data: {
          numeroFactura: 'FC-DEMO-VAR-001',
          fechaFactura: FECHA_INGRESOS,
          proveedorId: proveedorVarilla,
          fechaRecepcion: FECHA_INGRESOS,
          estado: 'RECIBIDO',
          valorTotal: DEMO_JUMBO.varilla.cantidadIngreso * DEMO_JUMBO.varilla.precioIngreso,
          usuarioRegistraId: adminId,
          usuarioCreacionId: adminId,
          detalles: {
            create: [
              {
                productoId: varilla.id,
                cantidad: DEMO_JUMBO.varilla.cantidadIngreso,
                precioUnitario: DEMO_JUMBO.varilla.precioIngreso,
                valorTotal: DEMO_JUMBO.varilla.cantidadIngreso * DEMO_JUMBO.varilla.precioIngreso,
              },
            ],
          },
        },
      });
      await tx.movimientoInventario.create({
        data: {
          fechaHora: FECHA_INGRESOS,
          tipo: 'ENTRADA',
          productoId: varilla.id,
          cantidad: DEMO_JUMBO.varilla.cantidadIngreso,
          stockResultante: DEMO_JUMBO.varilla.cantidadIngreso,
          documentoTipo: 'INGRESO',
          documentoId: ingresoVarilla.id,
          usuarioId: adminId,
        },
      });

      // --- Salidas del proyecto "Remodelación Bodega Norte" (CEM-001) ---

      // CONFIRMADA 100u → stock 500-100=400 (movimiento SALIDA, autorizada por el admin semilla).
      const numeroConfirmadaNorte = await siguienteNumeroSalida(tx);
      const salidaConfirmadaNorte = await tx.salida.create({
        data: {
          numero: BigInt(numeroConfirmadaNorte),
          fechaSalida: FECHA_SALIDA_CONFIRMADA_NORTE,
          clienteId: proyectoNorte.clienteId,
          proyectoId: proyectoNorte.id,
          estado: 'CONFIRMADA',
          valorTotal: 100 * DEMO_JUMBO.cemento.precioSalida,
          usuarioAutorizaId: adminId,
          fechaConfirmacion: FECHA_SALIDA_CONFIRMADA_NORTE,
          usuarioCreacionId: adminId,
          detalles: {
            create: [
              {
                productoId: cemento.id,
                cantidad: 100,
                precioUnitario: DEMO_JUMBO.cemento.precioSalida,
                valorTotal: 100 * DEMO_JUMBO.cemento.precioSalida,
              },
            ],
          },
        },
      });
      await tx.movimientoInventario.create({
        data: {
          fechaHora: FECHA_SALIDA_CONFIRMADA_NORTE,
          tipo: 'SALIDA',
          productoId: cemento.id,
          cantidad: 100,
          stockResultante: 400,
          documentoTipo: 'SALIDA',
          documentoId: salidaConfirmadaNorte.id,
          proyectoId: proyectoNorte.id,
          usuarioId: adminId,
        },
      });

      // ANULADA ("cancelar", PENDIENTE→ANULADA directo): 10u, JAMÁS tocó stock ni tiene
      // autorizante/fecha de confirmación (nunca pasó por CONFIRMADA).
      const numeroAnuladaNorte = await siguienteNumeroSalida(tx);
      await tx.salida.create({
        data: {
          numero: BigInt(numeroAnuladaNorte),
          fechaSalida: FECHA_SALIDA_ANULADA_NORTE,
          clienteId: proyectoNorte.clienteId,
          proyectoId: proyectoNorte.id,
          estado: 'ANULADA',
          valorTotal: 10 * DEMO_JUMBO.cemento.precioSalida,
          motivoAnulacion: 'Cancelada — pedido duplicado (dato de demostración, T067)',
          usuarioCreacionId: adminId,
          detalles: {
            create: [
              {
                productoId: cemento.id,
                cantidad: 10,
                precioUnitario: DEMO_JUMBO.cemento.precioSalida,
                valorTotal: 10 * DEMO_JUMBO.cemento.precioSalida,
              },
            ],
          },
        },
      });

      // COMPLETADA 60u → stock 400-60=340 (pasó por CONFIRMADA: el movimiento de stock ya
      // ocurrió ahí; COMPLETADA es un cierre administrativo que NO vuelve a tocar stock —
      // se inserta un único movimiento SALIDA, no dos).
      const numeroCompletadaNorte = await siguienteNumeroSalida(tx);
      const salidaCompletadaNorte = await tx.salida.create({
        data: {
          numero: BigInt(numeroCompletadaNorte),
          fechaSalida: FECHA_SALIDA_COMPLETADA_NORTE,
          clienteId: proyectoNorte.clienteId,
          proyectoId: proyectoNorte.id,
          estado: 'COMPLETADA',
          valorTotal: 60 * DEMO_JUMBO.cemento.precioSalida,
          usuarioAutorizaId: adminId,
          fechaConfirmacion: FECHA_SALIDA_COMPLETADA_NORTE,
          usuarioCreacionId: adminId,
          detalles: {
            create: [
              {
                productoId: cemento.id,
                cantidad: 60,
                precioUnitario: DEMO_JUMBO.cemento.precioSalida,
                valorTotal: 60 * DEMO_JUMBO.cemento.precioSalida,
              },
            ],
          },
        },
      });
      await tx.movimientoInventario.create({
        data: {
          fechaHora: FECHA_SALIDA_COMPLETADA_NORTE,
          tipo: 'SALIDA',
          productoId: cemento.id,
          cantidad: 60,
          stockResultante: 340,
          documentoTipo: 'SALIDA',
          documentoId: salidaCompletadaNorte.id,
          proyectoId: proyectoNorte.id,
          usuarioId: adminId,
        },
      });

      // PENDIENTE 20u: sin movimiento — una PENDIENTE nunca toca stock_actual, solo compromete
      // (agregado derivado vía RepositorioSalidas.comprometidoPorProducto, fuera de este seed).
      const numeroPendienteNorte = await siguienteNumeroSalida(tx);
      await tx.salida.create({
        data: {
          numero: BigInt(numeroPendienteNorte),
          fechaSalida: FECHA_SALIDA_PENDIENTE_NORTE,
          clienteId: proyectoNorte.clienteId,
          proyectoId: proyectoNorte.id,
          estado: 'PENDIENTE',
          valorTotal: 20 * DEMO_JUMBO.cemento.precioSalida,
          usuarioCreacionId: adminId,
          detalles: {
            create: [
              {
                productoId: cemento.id,
                cantidad: 20,
                precioUnitario: DEMO_JUMBO.cemento.precioSalida,
                valorTotal: 20 * DEMO_JUMBO.cemento.precioSalida,
              },
            ],
          },
        },
      });

      // --- Salida del proyecto "Instalación Bodega Sur" (VAR-001) ---

      // CONFIRMADA 50u → stock 200-50=150.
      const numeroConfirmadaSur = await siguienteNumeroSalida(tx);
      const salidaConfirmadaSur = await tx.salida.create({
        data: {
          numero: BigInt(numeroConfirmadaSur),
          fechaSalida: FECHA_SALIDA_CONFIRMADA_SUR,
          clienteId: proyectoSur.clienteId,
          proyectoId: proyectoSur.id,
          estado: 'CONFIRMADA',
          valorTotal: 50 * DEMO_JUMBO.varilla.precioSalida,
          usuarioAutorizaId: adminId,
          fechaConfirmacion: FECHA_SALIDA_CONFIRMADA_SUR,
          usuarioCreacionId: adminId,
          detalles: {
            create: [
              {
                productoId: varilla.id,
                cantidad: 50,
                precioUnitario: DEMO_JUMBO.varilla.precioSalida,
                valorTotal: 50 * DEMO_JUMBO.varilla.precioSalida,
              },
            ],
          },
        },
      });
      await tx.movimientoInventario.create({
        data: {
          fechaHora: FECHA_SALIDA_CONFIRMADA_SUR,
          tipo: 'SALIDA',
          productoId: varilla.id,
          cantidad: 50,
          stockResultante: 150,
          documentoTipo: 'SALIDA',
          documentoId: salidaConfirmadaSur.id,
          proyectoId: proyectoSur.id,
          usuarioId: adminId,
        },
      });
    },
    { timeout: 20_000 },
  );

  console.log(
    'Datos demo de negocio ("Jumbo") creados: stock final CEM-001=340, VAR-001=150 ' +
      '(consumo cliente = 4 900 000 — ver TSDoc de sembrarDatosNegocioDemo).',
  );
}

/**
 * `UPDATE contadores SET valor = valor + 1 WHERE clave = 'salida' RETURNING valor`, dentro de
 * la transacción `tx` (mismo patrón atómico que
 * `infraestructura/persistencia/contadores.prisma.ts`, research R5). Este script no puede
 * reutilizar esa clase porque está decorada para el contenedor de NestJS y corre fuera de él
 * — se repite aquí la MISMA query parametrizada para no reimplementar la lógica de negocio,
 * solo el detalle técnico de incrementar el contador, y así no "quemar" ni duplicar
 * correlativos de salida frente a los que la aplicación real asigne después.
 */
async function siguienteNumeroSalida(tx: Prisma.TransactionClient): Promise<number> {
  const filas = await tx.$queryRaw<{ valor: bigint }[]>`
    UPDATE contadores SET valor = valor + 1 WHERE clave = 'salida' RETURNING valor
  `;
  const fila = filas[0];
  if (!fila) {
    throw new Error("Contador 'salida' sin fila semilla — falta la migración T009 (research R5).");
  }
  return Number(fila.valor);
}

async function main(): Promise<void> {
  // Primero los roles: `usuarios.rol_id` es NOT NULL y apunta a `roles` (US9/T099).
  await sembrarRolesYPermisos();

  const admin = await upsertUsuarioSemilla(leerVariablesAdmin());

  // US15 (FR-093): no es un dato de demostración — sin él la carga masiva no puede registrar
  // stock inicial, así que va SIEMPRE, igual que los roles.
  await sembrarProveedorDelSistema(admin.id);

  const esDemo = process.argv.includes('--demo');
  if (esDemo) {
    for (const usuarioDemo of leerUsuariosDemo()) {
      await upsertUsuarioSemilla(usuarioDemo);
    }
    await sembrarDatosNegocioDemo(admin.id);
    await sembrarDemoFormex(admin.id);
  }
}

main()
  .catch((error: unknown) => {
    console.error('Error ejecutando el seed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
