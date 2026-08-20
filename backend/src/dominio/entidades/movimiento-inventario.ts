/**
 * Entidad de dominio `MovimientoInventario` — TypeScript puro (Principio VI, NO NEGOCIABLE).
 * Campos espejo de la tabla `movimientos_inventario` de `data-model.md`, como tipo PROPIO
 * del dominio: no importa el modelo/enum generado por Prisma (docs/arquitectura.md §2). El
 * adaptador `infraestructura/persistencia/repositorio-movimientos.prisma.ts` traduce
 * explícitamente entre el registro Prisma y esta forma.
 *
 * Esta tabla es INMUTABLE (trigger de BD — Principio II/FR-046): esta entidad y su puerto
 * (`repositorio-movimientos.ts`) son de SOLO LECTURA a propósito. Los `INSERT` de
 * movimientos viven dentro de las transacciones atómicas de `RepositorioIngresos`/
 * `RepositorioSalidas` (research R4) — este módulo nunca escribe.
 *
 * Implementa: FR-024 (historial de movimientos por producto, base de la ficha de US5) y
 * FR-045 (cada movimiento registra usuario, fecha/hora y documento de origen — auditoría de
 * la Trazabilidad Total, Principio II).
 */

/** Tipo de movimiento — el signo lo define este campo (ENTRADA/AJUSTE_ENTRADA suman,
 *  SALIDA/AJUSTE_SALIDA restan). Las anulaciones se registran como AJUSTE_* (FR-019/FR-032). */
export type TipoMovimientoInventario = 'ENTRADA' | 'SALIDA' | 'AJUSTE_ENTRADA' | 'AJUSTE_SALIDA';

/**
 * Documento de origen del movimiento — FK lógico a `Ingreso.id` o `Salida.id` según este campo.
 *
 * `AJUSTE` (US31, FR-130) es el único que NO tiene documento: es la corrección de cantidad hecha
 * desde el inventario para cuadrar con el conteo físico. Lo que la respalda es su `motivo`, que
 * la aplicación exige — por eso `documentoId` es `null` exactamente en este caso, y la base lo
 * fuerza como equivalencia (`movimientos_documento_ajuste_check`).
 */
export type DocumentoTipoMovimiento = 'INGRESO' | 'SALIDA' | 'AJUSTE';

export interface MovimientoInventario {
  readonly id: number;
  readonly fechaHora: Date;
  readonly tipo: TipoMovimientoInventario;
  readonly productoId: number;
  readonly cantidad: number;
  /** Snapshot de `stock_actual` inmediatamente después de este movimiento (auditoría). */
  readonly stockResultante: number;
  readonly documentoTipo: DocumentoTipoMovimiento;
  /** `null` Únicamente cuando `documentoTipo === 'AJUSTE'` (US31, FR-130). */
  readonly documentoId: number | null;
  /** `null` salvo cuando `documentoTipo === 'SALIDA'` (FR-042: todo movimiento de salida
   *  queda vinculado a su proyecto para el reporte de consumo). */
  readonly proyectoId: number | null;
  readonly usuarioId: number;
  /** Obligatorio a nivel de aplicación en AJUSTE_ENTRADA/AJUSTE_SALIDA (motivo de anulación). */
  readonly motivo: string | null;
}
