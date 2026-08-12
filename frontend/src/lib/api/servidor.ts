/**
 * Cliente HTTP para SERVER COMPONENTS — generaliza el patrón de `auth-servidor.ts` (T025)
 * para cualquier endpoint autenticado, no solo `GET /api/auth/perfil`. `fetch` dentro de un
 * Server Component NO adjunta las cookies del navegador (a diferencia de `lib/api/cliente.ts`,
 * que corre en el navegador con `credentials: 'include'`), así que reenviamos a mano el
 * header `Cookie` de la petición entrante — igual que `obtenerPerfilServidor`.
 *
 * A diferencia de `obtenerPerfilServidor` (que traga cualquier error y devuelve `null`,
 * fail-closed para el gate de sesión de T025), `apiServidor` PROPAGA los errores como
 * `ErrorApi`: cada página decide cómo reaccionar (p. ej. `notFound()` ante un `404`, como en
 * `app/(app)/ingresos/[id]/page.tsx`, T036).
 *
 * Usado por las páginas Server Component de listados/detalle de las historias de usuario
 * (US1 en adelante, empezando por `ingresos`) que necesitan datos autenticados antes del
 * primer render, sin duplicar el viaje cliente→servidor→backend que haría `api<T>()`.
 *
 * Para los recursos AUXILIARES de una pantalla —los que solo enriquecen lo que se muestra y
 * exigen un permiso DISTINTO del principal— está `apiServidorOpcional` (ver su TSDoc): con los
 * permisos como dato (US9) ya no se puede suponer que "todos los roles tienen `clientes.ver`".
 */
import { cookies } from 'next/headers';
import type { ApiError } from '@trazo/compartido';
import { ErrorApi } from './cliente';

/** Mismo valor por defecto que `auth-servidor.ts` (research R14: backend local en :4000). */
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';

/** Ejecuta un GET autenticado desde un Server Component y devuelve el JSON tipado, o lanza `ErrorApi`. */
export async function apiServidor<T>(ruta: string): Promise<T> {
  const encabezadoCookie = (await cookies()).toString();
  const respuesta = await fetch(`${BACKEND_URL}${ruta}`, {
    headers: { Cookie: encabezadoCookie },
    // Lleva la sesión de quien pide la página: nunca debe servirse desde el cache de datos
    // de Next (compartiría la respuesta entre usuarios distintos).
    cache: 'no-store',
  });

  if (!respuesta.ok) {
    let cuerpo: ApiError | null = null;
    try {
      cuerpo = (await respuesta.json()) as ApiError;
    } catch {
      cuerpo = null;
    }
    throw new ErrorApi(
      respuesta.status,
      cuerpo?.error.mensaje ?? 'No fue posible comunicarse con el servidor. Intenta de nuevo.',
      cuerpo?.error.campos ?? null,
    );
  }

  if (respuesta.status === 204) {
    return undefined as T;
  }
  return (await respuesta.json()) as T;
}

/**
 * Igual que `apiServidor`, pero devuelve `valorSiNoAutorizado` cuando el backend responde
 * `403` en vez de propagar el error (corrección de la revisión adversarial de la Tanda 13,
 * hallazgo HIGH).
 *
 * Para qué: varias pantallas precargan un recurso AUXILIAR que exige un permiso distinto del
 * principal — `/salidas` pide `/api/clientes` (`clientes.ver`) para poner nombres en las
 * columnas, los reportes lo piden para el combobox del filtro, los detalles de ingreso/salida
 * piden `/api/productos` (`productos.ver`) para mostrar el SKU de cada línea. Hasta US9 eso era
 * inofensivo porque los tres roles del sistema tenían esos permisos; con los permisos como dato
 * dejó de serlo: un rol propio con `salidas.ver` y sin `clientes.ver` veía el enlace "Salidas"
 * en su menú y, al pulsarlo, la pantalla de error genérica de Next en inglés. El enlace que la
 * propia interfaz le ofrece nunca debe terminar en un error no controlado.
 *
 * Solo se traga el `403` —el error que significa "esta parte no es para ti"—; un `404`, un
 * `500` o un fallo de red siguen propagándose, porque esos SÍ son fallos que hay que ver.
 * Fail-closed: sin datos auxiliares la pantalla se degrada (muestra el id en vez del nombre),
 * nunca inventa contenido.
 */
export async function apiServidorOpcional<T>(ruta: string, valorSiNoAutorizado: T): Promise<T> {
  try {
    return await apiServidor<T>(ruta);
  } catch (error) {
    if (error instanceof ErrorApi && error.status === HTTP_PROHIBIDO) {
      return valorSiNoAutorizado;
    }
    throw error;
  }
}

/** `403` — el código con el que `PermisosGuard` rechaza un permiso que la sesión no tiene. */
const HTTP_PROHIBIDO = 403;
