/**
 * Invariante anti-bloqueo de FR-057, compartido por TODAS las operaciones que pueden
 * dispararlo: **el sistema nunca puede quedarse sin capacidad de administrar roles NI
 * usuarios**.
 *
 * Es el mismo tipo de regla que "un administrador no puede desactivarse a sí mismo" (US6):
 * protege a la organización de una acción legítima en apariencia y catastrófica en efecto —
 * si nadie puede administrar, recuperar el sistema exige tocar la base de datos a mano. Es el
 * "riesgo principal" que research R16 identificó al convertir los permisos en datos.
 *
 * ## Qué se cuenta, y por qué (corrección de la revisión adversarial de la Tanda 13)
 *
 * La primera versión de esta pieza contaba **roles activos** que concedían `roles.gestionar`.
 * Eso deja pasar el bloqueo por dos caminos, ambos demostrados contra la API real:
 *
 * 1. Un rol con el permiso y CERO usuarios satisface el conteo pero no administra nada: bastaba
 *    crear ese rol huérfano (`POST /api/roles`) y acto seguido quitarle el permiso al rol que sí
 *    tenía gente (`PUT /api/roles/:id`) para dejar el sistema sin nadie que pudiera administrarlo.
 * 2. Los usuarios tienen su propia puerta: cambiarle el rol al último administrador
 *    (`PUT /api/usuarios/:id`) o desactivarlo (`PUT /api/usuarios/:id/estado`) produce el mismo
 *    estado sin pasar por `/api/roles`.
 *
 * De ahí las DOS verificaciones que exporta este archivo, complementarias y ambas necesarias:
 *
 * - `exigirQueSigaHabiendoUnRolActivoQueConceda` — sigue siendo la que impide quedarse sin
 *   ningún ROL asignable con el permiso (un rol INACTIVO ya no se ofrece en el selector de
 *   usuarios, así que no sirve de suplente).
 * - `exigirQueSigaHabiendoQuienPuedaEjercerlo` — la que faltaba: cuenta USUARIOS ACTIVOS cuyo
 *   rol concede el permiso, que es lo que FR-057 protege de verdad.
 *
 * Y las dos se aplican a los DOS permisos críticos (`PERMISOS_CRITICOS_DE_ADMINISTRACION`), no
 * solo a `roles.gestionar`: FR-057 dice "administrar roles **o usuarios**", y dejar el sistema
 * sin nadie que administre usuarios era posible con una sola petición.
 *
 * ## Dónde NO alcanza esta pieza (y quién lo cubre)
 *
 * Estas funciones verifican ANTES de escribir, así que entre la verificación y la escritura
 * cabe otra petición. Para las mutaciones de USUARIO —donde la revisión demostró que dos
 * administradores desactivándose mutuamente llegan a cero al primer intento— la garantía real
 * es transaccional y vive en el adaptador (`GuardiaCapacidadAdministrativa`: bloqueo
 * `FOR UPDATE` de los titulares + revalidación dentro de la misma transacción). Estas
 * verificaciones previas siguen existiendo porque son las que dan el mensaje en español que
 * explica QUÉ se estaba intentando hacer.
 *
 * Para las mutaciones de ROL queda la ventana conocida y aceptada (misma que antes de esta
 * corrección, Principio V): dos peticiones simultáneas sobre DOS roles distintos que concedan
 * el permiso podrían leer el conteo antes de que la otra escriba. Con un solo Administrador
 * operando la pantalla de roles no se justifica serializar la transacción.
 *
 * Verificado en el CASO DE USO, no solo en la interfaz (mandato de FR-057 y del Principio III):
 * ocultar el botón en la pantalla de roles no impide la petición directa a la API.
 *
 * Implementa: FR-057 (ninguna operación puede dejar a la organización sin capacidad de
 * administrar roles o usuarios) y FR-055 (el CRUD de roles ocurre dentro de esa garantía).
 */
import { EstadoInvalido } from '../../dominio/comunes/errores';
import {
  PERMISO_GESTION_ROLES,
  PERMISOS_CRITICOS_DE_ADMINISTRACION,
  type ClavePermiso,
} from '../../dominio/entidades/permiso';
import type { Rol } from '../../dominio/entidades/rol';
import type { RepositorioRoles } from '../../dominio/puertos/repositorio-roles';
import type {
  GuardiaCapacidadAdministrativa,
  RepositorioUsuarios,
} from '../../dominio/puertos/repositorio-usuarios';

