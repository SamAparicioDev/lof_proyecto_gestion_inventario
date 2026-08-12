/**
 * Tag de estado de un proyecto — mapea `EstadoProyecto` a las clases `.tag` de Nocturne
 * (docs/diseno-nocturne.md). Criterio de diseño de T045 (mismo espíritu que
 * `EstadoIngresoTag`, `componentes/ingresos/estado-ingreso-tag.tsx`): ACTIVO en acento (es
 * destino válido de nuevas salidas — FR-038), COMPLETADO en el segundo tono de acento
 * (cierre exitoso, sigue siendo "positivo" pero distinguible de "en curso" — Nocturne es un
 * esquema mono sin un color de éxito/alerta dedicado, docs/diseno-nocturne.md), SUSPENDIDO
 * en neutral (fuera de operación, deja de recibir salidas). Componente compartido entre el
 * detalle del cliente (T045) y el diálogo de proyecto.
 */
import type { EstadoProyecto } from '@trazo/compartido';

const ETIQUETA: Record<EstadoProyecto, string> = {
  ACTIVO: 'Activo',
  COMPLETADO: 'Completado',
  SUSPENDIDO: 'Suspendido',
};

const CLASE: Record<EstadoProyecto, string> = {
  ACTIVO: 'tag tag-accent',
  COMPLETADO: 'tag tag-accent-2',
  SUSPENDIDO: 'tag tag-neutral',
};

export function EstadoProyectoTag({ estado }: { estado: EstadoProyecto }) {
  return <span className={CLASE[estado]}>{ETIQUETA[estado]}</span>;
}
