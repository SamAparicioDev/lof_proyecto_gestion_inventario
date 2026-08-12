/**
 * Tag del rol de un usuario — muestra el NOMBRE del rol con las clases `.tag` de Nocturne
 * (docs/diseno-nocturne.md, FR-002/FR-006).
 *
 * Hasta US9 este componente traducía el enum `ADMINISTRADOR|GERENTE|OPERARIO` con dos
 * `Record<Rol, …>`: uno de etiqueta y otro de tono. Con los roles como dato (FR-054) ninguno de
 * los dos mapas puede existir — el Administrador crea roles cuyo nombre este archivo no puede
 * conocer, y uno que no estuviera en el mapa habría salido sin clase (`undefined`), es decir
 * sin tag visible. Ahora la etiqueta viene lista del servidor (`rol.nombre`, T106) y el tono se
 * deriva del `id`, que es estable e inmutable.
 *
 * El tono NO significa nada por sí mismo (no hay "el morado es el que manda"): solo sirve para
 * que dos roles distintos se distingan de un vistazo en la misma tabla, que es lo que hacía el
 * mapa anterior. Un rol conserva siempre su mismo tono porque su id no cambia.
 */
import type { RolAsignado } from '@trazo/compartido';

/** Tonos disponibles de `.tag` en Nocturne, en el orden en que se reparten por id. */
const TONOS = ['tag tag-accent', 'tag tag-accent-2', 'tag tag-neutral'] as const;

export function RolUsuarioTag({ rol }: { rol: RolAsignado }) {
  return <span className={TONOS[rol.id % TONOS.length]}>{rol.nombre}</span>;
}
