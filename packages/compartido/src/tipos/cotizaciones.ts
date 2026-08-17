/**
 * Formas de la API REST de cotizaciones consumidas por el frontend (contracts/api-rest.md
 * § Cotizaciones, US21). Mismo criterio que `tipos/ordenes-compra.ts`: reflejan la entidad de
 * dominio del backend SERIALIZADA a JSON —el frontend nunca importa esa entidad—, con las
 * fechas como texto ISO porque así viajan una vez que Nest serializa la respuesta.
 *
 * Implementa: FR-112…FR-116 (forma de lectura de una cotización y sus líneas).
 */
import type { EstadoCotizacion } from '../esquemas/cotizaciones';
import type { TasaIva } from '../esquemas/impuestos';

export interface Cotizacion {
  id: number;
  /** Correlativo asignado por el sistema (FR-112). Se muestra como `COT-000042`; el formato es
   *  presentación, el dato es este entero. */
  numero: number;
  cliente: { id: number; nombre: string };
  proyecto: { id: number; nombre: string };
  fecha: string;
  fechaValidez: string;
  observaciones: string | null;
  estado: EstadoCotizacion;
  /** Base gravable; el impuesto va en `valorIva` y el total se deriva sumando los dos (US20). */
  valorTotal: number;
  valorIva: number;
  motivoAnulacion: string | null;
  /** Salida generada al aceptarla (FR-115), o `null` mientras no se haya aceptado. */
  salidaId: number | null;
  /**
   * `true` si la fecha de validez ya pasó y la cotización sigue viva (FR-112).
   *
   * Lo calcula el BACKEND y viaja resuelto: es una comparación contra "hoy", y hacerla en el
   * navegador la ataría al reloj del equipo del usuario —dos personas verían cosas distintas
   * sobre el mismo documento—. No es un estado: una cotización vencida sigue ENVIADA.
   */
  vencida: boolean;
}

export interface DetalleCotizacion {
  id: number;
  cotizacionId: number;
  productoId: number;
  cantidad: number;
  precioUnitario: number;
  valorTotal: number;
  tasaIva: TasaIva;
  valorIva: number;
}

/** `GET /api/cotizaciones/:id` — cabecera + líneas. */
export interface CotizacionConDetalles extends Cotizacion {
  detalles: DetalleCotizacion[];
}

/** `GET /api/cotizaciones` — página del listado. */
export interface PaginaCotizaciones {
  datos: Cotizacion[];
  paginacion: { pagina: number; porPagina: number; total: number; totalPaginas: number };
}
