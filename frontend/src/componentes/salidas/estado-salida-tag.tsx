/**
 * Tag de estado de una salida — mapea `EstadoSalida` a las clases `.tag` de Nocturne
 * (docs/diseno-nocturne.md): CONFIRMADA/COMPLETADA en acento (stock ya afectado o entrega
 * cerrada), PENDIENTE en contorno (a la espera, solo compromete disponibilidad), ANULADA en
 * neutral (sin efecto vigente) — mismo criterio que `EstadoIngresoTag` (T034), reutilizado
 * entre el listado (T053) y el detalle (T055).
 */
import type { EstadoSalida } from '@trazo/compartido';

const ETIQUETA: Record<EstadoSalida, string> = {
  PENDIENTE: 'Pendiente',
  CONFIRMADA: 'Confirmada',
  COMPLETADA: 'Completada',
  ANULADA: 'Anulada',
};

const CLASE: Record<EstadoSalida, string> = {
  PENDIENTE: 'tag tag-outline',
  CONFIRMADA: 'tag tag-accent',
  COMPLETADA: 'tag tag-accent',
  ANULADA: 'tag tag-neutral',
};

export function EstadoSalidaTag({ estado }: { estado: EstadoSalida }) {
  return <span className={CLASE[estado]}>{ETIQUETA[estado]}</span>;
}
