/**
 * Puerto `RepositorioUsuarios` — acceso a la persistencia de usuarios visto desde el
 * dominio (patrón Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-usuarios.prisma.ts`.
 *
 * Alcance: los 4 métodos originales (Foundational — T014/T016) sirven al módulo de
 * seguridad (login, revalidación de sesión en cada petición, cambio de la propia
 * contraseña). Los 4 métodos siguientes (`listar`/`crear`/`actualizar`/`cambiarEstado`,
 * T075) agregan el CRUD completo de administración de usuarios de la historia US6.
 *
 * Implementa: FR-001 (autenticación por login/password), FR-002/FR-006 (rol y estado
 * ACTIVO revalidados en cada petición — nunca se confía en un claim de JWT desactualizado),
 * FR-005 (alta/edición/listado de usuarios por el Administrador), FR-007 (el hash de
 * password solo es visible en los dos métodos que lo necesitan para verificar
 * credenciales, nunca en `buscarPorId`/`listar`/`crear`/`actualizar`), FR-008 (baja lógica,
 * nunca DELETE) y FR-009 (login/email únicos, reforzado por la BD y traducido a
 * `Duplicado('login', ...)`/`Duplicado('email', ...)` en el adaptador).
 */
import type { ClavePermiso } from '../entidades/permiso';
import type { EstadoUsuario, Usuario } from '../entidades/usuario';

/**
 * Datos de alta de un usuario (FR-005). La contraseña llega YA hasheada — el caso de uso
 * la hashea con el puerto `Hasheador` antes de invocar `crear`; este puerto nunca recibe
 * texto plano (FR-007).
 *
 * El rol viaja por ID (US9/T106, antes era el texto `ADMINISTRADOR|GERENTE|OPERARIO`): los
 * roles son datos administrables (FR-054), así que su nombre no es un identificador estable
 * ni la lista de valores válidos se conoce en tiempo de compilación. Que el rol EXISTA lo
 * verifica el caso de uso contra `RepositorioRoles` antes de llamar aquí.
 */
export interface DatosNuevoUsuario {
  readonly nombreCompleto: string;
  readonly email: string;
  readonly login: string;
  readonly passwordHash: string;
  readonly rolId: number;
}

/** Datos editables de un usuario existente (FR-005) — sin `login` (identificador de negocio
 *  inmutable tras el alta, mismo criterio que el SKU de producto) ni contraseña (se cambia
 *  vía `actualizarPassword`, reutilizado por el caso de uso de restablecimiento). */
export interface DatosActualizarUsuario {
  readonly nombreCompleto: string;
  readonly email: string;
  readonly rolId: number;
}

/** Filtros del listado de usuarios (`GET /api/usuarios?estado=&rolId=`) — paginación siempre
 *  obligatoria (Principio V, rendimiento), mismo patrón que `RepositorioClientes.listar`. */
export interface FiltrosListarUsuarios {
  readonly estado?: EstadoUsuario;
  /**
   * Rol asignado (US13, FR-075) — responde "¿quiénes tienen este rol?", la pregunta previa a
   * editar la matriz de permisos de un rol. Por ID y no por nombre por el mismo motivo que en el
   * alta (US9/T104): desde FR-054 los roles son datos y su nombre no es un identificador
   * estable. Un `rolId` sin usuarios devuelve una página vacía, no un error.
   */
  readonly rolId?: number;
  readonly pagina: number;
  readonly porPagina: number;
}

/** Página de usuarios (mismo shape que `Paginado<T>` de `@trazo/compartido`, sin
 *  importarlo: el dominio no depende de ningún paquete externo — docs/arquitectura.md §2). */
export interface PaginaUsuarios {
  readonly datos: Usuario[];
  readonly total: number;
}

/**
 * Usuario ACTIVO que HOY puede ejercer un permiso, porque el rol que tiene asignado se lo
 * concede. Es la unidad que cuentan los invariantes de FR-057: la pregunta que importa no es
 * "¿cuántos ROLES conceden `roles.gestionar`?" —un rol sin usuarios no administra nada— sino
 * "¿cuánta GENTE puede entrar a administrar el sistema?".
 *
 * Lleva `rolId` para que el caso de uso pueda razonar sobre un cambio ANTES de aplicarlo: al
 * editar la matriz de un rol, los titulares que se quedarían sin el permiso son exactamente
 * los que tienen ESE rol (ver `aplicacion/comunes/proteccion-capacidad-administrativa.ts`).
 */
export interface TitularDePermiso {
  readonly usuarioId: number;
  readonly rolId: number;
}

/**
 * Red de seguridad ATÓMICA de FR-057 para las mutaciones de usuario que pueden reducir la
 * capacidad de administración (cambio de rol y baja lógica).
 *
 * Por qué no basta con verificar antes en el caso de uso: la verificación y la escritura son
 * dos operaciones distintas, y entre ellas cabe otra petición. Dos administradores que se
 * desactivan MUTUAMENTE ven cada uno un objetivo distinto de sí mismo, ambos leen "quedan
 * dos" y ambos escriben: el sistema termina con CERO administradores activos y ninguno de los
 * dos puede siquiera iniciar sesión (reproducido al primer intento contra la API real). El
 * adaptador bloquea (`FOR UPDATE`) a los titulares actuales ANTES de escribir y revuelve el
 * conteo DESPUÉS, todo en la misma transacción, de modo que la segunda petición espera a que
 * la primera termine y ve el estado ya cambiado.
 *
 * Solo se bloquea el permiso que la operación DEJARÍA en cero habiendo tenido titulares antes:
 * si un permiso ya estaba sin titulares (estado alcanzable solo tocando la base a mano), esta
 * red no puede impedir además que se repare.
 */
