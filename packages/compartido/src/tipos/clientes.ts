/**
 * Formas de la API REST de clientes y proyectos consumidas por el frontend
 * (contracts/api-rest.md § Clientes y proyectos, T044/T045). Reflejan las entidades de
 * dominio del backend (`backend/src/dominio/entidades/{cliente,proyecto}.ts`) SERIALIZADAS
 * a JSON — mismo criterio que `tipos/ingresos.ts`: el frontend nunca importa esas entidades
 * directamente (docs/arquitectura.md §2), así que el mismo shape se declara aquí con una
 * diferencia deliberada: las fechas (`fechaRegistro`, `fechaInicio`, `fechaCierreEstimada`)
 * llegan como texto ISO (`string`), no como `Date`, porque así es como viajan una vez que
 * Nest serializa la respuesta.
 *
 * Implementa: FR-034…FR-038 (forma de lectura de clientes, proyectos y su relación).
 */

/** Estado de un cliente — INACTIVO es baja lógica, nunca se elimina (Principio II/III). */
export type EstadoCliente = 'ACTIVO' | 'INACTIVO';

/** Máquina de estados de un proyecto (data-model.md — FR-036). */
export type EstadoProyecto = 'ACTIVO' | 'COMPLETADO' | 'SUSPENDIDO';

export interface Cliente {
  id: number;
  nombre: string;
  nit: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  ciudad: string | null;
  fechaRegistro: string;
  estado: EstadoCliente;
  /**
   * ¿El cliente tiene logo cargado? (US11, FR-066). Es un BOOLEANO y no los bytes: la ficha del
   * cliente lo usa para saber si pedir la vista previa a `GET /api/clientes/:id/logo` (que
   * responde `404` cuando no hay ninguno) y para ofrecer "Subir logo" o "Reemplazar/Quitar".
   * Los bytes nunca viajan en este JSON — irían en cada fila de cada listado.
   */
  tieneLogo: boolean;
}

export interface Proyecto {
  id: number;
  clienteId: number;
  nombre: string;
  descripcion: string | null;
  fechaInicio: string | null;
  fechaCierreEstimada: string | null;
  responsable: string | null;
  presupuestoEstimado: number | null;
  estado: EstadoProyecto;
}

/**
 * `GET /api/clientes/:id` — el cliente extendido con sus proyectos y el resumen de consumo
 * por proyecto (FR-037). `resumenSalidas` viaja vacío hasta que exista el módulo de salidas
 * (US3); el frontend de esta tanda no lo consume (ver `componentes/clientes/historial-salidas.tsx`).
 */
export interface ClienteConProyectos extends Cliente {
  proyectos: Proyecto[];
  resumenSalidas: unknown[];
}

/**
 * Respuesta de `GET /api/clientes/opciones-filtro` (US13, FR-076): las ciudades que existen
 * hoy entre los clientes, sin repetir y ordenadas. Mismo criterio (y mismo motivo) que
 * `OpcionesFiltroInventario`: `ciudad` es texto libre capturado a mano, así que el filtro se
 * elige de lo que hay en vez de teclearse a ciegas.
 */
export interface OpcionesFiltroClientes {
  ciudades: string[];
}
