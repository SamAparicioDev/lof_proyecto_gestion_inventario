/**
 * Funciones de salidas (entrega de mercancía a cliente/proyecto) del frontend (T053-T055).
 *
 * Envuelven las MUTACIONES de `/api/salidas/*` (contracts/api-rest.md § Salidas) usando
 * SIEMPRE `api<T>()` (frontend/CLAUDE.md) — nunca `fetch` directo. Sigue el patrón de
 * `lib/api/ingresos.ts`. El listado (`GET /api/salidas`) y el detalle
 * (`GET /api/salidas/:id`) los piden directamente las páginas Server Component vía
 * `apiServidor` (lib/api/servidor.ts) — aquí solo van las operaciones que corren en el
 * navegador (formulario y botones de acción, Client Components).
 */
import type { DatosActualizarSalida, DatosCrearSalida } from '@trazo/compartido';
import { api } from './cliente';

/** `POST /api/salidas` — registra la salida en PENDIENTE con correlativo (FR-025/FR-026/FR-027). */
export function crearSalida(datos: DatosCrearSalida): Promise<{ id: number; numero: number }> {
  return api<{ id: number; numero: number }>('/api/salidas', { method: 'POST', body: JSON.stringify(datos) });
}

/** `PUT /api/salidas/:id` — reemplaza cabecera y líneas; solo PENDIENTE (revalida disponibilidad). */
export function actualizarSalida(id: number, datos: DatosActualizarSalida): Promise<void> {
  return api<void>(`/api/salidas/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

/** `POST /api/salidas/:id/confirmar` — PENDIENTE→CONFIRMADA, descuenta stock atómicamente (FR-028/029/030). */
export function confirmarSalida(id: number): Promise<void> {
  return api<void>(`/api/salidas/${id}/confirmar`, { method: 'POST' });
}

/** `POST /api/salidas/:id/completar` — CONFIRMADA→COMPLETADA, cierre administrativo de entrega. */
export function completarSalida(id: number): Promise<void> {
  return api<void>(`/api/salidas/${id}/completar`, { method: 'POST' });
}

/** `POST /api/salidas/:id/cancelar` — PENDIENTE→ANULADA con motivo, libera el compromiso. */
export function cancelarSalida(id: number, motivo: string): Promise<void> {
  return api<void>(`/api/salidas/${id}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo }) });
}

/** `POST /api/salidas/:id/anular` — CONFIRMADA→ANULADA con reversa de stock (FR-032). Solo Gerente/Administrador. */
export function anularSalida(id: number, motivo: string): Promise<void> {
  return api<void>(`/api/salidas/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) });
}
