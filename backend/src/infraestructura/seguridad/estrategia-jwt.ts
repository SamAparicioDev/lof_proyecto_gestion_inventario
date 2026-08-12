/**
 * Estrategia Passport-JWT — verifica el JWT que viaja en la cookie httpOnly
 * `trazo_sesion` (nunca en un header `Authorization` — FR-001, research R6).
 *
 * El payload del JWT SOLO lleva `{ sub: usuarioId }` — claim de confianza mínima. Rol,
 * estado y `debeCambiarPassword` se leen SIEMPRE frescos desde BD dentro de `validate()`:
 * así un cambio de rol o una desactivación (US6) aplican de inmediato en la siguiente
 * petición, sin esperar a que el JWT expire (FR-002/FR-003). Si el usuario no existe o su
 * estado no es ACTIVO, la estrategia rechaza; `JwtAuthGuard.handleRequest` traduce ese
 * rechazo al formato de error único del contrato.
 */
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { Usuario } from '../../dominio/entidades/usuario';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';
import { NOMBRE_COOKIE_SESION } from './cookie-sesion';

/** Forma mínima y de confianza del payload firmado (ver `ControladorAuth`/`JwtAuthGuard`). */
export interface PayloadSesion {
  sub: number;
}

/** Extractor custom: lee el JWT desde la cookie httpOnly, nunca de un header Authorization. */
function extraerTokenDeCookie(request: Request): string | null {
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.[NOMBRE_COOKIE_SESION] ?? null;
}

@Injectable()
export class EstrategiaJwt extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extraerTokenDeCookie]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /** Revalida en BD (FR-002/FR-003) y devuelve el `Usuario` que Passport adjunta a `request.user`. */
  async validate(payload: PayloadSesion): Promise<Usuario> {
    const usuario = await this.repositorioUsuarios.buscarPorId(payload.sub);
    if (!usuario || usuario.estado !== 'ACTIVO') {
      throw new UnauthorizedException();
    }
    return usuario;
  }
}
