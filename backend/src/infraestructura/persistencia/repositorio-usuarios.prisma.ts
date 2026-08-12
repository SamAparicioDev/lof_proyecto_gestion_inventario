/**
 * Adaptador `RepositorioUsuariosPrisma` — implementa el puerto `RepositorioUsuarios` del
 * dominio con Prisma (patrón Repository/Adapter, docs/arquitectura.md §3). Único punto del
 * backend donde el modelo `usuarios` de Prisma se traduce a la entidad `Usuario` del
 * dominio.
 *
 * Traduce explícitamente el enum `EstadoUsuario` generado por Prisma a los tipos del
 * dominio (nunca se asume que son el mismo tipo aunque compartan los mismos valores —
 * docs/arquitectura.md, regla de dependencia) y convierte los ids `BigInt` de Prisma a
 * `number` (el dominio no conoce el tipo de columna de la BD).
 *
 * ROL Y PERMISOS EN LA MISMA LECTURA (T101, research R16): todas las consultas de este
 * adaptador usan `INCLUIR_ROL_CON_PERMISOS`, un `include` ANIDADO que resuelve el rol del
 * usuario y las claves de sus permisos efectivos en la MISMA llamada al repositorio. Esto es
 * lo que permite que `PermisosGuard` autorice contra datos frescos de BD en cada petición
 * —nunca contra un claim del JWT (US9-AS3)— sin agregar un round-trip: `EstrategiaJwt` ya
 * llamaba a `buscarPorId` en cada petición autenticada para revalidar estado y rol.
 *
 * Precisión de rendimiento (medida el 2026-08-12, para que nadie la deduzca al revés):
 * Prisma resuelve ese `include` anidado con SU estrategia por defecto —4 sentencias por
 * lectura: `usuarios` → `roles` → `roles_permisos` → `permisos`, todas por PK/FK indexada—,
 * no con un único JOIN. Lo que la migración necesitaba se mantiene: una sola llamada al
 * repositorio y CERO consultas adicionales desde el guard. Si algún día pesara, la palanca es
 * `relationLoadStrategy: 'join'` (exige habilitar el preview `relationJoins` en el generator),
 * nunca volver a cachear permisos en el JWT — eso rompería US9-AS3.
 *
 * PUENTE DE US9 RETIRADO (T106): la migración `20260812090000_roles_permisos_como_datos`
 * reemplazó el enum `usuarios.rol` por `usuarios.rol_id` → `roles`, y este adaptador sostuvo
 * mientras tanto un mapa (`NOMBRE_ROL_EN_BD`) que derivaba el texto
 * `ADMINISTRADOR|GERENTE|OPERARIO` del nombre del rol, porque el contrato todavía publicaba
 * `rol` así. Ese mapa se eliminó aquí: T104/T106 cambiaron el contrato a `rolId` (entrada) y
 * `rol: {id, nombre}` (salida), de modo que un rol PROPIO creado por el Administrador
 * —"Bodeguero", FR-054— ya viaja sin necesidad de tener representación en ningún enum del
 * código. Escribir el rol es ahora `rol: { connect: { id } }` (una sola sentencia, sin
 * round-trip para resolverlo por nombre), y leerlo es `rolAsignado` sin traducción intermedia.
 *
 * `crear`/`actualizar`/`cambiarEstado` (T075, US6) traducen violaciones técnicas de
 * Postgres a errores de dominio tipados: `P2002` (UNIQUE) en `login`/`email` →
 * `Duplicado('login'|'email', ...)` (FR-009) y `P2025` (registro inexistente) →
 * `NoEncontrado` (mismo patrón que `repositorio-clientes.prisma.ts`).
 *
 * GARANTÍA ATÓMICA DE FR-057 (corrección de la revisión adversarial de la Tanda 13):
 * `actualizar` y `cambiarEstado` son las dos mutaciones que pueden dejar al sistema sin nadie
 * que lo administre (cambiarle el rol al último administrador, o desactivarlo), y las dos
 * corren dentro de `UnidadDeTrabajo`: bloquean con `FOR UPDATE` a los usuarios que hoy pueden
 * ejercer los permisos críticos, escriben, y revalidan el conteo en la MISMA transacción
 * (`bloquearTitularesDePermisos` + `exigirQueNadieSeQuedeSinTitulares`). Verificar en el caso
 * de uso y escribir después no alcanza: dos administradores que se desactivan MUTUAMENTE ven
 * cada uno un objetivo distinto de sí mismo, ambos leen "quedan dos" y el sistema termina en
 * cero — reproducido al primer intento contra la API real, y sin ruta de vuelta por HTTP
 * porque ninguno de los dos puede ya iniciar sesión.
 *
 * Implementa: FR-001 (búsqueda de credenciales para login), FR-002/FR-006/FR-007 (estado,
 * rol y password gestionados exclusivamente aquí; el hash solo se expone en los métodos
 * que lo necesitan para verificar credenciales), FR-005 (CRUD de administración de
 * usuarios), FR-008 (baja lógica, nunca DELETE) y FR-009 (unicidad de login/email).
 */
