/**
 * Badge de alerta de stock bajo — `.tag tag-accent` con ícono de advertencia Phosphor
 * (`ph-warning` → `Warning`, docs/diseno-nocturne.md tabla de iconos), tal como lo pide T061
 * para marcar las filas del listado de inventario cuyo `disponible` está en o por debajo del
 * umbral del producto (FR-022, fuente de verdad: `stockBajo` que ya calcula el backend con
 * `esStockBajo`, nunca reimplementado aquí). Reutilizado también en la ficha (T062).
 *
 * Sin `flex items-center` de Tailwind (T110): `.tag` ya declara `display:inline-flex` y
 * `align-items:center`, y como Nocturne está sin capa CSS ganaba de todas formas sobre esas
 * utilidades — se veía bien, pero eran clases muertas que insinuaban lo contrario. `gap-1` sí
 * aplica: `.tag` no declara `gap`, así que no hay conflicto (docs/diseno-nocturne.md § cascada).
 */
import { Warning } from '@phosphor-icons/react/dist/ssr';

export function AlertaStockBajo() {
  return (
    <span className="tag tag-accent gap-1" style={{ width: 'fit-content' }}>
      <Warning size={12} weight="fill" /> Stock bajo
    </span>
  );
}