/**
 * Qué se pierde, en español, si nadie conserva el permiso. Un solo sitio para los dos textos:
 * los mensajes de `409` de roles y de usuarios deben nombrar la MISMA capacidad para que el
 * Administrador entienda que son la misma regla vista desde dos pantallas (FR-016).
 */
export function capacidadQueConcede(permiso: ClavePermiso): string {
  return permiso === PERMISO_GESTION_ROLES ? 'administrar roles y permisos' : 'administrar usuarios';
}

/**
 * Lanza `EstadoInvalido` (→ `409`) si `rol` es el ÚLTIMO rol activo que concede `permiso`. No
 * hace nada cuando la operación no puede reducir ese conteo:
 *
 * - si el rol NO concede el permiso, quitárselo/desactivarlo/eliminarlo no cambia nada;
 * - si el rol ya está INACTIVO, tampoco lo cuenta `contarRolesActivosConPermiso`, así que
 *   ninguna operación sobre él puede dejar el conteo en cero.
 *
 * El conteo se consulta solo cuando hace falta (una consulta, y únicamente en el caso
 * peligroso). `mensajeSiEsElUltimo` lo da cada caso de uso porque el texto debe decir en
 * español QUÉ se estaba intentando hacer (FR-016/FR-047).
 */
export async function exigirQueSigaHabiendoUnRolActivoQueConceda(
  repositorioRoles: RepositorioRoles,
  rol: Rol,
  permiso: ClavePermiso,
  mensajeSiEsElUltimo: string,
): Promise<void> {
  const puedeReducirElConteo = rol.estado === 'ACTIVO' && rol.permisos.includes(permiso);
  if (!puedeReducirElConteo) {
    return;
  }

  const rolesActivosQueLoConceden = await repositorioRoles.contarRolesActivosConPermiso(permiso);
  if (rolesActivosQueLoConceden <= 1) {
    throw new EstadoInvalido(mensajeSiEsElUltimo);
  }
}

/**
 * Lanza `EstadoInvalido` (→ `409`) si, tras dejar `rolQueDejaDeConcederlo` sin `permiso`,
 * NINGÚN usuario ACTIVO podría seguir ejerciéndolo.
 *
 * Es la verificación que le faltaba a la anterior: quien administra el sistema es una PERSONA
 * con un rol, no un rol suelto. Excluye a los titulares que tienen justamente el rol que se
 * está editando —son los que perderían el permiso— y exige que quede al menos uno más.
 */
export async function exigirQueSigaHabiendoQuienPuedaEjercerlo(
  repositorioUsuarios: RepositorioUsuarios,
  permiso: ClavePermiso,
  rolQueDejaDeConcederlo: number,
  mensajeSiNoQuedaNadie: string,
): Promise<void> {
  const titulares = await repositorioUsuarios.listarTitularesActivosDePermiso(permiso);
  const sobrevivientes = titulares.filter((titular) => titular.rolId !== rolQueDejaDeConcederlo);
  if (titulares.length > 0 && sobrevivientes.length === 0) {
    throw new EstadoInvalido(mensajeSiNoQuedaNadie);
  }
}

/**
 * Arma la red de seguridad transaccional que acompaña a toda mutación de USUARIO capaz de
 * reducir la capacidad de administración (`RepositorioUsuarios.actualizar`/`cambiarEstado`).
 *
 * `accion` describe en español lo que se intentaba hacer, en infinitivo y ya con su
 * complemento (p. ej. `cambiarle el rol a "Ana Pérez"`), para que el `409` diga qué se rechazó
 * y por qué (FR-016/FR-047).
 */
export function guardiaDeCapacidadAdministrativa(accion: string): GuardiaCapacidadAdministrativa {
  const mensajePorPermiso: Record<ClavePermiso, string> = {};
  for (const permiso of PERMISOS_CRITICOS_DE_ADMINISTRACION) {
    mensajePorPermiso[permiso] =
      `No puedes ${accion}: el sistema quedaría sin ningún usuario activo que pueda ` +
      `${capacidadQueConcede(permiso)}.`;
  }
  return { permisos: PERMISOS_CRITICOS_DE_ADMINISTRACION, mensajePorPermiso };
}
