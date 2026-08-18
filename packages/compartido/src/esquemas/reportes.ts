/**
 * Esquemas de los reportes de consumo (`/api/reportes/consumo-cliente`,
 * `/api/reportes/consumo-proyecto` — FR-039/FR-040/FR-044), de los reportes de inventario y
 * movimientos (`/api/reportes/inventario`, `/api/reportes/movimientos` — FR-041/FR-042,
 * Tanda 9/US7/T081) y del formato de exportación compartido por TODOS los reportes
 * (`/api/reportes/{tipo}/export?formato=pdf|xlsx` — FR-043). Sigue el mismo patrón de
 * `esquemas/salidas.ts` y `esquemas/inventario.ts`: los ids que llegan por query string se
 * coercionan a número (`z.coerce.number()`) y las fechas de rango viajan como texto ISO
 * `YYYY-MM-DD` opcional, validadas con la misma función interna `esquemaFechaOpcional` que ya
 * usa `esquemas/inventario.ts`.
 *
 * A diferencia de `clienteId`/`proyectoId` de `esquemaFiltroSalidas` (ahí son filtros
 * OPCIONALES de un listado), aquí `clienteId`/`proyectoId` son OBLIGATORIOS — cada reporte
 * de consumo necesita saber de quién — con un único mensaje de error para toda forma de
 * dato inválido (ausente, texto, cero, negativo o decimal), mismo criterio que
 * `MENSAJE_PROYECTO_OBLIGATORIO` en `esquemas/salidas.ts`. En cambio, en
 * `esquemaFiltroReporteInventario`/`esquemaFiltroReporteMovimientos` TODOS los filtros son
 * opcionales (un reporte sin filtros = universo completo, FR-041/FR-042) — mismo criterio
 * que `esquemaFiltroSalidas` para `clienteId`/`proyectoId`/`estado`.
 *
 * `esquemaFormatoExport` se mergea con el filtro del reporte correspondiente en las rutas
 * `/export` (contracts/api-rest.md § Reportes: "mismos filtros + formato") — nunca se valida
 * solo, por eso vive en este archivo junto a los filtros que siempre lo acompañan.
 *
 * Implementa: FR-039 (filtro de consumo por cliente y rango de fechas), FR-040 (filtro de
 * consumo por proyecto y rango de fechas), FR-041 (filtro de inventario por producto y rango
 * de cantidad disponible), FR-042 (filtro de movimientos por fecha/tipo/usuario/cliente/
 * proyecto), FR-043 (formato de exportación pdf/xlsx), FR-016/FR-047 (mensajes en español que
 * indican el campo).
 */
import { z } from 'zod';

/** Fecha (solo día) en texto ISO `YYYY-MM-DD`, opcional — mismo criterio que `esquemas/inventario.ts`. */
function esquemaFechaOpcional(mensajeInvalida: string) {
  return z
    .string()
    .optional()
    .refine((valor) => valor === undefined || !Number.isNaN(Date.parse(valor)), mensajeInvalida);
}

/** Mensaje único para toda forma de `clienteId` inválido (ausente, texto, cero, negativo, decimal). */
const MENSAJE_CLIENTE_OBLIGATORIO = 'El cliente es obligatorio';

/** Mensaje único para toda forma de `proyectoId` inválido — mismo criterio que `MENSAJE_CLIENTE_OBLIGATORIO`. */
const MENSAJE_PROYECTO_OBLIGATORIO = 'El proyecto es obligatorio';

/** Query de `GET /api/reportes/consumo-cliente` (contracts/api-rest.md § Reportes, FR-039). */
export const esquemaFiltroConsumoCliente = z.object({
  clienteId: z.coerce
    .number({
      required_error: MENSAJE_CLIENTE_OBLIGATORIO,
      invalid_type_error: MENSAJE_CLIENTE_OBLIGATORIO,
    })
    .int(MENSAJE_CLIENTE_OBLIGATORIO)
    .positive(MENSAJE_CLIENTE_OBLIGATORIO),
  desde: esquemaFechaOpcional('La fecha "desde" no es válida'),
  hasta: esquemaFechaOpcional('La fecha "hasta" no es válida'),
});
export type FiltroConsumoCliente = z.infer<typeof esquemaFiltroConsumoCliente>;

