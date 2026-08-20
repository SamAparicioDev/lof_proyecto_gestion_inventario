/**
 * Entidad de dominio `Permiso` — TypeScript puro (Principio VI, NO NEGOCIABLE).
 *
 * Un permiso es la unidad atómica de autorización del sistema: cada fila del catálogo
 * corresponde a UNA verificación real en un endpoint (`@RequierePermiso('clave')`). El
 * catálogo es de SOLO LECTURA desde la aplicación (FR-056): se siembra desde el código y se
 * versiona con él, porque un permiso que ningún endpoint consulta sería una casilla que el
 * Administrador marca creyendo que concede algo y no concede nada (research R16).
 *
 * Implementa: FR-054 (los permisos son datos, no una lista de roles fija en el código) y
 * FR-056 (catálogo sembrado, no administrable desde la interfaz).
 */

/**
 * Clave de un permiso con el formato `modulo.accion` (p. ej. `salidas.confirmar`). Es el
 * identificador estable que usan el decorador de los endpoints y la matriz rol↔permiso —
 * nunca el id numérico, que depende del orden de siembra de cada instalación.
 */
export type ClavePermiso = string;

/**
 * Permiso que habilita administrar roles y su matriz de permisos (`/api/roles`,
 * `GET /api/permisos`). Tiene nombre propio porque NO es una clave más: es la que sostiene
 * los invariantes anti-bloqueo de FR-057 — el sistema nunca puede quedarse sin al menos un
 * rol activo que la conceda, o nadie podría volver a administrar los permisos de nadie
 * (research R16, "riesgo principal y su mitigación").
 *
 * Los casos de uso de `aplicacion/roles/` la comparan al actualizar, desactivar o eliminar un
 * rol; el resto del sistema la declara como cualquier otra, con `@RequierePermiso`.
 */
export const PERMISO_GESTION_ROLES: ClavePermiso = 'roles.gestionar';

/**
 * Permiso que habilita administrar usuarios (`/api/usuarios`: alta, edición, estado y
 * restablecimiento de contraseña). Tiene nombre propio por la MISMA razón que
 * `PERMISO_GESTION_ROLES`: FR-057 prohíbe dejar a la organización sin capacidad de administrar
 * "roles **o usuarios**", así que las dos claves sostienen invariantes, no solo la primera.
 */
export const PERMISO_GESTION_USUARIOS: ClavePermiso = 'usuarios.gestionar';

/**
 * Los permisos cuya desaparición deja a la organización sin poder administrarse — la lista
 * literal de FR-057 ("administrar roles **o** usuarios").
 *
 * El orden importa: los invariantes recorren esta lista y el primero que se violaría es el que
 * da el mensaje del `409`. `roles.gestionar` va primero porque es el más grave de los dos:
 * quien lo conserva puede devolverse `usuarios.gestionar`, mientras que al revés no (perder
 * `roles.gestionar` es irrecuperable por HTTP — hay que tocar la base a mano).
 *
 * Implementa: FR-057.
 */
export const PERMISOS_CRITICOS_DE_ADMINISTRACION: readonly ClavePermiso[] = [
  PERMISO_GESTION_ROLES,
  PERMISO_GESTION_USUARIOS,
];

/**
 * Permiso que habilita CORREGIR a mano la cantidad de un producto (US31, FR-130). Tiene nombre
 * propio porque es el único RESERVADO (ver `PERMISOS_RESERVADOS`).
 */
export const PERMISO_AJUSTAR_INVENTARIO: ClavePermiso = 'inventario.ajustar';

/**
 * Permisos que solo un SUPER ADMINISTRADOR puede conceder o retirar a un rol (US31, FR-131).
 *
 * Por qué existe la categoría: escribir el stock a mano es la única operación del sistema que
 * puede desmentir a todos los documentos a la vez. Un ingreso mal registrado se anula y deja
 * rastro; una cantidad escrita a mano reemplaza el resultado de toda la historia de movimientos
 * de ese producto. Quién puede hacer eso no debería decidirse con el mismo permiso que reparte
 * todo lo demás — si `roles.gestionar` bastara, cualquiera que lo tenga podría concedérselo.
 *
 * Por qué vive en el código y no en una columna: es una propiedad del SIGNIFICADO del permiso,
 * no un dato de operación. Si fuera editable, quitarle la reserva sería el primer paso para
 * saltarse la regla, y la protección solo detendría a quien no supiera dónde mirar.
 *
 * La comprueba `ActualizarRolCasoUso` sobre la DIFERENCIA entre los permisos que el rol tenía y
 * los que se le envían: un cuerpo que no toca la casilla pasa sin más, tenga quien lo mande el
 * rango que tenga.
 *
 * Implementa: FR-131.
 */
export const PERMISOS_RESERVADOS: readonly ClavePermiso[] = [PERMISO_AJUSTAR_INVENTARIO];

/** Permiso del catálogo del sistema (FR-056). */
export interface Permiso {
  readonly id: number;
  /** `modulo.accion` — única en el catálogo. */
  readonly clave: ClavePermiso;
  /** Prefijo de la clave; agrupa la lista en la pantalla de roles. */
  readonly modulo: string;
  /** Texto en español que el Administrador lee al asignar el permiso a un rol. */
  readonly descripcion: string;
}
