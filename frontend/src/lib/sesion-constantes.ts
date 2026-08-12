/**
 * Constantes compartidas entre el middleware (T022) y los Server Components de sesión
 * (T025) — evita strings mágicos repetidos entre esos dos archivos.
 */

/**
 * Nombre de la cookie de sesión. DEBE coincidir exactamente con
 * `backend/src/infraestructura/seguridad/cookie-sesion.ts` (`NOMBRE_COOKIE_SESION =
 * 'trazo_sesion'`). No se puede importar ese archivo desde el frontend (workspaces npm
 * separados, sin dependencia entre sí) — se duplica aquí de forma explícita y documentada;
 * si el backend cambia el nombre de la cookie, este valor se actualiza a mano.
 */
export const NOMBRE_COOKIE_SESION = 'trazo_sesion';

/**
 * Header interno (no expuesto al navegador, solo entre el middleware y el árbol de
 * Server Components de la misma petición) con la ruta actual. El middleware (T022) corre
 * en el Edge Runtime y sí conoce `request.nextUrl.pathname`; el layout autenticado (T025)
 * es un Server Component sin una forma oficial de leer el pathname, así que lo recibe por
 * este header para decidir si ya está en `/cambiar-password` antes de redirigir.
 */
export const ENCABEZADO_RUTA_ACTUAL = 'x-trazo-ruta-actual';
