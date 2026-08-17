/**
 * Harness de pruebas de INTEGRACIÓN (T019) — construye la app NestJS de prueba y los
 * helpers que todas las suites de `backend/test/integracion` reutilizan.
 *
 * Por qué existe (docs/arquitectura.md §8): las suites de integración validan la API
 * COMPLETA (guards, filtro de errores, Prisma) contra PostgreSQL real — los invariantes
 * críticos (FOR UPDATE, CHECKs, trigger de inmutabilidad, UNIQUEs concurrentes) solo se
 * prueban ahí, nunca con mocks (research R10). `jest.setup.ts` ya garantiza que
 * `DATABASE_URL` apunta a `DATABASE_URL_TEST` ANTES de que `Test.createTestingModule`
 * instancie `PrismaService` (la conexión se abre recién en `app.init()`, no al importar
 * el módulo) — nunca se toca la base de datos de desarrollo. `truncarTablas()` además
 * verifica `current_database()` como segunda capa de defensa (ver nota de incidente ahí).
 *
 * Piezas que expone:
 * - `crearAppDePrueba()`: arma la misma app que `main.ts` (prefijo `/api`, cookie-parser,
 *   `FiltroErroresDominio`, guards globales incluidos porque vienen de `AppModule`) para
 *   usarla con Supertest.
 * - `truncarTablas()`: limpia todas las tablas de negocio entre pruebas (aislamiento —
 *   ninguna suite depende del orden ni de datos dejados por otra).
 * - `crearUsuarioDePrueba()`: factory mínima para levantar un usuario con rol/estado
 *   parametrizables, hasheando con el MISMO `Hasheador` (`AdaptadorHashBcrypt`) que usa
 *   el login real — así las pruebas ejercitan la comparación de hash real, no un atajo.
 *
 * - `crearProductoDePrueba()`: factory mínima para insertar un producto con
 *   `stockActual`/`umbralStockBajo` conocidos (T037) — la usan las suites de ingresos/salidas
 *   para verificar que el stock muta EXACTAMENTE lo esperado tras `recibir`/`confirmar`/
 *   `anular` (Principio I).
 *
 * - `crearClienteDePrueba()`/`crearProyectoDePrueba()`: factories mínimas (T046) que
 *   insertan DIRECTAMENTE con Prisma (mismo criterio que `crearProductoDePrueba`: evitan
 *   pasar por `POST /api/clientes`/`POST /api/clientes/:id/proyectos` cuando la prueba
 *   necesita partir de un estado ya conocido, p. ej. varios proyectos con estados distintos
 *   para ejercitar `proyectosDestino`) — las usa `clientes.spec.ts`.
 *
 * - `crearSalidaDePrueba()` (T056/T057/T058): inserta una salida `PENDIENTE` (o el estado que
 *   se indique) con sus líneas DIRECTAMENTE con Prisma, para las suites de salidas que
 *   necesitan partir de una salida ya existente en un estado conocido SIN pasar por la
 *   validación de disponibilidad de `POST /api/salidas` (p. ej. dejar una salida PENDIENTE
 *   pidiendo más de lo disponible, a propósito, para ejercitar el rechazo de `confirmar` —
 *   T056 punto 1). El número correlativo se asigna con el MISMO `UPDATE ... RETURNING` sobre
 *   `contadores` que usa `ContadoresPrisma` (research R5) para que nunca choque con un
 *   número asignado por la aplicación en la misma prueba.
 */
import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import type { EstadoCliente } from '../../src/dominio/entidades/cliente';
import type { EstadoProyecto } from '../../src/dominio/entidades/proyecto';
import type { EstadoSalida } from '../../src/dominio/entidades/salida';
import type { EstadoUsuario } from '../../src/dominio/entidades/usuario';
import { HASHEADOR, type Hasheador } from '../../src/dominio/puertos/hasheador';
import { FiltroErroresDominio } from '../../src/interfaces/http/comunes/filtro-errores-dominio';
import { PrismaService } from '../../src/infraestructura/persistencia/prisma.service';

/** App de prueba lista para Supertest, más los adaptadores que las factories necesitan. */
export interface AppDePrueba {
  app: INestApplication;
  prisma: PrismaService;
  hasheador: Hasheador;
}

/** Opciones de `crearAppDePrueba`. */
export interface OpcionesAppDePrueba {
  /**
   * Controladores SOLO DE PRUEBA a registrar además de los de `AppModule` (p. ej. el
   * endpoint sintético con `@RequierePermiso(...)` de `auth.spec.ts`, que ejercita el guard
   * de autorización sin depender de ningún endpoint de negocio concreto). Los guards
   * globales de `AppModule` (`JwtAuthGuard`/`PermisosGuard`, registrados vía `APP_GUARD`)
   * los cubren igual, porque esos providers aplican a TODA la aplicación compilada, no solo
   * a los controladores del módulo que los declara.
   */
  controllers?: Type<unknown>[];
}

