/**
 * Esquemas del módulo de cotizaciones (US21, FR-112…FR-117).
 *
 * Espejo de `ordenes-compra.ts` mirando al cliente: mismas reglas de líneas (al menos una, sin
 * productos repetidos, cantidades y precios positivos) y mismos mensajes en español.
 *
 * Lo propio de este documento son las DOS fechas. `fechaValidez` no puede ser anterior a
 * `fecha` —sería una oferta nacida vencida— y esa comprobación cruzada vive aquí, en el esquema
 * compartido, para que el formulario la haga sin viaje al servidor y el backend la exija igual.
 */
import { z } from 'zod';
import { esquemaTasaIva } from './impuestos';
import { MENSAJE_CANTIDAD_ENTERA } from './comunes';

/** Estados del documento (data-model.md — FR-112). */
export const ESTADOS_COTIZACION = ['BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'ANULADA'] as const;
export type EstadoCotizacion = (typeof ESTADOS_COTIZACION)[number];

/** Línea de cotización: producto ofrecido, cantidad, precio e impuesto. */
const esquemaLineaCotizacion = z.object({
  productoId: z
    .number({ required_error: 'El producto es obligatorio', invalid_type_error: 'El producto es obligatorio' })
    .int('El producto no es válido')
    .positive('El producto no es válido'),
  cantidad: z
    .number({ required_error: 'La cantidad es obligatoria', invalid_type_error: 'La cantidad debe ser un número' })
    // US26 (FR-122): entera. `.int()` va ANTES de `.positive()` para que `2.5` se queje de los
    // decimales y no de otra cosa; `0.5` sí caería en el primero de los dos, y cualquiera de los
    // mensajes es correcto ahí.
    .int(MENSAJE_CANTIDAD_ENTERA)
    .positive('La cantidad debe ser mayor a 0'),
  precioUnitario: z
    .number({
      required_error: 'El precio unitario es obligatorio',
      invalid_type_error: 'El precio unitario debe ser un número',
    })
    .positive('El precio unitario debe ser mayor a 0'),
  tasaIva: esquemaTasaIva,
});
export type LineaCotizacion = z.infer<typeof esquemaLineaCotizacion>;

/**
 * Rechaza líneas que referencian el mismo producto más de una vez — el documento solo admite un
 * producto por línea (`UNIQUE(cotizacion_id, producto_id)`). El error se ancla a `lineas` para
 * que el formulario lo muestre junto a la tabla.
 */
function sinProductosRepetidos(lineas: LineaCotizacion[], ctx: z.RefinementCtx): void {
  const vistos = new Set<number>();
  const hayRepetidos = lineas.some((linea) => {
    if (vistos.has(linea.productoId)) return true;
    vistos.add(linea.productoId);
    return false;
  });
  if (hayRepetidos) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lineas'],
      message: 'Cada producto puede aparecer en una sola línea',
    });
  }
}

/** Fecha `aaaa-mm-dd` del contrato (mismo formato en todos los documentos). */
const esquemaFecha = (mensaje: string) =>
  z
    .string({ required_error: mensaje, invalid_type_error: mensaje })
    .regex(/^\d{4}-\d{2}-\d{2}$/, mensaje);

export const esquemaCrearCotizacion = z
  .object({
    clienteId: z
      .number({ required_error: 'El cliente es obligatorio', invalid_type_error: 'El cliente es obligatorio' })
      .int('El cliente no es válido')
      .positive('El cliente no es válido'),
    proyectoId: z
      .number({ required_error: 'El proyecto es obligatorio', invalid_type_error: 'El proyecto es obligatorio' })
      .int('El proyecto no es válido')
      .positive('El proyecto no es válido'),
    fecha: esquemaFecha('La fecha es obligatoria'),
    fechaValidez: esquemaFecha('La fecha de validez es obligatoria'),
    observaciones: z.string().trim().max(1000, 'Las observaciones no pueden superar 1000 caracteres').optional(),
    lineas: z.array(esquemaLineaCotizacion).min(1, 'Agrega al menos un producto').superRefine(sinProductosRepetidos),
  })
  .superRefine((datos, contexto) => {
    // Una oferta que caduca antes de emitirse no es una oferta. Se ancla a `fechaValidez`
    // porque es el campo que el usuario tiene que corregir.
    if (datos.fechaValidez < datos.fecha) {
      contexto.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fechaValidez'],
        message: 'La validez no puede ser anterior a la fecha de la cotización',
      });
    }
  });
export type DatosCrearCotizacion = z.infer<typeof esquemaCrearCotizacion>;

/** Editar usa el mismo cuerpo que crear (el contrato dice "mismo esquema"). */
export const esquemaActualizarCotizacion = esquemaCrearCotizacion;

/** Body de `PUT /api/cotizaciones/:id/anular` — el motivo es obligatorio, igual que en salidas
 *  y órdenes de compra: una anulación sin explicación no es trazable (FR-045). */
export const esquemaAnularCotizacion = z.object({
  motivo: z
    .string({ required_error: 'El motivo de anulación es obligatorio' })
    .trim()
    .min(1, 'El motivo de anulación es obligatorio')
    .max(500, 'El motivo no puede superar 500 caracteres'),
});
export type DatosAnularCotizacion = z.infer<typeof esquemaAnularCotizacion>;

/** Query de `GET /api/cotizaciones`. */
export const esquemaListarCotizaciones = z.object({
  pagina: z.coerce.number().int().positive().optional().default(1),
  porPagina: z.coerce.number().int().positive().max(100).optional().default(20),
  buscar: z.string().trim().optional(),
  clienteId: z.coerce.number().int().positive().optional(),
  estado: z.enum(ESTADOS_COTIZACION, { errorMap: () => ({ message: 'El estado no es válido' }) }).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha desde no es válida').optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha hasta no es válida').optional(),
});
export type FiltroListarCotizaciones = z.infer<typeof esquemaListarCotizaciones>;

/** Formato de presentación del correlativo — "COT-000042". El número es un entero en la base;
 *  esto es solo cómo se lee (mismo criterio que `formatoNumeroOrdenCompra`). */
export function formatoNumeroCotizacion(numero: number): string {
  return `COT-${String(numero).padStart(6, '0')}`;
}
