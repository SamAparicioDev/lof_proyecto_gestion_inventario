/**
 * Cliente HTTP del frontend — ÚNICA puerta de salida hacia la API de Trazo.
 *
 * Todos los componentes y páginas llaman a la API a través de estas funciones; nadie usa
 * `fetch` directo. Así garantizamos en un solo lugar (docs/arquitectura.md — frontend):
 *
 * 1. `credentials: 'include'` → la cookie httpOnly de sesión viaja en cada petición.
 * 2. Manejo uniforme del formato de error del contrato { error: { mensaje, campos } }
 *    (contracts/api-rest.md): los errores de campo se pintan junto al campo, el resto
 *    como mensaje general en español.
 * 3. Sesión expirada: ante 401 (y si no estamos ya en /login, para no hacer un bucle con
 *    el propio intento de login) redirige a /login con `sesionExpirada=1` y `next=<ruta>`
 *    en la URL, para mostrar el aviso en español y no perder silenciosamente a dónde iba
 *    el usuario (edge case de spec.md; contracts/rutas-frontend.md). El banner en sí lo
 *    pinta la página de login (T023) leyendo esos query params.
 *
 * Las rutas son relativas (/api/...) porque Next.js las reenvía al backend vía rewrites
 * (mismo origen — ver next.config.ts y research R14).
 */
import type { ApiError } from '@trazo/compartido';

/** Error tipado que reciben los formularios y páginas del frontend. */
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly mensaje: string,
    /** Errores por campo del formulario (o null si es un error general). */
    readonly campos: Record<string, string> | null,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

/**
 * Ejecuta una petición a la API y devuelve el JSON tipado, o lanza `ErrorApi`.
 * Uso: `const perfil = await api<PerfilSesion>('/api/auth/perfil');`
 *
 * Si `init.body` es un `FormData` (subida `multipart/form-data` — hoy solo el logo del cliente,
 * US11/T122), NO se fija `Content-Type`: ese header debe escribirlo el navegador, porque tiene
 * que incluir el `boundary` que él mismo genera para separar las partes. Fijarlo a
 * `application/json` como en el resto de llamadas produciría un cuerpo que el backend no puede
 * parsear. La respuesta se maneja igual que cualquier otra (incluido el `204` sin cuerpo).
 */
export async function api<T>(ruta: string, init?: RequestInit): Promise<T> {
  const esFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const respuesta = await fetch(ruta, {
    ...init,
    credentials: 'include',
    headers: {
      ...(esFormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });

  if (!respuesta.ok) {
    const error = await construirError(respuesta);
    redirigirSiSesionExpiro(respuesta.status);
    throw error;
  }

  // 204 No Content: las mutaciones exitosas del contrato no devuelven cuerpo.
  if (respuesta.status === 204) {
    return undefined as T;
  }
  return (await respuesta.json()) as T;
}

/** Traduce la respuesta de error del contrato a `ErrorApi`; tolera cuerpos no-JSON. */
async function construirError(respuesta: Response): Promise<ErrorApi> {
  try {
    const cuerpo = (await respuesta.json()) as ApiError;
    return new ErrorApi(respuesta.status, cuerpo.error.mensaje, cuerpo.error.campos);
  } catch {
    return new ErrorApi(
      respuesta.status,
      'No fue posible comunicarse con el servidor. Intenta de nuevo.',
      null,
    );
  }
}

/** Código de estado de "no autenticado" del contrato (contracts/api-rest.md). */
const ESTADO_NO_AUTENTICADO = 401;

/**
 * Ante una sesión expirada (401) en cualquier llamada autenticada, redirige a /login
 * preservando la ruta desde la que venía el usuario (`next`) y marcando `sesionExpirada=1`
 * para que la página de login muestre el aviso en español — así no se pierde
 * silenciosamente lo que el usuario estaba haciendo (edge case de spec.md).
 *
 * Si la respuesta 401 viene del propio intento de login (ya estamos en /login), NO
 * redirige: ese caso es "usuario o contraseña incorrectos", no sesión expirada, y evita un
 * bucle /login → /login. Solo actúa en el navegador (esta función no corre en servidor:
 * los Server Components resuelven la sesión con lib/api/auth-servidor.ts, T025).
 */
function redirigirSiSesionExpiro(status: number): void {
  if (status !== ESTADO_NO_AUTENTICADO || typeof window === 'undefined') {
    return;
  }
  if (window.location.pathname === '/login') {
    return;
  }

  const destino = new URL('/login', window.location.origin);
  destino.searchParams.set('sesionExpirada', '1');
  destino.searchParams.set('next', window.location.pathname + window.location.search);
  window.location.href = destino.toString();
}
