/**
 * Puerto `RepositorioRoles` — acceso a la persistencia de roles y de su matriz de permisos
 * visto desde el dominio (patrón Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-roles.prisma.ts`.
 *
 * Alcance: EXACTAMENTE las operaciones que la sección "Roles y permisos" de
 * contracts/api-rest.md documenta para `/api/roles` (7 endpoints), más los dos conteos que
 * los invariantes anti-bloqueo de FR-057 necesitan verificar en el caso de uso (T105). No
 * hay un método más: el catálogo de permisos es de solo lectura y vive en
 * `RepositorioPermisos` (FR-056), y los roles NO llevan columnas de auditoría (data-model.md
 * § roles), así que ninguna escritura recibe el usuario que la ejecuta.
 *
 * Implementa: FR-054 (los permisos son datos, no una lista fija en el código), FR-055 (CRUD
 * de roles y edición de su matriz de permisos por el Administrador), FR-057 (invariantes que
 * impiden dejar a la organización sin quién la administre) y FR-058 (los permisos efectivos
 * que la autorización consulta salen de aquí, no de un nombre de rol fijo).
 */
import type { ClavePermiso } from '../entidades/permiso';
import type { EstadoRol, Rol } from '../entidades/rol';

/**
 * Datos de alta y de edición de un rol (FR-055). Los permisos viajan por ID —no por clave—
 * porque es lo que el contrato define como cuerpo de `POST`/`PUT /api/roles` (`permisoIds[]`,
 * los ids del catálogo que el Administrador marcó en la pantalla).
 *
 * La misma forma sirve para crear y para actualizar: un rol es su nombre, su descripción y su
 * conjunto de permisos, y `actualizar` REEMPLAZA ese conjunto completo (no lo fusiona), así
 * que desmarcar una casilla quita el permiso. Duplicar la interfaz en dos tipos idénticos
 * solo agregaría ruido (Principio V).
 */
export interface DatosRol {
  readonly nombre: string;
  readonly descripcion: string | null;
  readonly permisoIds: readonly number[];
}

/** Filtros del listado de roles (`GET /api/roles?estado=`) — paginación siempre obligatoria,
 *  mismo patrón que `RepositorioUsuarios.listar` (Principio V, rendimiento). */
export interface FiltrosListarRoles {
  readonly estado?: EstadoRol;
  readonly pagina: number;
  readonly porPagina: number;
}

/**
 * Rol con el número de usuarios que lo tienen asignado — el listado lo muestra junto a cada
 * fila (contracts/api-rest.md: "página de roles con su conteo de usuarios y sus permisos")
 * para que el Administrador vea a cuánta gente afecta antes de tocar un rol, y para explicar
 * por qué un rol con usuarios no se puede eliminar (FR-057).
 */
export interface RolConUsuarios extends Rol {
  readonly cantidadUsuarios: number;
}

/** Página de roles (mismo shape que `Paginado<T>` de `@trazo/compartido`, sin importarlo: el
 *  dominio no depende de ningún paquete externo — docs/arquitectura.md §2). */
export interface PaginaRoles {
  readonly datos: RolConUsuarios[];
  readonly total: number;
}

export interface RepositorioRoles {
  /** Listado paginado de roles con sus permisos y su conteo de usuarios (`GET /api/roles`). */
  /**
   * El rol de RESPALDO (`es_super_admin`), o `null` si la base no lo tiene todavía (US30, FR-127).
   *
   * Se busca por la COLUMNA y nunca por el nombre: el nombre es una etiqueta para humanos y
   * podría cambiarse; la columna la protege un índice único parcial y solo la base puede tocarla.
   * Lo usa el arranque para saber a qué rol enganchar el usuario de respaldo (FR-129).
   */
  buscarRolDeRespaldo(): Promise<Rol | null>;

  listar(filtros: FiltrosListarRoles): Promise<PaginaRoles>;

  /** Rol con el detalle de sus permisos asignados (`GET /api/roles/:id`); `null` si no existe. */
  buscarPorId(id: number): Promise<Rol | null>;

  /**
   * Da de alta un rol con su conjunto inicial de permisos (`POST /api/roles`). Nace siempre
   * `esSistema=false` y `estado=ACTIVO`: los tres roles del sistema los siembra la migración,
   * nunca la aplicación (FR-059). El adaptador traduce el `UNIQUE` de `roles.nombre` a
   * `Duplicado('nombre', ...)` y un `permisoId` inexistente a `ErrorValidacionDominio`
   * (ambos `400` según el contrato).
   */
  crear(datos: DatosRol): Promise<Rol>;

  /**
   * Actualiza nombre, descripción y el conjunto COMPLETO de permisos del rol
   * (`PUT /api/roles/:id`) de forma atómica: la matriz anterior se reemplaza por la nueva en
   * una sola transacción, para que ninguna petición concurrente pueda leer un rol a medio
   * actualizar (los permisos se resuelven en CADA petición — US9-AS3).
   */
  actualizar(id: number, datos: DatosRol): Promise<void>;

  /** Activa/desactiva un rol — baja lógica, nunca DELETE (`PUT /api/roles/:id/estado`). */
  cambiarEstado(id: number, estado: EstadoRol): Promise<void>;

  /**
   * Elimina un rol (`DELETE /api/roles/:id`). Solo es válido para roles propios sin usuarios
   * asignados: el caso de uso (T105) verifica ambos invariantes ANTES de llamar aquí, y la FK
   * `usuarios.rol_id ON DELETE RESTRICT` es la última línea de defensa (FR-057).
   */
  eliminar(id: number): Promise<void>;

  /** Cuántos usuarios tienen asignado este rol — el mensaje de FR-057 lo indica al rechazar
   *  la eliminación ("no se puede eliminar: N usuarios lo tienen"). */
  contarUsuarios(rolId: number): Promise<number>;

  /**
   * Cuántos roles ACTIVOS conceden el permiso indicado. Sostiene el invariante de FR-057 "no
   * se puede quitar `roles.gestionar` del ÚLTIMO rol activo que lo tiene": el caso de uso
   * compara este conteo contra 1 antes de aplicar un cambio que retiraría ese permiso
   * (misma familia que "un administrador no puede desactivarse a sí mismo", US6).
   */
  contarRolesActivosConPermiso(permiso: ClavePermiso): Promise<number>;
}

/** Token de inyección de NestJS para el puerto `RepositorioRoles`. */
export const REPOSITORIO_ROLES = 'RepositorioRoles';
