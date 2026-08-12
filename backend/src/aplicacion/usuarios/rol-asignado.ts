/**
 * Reglas compartidas por el alta y la edición de usuarios sobre el ROL que se les asigna
 * (`POST`/`PUT /api/usuarios`, US9/T106). Son dos, y ninguna vive en el dominio porque ambas
 * necesitan consultar un puerto; el dominio no consulta, decide.
 *
 * 1. **El rol asignado debe existir** — un usuario no puede quedar apuntando a un rol
 *    inexistente. Se verifica ANTES de escribir para dar el mensaje correcto: sin esto, la
 *    violación de la FK llegaría como un código de Prisma que el adaptador solo puede traducir
 *    a ciegas (ver `traducirErrorAltaUsuario`, que queda como red de seguridad ante la carrera).
 *
 * 2. **Nadie puede conceder permisos que no tiene** (corrección de la revisión adversarial de
 *    la Tanda 13, hallazgo HIGH de escalada de privilegios). Hasta esta corrección el alta y la
 *    edición solo comprobaban que el `rolId` EXISTIERA: cualquier rol propio con
 *    `usuarios.gestionar` podía asignarse a sí mismo el rol Administrador en UNA petición —sin
 *    re-login, porque los permisos se resuelven en cada petición (US9-AS3)— y quedarse con los
 *    30 permisos, incluido `roles.gestionar`. Es decir, `usuarios.gestionar` era en la práctica
 *    el permiso de "administrador total", y los tres invariantes que FR-057 gasta para que
 *    `roles.gestionar` no se PIERDA no servían de nada mientras esta puerta lateral lo
 *    REPARTÍA sin control. La pantalla lo disimulaba (ese rol recibe `403` en `GET /api/roles`,
 *    así que el selector se veía vacío), pero el `rolId` viaja en el cuerpo.
 *
 *    Con los tres roles del sistema la regla no cambia NADA observable (SC-013): Administrador
 *    —el único que hoy tiene `usuarios.gestionar`— concede los 30 permisos del catálogo, así
 *    que cualquier rol es un subconjunto suyo. Solo restringe lo que US9 hizo posible: roles
 *    propios con `usuarios.gestionar` y un subconjunto del resto.
 *
 * Por qué viven como pieza aparte y no como copias en cada caso de uso: son las MISMAS dos
 * reglas con los MISMOS mensajes en el alta y en la edición, y dos copias podrían divergir.
 *
 * Por qué no se exige además que el rol esté ACTIVO: ningún artefacto lo pide (spec, data-model
 * ni contrato), y desactivar un rol NO retira sus permisos a quien ya lo tiene (ver TSDoc de
 * `CambiarEstadoRolCasoUso`) — inventar aquí un rechazo sería una regla que nadie especificó
 * (Principio V). Lo que corresponde es que el selector de la pantalla de usuarios ofrezca solo
 * roles activos (`GET /api/roles?estado=ACTIVO`, T108).
 *
 * Implementa: FR-005/FR-006 (el Administrador asigna un rol al dar de alta o editar un
 * usuario), FR-016/FR-047 (el error señala el campo, en español), FR-054 (los roles son datos,
 * así que su validez se consulta en la base y no contra una lista fija en el código) y FR-057
 * (nadie puede repartir la capacidad de administrar el sistema saltándose sus invariantes).
 */
import { ErrorValidacionDominio } from '../../dominio/comunes/errores';
import type { ClavePermiso } from '../../dominio/entidades/permiso';
import type { Rol } from '../../dominio/entidades/rol';
import type { RepositorioRoles } from '../../dominio/puertos/repositorio-roles';

/** Mensaje único del rechazo — el mismo texto en el cuerpo general y en el campo `rolId`,
 *  para que el formulario lo pinte junto al selector de rol (FR-016). */
const MENSAJE_ROL_INEXISTENTE = 'El rol seleccionado no existe';

/**
 * Resuelve el rol que se va a asignar y verifica las dos reglas del encabezado. Devuelve el
 * rol ya leído para que el caso de uso no tenga que volver a pedirlo (lo necesita para saber
 * si el cambio retira permisos críticos — FR-057).
 *
 * `permisosDelActor` son los permisos EFECTIVOS del usuario autenticado que ejecuta la
 * operación, resueltos por el guard en esta misma petición desde la BD (`rolAsignado.permisos`,
 * FR-058) — nunca un dato del cuerpo.
 */
export async function exigirRolAsignable(
  repositorioRoles: RepositorioRoles,
  rolId: number,
  permisosDelActor: readonly ClavePermiso[],
): Promise<Rol> {
  const rol = await repositorioRoles.buscarPorId(rolId);
  if (!rol) {
    throw new ErrorValidacionDominio(MENSAJE_ROL_INEXISTENTE, { rolId: MENSAJE_ROL_INEXISTENTE });
  }
  exigirQueNoConcedaMasDeLoQueTiene(rol, permisosDelActor);
  return rol;
}

/**
 * Lanza `ErrorValidacionDominio` (→ `400` con el campo `rolId`) si `rol` concede algún permiso
 * que el actor no tiene.
 *
 * Se responde como error de CAMPO y no como `403` a propósito: el `403` de este sistema
 * significa "no puedes usar este endpoint" y lo decide `PermisosGuard` (FR-003); lo que aquí
 * se rechaza es un VALOR del cuerpo —igual que un `rolId` inexistente—, así que el formulario
 * lo pinta junto al selector de rol y el contrato de `/api/usuarios` conserva sus códigos.
 */
function exigirQueNoConcedaMasDeLoQueTiene(rol: Rol, permisosDelActor: readonly ClavePermiso[]): void {
  const permisosQueNoTienes = rol.permisos.filter((permiso) => !permisosDelActor.includes(permiso));
  if (permisosQueNoTienes.length === 0) {
    return;
  }

  const mensaje =
    `No puedes asignar el rol "${rol.nombre}": concede permisos que tu propio rol no tiene ` +
    `(${permisosQueNoTienes.join(', ')}). Solo puedes asignar roles cuyos permisos ya tengas.`;
  throw new ErrorValidacionDominio(mensaje, { rolId: mensaje });
}

/**
 * Lanza `ErrorValidacionDominio` (→ `400`) si el usuario OBJETIVO tiene un rol con permisos que
 * el actor no tiene. La usa el restablecimiento de contraseña (`PUT
 * /api/usuarios/:id/restablecer-password`).
 *
 * Es la otra mitad de la misma protección contra la escalada: bloquear la ASIGNACIÓN de un rol
 * superior no sirve de nada si quien tiene `usuarios.gestionar` puede fijarle una contraseña
 * temporal al Administrador y entrar con ella. Con los tres roles del sistema tampoco cambia
 * nada (SC-013): solo el Administrador tiene hoy `usuarios.gestionar`, y ningún rol concede
 * permisos que él no tenga.
 */
export function exigirQueElObjetivoNoTengaMasPermisos(
  rolDelObjetivo: Rol,
  permisosDelActor: readonly ClavePermiso[],
): void {
  const permisosQueNoTienes = rolDelObjetivo.permisos.filter((permiso) => !permisosDelActor.includes(permiso));
  if (permisosQueNoTienes.length === 0) {
    return;
  }

  throw new ErrorValidacionDominio(
    `No puedes administrar a un usuario con el rol "${rolDelObjetivo.nombre}": concede permisos que tu ` +
      `propio rol no tiene (${permisosQueNoTienes.join(', ')}).`,
  );
}