import { Injectable } from '@nestjs/common';
import { Prisma, type EstadoUsuario as EstadoUsuarioPrisma } from '@prisma/client';
import { Duplicado, ErrorValidacionDominio, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import type { ClavePermiso } from '../../dominio/entidades/permiso';
import type {
  DatosActualizarUsuario,
  DatosNuevoUsuario,
  FiltrosListarUsuarios,
  GuardiaCapacidadAdministrativa,
  PaginaUsuarios,
  RepositorioUsuarios,
  TitularDePermiso,
  UsuarioAutenticable,
} from '../../dominio/puertos/repositorio-usuarios';
import type { EstadoUsuario, Usuario } from '../../dominio/entidades/usuario';
import { PrismaService } from './prisma.service';
import { aRolDominio, INCLUIR_PERMISOS_DEL_ROL } from './repositorio-roles.prisma';
import { UnidadDeTrabajo, type PrismaTransactionClient } from './unidad-de-trabajo';

/**
 * `include` compartido por TODAS las lecturas de este adaptador: el rol del usuario y las
 * filas de `roles_permisos` con su permiso viajan en la MISMA lectura, sin ninguna consulta
 * adicional desde el guard (T101, research R16).
 *
 * Reutiliza `INCLUIR_PERMISOS_DEL_ROL` de `repositorio-roles.prisma.ts` para que la forma que
 * se lee aquí sea EXACTAMENTE la que traduce `aRolDominio` — una sola definición de "rol con
 * sus permisos" en todo el backend (ver TSDoc de ese archivo).
 */
const INCLUIR_ROL_CON_PERMISOS = { rol: { include: INCLUIR_PERMISOS_DEL_ROL } } as const;

/** Fila de `usuarios` con su rol y permisos resueltos — la forma que `aUsuarioDominio` sabe
 *  traducir. Todas las lecturas de este adaptador usan `INCLUIR_ROL_CON_PERMISOS`. */
type UsuarioConRol = Prisma.UsuarioGetPayload<{ include: typeof INCLUIR_ROL_CON_PERMISOS }>;

/** Fila cruda del `SELECT ... FOR UPDATE` que sostiene FR-057 (ver `bloquearTitulares`). */
interface FilaTitularBloqueado {
  usuario_id: bigint;
  rol_id: bigint;
  clave: string;
}

@Injectable()
export class RepositorioUsuariosPrisma implements RepositorioUsuarios {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unidadDeTrabajo: UnidadDeTrabajo,
  ) {}

  async buscarPorLogin(login: string): Promise<UsuarioAutenticable | null> {
    const registro = await this.prisma.usuario.findUnique({
      where: { login },
      include: INCLUIR_ROL_CON_PERMISOS,
    });
    return registro ? aUsuarioAutenticable(registro) : null;
  }

  async buscarPorId(id: number): Promise<Usuario | null> {
    const registro = await this.prisma.usuario.findUnique({
      where: { id: BigInt(id) },
      include: INCLUIR_ROL_CON_PERMISOS,
    });
    return registro ? aUsuarioDominio(registro) : null;
  }

  async buscarConCredencialesPorId(id: number): Promise<UsuarioAutenticable | null> {
    const registro = await this.prisma.usuario.findUnique({
      where: { id: BigInt(id) },
      include: INCLUIR_ROL_CON_PERMISOS,
    });
    return registro ? aUsuarioAutenticable(registro) : null;
  }

  async actualizarPassword(id: number, passwordHash: string, debeCambiarPassword: boolean): Promise<void> {
    await this.prisma.usuario.update({
      where: { id: BigInt(id) },
      data: { passwordHash, debeCambiarPassword },
    });
  }

  async listar(filtros: FiltrosListarUsuarios): Promise<PaginaUsuarios> {
    const where = construirWhereListarUsuarios(filtros);
    const [registros, total] = await this.prisma.$transaction([
      this.prisma.usuario.findMany({
        where,
        include: INCLUIR_ROL_CON_PERMISOS,
        // Desempate por `id`: `nombre_completo` no es único (dos "Juan Pérez" son perfectamente
        // posibles) y sin un segundo criterio el orden es inestable, así que `skip`/`take`
        // duplicaría unos usuarios y escondería otros al paginar — mismo defecto que se
        // corrigió en salidas e ingresos, aquí atajado antes de que el volumen lo hiciera
        // visible.
        orderBy: [{ nombreCompleto: 'asc' }, { id: 'asc' }],
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
      }),
      this.prisma.usuario.count({ where }),
    ]);
    return { datos: registros.map(aUsuarioDominio), total };
  }

  async crear(datos: DatosNuevoUsuario): Promise<Usuario> {
    try {
      const registro = await this.prisma.usuario.create({
        data: {
          nombreCompleto: datos.nombreCompleto,
          email: datos.email,
          login: datos.login,
          passwordHash: datos.passwordHash,
          rol: { connect: { id: BigInt(datos.rolId) } },
        },
        include: INCLUIR_ROL_CON_PERMISOS,
      });
      return aUsuarioDominio(registro);
    } catch (error) {
      throw traducirErrorAltaUsuario(error);
    }
  }

  async actualizar(id: number, datos: DatosActualizarUsuario, guardia: GuardiaCapacidadAdministrativa): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const titularesAntes = await bloquearTitularesDePermisos(tx, guardia.permisos);
      try {
        await tx.usuario.update({
          where: { id: BigInt(id) },
          data: {
            nombreCompleto: datos.nombreCompleto,
            email: datos.email,
            rol: { connect: { id: BigInt(datos.rolId) } },
            fechaModificacion: new Date(),
          },
        });
      } catch (error) {
        throw traducirErrorEscrituraUsuario(error);
      }
      await exigirQueNadieSeQuedeSinTitulares(tx, guardia, titularesAntes);
    });
  }

  async cambiarEstado(id: number, estado: EstadoUsuario, guardia: GuardiaCapacidadAdministrativa): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const titularesAntes = await bloquearTitularesDePermisos(tx, guardia.permisos);
      try {
        await tx.usuario.update({
          where: { id: BigInt(id) },
          data: {
            estado: mapearEstadoAPrisma(estado),
            fechaModificacion: new Date(),
          },
        });
      } catch (error) {
        throw traducirErrorEscrituraUsuario(error);
      }
      await exigirQueNadieSeQuedeSinTitulares(tx, guardia, titularesAntes);
    });
  }

  async listarTitularesActivosDePermiso(permiso: ClavePermiso): Promise<TitularDePermiso[]> {
    const registros = await this.prisma.usuario.findMany({
      where: { estado: 'ACTIVO', rol: { permisos: { some: { permiso: { clave: permiso } } } } },
      select: { id: true, rolId: true },
    });
    return registros.map((fila) => ({ usuarioId: Number(fila.id), rolId: Number(fila.rolId) }));
  }
}

