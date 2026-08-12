/**
 * Esquemas de administración de usuarios — alta, edición, restablecimiento de contraseña y
 * cambio de estado, exclusivos del rol Administrador (contracts/api-rest.md § Usuarios).
 *
 * Implementa: FR-005 (alta/edición/listado de usuario por el Administrador), FR-006 (rol
 * asignado en el alta), FR-007 (la contraseña nunca viaja en la entidad `Usuario` de
 * respuesta — este archivo solo valida la ENTRADA de los formularios), FR-008 (baja lógica,
 * nunca DELETE — `esquemaCambiarEstadoUsuario` solo admite ACTIVO/INACTIVO) y FR-009
 * (login/email obligatorios y con formato válido; la unicidad concurrente la refuerza la
 * BD, esto solo valida la FORMA) y FR-016/FR-047 (mensajes en español que indican el campo).
 *
 * La política de contraseña (mínimo 8, máximo 72 caracteres) es la MISMA que
 * `esquemaCambiarPassword.passwordNueva` de `esquemas/autenticacion.ts` (archivo ejemplar) —
 * una sola regla de negocio para "qué es una contraseña válida" en todo el sistema.
 *
 * Sigue el patrón de esquemas/autenticacion.ts.
 */
import { z } from 'zod';
import { esquemaIdFiltro, esquemaPaginacion } from './comunes';

/** Límite inferior de una contraseña (temporal o propia) — mismo criterio en todo el sistema. */
const PASSWORD_MIN = 8;
/** Límite superior de una contraseña — límite práctico de bcrypt (72 bytes). */
const PASSWORD_MAX = 72;

/**
 * Contraseña temporal asignada por el Administrador al crear un usuario o al restablecer
 * la suya — misma política que `esquemaCambiarPassword.passwordNueva` (FR-005).
 */
function esquemaPasswordTemporal() {
  return z
    .string({ required_error: 'La contraseña temporal es obligatoria' })
    .min(PASSWORD_MIN, `La contraseña temporal debe tener al menos ${PASSWORD_MIN} caracteres`)
    .max(PASSWORD_MAX, `La contraseña temporal no puede superar ${PASSWORD_MAX} caracteres`);
}

/**
 * Rol asignado al usuario, por ID de la tabla `roles` (US9/T104 — reemplaza al enum
 * `ADMINISTRADOR|GERENTE|OPERARIO` que este esquema validaba antes).
 *
 * Por qué un id y no un nombre: desde US9 los roles son DATOS administrables (FR-054) — el
 * Administrador crea los suyos y puede renombrar los propios, así que el nombre no es un
 * identificador estable y la lista de valores válidos ya no se conoce en tiempo de
 * compilación. Que el rol exista de verdad NO se valida aquí (este esquema solo valida la
 * FORMA): lo verifica el caso de uso contra `RepositorioRoles`, que responde `400` con el
 * campo `rolId` si el id no corresponde a ningún rol.
 */
const esquemaRolId = z
  .number({ required_error: 'El rol es obligatorio', invalid_type_error: 'El rol no es válido' })
  .int('El rol no es válido')
  .positive('El rol no es válido');

/** Body de `POST /api/usuarios` (contracts/api-rest.md, FR-005). */
export const esquemaCrearUsuario = z.object({
  nombreCompleto: z
    .string({ required_error: 'El nombre completo es obligatorio' })
    .trim()
    .min(1, 'El nombre completo es obligatorio')
    .max(150, 'El nombre completo no puede superar 150 caracteres'),
  email: z
    .string({ required_error: 'El correo es obligatorio' })
    .trim()
    .min(1, 'El correo es obligatorio')
    .max(150, 'El correo no puede superar 150 caracteres')
    .email('El correo no es válido'),
  login: z
    .string({ required_error: 'El usuario es obligatorio' })
    .trim()
    .min(1, 'El usuario es obligatorio')
    .max(50, 'El usuario no puede superar 50 caracteres'),
  passwordTemporal: esquemaPasswordTemporal(),
  rolId: esquemaRolId,
});
export type DatosCrearUsuario = z.infer<typeof esquemaCrearUsuario>;

/**
 * Body de `PUT /api/usuarios/:id` — mismos criterios de `nombreCompleto`/`email`/`rolId` que
 * crear, sin `login` (identificador de negocio inmutable tras el alta, mismo criterio que
 * el SKU de producto) ni contraseña (se gestiona vía `esquemaRestablecerPasswordUsuario`).
 */
