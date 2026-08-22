/**
 * Guard `SuperAdminGuard` — deja pasar SOLO al super administrador en los endpoints marcados con
 * `@SoloSuperAdmin()` (US36, FR-148).
 *
 * ## Qué lo distingue de `PermisosGuard`
 *
 * `PermisosGuard` pregunta "¿tu rol concede esta capacidad?" y trata al super administrador como
 * la excepción que concede todo. Este guard pregunta lo contrario: "¿eres TÚ?". No hay permiso que
 * pueda sustituirlo, ni rol a medida que lo alcance, ni casilla que marcar en `/roles` — un
 * Administrador con los permisos del catálogo completos recibe `403` aquí, y eso no es un hueco
 * de configuración sino el diseño (SC-019).
 *
 * Corre en el orden global de `app.module.ts`, DESPUÉS de `JwtAuthGuard`: cuando evalúa, o existe
 * `request.user` o la petición ya murió con `401`. Un endpoint sin el decorador no le concierne.
 *
 * `esSuperAdmin` es una columna que solo la base de datos puede cambiar (US30, FR-127), no una
 * fila de `roles_permisos`. Por eso vaciar la matriz de permisos no abre ni cierra esta puerta.
 *
 * Sigue exigiendo sesión válida y usuario ACTIVO — igual que `PermisosGuard`: el respaldo del
 * sistema evita el bloqueo por permisos, nunca la autenticación.
 *
 * Implementa: FR-148, FR-003 (verificado siempre en el servidor; ocultar el enlace del menú no es
 * seguridad, Principio V de la constitución).
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Usuario } from '../../../../dominio/entidades/usuario';
import { CLAVE_METADATA_SUPER_ADMIN } from '../solo-super-admin.decorator';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const exigido = this.reflector.getAllAndOverride<boolean | undefined>(CLAVE_METADATA_SUPER_ADMIN, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!exigido) {
      return true;
    }

    const { user } = contexto.switchToHttp().getRequest<{ user?: Usuario }>();
    if (!user || user.estado !== 'ACTIVO' || !user.rolAsignado.esSuperAdmin) {
      // El mensaje NO revela que exista un módulo reservado: para quien no es, no hay nada que ver.
      throw new ForbiddenException({
        error: { mensaje: 'No tienes permisos para realizar esta acción.', campos: null },
      });
    }
    return true;
  }
}
