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
import type { TasaIva } from '../esquemas/impuestos';
import type { TipoIngreso } from '../esquemas/ingresos';

/** Máquina de estados de un ingreso (data-model.md — FR-017/FR-019). */
export type EstadoIngreso = 'PENDIENTE' | 'RECIBIDO' | 'VERIFICADO' | 'ANULADO';

export interface Ingreso {
  id: number;
  /** US29 (FR-126): `FACTURA` es una compra; `AJUSTE`, una corrección de inventario. */
  tipo: TipoIngreso;
  /** `null` en los ajustes: no hay factura detrás (US29, FR-126). */
  numeroFactura: string | null;
  /** Correlativo propio del ajuste, YA formateado como `AJU-000042`; `null` en las facturas.
   *  Es el identificador que la pantalla muestra donde las facturas muestran su número. */
  numeroAjuste: string | null;
  /** `null` en los ajustes. */
  fechaFactura: string | null;
  /** US15 (FR-091): el proveedor vive en un catálogo. Viaja resuelto —id y nombre— porque es
   *  lo que la pantalla necesita mostrar sin una segunda petición, igual que `Producto.categoria`.
   *  `null` solo en los ajustes de inventario (US29): a un ajuste no se le compra a nadie. */
  proveedor: { id: number; nombre: string } | null;
  fechaRecepcion: string;
  observaciones: string | null;
  estado: EstadoIngreso;
  valorTotal: number;
  /** US20 (FR-110): base gravable en `valorTotal`, impuesto aquí. El total que se paga es la
   *  suma de los dos y NO viaja como campo propio — se deriva donde se muestra. */
  valorIva: number;
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
  /** US20 (FR-109): tasa aplicada a esta línea y el impuesto que resulta. Es la MISMA unión
   *  que valida el esquema —y que restringe el `CHECK` de la base—, así que el formulario puede
   *  recargar la línea tal cual sin volver a estrecharla. */
  tasaIva: TasaIva;
  valorIva: number;
}

/** `GET /api/ingresos/:id` — cabecera + líneas (forma de `IngresoConDetalles` del backend). */
export interface IngresoConDetalles extends Ingreso {
  detalles: DetalleIngreso[];
}