/**
 * Construye una app NestJS de prueba EQUIVALENTE a la de `main.ts` (mismo prefijo global,
 * middleware de cookies y filtro de errores) para que las pruebas de integración ejerciten
 * el comportamiento real de la API, incluidos los guards globales de `AppModule`
 * (`JwtAuthGuard`/`PermisosGuard` — FR-002/FR-003/FR-058).
 */
export async function crearAppDePrueba(opciones: OpcionesAppDePrueba = {}): Promise<AppDePrueba> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: opciones.controllers ?? [],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalFilters(new FiltroErroresDominio());
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    // strict:false (comportamiento por defecto de app.get) resuelve el token aunque el
    // provider viva en AuthModule y no en el módulo raíz — habitual en pruebas de Nest.
    hasheador: app.get<Hasheador>(HASHEADOR),
  };
}

/** Cierra la app de prueba (conexión Prisma incluida vía `enableShutdownHooks`/`onModuleDestroy`). */
export async function cerrarAppDePrueba(app: INestApplication): Promise<void> {
  await app.close();
}

/**
 * Tablas de negocio en orden hijo→padre (documental — Postgres trunca todas las tablas de
 * una misma sentencia de forma atómica, así que el orden dentro de la lista no afecta el
 * resultado; se listan así para que el archivo sea legible como "mapa de FKs").
 * `movimientos_inventario` se puede truncar sin problema pese al trigger de inmutabilidad
 * de T009: ese trigger solo intercepta UPDATE/DELETE fila a fila, nunca TRUNCATE.
 *
 * `roles`/`permisos`/`roles_permisos` NO están aquí a propósito (US9/T099): son datos del
 * SISTEMA sembrados por la migración, no datos de negocio — mismo criterio que la fila
 * semilla de `contadores`. Truncarlos dejaría sin rol a todo usuario creado después
 * (`usuarios.rol_id` es NOT NULL). El `TRUNCATE ... CASCADE` de `usuarios` tampoco los
 * alcanza: es `usuarios` quien referencia a `roles`, no al revés. Los roles PROPIOS que crean
 * las pruebas (`es_sistema = false`, T109) sí se borran, pero uno a uno y después de vaciar
 * `usuarios` — ver `truncarTablas`.
 */
const TABLAS_DE_NEGOCIO = [
  'movimientos_inventario',
  // US12: igual que `movimientos_inventario`, su trigger de inmutabilidad solo intercepta
  // UPDATE/DELETE fila a fila, nunca TRUNCATE.
  'historial_costos_producto',
  'detalles_salidas',
  'salidas',
  // US21: después de `salidas` por la FK `salidas.cotizacion_id` (RESTRICT), mismo criterio
  // que `ordenes_compra` respecto de `ingresos`.
  'detalles_cotizaciones',
  'cotizaciones',
  'detalles_ingresos',
  'ingresos',
  // US16: después de `ingresos` por la FK `ingresos.orden_compra_id` (RESTRICT).
  'detalles_ordenes_compra',
  'ordenes_compra',
  // US15: después de `ingresos` por la FK `ingresos.proveedor_id` (RESTRICT), mismo criterio
  // que `categorias` respecto de `productos`.
  'proveedores',
  'proyectos',
  'clientes',
  'productos',
  // US15: va DESPUÉS de `productos` porque la FK `productos.categoria_id` es RESTRICT; el
  // `CASCADE` del TRUNCATE la resolvería igual, pero el orden explícito documenta la dependencia.
  'categorias',
  // US17: mismo caso que `categorias` — la FK `productos.unidad_medida_id` es RESTRICT, así que
  // va después de `productos`. Se lista EXPLÍCITAMENTE aunque el `CASCADE` la arrastraría de
  // todos modos por su FK a `usuarios`: dejarla implícita escondía que las quince unidades que
  // siembra la migración NO sobreviven al truncado, que es justo lo que hay que saber al
  // escribir una suite (por eso existe `crearUnidadMedidaDePrueba`).
  'unidades_medida',
  'usuarios',
] as const;

/**
 * Nombre de la base de datos de DESARROLLO — nunca debe truncarse. Segunda capa de defensa
 * (además del guard de `jest.setup.ts`): un `TRUNCATE` es irreversible, así que
 * `truncarTablas()` verifica `current_database()` y aborta si coincide con este nombre,
 * incluso si `DATABASE_URL` llegó mal configurada por cualquier otra causa futura.
 *
 * INCIDENTE (2026-08-10): sin esta verificación, un bug en la carga de `DATABASE_URL_TEST`
 * (ver jest.setup.ts) hizo que una corrida real de `npm run test:integracion` truncara la
 * base `trazo` de desarrollo en vez de `trazo_test`. Esta función ahora se niega a truncar
 * si la base conectada es `trazo`, sin importar por qué `DATABASE_URL` haya llegado así.
 */
