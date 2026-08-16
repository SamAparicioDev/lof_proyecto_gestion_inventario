/**
 * Cliente HTTP del catálogo de unidades de medida (US17, FR-101…FR-105).
 *
 * Todas las llamadas pasan por `api<T>()` (regla dura del workspace: nunca `fetch` directo).
 */
import type {
  DatosCrearUnidadMedida,
  EstadoUnidadMedida,
  FiltroListarUnidadesMedida,
} from '@trazo/compartido';
import { api } from './cliente';

/** Unidad tal como la devuelve `GET /api/unidades-medida`, con el uso que tiene. */
export interface UnidadMedidaListada {
  id: number;
  nombre: string;
  abreviatura: string;
  estado: EstadoUnidadMedida;
  cantidadProductos: number;
}

export async function listarUnidadesMedida(
  filtros: FiltroListarUnidadesMedida = {},
): Promise<UnidadMedidaListada[]> {
  const query = new URLSearchParams();
  if (filtros.buscar) query.set('buscar', filtros.buscar);
  if (filtros.estado) query.set('estado', filtros.estado);
  const cadena = query.toString();
  return api<UnidadMedidaListada[]>(`/api/unidades-medida${cadena ? `?${cadena}` : ''}`);
}

export async function crearUnidadMedida(datos: DatosCrearUnidadMedida): Promise<{ id: number }> {
  return api<{ id: number }>('/api/unidades-medida', { method: 'POST', body: JSON.stringify(datos) });
}

export async function actualizarUnidadMedida(id: number, datos: DatosCrearUnidadMedida): Promise<void> {
  await api<void>(`/api/unidades-medida/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

export async function cambiarEstadoUnidadMedida(id: number, estado: EstadoUnidadMedida): Promise<void> {
  await api<void>(`/api/unidades-medida/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado }) });
}

export async function eliminarUnidadMedida(id: number): Promise<void> {
  await api<void>(`/api/unidades-medida/${id}`, { method: 'DELETE' });
}