/**
 * Bloquea con `FOR UPDATE` a los usuarios ACTIVOS que HOY pueden ejercer alguno de los
 * permisos críticos, y devuelve cuántos titulares tenía cada uno ANTES de la escritura
 * (research R4, mismo mecanismo que el `SELECT ... FOR UPDATE ORDER BY id` del stock).
 *
 * Es la mitad que convierte la regla de FR-057 en una garantía real y no en una carrera: dos
 * peticiones que puedan dejar al sistema sin administración compiten por ESTAS MISMAS filas,
 * así que la segunda espera a que la primera confirme y vuelve a leer el estado ya cambiado.
 * Sin el bloqueo, dos administradores desactivándose mutuamente leen ambos "quedan dos" y el
 * sistema termina en cero (reproducido al primer intento contra la API real).
 *
 * `ORDER BY u.id` fija el orden de adquisición de los bloqueos para que dos transacciones
 * concurrentes nunca se los pidan al revés (evita deadlocks) — misma razón que en
 * `RepositorioSalidasPrisma.confirmar`.
 */
async function bloquearTitularesDePermisos(
  tx: PrismaTransactionClient,
  permisos: readonly ClavePermiso[],
): Promise<Map<ClavePermiso, number>> {
  const filas = await tx.$queryRaw<FilaTitularBloqueado[]>`
    SELECT u.id AS usuario_id, u.rol_id, p.clave
    FROM usuarios u
    JOIN roles_permisos rp ON rp.rol_id = u.rol_id
    JOIN permisos p ON p.id = rp.permiso_id
    WHERE u.estado = 'ACTIVO' AND p.clave = ANY(${[...permisos]}::text[])
    ORDER BY u.id
    FOR UPDATE OF u
  `;
  return contarPorPermiso(filas);
}

