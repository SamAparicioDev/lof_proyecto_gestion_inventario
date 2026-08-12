/**
 * Tag de estado de un rol — mapea `EstadoRol` a las clases `.tag` de Nocturne
 * (docs/diseno-nocturne.md), mismo patrón que `componentes/usuarios/estado-usuario-tag.tsx`.
 * Un rol INACTIVO es una baja lógica (nunca se elimina): sigue asignado a sus usuarios y por
 * eso se muestra atenuado, no oculto.
 */
import type { EstadoRol } from '@trazo/compartido';

const ETIQUETA: Record<EstadoRol, string> = {
  ACTIVO: 'Activo',
  INACTIVO: 'Inactivo',
};

const CLASE: Record<EstadoRol, string> = {
  ACTIVO: 'tag tag-accent',
  INACTIVO: 'tag tag-neutral',
};

export function EstadoRolTag({ estado }: { estado: EstadoRol }) {
  return <span className={CLASE[estado]}>{ETIQUETA[estado]}</span>;
}
