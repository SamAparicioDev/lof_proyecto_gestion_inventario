/**
 * Tag de tipo de movimiento del historial de un producto — mapea `TipoMovimientoInventario`
 * a las clases `.tag` de Nocturne (docs/diseno-nocturne.md), tal como lo pide la tanda T062:
 * ENTRADA en acento (suma stock), SALIDA en contorno (resta stock, requiere cliente/proyecto),
 * AJUSTE_ENTRADA/AJUSTE_SALIDA en neutral (correcciones — FR-019/FR-032, siempre con `motivo`).
 * Reutilizado por la tabla de historial de `/inventario/[id]` (T062) y, desde la Tanda 9
 * (US7/T082), por el filtro y la tabla del reporte de movimientos
 * (`componentes/reportes/reporte-movimientos.tsx`) — `ETIQUETA_TIPO_MOVIMIENTO` se exporta
 * para que ese reporte no duplique la MISMA traducción español (ya replicada, por necesidad,
 * en `mapeadores-documento-reporte.ts` del backend, que no puede importar código del frontend).
 */
import type { TipoMovimientoInventario } from '@trazo/compartido';

export const ETIQUETA_TIPO_MOVIMIENTO: Record<TipoMovimientoInventario, string> = {
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  AJUSTE_ENTRADA: 'Ajuste (entrada)',
  AJUSTE_SALIDA: 'Ajuste (salida)',
};

const CLASE: Record<TipoMovimientoInventario, string> = {
  ENTRADA: 'tag tag-accent',
  SALIDA: 'tag tag-outline',
  AJUSTE_ENTRADA: 'tag tag-neutral',
  AJUSTE_SALIDA: 'tag tag-neutral',
};

export function TipoMovimientoTag({ tipo }: { tipo: TipoMovimientoInventario }) {
  return <span className={CLASE[tipo]}>{ETIQUETA_TIPO_MOVIMIENTO[tipo]}</span>;
}

/** Signo del movimiento sobre el stock (ENTRADA/AJUSTE_ENTRADA suman, SALIDA/AJUSTE_SALIDA
 *  restan) — usado para anteponer "+"/"-" a la cantidad en la tabla de historial (T062). */
export function signoMovimiento(tipo: TipoMovimientoInventario): 1 | -1 {
  return tipo === 'ENTRADA' || tipo === 'AJUSTE_ENTRADA' ? 1 : -1;
}
