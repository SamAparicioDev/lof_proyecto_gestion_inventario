/**
 * Middleware de Next.js — gate básico de sesión para toda la app autenticada (T022).
 *
 * División de responsabilidades (contracts/rutas-frontend.md, comentario de encargo T022):
 *  - Este middleware corre en el Edge Runtime y SOLO verifica la PRESENCIA de la cookie de
 *    sesión (`trazo_sesion`). No puede validar su contenido: es un JWT firmado por el
 *    backend, opaco aquí. Sin cookie → redirect a /login. Es un gate rápido, no la
 *    autoridad de autenticación.
 *  - La validez real del JWT (firma, expiración, `usuario.estado === 'ACTIVO'`) la revisa
 *    el backend en cada petición (`JwtAuthGuard`). Si la cookie existe pero ya no es
 *    válida, el backend responde `401` y el cliente HTTP del frontend
 *    (frontend/src/lib/api/cliente.ts, T021) redirige a /login con aviso.
 *  - El chequeo de `debeCambiarPassword` (FR-004) NO se hace aquí: requiere llamar a
 *    `GET /api/auth/perfil`, y hacerlo de forma síncrona y confiable en el Edge Runtime en
 *    cada request añade complejidad innecesaria (Principio V). Se resuelve del lado
 *    servidor en el layout autenticado (frontend/src/app/(app)/layout.tsx, T025), que sí
 *    puede hacer ese fetch. Para que ese layout —un Server Component sin acceso directo al
 *    pathname— sepa en qué ruta está parado sin depender de una API no oficial de
 *    Next.js, este middleware le pasa la ruta actual en un header interno.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { ENCABEZADO_RUTA_ACTUAL, NOMBRE_COOKIE_SESION } from '@/lib/sesion-constantes';

export function middleware(request: NextRequest): NextResponse {
  const tieneSesion = request.cookies.has(NOMBRE_COOKIE_SESION);

  if (!tieneSesion) {
    const destino = request.nextUrl.clone();
    destino.pathname = '/login';
    destino.search = '';
    destino.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(destino);
  }

  const encabezados = new Headers(request.headers);
  encabezados.set(ENCABEZADO_RUTA_ACTUAL, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: encabezados } });
}

/**
 * Excluye del gate de sesión: `/login` (público), `/api/*` (proxy al backend — el propio
 * backend valida acceso), los assets internos de Next (`_next/static`, `_next/image`),
 * `favicon.ico` y cualquier ruta con extensión de archivo (assets estáticos servidos desde
 * `public/`, p. ej. `*.svg`).
 */
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|login|.*\\..*).*)'],
};
