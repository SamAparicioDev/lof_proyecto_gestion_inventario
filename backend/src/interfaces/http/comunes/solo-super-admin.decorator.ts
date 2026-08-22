/**
 * Decorador `@SoloSuperAdmin()` — declara que un endpoint es exclusivo del SUPER ADMINISTRADOR
 * (US36, FR-148). Fija la metadata que lee `SuperAdminGuard`.
 *
 * ## Por qué no es un permiso
 *
 * Todo el control de acceso del sistema pasa por `@RequierePermiso('modulo.accion')`, y eso es
 * deliberado (US9): quién puede qué es dato administrable, no una lista de roles en el código. Este
 * decorador es la ÚNICA excepción, y existe porque el buzón de solicitudes no es una capacidad del
 * negocio sino la mesa de trabajo del dueño del sistema.
 *
 * La diferencia es concreta, no filosófica: un permiso se puede conceder. Si `solicitudes.gestionar`
 * existiera como fila en el catálogo, aparecería como casilla en `/roles` y bastaría un clic —o un
 * despiste— para que un Administrador entrara. Lo que garantiza que eso no pase no es que la casilla
 * esté desmarcada: es que la casilla NO EXISTE. Una capacidad que no se puede conceder no se
 * concede por error.
 *
 * Mismo criterio que `esSuperAdmin` en `PermisosGuard`: se lee una columna que solo la base de
 * datos puede cambiar, no una fila de `roles_permisos`.
 *
 * Uso (en el método o en la clase del controlador):
 *
 * ```ts
 * @Controller('solicitudes')
 * @SoloSuperAdmin()
 * export class ControladorSolicitudes { ... }
 * ```
 *
 * Implementa: FR-148 (el buzón se resuelve por ROL y no contra la matriz de permisos),
 * FR-003 (la autorización se verifica siempre en el servidor).
 */
import { CustomDecorator, SetMetadata } from '@nestjs/common';

/** Llave de la metadata que lee `SuperAdminGuard`. */
export const CLAVE_METADATA_SUPER_ADMIN = 'solo_super_admin';

export const SoloSuperAdmin = (): CustomDecorator => SetMetadata(CLAVE_METADATA_SUPER_ADMIN, true);
