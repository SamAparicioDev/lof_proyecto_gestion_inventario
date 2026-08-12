/**
 * Funciones de productos del catálogo, lado navegador (T035, ampliado en T062 y T096).
 *
 * Envuelven `/api/productos` (contracts/api-rest.md § Productos) usando SIEMPRE `api<T>()`
 * (frontend/CLAUDE.md) — nunca `fetch` directo. Sigue el patrón de `lib/api/auth.ts` (T021) y,
 * para las mutaciones de edición/estado agregadas en T062, el de `lib/api/clientes.ts`
 * (`actualizarCliente`/`cambiarEstadoCliente`).
 *
 * EXCEPCIÓN: `importarProductos` (T096, US8) no usa `api<T>()` — ver su propio TSDoc, mismo
 * criterio documentado que `lib/api/reportes.ts` § `descargarArchivo`.
 */
import type {
  DatosActualizarProducto,
  DatosCrearProducto,
  EstadoProducto,
  FiltroProductos,
  ProductoResumen,
  ResumenImportacion,
} from '@trazo/compartido';
import { api, ErrorApi } from './cliente';

/**
 * `POST /api/productos` — alta de producto (FR-010/FR-011). La usa el diálogo "Producto nuevo"
 * (`componentes/inventario/dialogo-producto-nuevo.tsx`), abierto desde el botón del listado de
 * inventario (T111) y desde una línea del formulario de ingresos (alta rápida, T035). Roles
 * A,G,O — a diferencia de las dos mutaciones de abajo, que son A,G.
 */
export function crearProducto(datos: DatosCrearProducto): Promise<{ id: number }> {
  return api<{ id: number }>('/api/productos', { method: 'POST', body: JSON.stringify(datos) });
}

/**
 * `GET /api/productos?buscar=` — listado simple sin paginar para selectores (extensión T035
 * del contrato). Las páginas Server Component (T035/T036) lo piden vía `apiServidor` antes
 * del primer render; esta función queda para cualquier Client Component que necesite
 * refrescar el catálogo sin recargar la página (p. ej. tras cerrar el diálogo de alta rápida
 * si en el futuro se decide re-sincronizar en vez de solo anexar localmente).
 */
export function listarProductos(filtros?: FiltroProductos): Promise<ProductoResumen[]> {
  const query = filtros?.buscar ? `?buscar=${encodeURIComponent(filtros.buscar)}` : '';
  return api<ProductoResumen[]>(`/api/productos${query}`);
}

/**
 * `PUT /api/productos/:id` — edita descripción/categoría/ubicación/umbral de stock bajo
 * (FR-010). La usa el diálogo de edición `componentes/inventario/producto-form.tsx` (T062),
 * que se abre tanto desde la ficha del producto como desde una fila del listado (T111); roles
 * Administrador/Gerente, ver `contracts/api-rest.md`.
 */
export function actualizarProducto(id: number, datos: DatosActualizarProducto): Promise<void> {
  return api<void>(`/api/productos/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

/**
 * `PUT /api/productos/:id/estado` — activa/desactiva un producto (baja lógica, FR-012, nunca
 * `DELETE`). La usan el botón "Activar/Desactivar" de la ficha de inventario (T062) y el de
 * cada fila del listado (`componentes/inventario/tabla-inventario.tsx`, T111).
 */
export function cambiarEstadoProducto(id: number, estado: EstadoProducto): Promise<void> {
  return api<void>(`/api/productos/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado }) });
}

/**
 * `POST /api/productos/importar` — carga masiva de inventario desde plantilla Excel (T096,
 * US8, FR-048…FR-051). Sube `archivo` como `multipart/form-data` y devuelve el
 * `ResumenImportacion` completo (creados/actualizados/con stock inicial/errores por fila —
 * nunca un mensaje genérico de éxito, contracts/rutas-frontend.md).
 *
 * EXCEPCIÓN documentada a "todo pasa por `api<T>()`" (frontend/CLAUDE.md — misma excepción ya
 * usada por `lib/api/reportes.ts` § `descargarArchivo` para archivos binarios): `api<T>()` fija
 * siempre `Content-Type: application/json` (`lib/api/cliente.ts`), y ese header, una vez
 * presente, impide que el navegador fije el suyo propio con el `boundary` que necesita un
 * `multipart/form-data` — el backend no podría parsear el archivo. Por eso esta función aísla
 * su propio `fetch`, con el mismo `credentials: 'include'` (cookie de sesión httpOnly) y el
 * mismo formato de error del contrato `{ error: { mensaje, campos } }` traducido a `ErrorApi`,
 * para que el componente que llama la trate exactamente igual que cualquier otro error de la
 * API (incluido un `403` de un rol sin permiso).
 */
export async function importarProductos(archivo: File): Promise<ResumenImportacion> {
  const formData = new FormData();
  formData.append('archivo', archivo);

  const respuesta = await fetch('/api/productos/importar', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!respuesta.ok) {
    let mensaje = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
    let campos: Record<string, string> | null = null;
    try {
      const cuerpo = (await respuesta.json()) as { error: { mensaje: string; campos: Record<string, string> | null } };
      mensaje = cuerpo.error.mensaje;
      campos = cuerpo.error.campos;
    } catch {
      // Cuerpo no-JSON: se conserva el mensaje genérico de arriba.
    }
    throw new ErrorApi(respuesta.status, mensaje, campos);
  }

  return (await respuesta.json()) as ResumenImportacion;
}
