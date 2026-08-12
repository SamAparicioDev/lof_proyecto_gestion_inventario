/**
 * Formas de la API REST de roles y permisos consumidas por el frontend
 * (contracts/api-rest.md § Roles y permisos, T104). Reflejan las entidades de dominio
 * `backend/src/dominio/entidades/{rol,permiso}.ts` SERIALIZADAS a JSON — mismo criterio que
 * `tipos/usuarios.ts`: el frontend nunca importa la entidad de dominio (docs/arquitectura.md §2).
 *
 * Implementa: FR-054 (los permisos son datos, no una lista de roles fija en el código),
 * FR-055 (el Administrador consulta y edita roles con su matriz de permisos), FR-056 (el
 * catálogo de permisos es de SOLO LECTURA: aquí no hay forma de "crear permiso") y FR-058
 * (la autorización se resuelve contra CLAVES de permiso, que son lo que viaja al cliente
 * para que la interfaz decida qué ofrecer — nunca lo que decide si se puede o no: eso lo
 * resuelve el guard del servidor en cada petición).
 */

/**
 * Clave de un permiso, con el formato `modulo.accion` (p. ej. `salidas.confirmar`). Es el
 * identificador ESTABLE del permiso: el id numérico depende del orden de siembra de cada
 * instalación, así que nunca se compara contra un id en la interfaz.
 */
export type ClavePermiso = string;

/** Estado de un rol — INACTIVO es baja lógica, nunca se elimina (data-model.md § roles). */
export type EstadoRol = 'ACTIVO' | 'INACTIVO';

/**
 * Rol tal como viaja IDENTIFICADO en otras respuestas: el perfil de la sesión
 * (`GET /api/auth/perfil`) y cada fila del listado de usuarios (`GET /api/usuarios`).
 *
 * Lleva `id` además del nombre porque el formulario de usuarios envía `rolId` (el nombre de
 * un rol propio puede cambiar; su id no) y `nombre` porque es lo que la pantalla muestra.
 * NO lleva los permisos: quién puede qué lo decide el servidor en cada petición (FR-058); la
 * lista de permisos de la SESIÓN viaja aparte, en `PerfilSesion.permisos`, y solo para que la
 * interfaz sepa qué ofrecer.
 */
export interface RolAsignado {
  id: number;
  nombre: string;
}

/**
 * Rol con el detalle de sus permisos asignados (`GET /api/roles/:id`).
 * `permisos` son CLAVES, no ids: es lo que la pantalla de roles compara para marcar casillas
 * y lo mismo que compara el guard del servidor.
 */
export interface RolDetalle {
  id: number;
  nombre: string;
  descripcion: string | null;
  /** `true` en Administrador/Gerente/Operario: no se eliminan ni se renombran (FR-057/FR-059). */
  esSistema: boolean;
  estado: EstadoRol;
  permisos: ClavePermiso[];
}

/**
 * Fila del listado de roles (`GET /api/roles`) — el detalle más el conteo de usuarios que lo
 * tienen asignado, para que el Administrador vea a cuánta gente afecta antes de tocarlo y
 * entienda por qué un rol con usuarios no se puede eliminar (FR-057).
 */
export interface RolListado extends RolDetalle {
  cantidadUsuarios: number;
}

/** Permiso del catálogo tal como lo publica `GET /api/permisos` — sin `modulo`, porque ya
 *  viene agrupado por módulo (ver `ModuloPermisos`). */
export interface PermisoCatalogo {
  id: number;
  clave: ClavePermiso;
  /** Texto en español que el Administrador lee al marcar la casilla. */
  descripcion: string;
}

/**
 * Grupo del catálogo de permisos (`GET /api/permisos`): los permisos de un módulo, en el
 * orden en que la pantalla de roles los muestra. El catálogo completo es un arreglo de estos
 * grupos — de SOLO LECTURA (FR-056): cada permiso corresponde a una verificación real del
 * código, así que se siembra con el despliegue y no se crea desde la aplicación.
 */
export interface ModuloPermisos {
  modulo: string;
  permisos: PermisoCatalogo[];
}