/**
 * Revalida, DENTRO de la misma transacción y con las filas ya bloqueadas, que la escritura no
 * haya dejado sin ningún titular activo a un permiso crítico que sí lo tenía antes. Si ocurre,
 * lanza `EstadoInvalido` (→ `409`) y Prisma revierte la escritura completa: nunca queda un
 * cambio parcial (FR-057).
 *
 * La comparación es "tenía titulares y ya no": si un permiso YA estaba sin titulares —estado
 * alcanzable solo tocando la base a mano— esta red no debe además impedir repararlo.
 */
async function exigirQueNadieSeQuedeSinTitulares(
  tx: PrismaTransactionClient,
  guardia: GuardiaCapacidadAdministrativa,
  titularesAntes: Map<ClavePermiso, number>,
): Promise<void> {
  const filas = await tx.$queryRaw<FilaTitularBloqueado[]>`
    SELECT u.id AS usuario_id, u.rol_id, p.clave
    FROM usuarios u
    JOIN roles_permisos rp ON rp.rol_id = u.rol_id
    JOIN permisos p ON p.id = rp.permiso_id
    WHERE u.estado = 'ACTIVO' AND p.clave = ANY(${[...guardia.permisos]}::text[])
  `;
  const titularesDespues = contarPorPermiso(filas);

  for (const permiso of guardia.permisos) {
    const antes = titularesAntes.get(permiso) ?? 0;
    const despues = titularesDespues.get(permiso) ?? 0;
    if (antes > 0 && despues === 0) {
      throw new EstadoInvalido(guardia.mensajePorPermiso[permiso] ?? MENSAJE_BLOQUEO_GENERICO);
    }
  }
}

/** Mensaje de último recurso si un caso de uso olvidara el texto de un permiso crítico —
 *  nunca debería verse, pero un `409` sin mensaje sería peor que uno genérico (FR-047). */
const MENSAJE_BLOQUEO_GENERICO =
  'La operación dejaría al sistema sin ningún usuario activo que pueda administrarlo.';

/** Cuántos usuarios distintos concede cada permiso, a partir de las filas usuario×permiso. */
function contarPorPermiso(filas: readonly FilaTitularBloqueado[]): Map<ClavePermiso, number> {
  const usuariosPorPermiso = new Map<ClavePermiso, Set<string>>();
  for (const fila of filas) {
    const usuarios = usuariosPorPermiso.get(fila.clave) ?? new Set<string>();
    usuarios.add(String(fila.usuario_id));
    usuariosPorPermiso.set(fila.clave, usuarios);
  }
  return new Map([...usuariosPorPermiso].map(([clave, usuarios]) => [clave, usuarios.size]));
}

/** Filtro de estado del listado (`GET /api/usuarios?estado=`) — mismo patrón que
 *  `construirWhereListarClientes`. */
function construirWhereListarUsuarios(filtros: FiltrosListarUsuarios): Prisma.UsuarioWhereInput {
  const where: Prisma.UsuarioWhereInput = {};
  if (filtros.estado) where.estado = mapearEstadoAPrisma(filtros.estado);
  // US13 (FR-075): "¿quiénes tienen este rol?". Un `rolId` inexistente no es un error, es una
  // página vacía — un filtro acota, no valida la existencia del recurso.
  if (filtros.rolId !== undefined) where.rolId = BigInt(filtros.rolId);
  return where;
}

