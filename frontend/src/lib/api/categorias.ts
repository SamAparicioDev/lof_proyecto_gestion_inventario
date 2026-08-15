/**
 * Cliente HTTP del catálogo de categorías (US15, FR-084…FR-088).
 *
 * Todas las llamadas pasan por `api<T>()` (regla dura del workspace: nunca `fetch` directo).
 */
import type { DatosCrearCategoria, EstadoCategoria, FiltroListarCategorias } from '@trazo/compartido';
import { api } from './cliente';

/** Categoría tal como la devuelve `GET /api/categorias`, con el uso que tiene. */
export interface CategoriaListada {
  id: number;
  nombre: string;
  descripcion: string | null;
  estado: EstadoCategoria;
  cantidadProductos: number;
}

export async function listarCategorias(filtros: FiltroListarCategorias = {}): Promise<CategoriaListada[]> {
  const query = new URLSearchParams();
  if (filtros.buscar) query.set('buscar', filtros.buscar);
  if (filtros.estado) query.set('estado', filtros.estado);
  const cadena = query.toString();
  return api<CategoriaListada[]>(`/api/categorias${cadena ? `?${cadena}` : ''}`);
}

export async function crearCategoria(datos: DatosCrearCategoria): Promise<{ id: number }> {
  return api<{ id: number }>('/api/categorias', { method: 'POST', body: JSON.stringify(datos) });
}

export async function actualizarCategoria(id: number, datos: DatosCrearCategoria): Promise<void> {
  await api<void>(`/api/categorias/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

export async function cambiarEstadoCategoria(id: number, estado: EstadoCategoria): Promise<void> {
  await api<void>(`/api/categorias/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado }) });
}

export async function eliminarCategoria(id: number): Promise<void> {
  await api<void>(`/api/categorias/${id}`, { method: 'DELETE' });
}
