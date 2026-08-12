/**
 * Decorador `@RequierePermiso('modulo.accion')` — declara QUÉ permiso exige un endpoint.
 * Fija la metadata que `PermisosGuard` compara contra los permisos efectivos del usuario
 * autenticado, resueltos desde la BD en cada petición (FR-058).
 *
 * Reemplaza a `@Roles(...)`: en vez de enumerar QUIÉN puede entrar (una lista de nombres de
 * rol fija en el código), declara QUÉ CAPACIDAD hace falta. Quién la tiene es dato
 * administrable (`roles_permisos`), así que el dueño del negocio puede crear un rol
 * "Bodeguero" sin tocar el código ni volver a desplegar (US9, research R16).
 *
 * **Un solo permiso por endpoint, a propósito.** El decorador NO es variádico: la tabla de
 * mapeo de T100 es 1:1 (un permiso por OPERACIÓN de negocio — listar y ver detalle comparten
 * `*.ver`, los 3 endpoints de carga masiva comparten `productos.importar`), así que aceptar
 * varias claves solo abriría la pregunta "¿se exigen todas o basta una?" — exactamente el
 * tipo de ambigüedad que la Constitución prohíbe en el control de acceso (Principio III).
 * Donde `@Roles('ADMINISTRADOR','GERENTE')` enumeraba dos roles, ahora va UN permiso que esos
 * dos roles tienen concedido.
 *
 * Uso (se puede poner en un método o en la clase del controlador, igual que `@Roles`; el del
 * método gana sobre el de la clase):
 *
 * ```ts
 * @Put(':id/estado')
 * @RequierePermiso('productos.cambiar_estado')
 * async cambiarEstado(...) { ... }
 * ```
 *
 * Un endpoint SIN este decorador queda accesible a cualquier usuario autenticado (mismo
 * criterio que `@Roles`: no todas las rutas restringen — p. ej. `/api/auth/perfil`).
 *
 * Implementa: FR-003 (autorización verificada SIEMPRE en el servidor — ocultar un botón en la
 * UI nunca es suficiente) y FR-058 (cada endpoint se verifica contra un permiso, nunca contra
 * un nombre de rol fijo en el código).
 */
import { CustomDecorator, SetMetadata } from '@nestjs/common';
import type { ClavePermiso } from '../../../dominio/entidades/permiso';

/** Llave de la metadata que lee `PermisosGuard` (`interfaces/http/comunes/guards`). */
export const CLAVE_METADATA_PERMISO = 'permiso_requerido';

export const RequierePermiso = (permiso: ClavePermiso): CustomDecorator =>
  SetMetadata(CLAVE_METADATA_PERMISO, permiso);
