/**
 * Cliente HTTP del catálogo de proveedores (US15, FR-091…FR-093).
 *
 * Todas las llamadas pasan por `api<T>()` (regla dura del workspace: nunca `fetch` directo).
 */
import type { DatosCrearProveedor, EstadoProveedor, FiltroListarProveedores } from '@trazo/compartido';
import { api } from './cliente';

/** Proveedor tal como lo devuelve `GET /api/proveedores`, con el uso que tiene. */
export interface ProveedorListado {
  id: number;
  nombre: string;
  nit: string | null;
  telefono: string | null;
  email: string | null;
  estado: EstadoProveedor;
  /** `true` para el proveedor de la carga masiva: no se renombra ni se elimina (FR-093). */
  esSistema: boolean;
  cantidadIngresos: number;
}

export async function listarProveedores(filtros: FiltroListarProveedores = {}): Promise<ProveedorListado[]> {
  const query = new URLSearchParams();
  if (filtros.buscar) query.set('buscar', filtros.buscar);
  if (filtros.estado) query.set('estado', filtros.estado);
  const cadena = query.toString();
  return api<ProveedorListado[]>(`/api/proveedores${cadena ? `?${cadena}` : ''}`);
}

export async function crearProveedor(datos: DatosCrearProveedor): Promise<{ id: number }> {
  return api<{ id: number }>('/api/proveedores', { method: 'POST', body: JSON.stringify(datos) });
}

export async function actualizarProveedor(id: number, datos: DatosCrearProveedor): Promise<void> {
  await api<void>(`/api/proveedores/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

export async function cambiarEstadoProveedor(id: number, estado: EstadoProveedor): Promise<void> {
  await api<void>(`/api/proveedores/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado }) });
}

export async function eliminarProveedor(id: number): Promise<void> {
  await api<void>(`/api/proveedores/${id}`, { method: 'DELETE' });
}
