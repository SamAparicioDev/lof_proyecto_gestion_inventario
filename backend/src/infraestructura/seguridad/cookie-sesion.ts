/**
 * Configuración centralizada de la cookie de sesión `trazo_sesion` — un único lugar para
 * sus opciones y su duración, para no duplicarlas entre `POST /api/auth/login` y la
 * renovación deslizante de `JwtAuthGuard` (research R6). Complementa a `EstrategiaJwt`
 * (que LEE la cookie) con las funciones que la ESCRIBEN.
 *
 * Implementa: FR-001 (sesión por cookie httpOnly, invisible a JavaScript del navegador —
 * mitiga robo de token por XSS) y la expiración de 8h de `contracts/api-rest.md`.
 */
import type { Response } from 'express';

/** Nombre de la cookie de sesión (contracts/api-rest.md). */
export const NOMBRE_COOKIE_SESION = 'trazo_sesion';

/** Duración de la sesión: 8 horas (contracts/api-rest.md; también `expiresIn` del JWT). */
export const DURACION_SESION_SEGUNDOS = 8 * 60 * 60;

const DURACION_SESION_MS = DURACION_SESION_SEGUNDOS * 1000;

/** Fija (o renueva) la cookie httpOnly de sesión con el JWT ya firmado. */
export function fijarCookieSesion(respuesta: Response, token: string): void {
  respuesta.cookie(NOMBRE_COOKIE_SESION, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DURACION_SESION_MS,
  });
}

/** Limpia la cookie de sesión (logout). */
export function limpiarCookieSesion(respuesta: Response): void {
  respuesta.clearCookie(NOMBRE_COOKIE_SESION, { path: '/' });
}
