/**
 * Cliente HTTP de las órdenes de compra (US16, FR-094…FR-099).
 *
 * Todas las llamadas pasan por `api<T>()` (regla dura del workspace: nunca `fetch` directo).
 */
import type {
  DatosCrearOrdenCompra,
  OrdenCompraConDetalles,
  SugerenciaCompra,
} from '@trazo/compartido';
import { api } from './cliente';

export async function obtenerOrdenCompra(id: number): Promise<OrdenCompraConDetalles> {
  return api<OrdenCompraConDetalles>(`/api/ordenes-compra/${id}`);
}

export async function crearOrdenCompra(datos: DatosCrearOrdenCompra): Promise<{ id: number; numero: number }> {
  return api<{ id: number; numero: number }>('/api/ordenes-compra', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export async function actualizarOrdenCompra(id: number, datos: DatosCrearOrdenCompra): Promise<void> {
  await api<void>(`/api/ordenes-compra/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

export async function enviarOrdenCompra(id: number): Promise<void> {
  await api<void>(`/api/ordenes-compra/${id}/enviar`, { method: 'POST' });
}

export async function anularOrdenCompra(id: number, motivo: string): Promise<void> {
  await api<void>(`/api/ordenes-compra/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) });
}

/** Qué pedirle hoy a ese proveedor (FR-098). Una lista vacía es una respuesta legítima: no hay
 *  nada bajo umbral que ese proveedor haya suministrado antes. */
export async function sugerenciasDeCompra(proveedorId: number): Promise<SugerenciaCompra[]> {
  return api<SugerenciaCompra[]>(`/api/ordenes-compra/sugerencias?proveedorId=${proveedorId}`);
}
