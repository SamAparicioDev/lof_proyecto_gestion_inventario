/**
 * Funciones de clientes y proyectos del frontend (T044/T045).
 *
 * Envuelven las MUTACIONES de `/api/clientes/*` y `/api/proyectos/*`
 * (contracts/api-rest.md § Clientes y proyectos) usando SIEMPRE `api<T>()`
 * (frontend/CLAUDE.md) — nunca `fetch` directo. Sigue el patrón de `lib/api/ingresos.ts`.
 * El listado (`GET /api/clientes`) y el detalle (`GET /api/clientes/:id`) los piden
 * directamente las páginas Server Component vía `apiServidor` (lib/api/servidor.ts) — aquí
 * solo van las operaciones que corren en el navegador (formularios y botones de acción,
 * Client Components).
 */
import type {
  Cliente,
  ClienteConProyectos,
  DatosActualizarCliente,
  DatosActualizarProyecto,
  DatosCrearCliente,
  DatosCrearProyecto,
  EstadoCliente,
  EstadoProyecto,
  Proyecto,
} from '@trazo/compartido';
import { api } from './cliente';

/** `POST /api/clientes` — alta de cliente (FR-034/FR-035). */
export function crearCliente(datos: DatosCrearCliente): Promise<{ id: number }> {
  return api<{ id: number }>('/api/clientes', { method: 'POST', body: JSON.stringify(datos) });
}

/** `PUT /api/clientes/:id` — edición de cliente (FR-034/FR-035). */
export function actualizarCliente(id: number, datos: DatosActualizarCliente): Promise<void> {
  return api<void>(`/api/clientes/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

/** `PUT /api/clientes/:id/estado` — activa/desactiva un cliente (baja lógica, FR-038). */
export function cambiarEstadoCliente(id: number, estado: EstadoCliente): Promise<void> {
  return api<void>(`/api/clientes/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado }) });
}

/** `GET /api/clientes/:id/proyectos-destino` — proyectos ACTIVOS del cliente ACTIVO (FR-038). */
export function obtenerProyectosDestino(clienteId: number): Promise<Proyecto[]> {
  return api<Proyecto[]>(`/api/clientes/${clienteId}/proyectos-destino`);
}

/**
 * `GET /api/clientes/:id` — cliente con TODOS sus proyectos (cualquier estado) y su resumen de
 * salidas (FR-037). Uso en el navegador: la cascada cliente→proyecto del filtro del reporte de
 * consumo por proyecto (`componentes/reportes/reporte-consumo-proyecto.tsx`, T072) — a
 * diferencia de `obtenerProyectosDestino` (solo proyectos ACTIVOS de un cliente ACTIVO,
 * pensado para elegir el destino de una salida nueva), un reporte histórico debe poder
 * consultar también proyectos ya COMPLETADO/SUSPENDIDO.
 */
export function obtenerCliente(clienteId: number): Promise<ClienteConProyectos> {
  return api<ClienteConProyectos>(`/api/clientes/${clienteId}`);
}

/** `POST /api/clientes/:id/proyectos` — alta de proyecto para el cliente dado (FR-036). */
export function crearProyecto(clienteId: number, datos: DatosCrearProyecto): Promise<{ id: number }> {
  return api<{ id: number }>(`/api/clientes/${clienteId}/proyectos`, {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

/** `PUT /api/proyectos/:id` — edición de proyecto (FR-036). */
export function actualizarProyecto(id: number, datos: DatosActualizarProyecto): Promise<void> {
  return api<void>(`/api/proyectos/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

/** `PUT /api/proyectos/:id/estado` — transición ACTIVO/COMPLETADO/SUSPENDIDO (US2-AS4). */
export function cambiarEstadoProyecto(id: number, estado: EstadoProyecto): Promise<void> {
  return api<void>(`/api/proyectos/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado }) });
}


/** Reexport de conveniencia — así los componentes de este módulo importan un solo archivo. */
export type { Cliente, Proyecto };
