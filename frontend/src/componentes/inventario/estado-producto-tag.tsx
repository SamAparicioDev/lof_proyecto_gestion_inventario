/**
 * Tag de estado de un producto — mapea `EstadoProducto` a las clases `.tag` de Nocturne
 * (docs/diseno-nocturne.md): ACTIVO en acento (puede recibirse/despacharse en documentos
 * nuevos), INACTIVO en neutral (baja lógica, sin efecto — FR-012). Mismo criterio que
 * `EstadoClienteTag`/`EstadoSalidaTag` (T044/T053): un solo mapeo compartido, no repetido
 * en cada pantalla que muestra el estado de un producto (T062).
 */
import type { EstadoProducto } from '@trazo/compartido';

const ETIQUETA: Record<EstadoProducto, string> = {
  ACTIVO: 'Activo',
  INACTIVO: 'Inactivo',
};

const CLASE: Record<EstadoProducto, string> = {
  ACTIVO: 'tag tag-accent',
  INACTIVO: 'tag tag-neutral',
};

export function EstadoProductoTag({ estado }: { estado: EstadoProducto }) {
  return <span className={CLASE[estado]}>{ETIQUETA[estado]}</span>;
}
