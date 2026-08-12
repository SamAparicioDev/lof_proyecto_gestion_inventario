/**
 * Guard global `JwtAuthGuard` — exige sesión válida (cookie httpOnly `trazo_sesion`) en
 * TODA ruta salvo las marcadas con `@Public()` (login y salud — contracts/api-rest.md).
 * Delega la verificación del JWT y la revalidación en BD a `EstrategiaJwt`
 * (passport-jwt); aquí solo se decide si la ruta aplica y se implementa la renovación
 * deslizante de 8h (research R6): tras autenticar con éxito, se re-emite la cookie con una
 * nueva expiración en CADA petición autenticada — aproximación simple autorizada
 * explícitamente (sin lógica de umbral).
 *
 * Registrado como `APP_GUARD` en `app.module.ts`, ANTES de `PermisosGuard` (primero se sabe
 * quién es el usuario —y se traen su rol y sus permisos efectivos en esa misma lectura—,
 * luego si ese rol concede el permiso que la ruta exige).
 */
import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import type { Usuario } from '../../../../dominio/entidades/usuario';
import { fijarCookieSesion } from '../../../../infraestructura/seguridad/cookie-sesion';
import { CLAVE_METADATA_PUBLICA } from '../public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {
    super();
  }

  override async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const esPublica = this.reflector.getAllAndOverride<boolean>(CLAVE_METADATA_PUBLICA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (esPublica) {
      return true;
    }

    const autenticado = (await super.canActivate(contexto)) as boolean;
    if (autenticado) {
      this.renovarCookieSesion(contexto);
    }
    return autenticado;
  }

  /**
   * Traduce el rechazo de Passport (sin cookie, JWT inválido/expirado, o usuario
   * inexistente/INACTIVO detectado en `EstrategiaJwt.validate`) al formato único de error
   * `{ error: { mensaje, campos } }` del contrato — el `UnauthorizedException` por
   * defecto de Nest no trae ese formato.
   *
   * `err` NO siempre significa "no hay sesión válida": passport-jwt reporta el rechazo
   * NORMAL (sin cookie, JWT inválido/expirado) con `err=null, user=false`, y
   * `EstrategiaJwt.validate` lanza `UnauthorizedException` a propósito para usuario
   * inexistente/INACTIVO — ambos casos deben seguir cayendo en el mensaje genérico de abajo.
   * Pero si `validate` (o su llamada a `RepositorioUsuarios.buscarPorId`) lanza CUALQUIER
   * OTRO tipo de error (p. ej. un fallo transitorio de conexión/pool de BD), ese `err` NO es
   * un rechazo de autenticación — es un error técnico real, y enmascararlo como "inicia
   * sesión" lo hacía indiagnosticable (se perdía en logs). Se relanza tal cual: el filtro
   * global (`FiltroErroresDominio`) lo loguea completo y responde 500, nunca 401.
   */
  override handleRequest<TUser = Usuario>(err: unknown, user: TUser | false): TUser {
    if (err && !(err instanceof UnauthorizedException)) {
      throw err;
    }
    if (err || !user) {
      throw new UnauthorizedException({
        error: { mensaje: 'Debes iniciar sesión para continuar.', campos: null },
      });
    }
    return user;
  }

  /** Renovación deslizante (research R6): re-firma `{ sub }` y reemite la cookie 8h. */
  private renovarCookieSesion(contexto: ExecutionContext): void {
    const request = contexto.switchToHttp().getRequest<Request & { user?: Usuario }>();
    const respuesta = contexto.switchToHttp().getResponse<Response>();
    if (!request.user) {
      return;
    }
    const token = this.jwtService.sign({ sub: request.user.id });
    fijarCookieSesion(respuesta, token);
  }
}
