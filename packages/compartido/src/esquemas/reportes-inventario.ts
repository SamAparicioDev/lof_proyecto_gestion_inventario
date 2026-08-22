/**
 * Esquemas de los dos reportes de SOLO LECTURA sobre el inventario: inventario inmóvil (US37,
 * FR-158…FR-162) y valorización a una fecha (US38, FR-163…FR-168).
 *
 * Van juntos porque comparten los mismos filtros de acotación (categoría y búsqueda) y porque
 * ninguno de los dos escribe nada: son dos preguntas distintas sobre los datos que el sistema ya
 * guarda desde el primer día.
 *
 * ## La fecha de la valorización no tiene valor por defecto, a propósito
 *
 * Sería cómodo precargarla con hoy y sería un error. Quien pide un cierre de diciembre y recibe el
 * inventario de hoy no tiene forma de notarlo mirando el archivo: la tabla se ve igual de
 * plausible. Un `400` que señala el campo es incómodo una vez; una cifra equivocada firmada como
 * cierre es un problema que aparece meses después.
 */
import { z } from 'zod';

/** Umbral por defecto del reporte de inmóvil. Un trimestre sin salir es el primer tramo donde
 *  casi cualquier negocio empieza a preocuparse — pero es solo el valor inicial del filtro, no
 *  una constante del sistema (FR-158). */
export const DIAS_SIN_SALIDA_POR_DEFECTO = 90;

/** Query de `GET /api/reportes/inventario-inmovil`. */
export const esquemaFiltrosInventarioInmovil = z.object({
  diasSinSalida: z.coerce
    .number({ invalid_type_error: 'Los días sin salida deben ser un número' })
    .int('Los días sin salida deben ser un número entero')
    .min(1, 'Los días sin salida deben ser al menos 1')
    .max(3650, 'Los días sin salida no pueden superar 3650 (10 años)')
    .optional()
    .default(DIAS_SIN_SALIDA_POR_DEFECTO),
  categoriaId: z.coerce.number().int().positive().optional(),
  buscar: z.string().trim().max(100).optional(),
});
export type FiltrosInventarioInmovil = z.infer<typeof esquemaFiltrosInventarioInmovil>;

/**
 * Query de `GET /api/reportes/valorizacion`.
 *
 * El rechazo de fechas futuras vive AQUÍ y no en el caso de uso (FR-167) para que el frontend dé
 * el mismo mensaje antes de enviar, y para que el backend —la autoridad— lo aplique con el mismo
 * texto. Es exactamente la validación doble del Principio IV.
 */
export const esquemaFiltrosValorizacion = z.object({
  fecha: z
    .string({ required_error: 'Elige la fecha del cierre' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato AAAA-MM-DD')
    .refine((valor) => !Number.isNaN(Date.parse(valor)), 'La fecha no es válida')
    .refine((valor) => {
      // Se compara contra el FINAL del día de hoy: pedir la valorización de hoy es legítimo
      // —es el cierre más común— y compararla contra el instante actual la rechazaría.
      const hoy = new Date();
      hoy.setHours(23, 59, 59, 999);
      return new Date(`${valor}T23:59:59.999Z`) <= hoy;
    }, 'La fecha no puede ser futura: el inventario de mañana todavía no existe'),
  categoriaId: z.coerce.number().int().positive().optional(),
  buscar: z.string().trim().max(100).optional(),
});
export type FiltrosValorizacion = z.infer<typeof esquemaFiltrosValorizacion>;
