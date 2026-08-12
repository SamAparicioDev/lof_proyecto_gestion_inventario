/**
 * Funciones de ingresos (facturas de compra) del frontend (T035/T036).
 *
 * Envuelven las MUTACIONES de `/api/ingresos/*` (contracts/api-rest.md § Ingresos) usando
 * SIEMPRE `api<T>()` (frontend/CLAUDE.md) — nunca `fetch` directo. Sigue el patrón de
 * `lib/api/auth.ts` (T021). El listado (`GET /api/ingresos`) y el detalle
 * (`GET /api/ingresos/:id`) los piden directamente las páginas Server Component vía
 * `apiServidor` (lib/api/servidor.ts) — más simple y sin una ida y vuelta cliente→servidor
 * de más; aquí solo van las operaciones que sí corren en el navegador (formularios y botones
 * de acción, Client Components).
 */
import type { DatosActualizarIngreso, DatosCrearIngreso } from '@trazo/compartido';
import { api } from './cliente';

/** `POST /api/ingresos` — registra la factura en PENDIENTE (FR-013/FR-014/FR-015). */
export function crearIngreso(datos: DatosCrearIngreso): Promise<{ id: number }> {
  return api<{ id: number }>('/api/ingresos', { method: 'POST', body: JSON.stringify(datos) });
}

/** `PUT /api/ingresos/:id` — reemplaza cabecera y líneas; solo PENDIENTE (US1-AS5). */
export function actualizarIngreso(id: number, datos: DatosActualizarIngreso): Promise<void> {
  return api<void>(`/api/ingresos/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

/** `POST /api/ingresos/:id/recibir` — PENDIENTE→RECIBIDO, sube stock atómicamente (FR-017/FR-021). */
export function recibirIngreso(id: number): Promise<void> {
  return api<void>(`/api/ingresos/${id}/recibir`, { method: 'POST' });
}

/** `POST /api/ingresos/:id/verificar` — RECIBIDO→VERIFICADO. Solo Gerente/Administrador. */
export function verificarIngreso(id: number): Promise<void> {
  return api<void>(`/api/ingresos/${id}/verificar`, { method: 'POST' });
}

/** `POST /api/ingresos/:id/anular` — PENDIENTE|RECIBIDO→ANULADO con motivo obligatorio (FR-019). */
export function anularIngreso(id: number, motivo: string): Promise<void> {
  return api<void>(`/api/ingresos/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) });
}
