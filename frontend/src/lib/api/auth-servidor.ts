/**
 * Lectura de sesión del lado SERVIDOR — exclusiva para Server Components (T025).
 *
 * `fetch` dentro de un Server Component NO adjunta automáticamente las cookies del
 * navegador (a diferencia del cliente HTTP de frontend/src/lib/api/cliente.ts, que corre
 * en el navegador y usa `credentials: 'include'`). Aquí reenviamos a mano el header
 * `Cookie` de la petición entrante (`next/headers`) hacia `GET /api/auth/perfil`, para que
 * el backend reconozca la misma sesión. NUNCA importar este archivo desde un Client
 * Component (usa `next/headers`, que solo existe en el servidor).
 */
import { cookies } from 'next/headers';
import type { PerfilSesion } from '@trazo/compartido';

/**
 * Mismo valor por defecto que `frontend/next.config.ts` (research R14: el backend local
 * corre en :4000). No se comparte el módulo porque `next.config.ts` se ejecuta fuera del
 * árbol de `src/`, en el proceso de build/arranque de Next, no en el runtime de la app.
 */
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';

/**
 * Consulta `GET /api/auth/perfil` reenviando la cookie de sesión de la petición entrante.
 *
 * Devuelve `null` ante `401` (sin sesión válida) o cualquier otra falla de red/servidor —
 * el layout autenticado (frontend/src/app/(app)/layout.tsx, T025) trata ambos casos igual:
 * redirige a `/login` (fail-closed: ante la duda, no se muestra contenido protegido).
 */
export async function obtenerPerfilServidor(): Promise<PerfilSesion | null> {
  const encabezadoCookie = (await cookies()).toString();

  let respuesta: Response;
  try {
    respuesta = await fetch(`${BACKEND_URL}/api/auth/perfil`, {
      headers: { Cookie: encabezadoCookie },
      // Esta llamada lleva la sesión del usuario que hace la petición: nunca debe
      // servirse desde el cache de datos de Next (compartiría el perfil entre usuarios).
      cache: 'no-store',
    });
  } catch {
    return null;
  }

  if (!respuesta.ok) {
    return null;
  }
  return (await respuesta.json()) as PerfilSesion;
}
