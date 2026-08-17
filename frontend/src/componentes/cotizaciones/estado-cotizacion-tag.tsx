/**
 * Tag de estado de una cotización — mapea `EstadoCotizacion` a las clases `.tag` de Nocturne
 * (docs/diseno-nocturne.md), con el MISMO criterio que `EstadoOrdenCompraTag`: acento para lo
 * que ya surtió efecto, contorno para lo que está en curso y neutral para lo que no lo tendrá.
 *
 * `vencida` se pinta como una etiqueta APARTE, no como un estado: una cotización vencida sigue
 * ENVIADA (el cliente todavía puede responderla), así que sustituir su estado por "Vencida"
 * escondería información en vez de añadirla (FR-112).
 *
 * Las etiquetas coinciden literalmente con `ETIQUETA_ESTADO` de
 * `mapeadores-documento-cotizacion.ts` (backend): el documento exportado y la pantalla dicen lo
 * mismo, aunque el backend no pueda importar este archivo (docs/arquitectura.md §2).
 */
import type { EstadoCotizacion } from '@trazo/compartido';

const ETIQUETA: Record<EstadoCotizacion, string> = {
  BORRADOR: 'Borrador',
  ENVIADA: 'Enviada',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
  ANULADA: 'Anulada',
};

const CLASE: Record<EstadoCotizacion, string> = {
  BORRADOR: 'tag tag-neutral',
  ENVIADA: 'tag tag-outline',
  ACEPTADA: 'tag tag-accent',
  RECHAZADA: 'tag tag-neutral',
  ANULADA: 'tag tag-neutral',
};

export function EstadoCotizacionTag({ estado, vencida }: { estado: EstadoCotizacion; vencida?: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={CLASE[estado]}>{ETIQUETA[estado]}</span>
      {vencida && (
        <span className="tag tag-outline" title="La fecha de validez de esta cotización ya pasó">
          Vencida
        </span>
      )}
    </span>
  );
}
