/**
 * Formas de la API REST de ingresos (factura de compra) consumidas por el frontend
 * (contracts/api-rest.md § Ingresos, T034/T036). Reflejan la entidad de dominio del backend
 * (`backend/src/dominio/entidades/ingreso.ts`) SERIALIZADA a JSON — el frontend nunca
 * importa esa entidad directamente (docs/arquitectura.md §2: solo conoce el contrato, nunca
 * las capas internas del backend) — por eso el mismo shape se declara aquí, en el paquete
 * compartido, con una diferencia deliberada: las fechas llegan como texto ISO (`string`),
 * no como `Date`, porque así es como viajan una vez que Nest serializa la respuesta.
 *
 * Implementa: FR-013…FR-019 (forma de lectura de ingresos y sus líneas).
 */

/** Máquina de estados de un ingreso (data-model.md — FR-017/FR-019). */
export type EstadoIngreso = 'PENDIENTE' | 'RECIBIDO' | 'VERIFICADO' | 'ANULADO';

export interface Ingreso {
  id: number;
  numeroFactura: string;
  fechaFactura: string;
  /** US15 (FR-091): el proveedor vive en un catálogo. Viaja resuelto —id y nombre— porque es
   *  lo que la pantalla necesita mostrar sin una segunda petición, igual que `Producto.categoria`.
   *  Nunca es `null`: el proveedor de un ingreso es obligatorio. */
  proveedor: { id: number; nombre: string };
  fechaRecepcion: string;
  observaciones: string | null;
  estado: EstadoIngreso;
  valorTotal: number;
  usuarioRegistraId: number;
  motivoAnulacion: string | null;
}

export interface DetalleIngreso {
  id: number;
  ingresoId: number;
  productoId: number;
  cantidad: number;
  precioUnitario: number;
  valorTotal: number;
}

/** `GET /api/ingresos/:id` — cabecera + líneas (forma de `IngresoConDetalles` del backend). */
export interface IngresoConDetalles extends Ingreso {
  detalles: DetalleIngreso[];
}
