/**
 * Cliente del módulo de INVENTARIO (US31, FR-130).
 *
 * Hoy una sola operación: corregir la cantidad de un producto. Las LECTURAS del inventario las
 * hacen los Server Components por su cuenta (`lib/api/servidor.ts`), y por eso este archivo no
 * existía hasta ahora — se crea cuando aparece la primera ESCRITURA que el navegador tiene que
 * lanzar desde un diálogo.
 *
 * Como todo el frontend, pasa por `api<T>()` (frontend/CLAUDE.md): un único punto donde viven la
 * cookie de sesión, el manejo de `401` y la traducción de errores del contrato.
 */
import type { DatosCorregirCantidad } from '@trazo/compartido';
import { api } from './cliente';

/**
 * `PUT /api/inventario/:productoId/cantidad` — fija el stock en la cantidad CONTADA y deja un
 * movimiento de ajuste por la diferencia (FR-130).
 *
 * Exige el permiso `inventario.ajustar`, que es RESERVADO: solo un super administrador puede
 * concedérselo a un rol (FR-131). Sin él, el servidor responde `403` aunque el botón se hubiera
 * mostrado — ocultarlo es UX, no control de acceso.
 */
export function corregirCantidadProducto(productoId: number, datos: DatosCorregirCantidad): Promise<void> {
  return api<void>(`/api/inventario/${productoId}/cantidad`, { method: 'PUT', body: JSON.stringify(datos) });
}
