/**
 * Tag de estado de un usuario — mapea `EstadoUsuario` a las clases `.tag` de Nocturne
 * (docs/diseno-nocturne.md), mismo criterio que `componentes/clientes/estado-cliente-tag.tsx`:
 * ACTIVO en acento (puede iniciar sesión), INACTIVO en neutral (baja lógica, sin acceso —
 * FR-008).
 */
import type { EstadoUsuario } from '@trazo/compartido';

const ETIQUETA: Record<EstadoUsuario, string> = {
  ACTIVO: 'Activo',
  INACTIVO: 'Inactivo',
};

const CLASE: Record<EstadoUsuario, string> = {
  ACTIVO: 'tag tag-accent',
  INACTIVO: 'tag tag-neutral',
};

export function EstadoUsuarioTag({ estado }: { estado: EstadoUsuario }) {
  return <span className={CLASE[estado]}>{ETIQUETA[estado]}</span>;
}
