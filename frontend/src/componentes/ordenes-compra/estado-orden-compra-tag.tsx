/**
 * Tag de estado de una orden de compra — mapea `EstadoOrdenCompra` a las clases `.tag` de
 * Nocturne (docs/diseno-nocturne.md), con el MISMO criterio que `EstadoIngresoTag`: acento para
 * lo que ya surtió efecto, contorno para lo que está en curso y neutral para lo que no lo
 * tendrá. BORRADOR usa neutral —todavía no ha salido del sistema— y ENVIADA contorno: está a la
 * espera de que llegue la mercancía, que es exactamente lo que "pendiente" significa aquí.
 *
 * Las etiquetas coinciden literalmente con `ETIQUETA_ESTADO` de
 * `mapeadores-documento-orden-compra.ts` (backend): el documento exportado y la pantalla dicen
 * lo mismo, aunque el backend no pueda importar este archivo (docs/arquitectura.md §2).
 */
import type { EstadoOrdenCompra } from '@trazo/compartido';

const ETIQUETA: Record<EstadoOrdenCompra, string> = {
  BORRADOR: 'Borrador',
  ENVIADA: 'Enviada',
  RECIBIDA: 'Recibida',
  ANULADA: 'Anulada',
};

const CLASE: Record<EstadoOrdenCompra, string> = {
  BORRADOR: 'tag tag-neutral',
  ENVIADA: 'tag tag-outline',
  RECIBIDA: 'tag tag-accent',
  ANULADA: 'tag tag-neutral',
};

export function EstadoOrdenCompraTag({ estado }: { estado: EstadoOrdenCompra }) {
  return <span className={CLASE[estado]}>{ETIQUETA[estado]}</span>;
}
