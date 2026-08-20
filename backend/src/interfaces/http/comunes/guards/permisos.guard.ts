/**
 * Guard `PermisosGuard` — autoriza cada petición contra los PERMISOS EFECTIVOS del rol del
 * usuario autenticado (`request.user.rolAsignado.permisos`), no contra un nombre de rol fijo
 * en el código. Es el mecanismo que reemplaza a `RolesGuard` (US9, research R16).
 *
 * De dónde salen los permisos, y por qué importa: `EstrategiaJwt` revalida al usuario en BD
 * en CADA petición autenticada (el JWT solo lleva `{ sub }`), y desde T101 esa misma lectura
 * trae el rol con sus permisos en un `include` anidado. Así, quitarle un permiso a un rol
 * surte efecto en la petición siguiente, sin que el usuario tenga que volver a iniciar sesión
 * (US9-AS3) y sin agregar una consulta: cachear permisos en el JWT fue descartado
 * explícitamente por esa razón (research R16, alternativas descartadas).
 *
 * Orden de guards (`app.module.ts`): corre DESPUÉS de `JwtAuthGuard`, así que cuando este
 * guard evalúa ya existe `request.user` (o la petición murió con 401). Si el endpoint no
 * declara `@RequierePermiso(...)`, cualquier usuario autenticado pasa — mismo criterio que
 * `RolesGuard` (no todas las rutas restringen; contracts/api-rest.md).
 *
 * ÚNICO mecanismo de autorización del sistema desde T103: `@Roles(...)`/`RolesGuard` fueron
 * retirados en la misma pasada que migró los 8 controladores con autorización (research R16
 * — dos mecanismos en paralelo serían dos fuentes de verdad sobre quién puede qué). Los 47
 * endpoints protegidos declaran hoy `@RequierePermiso`. Los únicos que NO lo declaran son,
 * a propósito, los `@Public()` (`POST /api/auth/login`, `GET /api/salud`, sin sesión) y las
 * tres rutas que un usuario autenticado ejerce sobre SÍ MISMO, no sobre datos de negocio:
 * `POST /api/auth/logout`, `GET /api/auth/perfil` y `PUT /api/auth/password`. Exigirles un
 * permiso permitiría dejar a alguien sin poder ver su perfil ni cambiar su contraseña.
 *
 * Implementa: FR-003 (la autorización se verifica siempre en el servidor, Principio III),
 * FR-058 (permisos efectivos resueltos en el servidor en cada petición, nunca desde un dato
 * del cliente) y US9-AS2 (llamar directo a un endpoint no permitido responde 403).
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ClavePermiso } from '../../../../dominio/entidades/permiso';
import type { Usuario } from '../../../../dominio/entidades/usuario';
import { CLAVE_METADATA_PERMISO } from '../requiere-permiso.decorator';

@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const permisoRequerido = this.reflector.getAllAndOverride<ClavePermiso | undefined>(CLAVE_METADATA_PERMISO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!permisoRequerido) {
      return true;
    }

    const { user } = contexto.switchToHttp().getRequest<{ user?: Usuario }>();
    if (!this.puede(user, permisoRequerido)) {
      throw new ForbiddenException({
        error: { mensaje: 'No tienes permisos para realizar esta acción.', campos: null },
      });
    }
    return true;
  }

  /**
   * Un usuario puede ejecutar la operación si está autenticado, ACTIVO, y su rol concede el
   * permiso exigido. Las tres condiciones se evalúan aquí y ninguna se da por supuesta:
   *
   * - La verificación de `estado` es defensa en profundidad, no un cambio de comportamiento:
   *   `EstrategiaJwt` ya rechaza con 401 a un usuario que no esté ACTIVO, así que hoy uno
   *   inactivo no llega hasta aquí. Se repite porque este guard es la última barrera antes
   *   del controlador y no debe depender de que otra pieza haya hecho su parte (FR-006/FR-008:
   *   un usuario dado de baja no opera, aunque conserve su rol y su historial).
   * - `permisos` son CLAVES `modulo.accion` resueltas desde BD en esta misma petición; la
   *   comparación es exacta, sin comodines ni jerarquías: un permiso concede exactamente su
   *   operación y nada más (FR-056).
   *
   * ## La única excepción: el super administrador (US30, FR-127)
   *
   * Un rol con `esSuperAdmin` concede TODO, y se comprueba ANTES de mirar `permisos` — no
   * después, ni sumando sus claves a la lista. La diferencia es exactamente el motivo por el
   * que este rol existe: si sus capacidades salieran de filas en `roles_permisos`, vaciar esa
   * tabla lo dejaría tan bloqueado como al resto, y el respaldo se rompería con la misma
   * operación de la que protege. Aquí no se lee ningún dato administrable: se lee una columna
   * que solo la base de datos puede cambiar.
   *
   * Sigue exigiendo sesión válida y usuario ACTIVO: el respaldo evita el bloqueo por permisos,
   * no la autenticación.
   */
  private puede(usuario: Usuario | undefined, permisoRequerido: ClavePermiso): boolean {
    if (!usuario || usuario.estado !== 'ACTIVO') {
      return false;
    }
    if (usuario.rolAsignado.esSuperAdmin) {
      return true;
    }
    return usuario.rolAsignado.permisos.includes(permisoRequerido);
  }
}
