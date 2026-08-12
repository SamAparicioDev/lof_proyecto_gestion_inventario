/**
 * Funciones de autenticación del frontend (T021).
 *
 * Envuelven las rutas `/api/auth/*` (contracts/api-rest.md) usando SIEMPRE el cliente HTTP
 * único (`api<T>()` de ./cliente.ts) — nunca `fetch` directo, por la regla dura del
 * workspace (frontend/CLAUDE.md). Las consumen: la página de login (T023), la de cambio de
 * contraseña (T024) y el proveedor de sesión de Client Components (T026).
 */
import type { DatosCambiarPassword, DatosLogin, PerfilSesion } from '@trazo/compartido';
import { api } from './cliente';

/**
 * POST /api/auth/login — autentica con usuario y contraseña (FR-001).
 * Éxito: `204` + cookie httpOnly `trazo_sesion`. Error: `401` con mensaje genérico
 * ("Usuario o contraseña incorrectos") tanto para credenciales inválidas como para un
 * usuario INACTIVO (US6-AS4) — no se distingue en el mensaje por seguridad.
 */
export function iniciarSesion(datos: DatosLogin): Promise<void> {
  return api<void>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

/** POST /api/auth/logout — cierra la sesión activa; `204` y limpia la cookie en el servidor. */
export function cerrarSesion(): Promise<void> {
  return api<void>('/api/auth/logout', { method: 'POST' });
}

/**
 * GET /api/auth/perfil — perfil de la sesión activa, para Client Components (T026).
 * El layout autenticado (T025) ya resuelve el perfil del lado servidor; esta función es
 * para los casos en que un Client Component necesita refrescarlo por su cuenta.
 */
export function obtenerPerfil(): Promise<PerfilSesion> {
  return api<PerfilSesion>('/api/auth/perfil');
}

/**
 * PUT /api/auth/password — cambio de contraseña obligatorio o voluntario (FR-004).
 * Éxito: `204` y limpia `debeCambiarPassword`. Error: `400` con `campos` si la nueva
 * contraseña no cumple la política; `409` si `passwordActual` no coincide.
 */
export function cambiarPassword(datos: DatosCambiarPassword): Promise<void> {
  return api<void>('/api/auth/password', {
    method: 'PUT',
    body: JSON.stringify(datos),
  });
}
