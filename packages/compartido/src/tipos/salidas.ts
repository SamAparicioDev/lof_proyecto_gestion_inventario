/**
 * Formas de la API REST de salidas (entrega de mercancía a cliente/proyecto) consumidas por
 * el frontend (contracts/api-rest.md § Salidas, T053-T055). Reflejan la entidad de dominio
 * del backend (`backend/src/dominio/entidades/salida.ts`) SERIALIZADA a JSON — mismo criterio
 * que `tipos/ingresos.ts`: el frontend nunca importa esa entidad directamente
 * (docs/arquitectura.md §2), y las fechas llegan como texto ISO (`string`), no como `Date`,
 * porque así es como viajan una vez que Nest serializa la respuesta.
 *
 * Implementa: FR-025…FR-033 (forma de lectura de salidas y sus líneas).
 */

/** Máquina de estados de una salida (data-model.md — FR-029/FR-032). */
export type EstadoSalida = 'PENDIENTE' | 'CONFIRMADA' | 'COMPLETADA' | 'ANULADA';

export interface Salida {
  id: number;
  numero: number;
  fechaSalida: string;
  /** El cliente se deriva del proyecto (data-model.md: guardar ambos duplicaría la verdad). */
  proyectoId: number;
  observaciones: string | null;
  estado: EstadoSalida;
  valorTotal: number;
  usuarioAutorizaId: number | null;
  fechaConfirmacion: string | null;
  motivoAnulacion: string | null;
}

export interface DetalleSalida {
  id: number;
  salidaId: number;
  productoId: number;
  cantidad: number;
  precioUnitario: number;
  valorTotal: number;
}

/** `GET /api/salidas/:id` — cabecera + líneas (forma de `SalidaConDetalles` del backend). */
export interface SalidaConDetalles extends Salida {
  detalles: DetalleSalida[];
}
