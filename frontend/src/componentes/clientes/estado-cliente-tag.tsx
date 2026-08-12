/**
 * Tag de estado de un cliente — mapea `EstadoCliente` a las clases `.tag` de Nocturne
 * (docs/diseno-nocturne.md): ACTIVO en acento (aporta destinos válidos de salida —
 * FR-038), INACTIVO en neutral (baja lógica, sin efecto — criterio de diseño de T044, mismo
 * mapeo pedido por la tanda: "ACTIVO=tag-accent, INACTIVO=tag-neutral"). Componente
 * compartido entre el listado (T044) y el detalle (T045) para no repetir el mapeo.
 */
import type { EstadoCliente } from '@trazo/compartido';

const ETIQUETA: Record<EstadoCliente, string> = {
  ACTIVO: 'Activo',
  INACTIVO: 'Inactivo',
};

const CLASE: Record<EstadoCliente, string> = {
  ACTIVO: 'tag tag-accent',
  INACTIVO: 'tag tag-neutral',
};

export function EstadoClienteTag({ estado }: { estado: EstadoCliente }) {
  return <span className={CLASE[estado]}>{ETIQUETA[estado]}</span>;
}
