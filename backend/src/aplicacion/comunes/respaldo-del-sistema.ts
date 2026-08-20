/**
 * Las reglas que hacen del super administrador un RESPALDO y no un rol más (US30, FR-127/FR-128),
 * y la reserva de permisos que se apoya en él (US31, FR-131).
 *
 * Viven juntas y en un solo archivo porque son una sola idea repartida en seis casos de uso: el
 * rol de respaldo no se toca desde la API, y quien lo tiene tampoco. Una copia por caso de uso
 * sería seis sitios donde olvidarse de una comprobación, y basta con olvidar UNA para que el
 * respaldo deje de serlo — quien pueda restablecerle la contraseña entra como él, y todo lo
 * demás sobra.
 *
 * ## Por qué el actor viaja como bandera y no como lista de permisos
 *
 * El resto del sistema decide "¿puede este usuario?" mirando `permisosDelActor`. Para el super
 * administrador esa lista está VACÍA a propósito (su rol no tiene filas en `roles_permisos`), así
 * que cualquier regla que solo mire la lista lo trataría como al usuario con menos poder del
 * sistema. De ahí que todas estas funciones reciban `actorEsSuperAdmin`: es la MISMA decisión
 * que toma `PermisosGuard`, y por el mismo motivo — el respaldo no puede depender de datos que
 * alguien pueda borrar.
 *
 * Implementa: FR-127 (la autorización del respaldo no sale de la matriz), FR-128 (no se edita,
 * no se asigna, no se administra a quien lo tiene) y FR-131 (permisos reservados).
 */
import { EstadoInvalido, ErrorValidacionDominio } from '../../dominio/comunes/errores';
import {
  PERMISOS_RESERVADOS,
  RAZON_DE_LA_RESERVA,
  type ClavePermiso,
  type Permiso,
} from '../../dominio/entidades/permiso';
import type { Rol } from '../../dominio/entidades/rol';

/**
 * Rechaza cualquier operación de escritura sobre el ROL de respaldo (FR-128).
 *
 * `accion` completa la frase "no se puede …" para que el mensaje diga exactamente qué se
 * intentó, en vez de un "operación no permitida" que obliga a adivinar.
 */
export function exigirQueNoSeaElRolDeRespaldo(rol: Rol, accion: string): void {
  if (!rol.esSuperAdmin) {
    return;
  }
  throw new EstadoInvalido(
    `"${rol.nombre}" es el respaldo del sistema: no se puede ${accion}. Existe para que un error ` +
      'de permisos no pueda dejar la aplicación sin nadie que la administre, y eso solo se ' +
      'sostiene si nadie puede modificarlo desde aquí. Su asignación se hace únicamente desde la ' +
      'base de datos.',
  );
}

/**
 * Rechaza ASIGNAR el rol de respaldo a un usuario (FR-128). Es un error de CAMPO y no un `403`,
 * por el mismo criterio que el resto de validaciones sobre `rolId`: lo que se rechaza es un
 * valor del cuerpo, así que el formulario lo pinta junto al selector de rol.
 */
export function exigirQueElRolSeaAsignable(rol: Rol): void {
  if (!rol.esSuperAdmin) {
    return;
  }
  const mensaje =
    `El rol "${rol.nombre}" no se puede asignar desde la aplicación: es el respaldo del sistema y ` +
    'solo se concede desde la base de datos.';
  throw new ErrorValidacionDominio(mensaje, { rolId: mensaje });
}

/**
 * Rechaza administrar a un usuario que YA es super administrador, salvo que quien lo intente
 * también lo sea (FR-128).
 *
 * Es la mitad de la protección que se olvida: bloquear la asignación del rol no sirve de nada si
 * quien tiene `usuarios.gestionar` puede desactivar al respaldo, cambiarle el rol o fijarle una
 * contraseña temporal y entrar con ella. La comprobación existente
 * (`exigirQueElObjetivoNoTengaMasPermisos`) no lo cubre: compara listas de permisos, y la del
 * respaldo está vacía — el objetivo más poderoso del sistema parece el más inofensivo.
 */
export function exigirQueElObjetivoNoSeaElRespaldo(
  rolDelObjetivo: Rol,
  actorEsSuperAdmin: boolean,
  accion: string,
): void {
  if (!rolDelObjetivo.esSuperAdmin || actorEsSuperAdmin) {
    return;
  }
  throw new EstadoInvalido(
    `No puedes ${accion} a un usuario con el rol "${rolDelObjetivo.nombre}": es el respaldo del ` +
      'sistema. Solo otro super administrador puede administrarlo.',
  );
}

/**
 * Rechaza AÑADIR o QUITAR un permiso reservado si quien lo intenta no es super administrador
 * (US31, FR-131).
 *
 * Se evalúa sobre la DIFERENCIA entre lo que el rol tenía y lo que se le envía, no sobre el
 * conjunto enviado: un administrador debe poder seguir editando el nombre, la descripción y el
 * resto de casillas de un rol que YA tiene el permiso reservado, sin que el sistema le exija
 * quitárselo primero. Solo se detiene cuando la casilla reservada cambia de estado.
 *
 * `catalogo` traduce los ids del cuerpo a claves; los ids no dicen nada por sí mismos y dependen
 * del orden de siembra de cada instalación.
 */
export function exigirQueNoToqueUnPermisoReservado(
  permisosActuales: readonly ClavePermiso[],
  permisoIdsSolicitados: readonly number[],
  catalogo: readonly Permiso[],
  actorEsSuperAdmin: boolean,
): void {
  if (actorEsSuperAdmin) {
    return;
  }

  const clavesSolicitadas = catalogo
    .filter((permiso) => permisoIdsSolicitados.includes(permiso.id))
    .map((permiso) => permiso.clave);

  const tocados = PERMISOS_RESERVADOS.filter(
    (reservado) => permisosActuales.includes(reservado) !== clavesSolicitadas.includes(reservado),
  );
  if (tocados.length === 0) {
    return;
  }

  const explicados = tocados
    .map((clave) => `${clave} (${RAZON_DE_LA_RESERVA[clave] ?? 'permiso reservado'})`)
    .join('; ');
  throw new EstadoInvalido(
    `Solo un super administrador puede conceder o retirar ${explicados}. ` +
      'Puedes seguir editando el resto de este rol con normalidad.',
  );
}
