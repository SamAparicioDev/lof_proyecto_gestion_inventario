/**
 * Decorador de parámetro `@UsuarioActual()` — extrae el usuario autenticado que
 * `EstrategiaJwt` adjuntó a `request.user` (patrón estándar de Passport).
 *
 * Implementa: FR-045 (toda mutación debe saber QUIÉN la ejecuta) — los controladores usan
 * este decorador para pasar el `usuarioId`/rol a los casos de uso sin tocar `Request`
 * directamente (mantiene los controladores delgados).
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Usuario } from '../../../dominio/entidades/usuario';

export const UsuarioActual = createParamDecorator((_datos: unknown, contexto: ExecutionContext): Usuario => {
  const request = contexto.switchToHttp().getRequest<{ user: Usuario }>();
  return request.user;
});
