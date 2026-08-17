/**
 * Cliente HTTP de las cotizaciones (US21, FR-112…FR-117).
 *
 * Todas las llamadas pasan por `api<T>()` (regla dura del workspace: nunca `fetch` directo).
 */
import type { CotizacionConDetalles, DatosCrearCotizacion } from '@trazo/compartido';
import { api } from './cliente';

export async function obtenerCotizacion(id: number): Promise<CotizacionConDetalles> {
  return api<CotizacionConDetalles>(`/api/cotizaciones/${id}`);
}

export async function crearCotizacion(datos: DatosCrearCotizacion): Promise<{ id: number; numero: number }> {
  return api<{ id: number; numero: number }>('/api/cotizaciones', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export async function actualizarCotizacion(id: number, datos: DatosCrearCotizacion): Promise<void> {
  await api<void>(`/api/cotizaciones/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

export async function enviarCotizacion(id: number): Promise<void> {
  await api<void>(`/api/cotizaciones/${id}/enviar`, { method: 'POST' });
}

/** Aceptar devuelve el id de la SALIDA que se generó (FR-115), para poder llevar al usuario
 *  hasta el pedido que acaba de nacer en vez de dejarlo en el listado. */
export async function aceptarCotizacion(id: number): Promise<{ salidaId: number }> {
  return api<{ salidaId: number }>(`/api/cotizaciones/${id}/aceptar`, { method: 'POST' });
}

export async function rechazarCotizacion(id: number): Promise<void> {
  await api<void>(`/api/cotizaciones/${id}/rechazar`, { method: 'POST' });
}

export async function anularCotizacion(id: number, motivo: string): Promise<void> {
  await api<void>(`/api/cotizaciones/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) });
}
