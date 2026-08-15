/**
 * Formas de la API REST de órdenes de compra consumidas por el frontend (contracts/api-rest.md
 * § Órdenes de compra, US16). Mismo criterio que `tipos/ingresos.ts`: reflejan la entidad de
 * dominio del backend SERIALIZADA a JSON —el frontend nunca importa esa entidad—, con las
 * fechas como texto ISO porque así viajan una vez que Nest serializa la respuesta.
 *
 * Implementa: FR-094…FR-099 (forma de lectura de una orden, sus líneas y sus sugerencias).
 */
import type { EstadoOrdenCompra } from '../esquemas/ordenes-compra';

export interface OrdenCompra {
  id: number;
  /** Correlativo asignado por el sistema (FR-095). Se muestra como `OC-000042`; el formato es
   *  presentación, el dato es este entero. */
  numero: number;
  proveedor: { id: number; nombre: string };
  fechaOrden: string;
  fechaEntregaEsperada: string | null;
  observaciones: string | null;
  estado: EstadoOrdenCompra;
  valorTotal: number;
  motivoAnulacion: string | null;
}

export interface DetalleOrdenCompra {
  id: number;
  ordenCompraId: number;
  productoId: number;
  cantidad: number;
  precioUnitario: number;
  valorTotal: number;
}

/** `GET /api/ordenes-compra/:id` — cabecera + líneas. */
export interface OrdenCompraConDetalles extends OrdenCompra {
  detalles: DetalleOrdenCompra[];
}

/**
 * Una fila de `GET /api/ordenes-compra/sugerencias?proveedorId=` (FR-098).
 *
 * Es una PROPUESTA, no una orden: el usuario decide qué agregar y con qué cantidad. Trae el
 * porqué a la vista (`disponible` contra `umbralStockBajo`) para que la decisión no dependa de
 * confiar en el número sugerido.
 */
export interface SugerenciaCompra {
  productoId: number;
  sku: string;
  descripcion: string;
  disponible: number;
  umbralStockBajo: number;
  /** `umbral × 2 − disponible`, redondeada hacia arriba — ver el contrato para el porqué. */
  cantidadSugerida: number;
  /** El último costo conocido del producto: lo último que se pagó por él. */
  precioSugerido: number;
}

/** Formato de presentación del número de orden (`42` → `OC-000042`). Vive en el paquete
 *  compartido porque lo usan el frontend (pantallas) y el backend (documentos exportados), y
 *  dos implementaciones del mismo formato acabarían divergiendo. */
export function formatoNumeroOrdenCompra(numero: number): string {
  return `OC-${String(numero).padStart(6, '0')}`;
}