/** Query de `GET /api/reportes/consumo-proyecto` (contracts/api-rest.md § Reportes, FR-040). */
export const esquemaFiltroConsumoProyecto = z.object({
  proyectoId: z.coerce
    .number({
      required_error: MENSAJE_PROYECTO_OBLIGATORIO,
      invalid_type_error: MENSAJE_PROYECTO_OBLIGATORIO,
    })
    .int(MENSAJE_PROYECTO_OBLIGATORIO)
    .positive(MENSAJE_PROYECTO_OBLIGATORIO),
  desde: esquemaFechaOpcional('La fecha "desde" no es válida'),
  hasta: esquemaFechaOpcional('La fecha "hasta" no es válida'),
});
export type FiltroConsumoProyecto = z.infer<typeof esquemaFiltroConsumoProyecto>;

/**
 * Query adicional de las rutas `/export` (FR-043) — se mergea con `esquemaFiltroConsumoCliente`
 * o `esquemaFiltroConsumoProyecto` (y, en US7, con los futuros filtros de inventario/
 * movimientos) para validar `formato` junto a los filtros del reporte en una sola pasada, de
 * modo que la exportación reciba EXACTAMENTE los mismos filtros que el endpoint de pantalla
 * (SC-007).
 */
export const esquemaFormatoExport = z.object({
  formato: z.enum(['pdf', 'xlsx'], { errorMap: () => ({ message: 'El formato debe ser pdf o xlsx' }) }),
});
export type FormatoExport = z.infer<typeof esquemaFormatoExport>;

/**
 * Query de `GET /api/reportes/inventario` (contracts/api-rest.md § Reportes, FR-041). Todos
 * los filtros son opcionales: sin `buscar` es todo el catálogo, sin `cantidadMin`/
 * `cantidadMax` no hay recorte de rango. El rango filtra sobre `disponible`
 * (`stockActual - comprometido`), no sobre `stockActual` crudo — el CÁLCULO vive en el caso
 * de uso (`reporte-inventario-actual.caso-uso.ts`), este esquema solo valida la FORMA del
 * query (que sean números no negativos).
 */
export const esquemaFiltroReporteInventario = z.object({
  buscar: z.string().trim().optional(),
  /** US24 (FR-120): acota el reporte a una familia de productos. Se elige del catálogo, así que
   *  viaja como id y no como texto — el nombre lo resuelve quien pinta el documento. */
  categoriaId: z.coerce
    .number({ invalid_type_error: 'La categoría no es válida' })
    .int('La categoría no es válida')
    .positive('La categoría no es válida')
    .optional(),
  cantidadMin: z.coerce
    .number({ invalid_type_error: 'La cantidad mínima debe ser un número' })
    .min(0, 'La cantidad mínima no puede ser negativa')
    .optional(),
  cantidadMax: z.coerce
    .number({ invalid_type_error: 'La cantidad máxima debe ser un número' })
    .min(0, 'La cantidad máxima no puede ser negativa')
    .optional(),
});
export type FiltroReporteInventario = z.infer<typeof esquemaFiltroReporteInventario>;

/**
 * Query de `GET /api/reportes/movimientos` (contracts/api-rest.md § Reportes, FR-042). Todos
 * los filtros son opcionales — mismo criterio que `esquemaFiltroSalidas` para
 * `clienteId`/`proyectoId`/`estado`: sin filtros, el reporte trae TODOS los movimientos.
 * `tipo` es el mismo enum de `dominio/entidades/movimiento-inventario.ts#TipoMovimientoInventario`,
 * replicado aquí a propósito (el paquete compartido no importa código del backend,
 * docs/arquitectura.md §2).
 */
export const esquemaFiltroReporteMovimientos = z.object({
  desde: esquemaFechaOpcional('La fecha "desde" no es válida'),
  hasta: esquemaFechaOpcional('La fecha "hasta" no es válida'),
  tipo: z
    .enum(['ENTRADA', 'SALIDA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA'], {
      errorMap: () => ({ message: 'El tipo de movimiento no es válido' }),
    })
    .optional(),
  usuarioId: z.coerce
    .number({ invalid_type_error: 'El usuario no es válido' })
    .int('El usuario no es válido')
    .positive('El usuario no es válido')
    .optional(),
  clienteId: z.coerce
    .number({ invalid_type_error: 'El cliente no es válido' })
    .int('El cliente no es válido')
    .positive('El cliente no es válido')
    .optional(),
  proyectoId: z.coerce
    .number({ invalid_type_error: 'El proyecto no es válido' })
    .int('El proyecto no es válido')
    .positive('El proyecto no es válido')
    .optional(),
});
export type FiltroReporteMovimientos = z.infer<typeof esquemaFiltroReporteMovimientos>;
