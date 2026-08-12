/**
 * Regla anti-escalada del CRUD de roles (`POST`/`PUT /api/roles`, US9/FR-057): **nadie puede
 * conceder, a través de un rol, permisos que su propio rol no tiene**.
 *
 * Por qué existe (hallazgo MEDIUM de la verificación final de la Tanda 13, cerrado después):
 * la propia US9 estableció esta regla para `/api/usuarios` (`aplicacion/usuarios/rol-asignado.ts`)
 * pero NO para `/api/roles`, y esa asimetría dejaba `roles.gestionar` como un permiso
 * auto-escalable. Demostrado en vivo: un rol propio con `roles.gestionar` como ÚNICO permiso
 * podía hacer `PUT /api/roles/{su propio rol}` con las 30 claves del catálogo y quedarse con
 * todo —incluidos inventario, salidas y usuarios— en una sola petición y sin re-login, porque
 * los permisos se resuelven en cada petición (US9-AS3).
 *
 * Con los tres roles del sistema NO cambia nada observable (SC-013): Administrador —el único
 * que hoy tiene `roles.gestionar`— ya tiene los 30 permisos del catálogo, así que cualquier
 * matriz que arme es un subconjunto de la suya. Solo acota lo que US9 hizo posible por primera
 * vez: roles propios con `roles.gestionar` y un subconjunto del resto, que el dueño del negocio
 * podría crear creyéndolos limitados. Sin esta regla, marcar esa casilla equivalía a conceder
 * administración total de forma silenciosa.
 *
 * Simetría con `rol-asignado.ts`, deliberada: mismo criterio de que el rechazo es un
 * `ErrorValidacionDominio` (→ `400` con el campo `permisoIds`) y no un `403`. El `403` de este
 * sistema significa "no puedes usar este endpoint" y lo decide `PermisosGuard` (FR-003); aquí
 * el actor SÍ puede usar el endpoint, lo que se rechaza es un VALOR del cuerpo — así el
 * formulario lo pinta junto a la matriz de permisos.
 *
 * Implementa: FR-055 (gestión de roles y sus permisos) y FR-057 (ninguna operación puede
 * repartir la capacidad de administrar el sistema saltándose sus invariantes).
 */
import { ErrorValidacionDominio } from '../../dominio/comunes/errores';
import type { ClavePermiso, Permiso } from '../../dominio/entidades/permiso';

/**
 * Lanza `ErrorValidacionDominio` si la matriz solicitada concede algún permiso que el actor no
 * posee.
 *
 * `permisosDelActor` son los permisos EFECTIVOS del usuario autenticado, resueltos por el guard
 * en esta misma petición desde la base de datos (FR-058) — nunca un dato del cuerpo.
 *
 * `catalogo` se recibe ya leído (en vez de consultarlo aquí) porque los dos llamadores lo
 * necesitan de todas formas para traducir los `permisoIds` del cuerpo a claves, y así el
 * catálogo se lee UNA sola vez por petición.
 */
export function exigirQueNoConcedaPermisosQueNoTiene(
  permisoIdsSolicitados: readonly number[],
  catalogo: readonly Permiso[],
  permisosDelActor: readonly ClavePermiso[],
): void {
  const solicitados = catalogo.filter((permiso) => permisoIdsSolicitados.includes(permiso.id));
  const queNoTiene = solicitados
    .map((permiso) => permiso.clave)
    .filter((clave) => !permisosDelActor.includes(clave));

  if (queNoTiene.length === 0) {
    return;
  }

  const mensaje =
    'No puedes conceder permisos que tu propio rol no tiene ' +
    `(${queNoTiene.join(', ')}). Solo puedes armar roles con permisos que ya tengas.`;
  throw new ErrorValidacionDominio(mensaje, { permisoIds: mensaje });
}
