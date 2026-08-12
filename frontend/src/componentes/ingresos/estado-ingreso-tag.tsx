/**
 * Tag de estado de un ingreso — mapea `EstadoIngreso` a las clases `.tag` de Nocturne
 * (docs/diseno-nocturne.md): RECIBIDO/VERIFICADO en acento (efectivo en stock), PENDIENTE en
 * contorno (a la espera), ANULADO en neutral (sin efecto) — criterio de diseño de T034.
 * Componente compartido entre el listado (T034) y el detalle (T036) para no repetir el mapeo.
 */
import type { EstadoIngreso } from '@trazo/compartido';

const ETIQUETA: Record<EstadoIngreso, string> = {
  PENDIENTE: 'Pendiente',
  RECIBIDO: 'Recibido',
  VERIFICADO: 'Verificado',
  ANULADO: 'Anulado',
};

const CLASE: Record<EstadoIngreso, string> = {
  PENDIENTE: 'tag tag-outline',
  RECIBIDO: 'tag tag-accent',
  VERIFICADO: 'tag tag-accent',
  ANULADO: 'tag tag-neutral',
};

export function EstadoIngresoTag({ estado }: { estado: EstadoIngreso }) {
  return <span className={CLASE[estado]}>{ETIQUETA[estado]}</span>;
}