const NOMBRE_BASE_DE_DATOS_DESARROLLO = 'trazo';

/**
 * Vacía todas las tablas de negocio y reinicia sus secuencias — se llama en el
 * `beforeEach`/`afterEach` de cada suite para que ninguna prueba dependa de datos dejados
 * por otra (aislamiento). El correlativo técnico `contadores` no se trunca (perdería la
 * fila semilla `'salida'` insertada por la migración T009): se reinicia su valor a 0 con
 * un UPDATE aparte.
 */
export async function truncarTablas(prisma: PrismaService): Promise<void> {
  const [{ current_database: baseActual }] = await prisma.$queryRaw<[{ current_database: string }]>`
    SELECT current_database();
  `;
  if (baseActual === NOMBRE_BASE_DE_DATOS_DESARROLLO) {
    throw new Error(
      `truncarTablas() se negó a truncar "${baseActual}": es el nombre de la base de ` +
        'desarrollo, no de pruebas. Revisa DATABASE_URL/DATABASE_URL_TEST en backend/.env.',
    );
  }

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLAS_DE_NEGOCIO.join(', ')} RESTART IDENTITY CASCADE;`);
  await prisma.$executeRaw`UPDATE contadores SET valor = 0 WHERE clave IN ('salida', 'orden_compra', 'cotizacion');`;
  await borrarRolesPropios(prisma);
}

/**
 * Borra los roles PROPIOS que haya dejado una prueba (`es_sistema = false`), conservando
 * intactos los tres del sistema (US9/T109). Sus filas de `roles_permisos` se van con ellos
 * (`onDelete: Cascade`).
 *
 * Va DESPUÉS del `TRUNCATE` de `usuarios`: la FK `usuarios.rol_id` es `ON DELETE RESTRICT`, así
 * que con usuarios vivos este borrado fallaría — y con la tabla ya vacía no puede fallar.
 *
 * Existe por aislamiento, pero sobre todo por CORRECCIÓN de las pruebas de FR-057: un rol
 * propio olvidado que conceda `roles.gestionar` cambiaría el conteo de "roles activos que lo
 * tienen" y volvería verde —o roja— una prueba de invariante por una razón que no es la suya.
 */
async function borrarRolesPropios(prisma: PrismaService): Promise<void> {
  await prisma.rol.deleteMany({ where: { esSistema: false } });
}

/**
 * Los tres roles del sistema, nombrados como los nombran las suites (`'ADMINISTRADOR'`,
 * `'GERENTE'`, `'OPERARIO'`).
 *
 * Este union vive AQUÍ, en el harness, y ya no en el dominio: US9 convirtió los roles en datos
 * administrables (FR-054) y T106 retiró el `NombreRol` del backend junto con el resto del
 * puente de la migración. Las suites, en cambio, siguen razonando en términos de los tres roles
 * del sistema —son los que la migración siembra y los que fijan la matriz de autorización que
 * SC-013 congela—, así que conservarlo aquí es lo que permitió que ninguna de ellas cambiara.
 * Un rol PROPIO de prueba no se pide por este union: se crea con `crearRolDePrueba`.
 */
export type RolDelSistema = 'ADMINISTRADOR' | 'GERENTE' | 'OPERARIO';

/** Correspondencia entre el nombre que usan las suites y el `roles.nombre` que sembró la
 *  migración `20260812090000_roles_permisos_como_datos` (FR-059). */
const NOMBRE_ROL_DEL_SISTEMA_EN_BD: Readonly<Record<RolDelSistema, string>> = {
  ADMINISTRADOR: 'Administrador',
  GERENTE: 'Gerente',
  OPERARIO: 'Operario',
};

/** Parámetros opcionales de `crearUsuarioDePrueba` — todos con un valor por defecto útil para pruebas. */
export interface OpcionesUsuarioDePrueba {
  login?: string;
  password?: string;
  nombreCompleto?: string;
  email?: string;
  rol?: RolDelSistema;
  estado?: EstadoUsuario;
  /**
   * Rol PROPIO (creado con `crearRolDePrueba`) a asignar en vez de uno del sistema — lo usa
   * `roles.spec.ts` para levantar un usuario con un subconjunto de permisos (SC-012). Tiene
   * prioridad sobre `rol`; si se omite, manda `rol` (por defecto `OPERARIO`).
   */
  rolId?: number;
}

/** Usuario recién creado — incluye la contraseña en texto plano (solo existe en memoria de prueba). */
export interface UsuarioDePruebaCreado {
  id: number;
  login: string;
  password: string;
  rol: RolDelSistema;
  estado: EstadoUsuario;
  /** Id del rol REALMENTE asignado (el del sistema, o el propio que se haya pedido). */
  rolId: number;
}

/**
 * Factory mínima de usuarios para pruebas de integración (T019/T020): inserta un usuario
 * con rol y estado parametrizables, hasheando la contraseña con el `Hasheador` REAL de la
 * app (`AdaptadorHashBcrypt`, cableado en `AuthModule`) para que `POST /api/auth/login`
 * compare contra un hash generado exactamente igual que en producción.
 *
 * `debeCambiarPassword` se fija en `false` a propósito (a diferencia del alta real de
 * FR-005, que siempre nace en `true`): estas pruebas cubren sesión/roles, no el flujo de
 * cambio de contraseña forzado, y un usuario listo para operar simplifica cada caso.
 */
export async function crearUsuarioDePrueba(
  { prisma, hasheador }: Pick<AppDePrueba, 'prisma' | 'hasheador'>,
  opciones: OpcionesUsuarioDePrueba = {},
): Promise<UsuarioDePruebaCreado> {
  const sufijo = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const login = opciones.login ?? `usuario.prueba.${sufijo}`;
  const password = opciones.password ?? 'ClaveDePrueba#123';
  const rol = opciones.rol ?? 'OPERARIO';
  const estado = opciones.estado ?? 'ACTIVO';

  const passwordHash = await hasheador.hash(password);
  const rolId = opciones.rolId ?? Number(await resolverRolIdPorNombre(prisma, rol));
  const registro = await prisma.usuario.create({
    data: {
      login,
      passwordHash,
      nombreCompleto: opciones.nombreCompleto ?? 'Usuario de Prueba',
      email: opciones.email ?? `${login}@pruebas.trazo.local`,
      rolId: BigInt(rolId),
      estado,
      debeCambiarPassword: false,
    },
  });

  return { id: Number(registro.id), login, password, rol, estado, rolId };
}

/**
 * Id de uno de los tres roles del sistema — lo necesitan las suites que envían `rolId` en el
 * cuerpo de `POST`/`PUT /api/usuarios` (US9/T104: el contrato dejó de recibir el nombre del rol).
 */
export async function obtenerRolDelSistemaId(prisma: PrismaService, rol: RolDelSistema): Promise<number> {
  return Number(await resolverRolIdPorNombre(prisma, rol));
}

/** Rol PROPIO recién creado para una prueba — `esSistema=false`, con los permisos pedidos. */
export interface RolDePruebaCreado {
  id: number;
  nombre: string;
  permisos: string[];
}

/**
 * Factory de roles PROPIOS (T109): inserta un rol `esSistema=false` con EXACTAMENTE las claves
 * de permiso indicadas, resolviéndolas contra el catálogo sembrado. Es lo que permite probar
 * SC-012 ("un rol nuevo con un subconjunto de permisos concede eso y nada más") sin depender
 * de la pantalla de roles ni del orden de siembra: la prueba nombra `'ingresos.crear'`, no un id.
 *
 * Aborta si alguna clave no existe en el catálogo — un permiso mal escrito en una prueba de
 * autorización daría un 403 "correcto" por la razón equivocada, que es exactamente el tipo de
 * falso verde que SC-013 no puede permitirse.
 */
export async function crearRolDePrueba(
  prisma: PrismaService,
  permisos: readonly string[],
  nombre?: string,
): Promise<RolDePruebaCreado> {
  const filas = await prisma.permiso.findMany({ where: { clave: { in: [...permisos] } }, select: { id: true, clave: true } });
  if (filas.length !== new Set(permisos).size) {
    const encontradas = new Set(filas.map((fila) => fila.clave));
    const faltantes = [...new Set(permisos)].filter((clave) => !encontradas.has(clave));
    throw new Error(
      `Estas claves de permiso no existen en el catálogo de la base de pruebas: ${faltantes.join(', ')}. ` +
        'Revisa el nombre del permiso o aplica las migraciones/seed contra DATABASE_URL_TEST.',
    );
  }

  const sufijo = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const registro = await prisma.rol.create({
    data: {
      nombre: nombre ?? `Rol de Prueba ${sufijo}`,
      descripcion: 'Rol propio creado por una prueba de integración',
      permisos: { create: filas.map((fila) => ({ permisoId: fila.id })) },
    },
  });

  return { id: Number(registro.id), nombre: registro.nombre, permisos: [...permisos] };
}

/**
 * Resuelve el `usuarios.rol_id` del rol del sistema pedido (US9/T099: `usuarios.rol` dejó de
 * ser un enum y pasó a ser una FK a `roles`). Las factories siguen recibiendo `'OPERARIO'`,
 * `'GERENTE'`, `'ADMINISTRADOR'` — la traducción a fila de `roles` ocurre AQUÍ, de modo que
 * ninguna suite tuvo que cambiar por la migración (SC-013).
 *
 * Los tres roles los siembra la MIGRACIÓN (no el seed), así que existen en `trazo_test` desde
 * que se aplica; `truncarTablas()` tampoco los borra: `roles` no está en `TABLAS_DE_NEGOCIO`
 * y el `TRUNCATE ... CASCADE` de `usuarios` no la alcanza (es `usuarios` quien referencia a
 * `roles`, no al revés). Si aun así faltara, se aborta con un mensaje explícito en vez de
 * dejar que Prisma reporte una violación de FK opaca.
 */
async function resolverRolIdPorNombre(prisma: PrismaService, rol: RolDelSistema): Promise<bigint> {
  const nombre = NOMBRE_ROL_DEL_SISTEMA_EN_BD[rol];
  const registro = await prisma.rol.findUnique({ where: { nombre }, select: { id: true } });
  if (!registro) {
    throw new Error(
      `El rol del sistema "${nombre}" no existe en la base de pruebas: aplica las migraciones ` +
        '(prisma migrate deploy) contra DATABASE_URL_TEST antes de correr las suites.',
    );
  }
  return registro.id;
}

/** Parámetros opcionales de `crearProductoDePrueba` — todos con un valor por defecto útil. */
export interface OpcionesProductoDePrueba {
  sku?: string;
  descripcion?: string;
  stockActual?: number;
  umbralStockBajo?: number;
  /**
   * Clasificación y estado (US13/T138): los necesita `filtros-listados.spec.ts` para sembrar
   * productos con categoría/ubicación/estado CONOCIDOS y verificar que cada filtro nuevo
   * devuelve exactamente el conjunto esperado. Se dejan opcionales y sin valor por defecto
   * (`null`/`ACTIVO`) para que ninguna suite anterior cambie de comportamiento.
   */
  categoriaId?: number | null;
  /**
   * Unidad de medida (US17/FR-103). Por defecto `null`: un producto sembrado por esta factory
   * es, deliberadamente, uno de los ANTERIORES a la historia — así las suites que verifican qué
   * ocurre con ellos (editar exige completarla, importar la conserva) no tienen que deshacer
   * nada primero.
   */
  unidadMedidaId?: number | null;
  ubicacion?: string | null;
  estado?: 'ACTIVO' | 'INACTIVO';
  /**
   * Usuario de auditoría (`productos.usuario_creacion_id`, NOT NULL en data-model.md). Si se
   * omite, la factory crea un usuario técnico desechable solo para satisfacer la FK — las
   * suites de ingresos (T037) no ejercitan auditoría de PRODUCTOS (eso es US5/T060), solo
   * necesitan que el producto exista con un stock inicial conocido para usarlo en líneas.
   */
  usuarioCreacionId?: number;
}

/** Producto recién creado — con los mismos campos numéricos ya convertidos (`Decimal`→`number`,
 *  igual que `RepositorioProductosPrisma`) para que las aserciones de las suites sean directas. */
export interface ProductoDePruebaCreado {
  id: number;
  sku: string;
  descripcion: string;
  stockActual: number;
  umbralStockBajo: number;
}

/**
 * Factory mínima de productos (T037): inserta un producto DIRECTAMENTE con Prisma (sin pasar
 * por `POST /api/productos`, que siempre nace con `stockActual=0`) para que las suites de
 * ingresos puedan partir de un stock inicial conocido y verificar que `recibir`/`anular`
 * mutan `stock_actual` EXACTAMENTE lo esperado (Principio I, research R4).
 */
/**
 * Crea una categoría del catálogo (US15) y devuelve su id, para las pruebas que necesitan
 * clasificar productos. El nombre lleva sufijo único porque el índice funcional
 * `lower(btrim(nombre))` rechaza duplicados entre pruebas de la misma suite.
 */
export async function crearCategoriaDePrueba(
  prisma: PrismaService,
  nombre: string,
  usuarioCreacionId: number,
): Promise<number> {
  const categoria = await prisma.categoria.create({
    data: { nombre, usuarioCreacionId: BigInt(usuarioCreacionId) },
    select: { id: true },
  });
  return Number(categoria.id);
}

/**
 * Crea un proveedor del catálogo (US15, FR-091) y devuelve su id. Todo ingreso lo necesita: la
 * FK `ingresos.proveedor_id` es NOT NULL, así que ninguna suite puede registrar una factura sin
 * pasar antes por aquí.
 *
 * El nombre se guarda TAL CUAL —sin sufijo único, al revés que el SKU de
 * `crearProductoDePrueba`— por el mismo criterio que `crearCategoriaDePrueba`: hay pruebas que
 * comprueban el nombre en un documento exportado, y un sufijo aleatorio las obligaría a asertar
 * por coincidencia parcial. A cambio, dos llamadas con el MISMO nombre dentro de una prueba
 * chocan contra el índice funcional `lower(btrim(nombre))`: cada suite pasa nombres distintos.
 */
export async function crearProveedorDePrueba(
  prisma: PrismaService,
  nombre = 'Proveedor de Prueba',
  usuarioCreacionId?: number,
): Promise<number> {
  const creadorId = usuarioCreacionId ?? (await usuarioParaAuditoria(prisma));
  const proveedor = await prisma.proveedor.create({
    data: { nombre, usuarioCreacionId: BigInt(creadorId) },
    select: { id: true },
  });
  return Number(proveedor.id);
}

/**
 * Usuario al que apuntar la auditoría de un catálogo cuando la prueba no indica ninguno:
 * REUTILIZA el más antiguo que exista y solo crea uno técnico si la tabla está vacía.
 *
 * Es el mismo criterio que usa la migración de proveedores (`MIN(usuarios.id)`), pero aquí el
 * motivo es otro: hay suites que cuentan usuarios (`usuarios.spec.ts`) o los usuarios por rol
 * (`roles.spec.ts`), y una factory que creara una fila de más en cada llamada haría fallar esas
 * pruebas por una razón que no tiene nada que ver con lo que verifican.
 */
async function usuarioParaAuditoria(prisma: PrismaService): Promise<number> {
  const existente = await prisma.usuario.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });
  return existente ? Number(existente.id) : crearUsuarioTecnicoDePrueba(prisma);
}

/**
 * Nombre EXACTO del proveedor del sistema (US15, FR-093) — el mismo que
 * `ImportarProductosCasoUso` busca para su ingreso sintético.
 */
export const NOMBRE_PROVEEDOR_DEL_SISTEMA = 'Carga masiva de inventario';

/**
 * Crea la fila del proveedor del sistema (FR-093). En producción la ponen la migración y la
 * semilla; aquí hace falta explícitamente porque `truncarTablas` vacía `proveedores` antes de
 * cada prueba, y sin ella la carga masiva no tendría a quién apuntar su ingreso sintético.
 */
export async function crearProveedorDelSistemaDePrueba(prisma: PrismaService): Promise<number> {
  const creadorId = await usuarioParaAuditoria(prisma);
  const proveedor = await prisma.proveedor.create({
    data: { nombre: NOMBRE_PROVEEDOR_DEL_SISTEMA, esSistema: true, usuarioCreacionId: BigInt(creadorId) },
    select: { id: true },
  });
  return Number(proveedor.id);
}

/**
 * Crea una unidad de medida del catálogo (US17, FR-101) y devuelve su id.
 *
 * Hace falta explícitamente en cada suite que dé de alta un producto por HTTP: la migración
 * siembra quince unidades, pero `truncarTablas` vacía la tabla antes de cada prueba (ver
 * `TABLAS_DE_NEGOCIO`). Los productos creados con `crearProductoDePrueba` NO la necesitan —
 * nacen sin unidad a propósito, que es como quedaron los anteriores a la historia (FR-103).
 *
 * El nombre y la abreviatura se guardan TAL CUAL, mismo criterio que categorías y proveedores:
 * hay pruebas que los comprueban en un documento exportado. Dos llamadas con el mismo texto
 * dentro de una prueba chocan contra los índices funcionales — cada suite pasa los suyos.
 */
export async function crearUnidadMedidaDePrueba(
  prisma: PrismaService,
  nombre = 'Unidad',
  abreviatura = 'und',
  usuarioCreacionId?: number,
): Promise<number> {
  const creadorId = usuarioCreacionId ?? (await usuarioParaAuditoria(prisma));
  const unidad = await prisma.unidadMedida.create({
    data: { nombre, abreviatura, usuarioCreacionId: BigInt(creadorId) },
    select: { id: true },
  });
  return Number(unidad.id);
}

export async function crearProductoDePrueba(
  prisma: PrismaService,
  opciones: OpcionesProductoDePrueba = {},
): Promise<ProductoDePruebaCreado> {
  const usuarioCreacionId = opciones.usuarioCreacionId ?? (await crearUsuarioTecnicoDePrueba(prisma));
  const sufijo = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  const registro = await prisma.producto.create({
    data: {
      sku: opciones.sku ?? `SKU-PRUEBA-${sufijo}`,
      descripcion: opciones.descripcion ?? 'Producto de prueba de integración',
      stockActual: opciones.stockActual ?? 0,
      umbralStockBajo: opciones.umbralStockBajo ?? 0,
      categoriaId: opciones.categoriaId === undefined || opciones.categoriaId === null ? null : BigInt(opciones.categoriaId),
      unidadMedidaId:
        opciones.unidadMedidaId === undefined || opciones.unidadMedidaId === null
          ? null
          : BigInt(opciones.unidadMedidaId),
      ubicacion: opciones.ubicacion ?? null,
      estado: opciones.estado ?? 'ACTIVO',
      usuarioCreacionId: BigInt(usuarioCreacionId),
    },
  });

  return {
    id: Number(registro.id),
    sku: registro.sku,
    descripcion: registro.descripcion,
    stockActual: registro.stockActual.toNumber(),
    umbralStockBajo: registro.umbralStockBajo.toNumber(),
  };
}

/**
 * Usuario técnico desechable SOLO para satisfacer `productos.usuario_creacion_id` cuando
 * `crearProductoDePrueba` no recibe uno explícito. No pasa por `Hasheador` (esta factory solo
 * toma `PrismaService`, no el contexto completo de la app): nunca se usa para iniciar sesión,
 * únicamente necesita existir como fila válida de `usuarios` para la FK.
 */
async function crearUsuarioTecnicoDePrueba(prisma: PrismaService): Promise<number> {
  const sufijo = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const registro = await prisma.usuario.create({
    data: {
      login: `sistema.pruebas.${sufijo}`,
      passwordHash: 'no-aplica::usuario-tecnico-de-prueba',
      nombreCompleto: 'Usuario técnico de prueba (auditoría)',
      email: `sistema.pruebas.${sufijo}@pruebas.trazo.local`,
      rolId: await resolverRolIdPorNombre(prisma, 'ADMINISTRADOR'),
      estado: 'ACTIVO',
      debeCambiarPassword: false,
    },
  });
  return Number(registro.id);
}

/** Parámetros opcionales de `crearClienteDePrueba` — todos con un valor por defecto útil. */
export interface OpcionesClienteDePrueba {
  nombre?: string;
  nit?: string;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  estado?: EstadoCliente;
  /** Usuario de auditoría (`clientes.usuario_creacion_id`, NOT NULL). Si se omite, la
   *  factory crea un usuario técnico desechable solo para satisfacer la FK (mismo criterio
   *  que `crearProductoDePrueba`). */
  usuarioCreacionId?: number;
}

/** Cliente recién creado — campos mínimos que las suites necesitan para armar aserciones. */
export interface ClienteDePruebaCreado {
  id: number;
  nombre: string;
  nit: string;
  estado: EstadoCliente;
}

/**
 * Factory mínima de clientes (T046): inserta un cliente DIRECTAMENTE con Prisma (sin pasar
 * por `POST /api/clientes`) para que las suites puedan partir de un cliente con estado
 * conocido (p. ej. INACTIVO) sin depender del flujo HTTP de alta.
 */
export async function crearClienteDePrueba(
  prisma: PrismaService,
  opciones: OpcionesClienteDePrueba = {},
): Promise<ClienteDePruebaCreado> {
  const usuarioCreacionId = opciones.usuarioCreacionId ?? (await crearUsuarioTecnicoDePrueba(prisma));
  // `nit` es VARCHAR(30) (data-model.md) — prefijo corto para no desbordar la columna junto
  // con el sufijo de unicidad (a diferencia del SKU de producto, que tiene 50 caracteres).
  const sufijo = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  const registro = await prisma.cliente.create({
    data: {
      nombre: opciones.nombre ?? 'Cliente de Prueba',
      nit: opciones.nit ?? `NIT-${sufijo}`,
      telefono: opciones.telefono ?? null,
      email: opciones.email ?? null,
      direccion: opciones.direccion ?? null,
      ciudad: opciones.ciudad ?? null,
      estado: opciones.estado ?? 'ACTIVO',
      usuarioCreacionId: BigInt(usuarioCreacionId),
    },
  });

  return {
    id: Number(registro.id),
    nombre: registro.nombre,
    nit: registro.nit,
    estado: registro.estado,
  };
}

/** Parámetros opcionales de `crearProyectoDePrueba` — todos con un valor por defecto útil. */
export interface OpcionesProyectoDePrueba {
  nombre?: string;
  descripcion?: string | null;
  fechaInicio?: Date | null;
  fechaCierreEstimada?: Date | null;
  responsable?: string | null;
  presupuestoEstimado?: number | null;
  estado?: EstadoProyecto;
  /** Usuario de auditoría (`proyectos.usuario_creacion_id`, NOT NULL). Mismo criterio que
   *  `OpcionesClienteDePrueba.usuarioCreacionId`. */
  usuarioCreacionId?: number;
}

/** Proyecto recién creado — campos mínimos que las suites necesitan para armar aserciones. */
export interface ProyectoDePruebaCreado {
  id: number;
  clienteId: number;
  nombre: string;
  estado: EstadoProyecto;
}

/**
 * Factory mínima de proyectos (T046): inserta un proyecto DIRECTAMENTE con Prisma (sin pasar
 * por `POST /api/clientes/:id/proyectos`) para el `clienteId` dado, con estado parametrizable
 * — la usan las pruebas de `proyectosDestino` (FR-038) para dejar precargados proyectos
 * ACTIVO/SUSPENDIDO/COMPLETADO sin ejercitar el flujo HTTP de alta en cada caso.
 */
export async function crearProyectoDePrueba(
  prisma: PrismaService,
  clienteId: number,
  opciones: OpcionesProyectoDePrueba = {},
): Promise<ProyectoDePruebaCreado> {
  const usuarioCreacionId = opciones.usuarioCreacionId ?? (await crearUsuarioTecnicoDePrueba(prisma));
  const sufijo = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  const registro = await prisma.proyecto.create({
    data: {
      clienteId: BigInt(clienteId),
      nombre: opciones.nombre ?? `Proyecto de Prueba ${sufijo}`,
      descripcion: opciones.descripcion ?? null,
      fechaInicio: opciones.fechaInicio ?? null,
      fechaCierreEstimada: opciones.fechaCierreEstimada ?? null,
      responsable: opciones.responsable ?? null,
      presupuestoEstimado: opciones.presupuestoEstimado ?? null,
      estado: opciones.estado ?? 'ACTIVO',
      usuarioCreacionId: BigInt(usuarioCreacionId),
    },
  });

  return {
    id: Number(registro.id),
    clienteId: Number(registro.clienteId),
    nombre: registro.nombre,
    estado: registro.estado,
  };
}

/** Línea mínima para `crearSalidaDePrueba` — producto, cantidad y precio de referencia. */
export interface LineaSalidaDePrueba {
  productoId: number;
  cantidad: number;
  precioUnitario?: number;
}

/** Parámetros de `crearSalidaDePrueba` — todos con un valor por defecto útil salvo `proyectoId`/`lineas`. */
export interface OpcionesSalidaDePrueba {
  proyectoId: number;
  lineas: LineaSalidaDePrueba[];
  fechaSalida?: Date;
  observaciones?: string | null;
  estado?: EstadoSalida;
  usuarioAutorizaId?: number;
  fechaConfirmacion?: Date | null;
  motivoAnulacion?: string | null;
  /** Usuario de auditoría (`salidas.usuario_creacion_id`, NOT NULL). Mismo criterio que
   *  `OpcionesClienteDePrueba.usuarioCreacionId`. */
  usuarioCreacionId?: number;
}

/** Salida recién creada — campos mínimos que las suites necesitan para armar aserciones. */
export interface SalidaDePruebaCreada {
  id: number;
  numero: number;
  proyectoId: number;
  estado: EstadoSalida;
}

/**
 * Factory de salidas (T056/T057/T058): inserta una salida DIRECTAMENTE con Prisma (sin pasar
 * por `POST /api/salidas`, que SIEMPRE valida destino y disponibilidad antes de crear) con
 * el `proyectoId`/líneas/estado indicados. Existe para dejar precargado exactamente el
 * escenario que cada prueba necesita ejercitar — en particular, una salida `PENDIENTE` cuya
 * cantidad YA excede el disponible (T056 punto 1: el rechazo debe darse al `confirmar`, no
 * antes) y el par de salidas `PENDIENTE` de la prueba de carrera (T056 punto 2), que juntas
 * exceden el stock pero cada una por separado cabría.
 *
 * El correlativo se asigna con el mismo `UPDATE contadores SET valor = valor + 1 ... RETURNING`
 * que usa `ContadoresPrisma` (research R5) para que nunca colisione con un número asignado
 * por la aplicación (p. ej. si la misma prueba también llama `POST /api/salidas`).
 */
export async function crearSalidaDePrueba(
  prisma: PrismaService,
  opciones: OpcionesSalidaDePrueba,
): Promise<SalidaDePruebaCreada> {
  const usuarioCreacionId = opciones.usuarioCreacionId ?? (await crearUsuarioTecnicoDePrueba(prisma));
  const [{ valor: numero }] = await prisma.$queryRaw<[{ valor: bigint }]>`
    UPDATE contadores SET valor = valor + 1 WHERE clave = 'salida' RETURNING valor;
  `;

  const detallesCrear = opciones.lineas.map((linea) => {
    const precioUnitario = linea.precioUnitario ?? 1000;
    return {
      productoId: BigInt(linea.productoId),
      cantidad: linea.cantidad,
      precioUnitario,
      valorTotal: linea.cantidad * precioUnitario,
    };
  });
  const valorTotal = detallesCrear.reduce((acumulado, detalle) => acumulado + detalle.valorTotal, 0);

  const registro = await prisma.salida.create({
    data: {
      numero,
      fechaSalida: opciones.fechaSalida ?? new Date('2026-01-10'),
      proyectoId: BigInt(opciones.proyectoId),
      observaciones: opciones.observaciones ?? null,
      estado: opciones.estado ?? 'PENDIENTE',
      valorTotal,
      usuarioAutorizaId: opciones.usuarioAutorizaId ? BigInt(opciones.usuarioAutorizaId) : null,
      fechaConfirmacion: opciones.fechaConfirmacion ?? null,
      motivoAnulacion: opciones.motivoAnulacion ?? null,
      usuarioCreacionId: BigInt(usuarioCreacionId),
      detalles: { create: detallesCrear },
    },
  });

  return {
    id: Number(registro.id),
    numero: Number(registro.numero),
    proyectoId: Number(registro.proyectoId),
    estado: registro.estado,
  };
}
