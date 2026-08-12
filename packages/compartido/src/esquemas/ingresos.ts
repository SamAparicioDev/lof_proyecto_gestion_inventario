/**
 * Esquemas de ingresos (facturas de compra) — cabecera + líneas de producto (FR-013…FR-019).
 *
 * Implementa: FR-014 (líneas con cantidad y precio unitario, base del cálculo de totales),
 * FR-015 (número de factura obligatorio — la unicidad concurrente la refuerza la BD, esto
 * solo valida la forma), FR-016/FR-047 (validación con mensajes en español que indican el
 * campo y la corrección esperada). La regla "sin producto repetido en dos líneas" vive aquí
 * porque es una regla de FORMA del documento (coincide con el `UNIQUE(ingreso_id,
 * producto_id)` de data-model.md), no una regla de disponibilidad de stock — esa vive en
 * `ServicioStock` (dominio, research R4).
 *
 * `esquemaCrearIngreso` y `esquemaActualizarIngreso` comparten exactamente el mismo shape
 * (contracts/api-rest.md: `PUT /api/ingresos/:id` "mismo esquema" que `POST`) — se generan
 * con la misma función interna para no duplicar las reglas.
 *
 * Sigue el patrón de esquemas/autenticacion.ts (archivo ejemplar).
 */
import { z } from 'zod';
import { esquemaPaginacion, esquemaTextoFiltro } from './comunes';

/** `true` si `valor` tiene, como máximo, 2 cifras decimales (columnas `DECIMAL(12,2)` — FR-016). */
function tieneMaximoDosDecimales(valor: number): boolean {
  const [, decimales] = valor.toString().split('.');
  return (decimales?.length ?? 0) <= 2;
}

/** Línea de factura: producto recibido, cantidad y precio de compra unitario. */
const esquemaLineaIngreso = z.object({
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
export type LineaIngreso = z.infer<typeof esquemaLineaIngreso>;

/**
 * Rechaza líneas que referencian el mismo producto más de una vez — el documento solo
 * admite un producto por línea (`UNIQUE(ingreso_id, producto_id)`, data-model.md). El error
 * se ancla a `lineas` para que el formulario lo muestre junto a la tabla de líneas.
 */
function sinProductosRepetidos(lineas: LineaIngreso[], ctx: z.RefinementCtx): void {
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

/** Fecha (solo día, sin hora — columnas `DATE` de data-model.md) en texto, formato ISO `YYYY-MM-DD`. */
function esquemaFecha(mensajeObligatoria: string, mensajeInvalida: string) {
  return z
    .string({ required_error: mensajeObligatoria })
    .min(1, mensajeObligatoria)
    .refine((valor) => !Number.isNaN(Date.parse(valor)), mensajeInvalida);
}

/** Construye el esquema de cabecera+líneas de un ingreso — reutilizado por crear y actualizar. */
function construirEsquemaIngreso() {
  return z
    .object({
      numeroFactura: z
        .string({ required_error: 'El número de factura es obligatorio' })
        .trim()
        .min(1, 'El número de factura es obligatorio')
        .max(50, 'El número de factura no puede superar 50 caracteres'),
      fechaFactura: esquemaFecha('La fecha de la factura es obligatoria', 'La fecha de la factura no es válida'),
      proveedor: z
        .string({ required_error: 'El proveedor es obligatorio' })
        .trim()
        .min(1, 'El proveedor es obligatorio')
        .max(150, 'El proveedor no puede superar 150 caracteres'),
      fechaRecepcion: esquemaFecha(
        'La fecha de recepción es obligatoria',
        'La fecha de recepción no es válida',
      ),
      observaciones: z.string().trim().optional(),
      lineas: z.array(esquemaLineaIngreso).min(1, 'Agrega al menos un producto'),
    })
    .superRefine((datos, ctx) => sinProductosRepetidos(datos.lineas, ctx));
}

/** Body de `POST /api/ingresos` (contracts/api-rest.md). */
export const esquemaCrearIngreso = construirEsquemaIngreso();
export type DatosCrearIngreso = z.infer<typeof esquemaCrearIngreso>;

/** Body de `PUT /api/ingresos/:id` — mismo esquema que crear; solo editable en PENDIENTE (US1-AS5). */
export const esquemaActualizarIngreso = construirEsquemaIngreso();
export type DatosActualizarIngreso = z.infer<typeof esquemaActualizarIngreso>;

/**
 * Query de `GET /api/ingresos?buscar=&estado=&desde=&hasta=&proveedor=` — filtros de listado
 * (FR-018) más la paginación común a todos los listados (`esquemas/comunes.ts`). Las
 * fechas son opcionales aquí (a diferencia de la cabecera del documento): un filtro de
 * rango vacío simplemente no acota la búsqueda.
 *
 * `proveedor` (US13, FR-075) es subcadena insensible a mayúsculas, igual que `buscar`, pero
 * acotada a esa sola columna. No es redundante: `buscar` cruza `numero_factura` OR `proveedor`,
 * así que teclear "3M" trae también facturas cuyo NÚMERO contiene "3M". Los dos se combinan con
 * Y lógico, y como vive en `CriteriosIngresos` (backend) también acota la exportación del
 * listado sin trabajo adicional (FR-064/SC-007).
 */
export const esquemaFiltroIngresos = z
  .object({
    buscar: z.string().trim().optional(),
    proveedor: esquemaTextoFiltro(),
    estado: z.enum(['PENDIENTE', 'RECIBIDO', 'VERIFICADO', 'ANULADO'], {
      errorMap: () => ({ message: 'El estado no es válido' }),
    }).optional(),
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
export type FiltroIngresos = z.infer<typeof esquemaFiltroIngresos>;
