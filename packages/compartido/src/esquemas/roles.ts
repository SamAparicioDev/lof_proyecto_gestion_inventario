/**
 * Esquemas de administración de roles — alta, edición de la matriz de permisos, cambio de
 * estado y filtro del listado, exclusivos de quien tenga el permiso `roles.gestionar`
 * (contracts/api-rest.md § Roles y permisos, T104).
 *
 * NO hay esquema de "crear permiso" a propósito: el catálogo de permisos es de SOLO LECTURA
 * desde la aplicación (FR-056) — cada permiso corresponde a una verificación real del código
 * (`@RequierePermiso('...')`), así que se siembra con el despliegue. Lo que el Administrador
 * edita es la MATRIZ rol↔permiso, que sí es dato operativo (research R16).
 *
 * Implementa: FR-055 (crear, editar, activar/desactivar y consultar roles, y asignar o quitar
 * permisos a cada rol), FR-056 (el catálogo no se administra desde aquí) y FR-016/FR-047
 * (mensajes en español que indican el campo).
 *
 * Los invariantes de FR-057 (no eliminar un rol del sistema, no eliminar un rol con usuarios,
 * no dejar sin `roles.gestionar` al último rol activo que lo tiene) NO viven aquí: son reglas
 * de NEGOCIO que dependen del estado de la base —cuántos usuarios tiene ese rol, cuántos roles
 * activos conceden ese permiso—, no de la forma del cuerpo de la petición. Se verifican en los
 * casos de uso de `backend/src/aplicacion/roles/` (mismo criterio que el bloqueo de
 * auto-desactivación de usuarios, ver TSDoc de `esquemaCambiarEstadoUsuario`).
 *
 * Sigue el patrón de esquemas/autenticacion.ts (archivo ejemplar).
 */
import { z } from 'zod';
import { esquemaPaginacion } from './comunes';

/** Longitud máxima de `roles.nombre` (VARCHAR(50) — data-model.md § roles). */
const NOMBRE_MAX = 50;
/** Longitud máxima de `roles.descripcion` (VARCHAR(200) — data-model.md § roles). */
const DESCRIPCION_MAX = 200;

/**
 * Conjunto de permisos del rol, por ID del catálogo (es lo que el contrato define como cuerpo
 * de `POST`/`PUT /api/roles`: los ids que el Administrador marcó en la pantalla).
 *
 * No se exige un mínimo de permisos: un rol sin ninguno es válido —describe a un usuario que
 * entra al sistema y solo puede ver su perfil— y ningún requisito lo prohíbe (Principio V, no
 * se inventan reglas). Lo que SÍ se exige es que el campo venga: en `PUT` este arreglo
 * REEMPLAZA el conjunto completo, así que omitirlo es ambiguo ("dejar como está" vs. "quitar
 * todos") y el contrato no lo declara opcional.
 */
function esquemaPermisoIds() {
  return z.array(
    z
      .number({ invalid_type_error: 'Los permisos seleccionados no son válidos' })
      .int('Los permisos seleccionados no son válidos')
      .positive('Los permisos seleccionados no son válidos'),
    {
      required_error: 'Debes indicar los permisos del rol',
      invalid_type_error: 'Debes indicar los permisos del rol',
    },
  );
}

/**
 * Construye el esquema de rol — reutilizado por crear y actualizar, que comparten shape
 * exacto (contracts/api-rest.md: ambos reciben `{nombre, descripcion?, permisoIds[]}`), mismo
 * patrón que `esquemas/clientes.ts`.
 */
function construirEsquemaRol() {
  return z.object({
    nombre: z
      .string({ required_error: 'El nombre del rol es obligatorio' })
      .trim()
      .min(1, 'El nombre del rol es obligatorio')
      .max(NOMBRE_MAX, `El nombre del rol no puede superar ${NOMBRE_MAX} caracteres`),
    descripcion: z
      .string()
      .trim()
      .max(DESCRIPCION_MAX, `La descripción no puede superar ${DESCRIPCION_MAX} caracteres`)
      .optional(),
    permisoIds: esquemaPermisoIds(),
  });
}

/** Body de `POST /api/roles` — nace `esSistema=false` y `estado=ACTIVO` (FR-055). */
export const esquemaCrearRol = construirEsquemaRol();
export type DatosCrearRol = z.infer<typeof esquemaCrearRol>;

/**
 * Body de `PUT /api/roles/:id` — mismo shape que el alta. `permisoIds` REEMPLAZA el conjunto
 * completo de permisos del rol (desmarcar una casilla quita el permiso), no lo fusiona.
 */
export const esquemaActualizarRol = construirEsquemaRol();
export type DatosActualizarRol = z.infer<typeof esquemaActualizarRol>;

/**
 * Body de `PUT /api/roles/:id/estado` — baja lógica de un rol, nunca DELETE (data-model.md
 * § roles). Que un rol del sistema no pueda desactivarse, y que no pueda desactivarse el
 * último rol activo con `roles.gestionar`, son reglas de negocio del caso de uso (FR-057);
 * este esquema solo valida la FORMA del body.
 */
export const esquemaCambiarEstadoRol = z.object({
  estado: z.enum(['ACTIVO', 'INACTIVO'], { errorMap: () => ({ message: 'El estado no es válido' }) }),
});
export type DatosCambiarEstadoRol = z.infer<typeof esquemaCambiarEstadoRol>;

/**
 * Query de `GET /api/roles?estado=` — filtro de estado más la paginación común a todos los
 * listados (`esquemas/comunes.ts`), mismo patrón que `esquemaFiltroUsuarios`.
 */
export const esquemaFiltroRoles = z
  .object({
    estado: z
      .enum(['ACTIVO', 'INACTIVO'], { errorMap: () => ({ message: 'El estado no es válido' }) })
      .optional(),
  })
  .merge(esquemaPaginacion);
export type FiltroRoles = z.infer<typeof esquemaFiltroRoles>;