export const esquemaActualizarUsuario = z.object({
  nombreCompleto: z
    .string({ required_error: 'El nombre completo es obligatorio' })
    .trim()
    .min(1, 'El nombre completo es obligatorio')
    .max(150, 'El nombre completo no puede superar 150 caracteres'),
  email: z
    .string({ required_error: 'El correo es obligatorio' })
    .trim()
    .min(1, 'El correo es obligatorio')
    .max(150, 'El correo no puede superar 150 caracteres')
    .email('El correo no es válido'),
  rolId: esquemaRolId,
});
export type DatosActualizarUsuario = z.infer<typeof esquemaActualizarUsuario>;

/**
 * Body de `PUT /api/auth/perfil` — los datos que un usuario edita DE SÍ MISMO (US14, FR-080).
 *
 * Es `esquemaActualizarUsuario` SIN `rolId`, y esa ausencia es la funcionalidad, no un olvido:
 * `.object()` de Zod DESCARTA las claves que no declara, así que un `rolId`, `estado` o `login`
 * enviados en el cuerpo no llegan siquiera al caso de uso (FR-082). Cambiarse el propio rol
 * sería una escalada de privilegios —justo lo que FR-057b impide en la gestión de roles— y
 * cambiarse el estado, darse de baja a uno mismo.
 *
 * Los campos se derivan de `esquemaActualizarUsuario.shape` para que las reglas y los mensajes
 * sean literalmente los MISMOS: si mañana cambia el límite del nombre, cambia en los dos sitios
 * a la vez. La contraseña no está aquí: la cambia `esquemaCambiarPassword`, que exige la
 * actual — permitirla en este endpoint dejaría cambiarla sin conocer la anterior.
 */
export const esquemaActualizarMiPerfil = z.object({
  nombreCompleto: esquemaActualizarUsuario.shape.nombreCompleto,
  email: esquemaActualizarUsuario.shape.email,
});
export type DatosActualizarMiPerfil = z.infer<typeof esquemaActualizarMiPerfil>;

/**
 * Body de `PUT /api/usuarios/:id/restablecer-password` — a diferencia de
 * `esquemaCambiarPassword` (que exige la contraseña actual para que el propio usuario
 * cambie la suya), el Administrador restablece la de OTRO usuario sin conocerla; el caso
 * de uso marca `debeCambiarPassword=true` para forzar el cambio en el siguiente login.
 */
export const esquemaRestablecerPasswordUsuario = z.object({
  passwordTemporal: esquemaPasswordTemporal(),
});
export type DatosRestablecerPasswordUsuario = z.infer<typeof esquemaRestablecerPasswordUsuario>;

/**
 * Body de `PUT /api/usuarios/:id/estado` — baja lógica de un usuario (Principio II/III:
 * nunca DELETE). El bloqueo de auto-desactivación (US6-AS, 409) es una regla de negocio que
 * vive en el caso de uso, no aquí: este esquema solo valida la FORMA del body.
 */
export const esquemaCambiarEstadoUsuario = z.object({
  estado: z.enum(['ACTIVO', 'INACTIVO'], { errorMap: () => ({ message: 'El estado no es válido' }) }),
});
export type DatosCambiarEstadoUsuario = z.infer<typeof esquemaCambiarEstadoUsuario>;

/**
 * Query de `GET /api/usuarios?estado=&rolId=` — filtros de estado y rol más la paginación común
 * a todos los listados (`esquemas/comunes.ts`), mismo patrón que `esquemaFiltroClientes`
 * (FR-005).
 *
 * `rolId` (US13, FR-075/FR-076) responde "¿quiénes tienen este rol?", la pregunta que el
 * Administrador se hace antes de editar la matriz de permisos de un rol. Va por ID y no por
 * nombre por el MISMO motivo que en el alta (US9/T104): los roles son datos administrables, sus
 * nombres cambian y la lista de valores válidos no se conoce en tiempo de compilación. Que el
 * rol EXISTA no se valida aquí ni en el caso de uso: un `rolId` sin usuarios devuelve una página
 * vacía, que es la respuesta correcta de un filtro (no un `400`).
 */
export const esquemaFiltroUsuarios = z
  .object({
    estado: z.enum(['ACTIVO', 'INACTIVO'], { errorMap: () => ({ message: 'El estado no es válido' }) }).optional(),
    rolId: esquemaIdFiltro('El rol no es válido'),
  })
  .merge(esquemaPaginacion);
export type FiltroUsuarios = z.infer<typeof esquemaFiltroUsuarios>;