export interface GuardiaCapacidadAdministrativa {
  /** Permisos que la operación no puede dejar sin ningún usuario ACTIVO capaz de ejercerlos. */
  readonly permisos: readonly ClavePermiso[];
  /** Mensaje en español del `409` (FR-016/FR-047), por permiso — el texto debe decir QUÉ se
   *  estaba intentando hacer, así que lo aporta el caso de uso, no el adaptador. */
  readonly mensajePorPermiso: Readonly<Record<ClavePermiso, string>>;
}

export interface RepositorioUsuarios {
  /**
   * Busca un usuario por su login único, incluyendo el hash de password — necesario para
   * verificar credenciales en `POST /api/auth/login` (FR-001). `null` si no existe.
   */
  buscarPorLogin(login: string): Promise<UsuarioAutenticable | null>;

  /**
   * Busca un usuario por id, SIN el hash de password (FR-007). Lo usa `EstrategiaJwt` en
   * cada petición autenticada para revalidar en BD que el usuario sigue existiendo y que
   * su rol/estado están frescos, en vez de confiar en los claims del JWT (FR-002/FR-003).
   */
  buscarPorId(id: number): Promise<Usuario | null>;

  /**
   * Busca un usuario por id, incluyendo el hash de password — lo usa
   * `CambiarMiPasswordCasoUso` (FR-004) para verificar la contraseña actual sin exponer el
   * hash a través de `request.user` (que sí pasa por `buscarPorId`, sin credenciales).
   */
  buscarConCredencialesPorId(id: number): Promise<UsuarioAutenticable | null>;

  /** Actualiza el hash de password y el flag `debeCambiarPassword` de un usuario. Lo
   *  reutilizan `CambiarMiPasswordCasoUso` (FR-004) y el restablecimiento de contraseña por
   *  un Administrador (FR-005) — mismo método, sin necesidad de uno nuevo. */
  actualizarPassword(id: number, passwordHash: string, debeCambiarPassword: boolean): Promise<void>;

  /** Listado paginado de usuarios con filtro de estado, SIN el hash de password (FR-005,
   *  FR-007). */
  listar(filtros: FiltrosListarUsuarios): Promise<PaginaUsuarios>;

  /**
   * Da de alta un usuario (FR-005). El adaptador traduce las violaciones `UNIQUE` de
   * PostgreSQL a `Duplicado('login', ...)` o `Duplicado('email', ...)` según cuál de las
   * dos columnas chocó (FR-009).
   */
  crear(datos: DatosNuevoUsuario): Promise<Usuario>;

  /**
   * Actualiza los datos editables de un usuario existente (FR-005). Mismo manejo de
   * `Duplicado('email', ...)` que `crear` si el nuevo correo choca con otro usuario
   * (FR-009).
   *
   * `guardia` es obligatorio porque esta escritura CAMBIA EL ROL, y cambiar el rol puede
   * retirarle al usuario la capacidad de administrar el sistema (FR-057) — ver
   * `GuardiaCapacidadAdministrativa`.
   */
  actualizar(id: number, datos: DatosActualizarUsuario, guardia: GuardiaCapacidadAdministrativa): Promise<void>;

  /**
   * Activa/desactiva un usuario — baja lógica, nunca DELETE (FR-008): los movimientos que
   * el usuario registró/autorizó conservan la referencia (`usuario_id` FK) y su nombre se
   * resuelve por join en el momento de leer, sin borrar nunca la fila del usuario.
   *
   * `guardia` es obligatorio por la misma razón que en `actualizar`: desactivar a quien
   * administra el sistema es una de las dos formas de dejarlo sin nadie que lo administre.
   */
  cambiarEstado(id: number, estado: EstadoUsuario, guardia: GuardiaCapacidadAdministrativa): Promise<void>;

  /**
   * Usuarios ACTIVOS cuyo rol concede `permiso` — el conteo que sostiene los invariantes de
   * FR-057 en los casos de uso de ROLES (T105 los verificaba contra "cuántos roles activos lo
   * conceden", que es otra cosa: un rol con el permiso y CERO usuarios satisface ese conteo y
   * deja igualmente al sistema sin nadie que pueda administrarlo).
   */
  listarTitularesActivosDePermiso(permiso: ClavePermiso): Promise<TitularDePermiso[]>;
}

/** Usuario con su hash de password — solo para los flujos de verificación de credenciales. */
export interface UsuarioAutenticable extends Usuario {
  readonly passwordHash: string;
}

/** Token de inyección de NestJS para el puerto `RepositorioUsuarios`. */
export const REPOSITORIO_USUARIOS = 'RepositorioUsuarios';
