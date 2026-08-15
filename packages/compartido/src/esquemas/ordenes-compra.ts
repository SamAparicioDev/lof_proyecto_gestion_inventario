/**
 * Esquemas de órdenes de compra (US16, FR-094…FR-100).
 *
 * Una orden de compra es el pedido formal que se le envía a un proveedor. Su forma es casi la
 * de un ingreso —cabecera con proveedor y fechas, más líneas de producto con cantidad y
 * precio—, y esa semejanza es deliberada: es el MISMO documento visto antes y después de que
 * la mercancía llegue, así que convertir una orden en un ingreso (FR-099) es rellenar los dos
 * datos que solo la factura aporta (su número y su fecha).
 *
 * Dos diferencias de fondo con el ingreso, que explican por qué no comparten esquema:
 *
 *  - **El precio es ESTIMADO**. En un ingreso, `precioUnitario` es lo que se pagó y alimenta el
 *    costo del inventario (FR-071); aquí es lo que se espera pagar, y no toca nada.
 *  - **Una orden no tiene número propio que el usuario teclee**: lo asigna el sistema (FR-095),
 *    igual que el de las salidas. Por eso no aparece en el body.
 *
 * Sigue el patrón de `esquemas/ingresos.ts`, incluida la regla de forma "sin producto repetido
 * en dos líneas" (que coincide con el `UNIQUE(orden_compra_id, producto_id)` de data-model.md).
 */
import { z } from 'zod';
import { esquemaIdFiltro, esquemaPaginacion } from './comunes';

/** Estados de una orden (data-model.md — FR-096). */
export const ESTADOS_ORDEN_COMPRA = ['BORRADOR', 'ENVIADA', 'RECIBIDA', 'ANULADA'] as const;
export type EstadoOrdenCompra = (typeof ESTADOS_ORDEN_COMPRA)[number];

/** `true` si `valor` tiene, como máximo, 2 cifras decimales (columnas `DECIMAL(_,2)`). */
function tieneMaximoDosDecimales(valor: number): boolean {
  const [, decimales] = valor.toString().split('.');
  return (decimales?.length ?? 0) <= 2;
}

/** Línea de la orden: producto pedido, cantidad y precio unitario ESTIMADO. */
const esquemaLineaOrdenCompra = z.object({
  productoId: z
    .number({ required_error: 'El producto es obligatorio', invalid_type_error: 'El producto es obligatorio' })
    .int('El producto no es válido')
    .positive('El producto no es válido'),
  cantidad: z
    .number({ required_error: 'La cantidad es obligatoria', invalid_type_error: 'La cantidad debe ser un número' })
    .positive('La cantidad debe ser mayor a 0')
    .refine(tieneMaximoDosDecimales, 'La cantidad admite máximo 2 decimales'),
  precioUnitario: z
    .number({
      required_error: 'El precio unitario es obligatorio',
      invalid_type_error: 'El precio unitario debe ser un número',
    })
    .positive('El precio unitario debe ser mayor a 0'),
});
export type LineaOrdenCompra = z.infer<typeof esquemaLineaOrdenCompra>;

/** Rechaza líneas que referencian el mismo producto más de una vez — un producto por línea
 *  (`UNIQUE(orden_compra_id, producto_id)`). El error se ancla a `lineas` para que el
 *  formulario lo muestre junto a la tabla. */
function sinProductosRepetidos(lineas: LineaOrdenCompra[], ctx: z.RefinementCtx): void {
  const vistos = new Set<number>();
  const hayRepetidos = lineas.some((linea) => {
    if (vistos.has(linea.productoId)) return true;
    vistos.add(linea.productoId);
    return false;
  });
  if (hayRepetidos) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'No repitas el mismo producto en dos líneas',
      path: ['lineas'],
    });
  }
}

/** Fecha (solo día, sin hora — columnas `DATE`) en texto ISO `YYYY-MM-DD`. */
function esquemaFecha(mensajeObligatoria: string, mensajeInvalida: string) {
  return z
    .string({ required_error: mensajeObligatoria })
    .min(1, mensajeObligatoria)
    .refine((valor) => !Number.isNaN(Date.parse(valor)), mensajeInvalida);
}

function construirEsquemaOrdenCompra() {
  return z
    .object({
      proveedorId: z
        .number({
          required_error: 'El proveedor es obligatorio',
          invalid_type_error: 'El proveedor es obligatorio',
        })
        .int('El proveedor no es válido')
        .positive('El proveedor no es válido'),
      fechaOrden: esquemaFecha('La fecha de la orden es obligatoria', 'La fecha de la orden no es válida'),
      /** Lo que se le PIDE al proveedor, no un compromiso que el sistema controle: por eso es
       *  opcional y no se valida contra `fechaOrden` — pedir para "cuando puedas" es legítimo. */
      fechaEntregaEsperada: z
        .string()
        .optional()
        .refine(
          (valor) => valor === undefined || valor === '' || !Number.isNaN(Date.parse(valor)),
          'La fecha de entrega esperada no es válida',
        )
        .transform((valor) => (valor === '' ? undefined : valor)),
      observaciones: z.string().trim().optional(),
      lineas: z.array(esquemaLineaOrdenCompra).min(1, 'Agrega al menos un producto'),
    })
    .superRefine((datos, ctx) => sinProductosRepetidos(datos.lineas, ctx));
}

/** Body de `POST /api/ordenes-compra`. */
export const esquemaCrearOrdenCompra = construirEsquemaOrdenCompra();
export type DatosCrearOrdenCompra = z.infer<typeof esquemaCrearOrdenCompra>;

/** Body de `PUT /api/ordenes-compra/:id` — mismo esquema; solo editable en BORRADOR (FR-096). */
export const esquemaActualizarOrdenCompra = construirEsquemaOrdenCompra();
export type DatosActualizarOrdenCompra = z.infer<typeof esquemaActualizarOrdenCompra>;

/**
 * Query de `GET /api/ordenes-compra`. `buscar` cruza el NÚMERO de la orden y el nombre del
 * proveedor, igual que el `buscar` de ingresos cruza factura y proveedor; `proveedorId` acota
 * a uno solo, que es la pregunta natural del módulo ("¿qué le pedí a Formex?").
 */
export const esquemaFiltroOrdenesCompra = z
  .object({
    buscar: z.string().trim().optional(),
    proveedorId: esquemaIdFiltro('El proveedor no es válido'),
    estado: z
      .enum(ESTADOS_ORDEN_COMPRA, { errorMap: () => ({ message: 'El estado no es válido' }) })
      .optional(),
    desde: z
      .string()
      .optional()
      .refine((valor) => valor === undefined || !Number.isNaN(Date.parse(valor)), 'La fecha "desde" no es válida'),
    hasta: z
      .string()
      .optional()
      .refine((valor) => valor === undefined || !Number.isNaN(Date.parse(valor)), 'La fecha "hasta" no es válida'),
  })
  .merge(esquemaPaginacion);
export type FiltroOrdenesCompra = z.infer<typeof esquemaFiltroOrdenesCompra>;

/** Query de `GET /api/ordenes-compra/sugerencias?proveedorId=` (FR-098). A diferencia del
 *  filtro del listado, aquí el proveedor es OBLIGATORIO: la sugerencia se define contra uno. */
export const esquemaSugerenciasCompra = z.object({
  proveedorId: z.coerce
    .number({ invalid_type_error: 'El proveedor no es válido' })
    .int('El proveedor no es válido')
    .positive('El proveedor no es válido'),
});
export type FiltroSugerenciasCompra = z.infer<typeof esquemaSugerenciasCompra>;
