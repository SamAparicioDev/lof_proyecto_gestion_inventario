/**
 * Entidad de dominio `CambioCostoProducto` — TypeScript puro (Principio VI, NO NEGOCIABLE).
 *
 * Una fila del historial INMUTABLE de `historial_costos_producto`: de cuánto a cuánto pasó el
 * costo de un producto, quién lo cambió, cuándo y por qué camino (US12).
 *
 * **Por qué no es un `MovimientoInventario`** (FR-073, la decisión central de esta historia):
 * un cambio de costo no mueve cantidades. Registrarlo en `movimientos_inventario` rompería el
 * invariante `stock_actual(p) = Σ movimientos(p)` (invariante 2 de data-model.md), que es la
 * base de la prueba de conciliación y de la confianza en el inventario. Son dos historiales
 * distintos porque responden dos preguntas distintas: *cuánto hay y por qué* vs. *cuánto vale
 * y desde cuándo*.
 *
 * Implementa: FR-072 (todo cambio de costo queda registrado de forma permanente e inmutable
 * con costo anterior, costo nuevo, usuario, fecha/hora y origen) y FR-073 (no es un movimiento
 * de inventario).
 */

/**
 * De dónde vino un cambio de costo. Son los TRES —y únicos— caminos por los que
 * `productos.ultimo_costo` cambia hoy:
 *
 * - `IMPORTACION`: una fila de la carga masiva traía un "Valor unitario" distinto del vigente
 *   (FR-071/FR-074).
 * - `EDICION_MANUAL`: alguien corrigió el costo desde `PUT /api/productos/:id` (FR-071).
 * - `RECEPCION_INGRESO`: se recibió mercancía a un precio distinto del último conocido
 *   (`POST /api/ingresos/:id/recibir`). Ese camino YA actualizaba el costo desde US1 y hasta
 *   US12 no dejaba rastro del cambio de precio — este enum cierra ese hueco.
 *
 * Si mañana aparece un cuarto camino que toque el costo, agregar aquí su valor es lo que
 * obliga al compilador a resolver todos los `switch` que lo traducen.
 */
export type OrigenCambioCosto = 'IMPORTACION' | 'EDICION_MANUAL' | 'RECEPCION_INGRESO';

/** Una entrada del historial de costos de un producto, tal como se persistió. */
export interface CambioCostoProducto {
  readonly id: number;
  readonly productoId: number;
  readonly costoAnterior: number;
  readonly costoNuevo: number;
  readonly origen: OrigenCambioCosto;
  /** Id del ingreso que originó el cambio cuando `origen === 'RECEPCION_INGRESO'`; si no, `null`. */
  readonly documentoId: number | null;
  readonly fechaHora: Date;
  readonly usuarioId: number;
}