/**
 * Traducción específica del ALTA. Se separa de la general por el `P2025`: en un `create` no
 * hay usuario previo que pueda faltar, así que ese código solo puede venir del
 * `rol: { connect: { id } }` — un `rolId` que no existe en `roles`. El contrato lo trata como
 * error de CAMPO del formulario (`400`), no como un `404` de recurso (US9/T106).
 *
 * Es una red de seguridad, no la validación: `CrearUsuarioCasoUso` verifica antes que el rol
 * exista, para poder rechazar con el mismo mensaje sin depender de un código de Prisma. Esto
 * cubre la carrera (rol eliminado entre la verificación y el `INSERT`).
 */
function traducirErrorAltaUsuario(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    return new ErrorValidacionDominio('El rol seleccionado no existe', {
      rolId: 'El rol seleccionado no existe',
    });
  }
  return traducirErrorEscrituraUsuario(error);
}

/** `P2002` (UNIQUE de `login`/`email`) → `Duplicado` con el campo exacto que chocó (FR-009);
 *  `P2025` (registro inexistente) → `NoEncontrado`; cualquier otro error técnico se propaga
 *  sin traducir (lo maneja el filtro global). */
function traducirErrorEscrituraUsuario(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const campo = campoUnicoViolado(error);
      if (campo === 'login') return new Duplicado('login', 'El usuario (login) ya está en uso');
      return new Duplicado('email', 'El correo ya está registrado para otro usuario');
    }
    if (error.code === 'P2025') return new NoEncontrado('El usuario');
  }
  return error;
}

/**
 * `login` y `email` son dos `UNIQUE` simples e independientes en `usuarios` (nunca
 * compuestos), así que el nombre de columna que Postgres reporta en `error.meta.target`
 * basta para diferenciar cuál de los dos violó la restricción. Si el driver no expone
 * `target` (no debería pasar en Postgres), se asume `email` por ser el campo editable con
 * mayor probabilidad de colisión tras el alta (`login` es inmutable).
 */
function campoUnicoViolado(error: Prisma.PrismaClientKnownRequestError): 'login' | 'email' {
  const target = error.meta?.target;
  const columnas = Array.isArray(target) ? target.map(String) : typeof target === 'string' ? [target] : [];
  return columnas.some((columna) => columna.toLowerCase().includes('login')) ? 'login' : 'email';
}

/**
 * Traduce un registro Prisma de `usuarios` a la entidad de dominio (sin el hash — FR-007).
 *
 * `rolAsignado` es el rol COMPLETO con sus permisos efectivos —lo que `PermisosGuard`
 * autoriza en cada petición (FR-058)— y sale de la misma lectura, sin consulta adicional.
 * Se traduce con `aRolDominio` de `repositorio-roles.prisma.ts`: una sola definición de "rol
 * con sus permisos" en todo el backend, se lea desde `/api/roles` o desde el usuario
 * autenticado (dos copias podrían desincronizarse, y una discrepancia en la lista de permisos
 * es un fallo de control de acceso).
 */
function aUsuarioDominio(registro: UsuarioConRol): Usuario {
  return {
    id: Number(registro.id),
    nombreCompleto: registro.nombreCompleto,
    email: registro.email,
    login: registro.login,
    rolAsignado: aRolDominio(registro.rol),
    estado: mapearEstado(registro.estado),
    debeCambiarPassword: registro.debeCambiarPassword,
  };
}

/** Igual que `aUsuarioDominio`, pero conservando el hash para los flujos de credenciales. */
function aUsuarioAutenticable(registro: UsuarioConRol): UsuarioAutenticable {
  return { ...aUsuarioDominio(registro), passwordHash: registro.passwordHash };
}

function mapearEstado(estado: EstadoUsuarioPrisma): EstadoUsuario {
  switch (estado) {
    case 'ACTIVO':
      return 'ACTIVO';
    case 'INACTIVO':
      return 'INACTIVO';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de usuario de Prisma sin mapeo al dominio: ${String(valorInesperado)}`);
    }
  }
}

/** Dirección inversa de `mapearEstado` — dominio → Prisma, para `crear`/`actualizar`/
 *  `cambiarEstado` (T075). */
function mapearEstadoAPrisma(estado: EstadoUsuario): EstadoUsuarioPrisma {
  switch (estado) {
    case 'ACTIVO':
      return 'ACTIVO';
    case 'INACTIVO':
      return 'INACTIVO';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de usuario de dominio sin mapeo a Prisma: ${String(valorInesperado)}`);
    }
  }
}
