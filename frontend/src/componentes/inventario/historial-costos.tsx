/**
 * Sección "Historial de costos" de la ficha de producto (US12/T128) —
 * `GET /api/inventario/:productoId/historial-costos` (FR-072).
 *
 * Va JUNTO al historial de movimientos, pero es una tabla aparte y eso es deliberado: son dos
 * historiales que responden dos preguntas distintas —*cuánto hay y por qué* vs. *cuánto vale y
 * desde cuándo*— y un cambio de costo NO es un movimiento de inventario (FR-073). Mezclarlos
 * en una sola tabla sugeriría lo contrario justo donde el usuario decide si confía en sus
 * cifras.
 *
 * Server Component puro (recibe los datos ya resueltos por la página, igual que la tabla de
 * movimientos): no necesita estado ni interactividad — la paginación es por enlace, como en el
 * resto de listados del proyecto.
 *
 * `origen` se traduce a un `.tag` de Nocturne con el mismo criterio que `TipoMovimientoTag`:
 * la recepción de mercancía en acento (viene de un documento real, y su número enlaza al
 * ingreso), y los dos cambios "administrativos" en neutral.
 */
import Link from 'next/link';
import type { CambioCostoProducto, OrigenCambioCosto } from '@trazo/compartido';
import { formatoFechaHora, formatoMoneda } from '@/lib/formato';

/** Texto en español de cada origen (FR-047: todo lo que ve el usuario, en español). */
const ETIQUETA_ORIGEN: Record<OrigenCambioCosto, string> = {
  IMPORTACION: 'Carga masiva',
  EDICION_MANUAL: 'Edición manual',
  RECEPCION_INGRESO: 'Recepción de mercancía',
};

const CLASE_ORIGEN: Record<OrigenCambioCosto, string> = {
  IMPORTACION: 'tag tag-neutral',
  EDICION_MANUAL: 'tag tag-neutral',
  RECEPCION_INGRESO: 'tag tag-accent',
};

export function OrigenCostoTag({ origen }: { origen: OrigenCambioCosto }) {
  return <span className={CLASE_ORIGEN[origen]}>{ETIQUETA_ORIGEN[origen]}</span>;
}

export function TablaHistorialCostos({ cambios }: { cambios: CambioCostoProducto[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Costo anterior</th>
            <th>Costo nuevo</th>
            <th>Origen</th>
            <th>Documento</th>
            <th>Usuario</th>
          </tr>
        </thead>
        <tbody>
          {cambios.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                El costo de este producto no ha cambiado desde que se registró.
              </td>
            </tr>
          ) : (
            cambios.map((cambio) => (
              <tr key={cambio.id}>
                <td>{formatoFechaHora(cambio.fechaHora)}</td>
                <td className="text-muted">{formatoMoneda(cambio.costoAnterior)}</td>
                <td>{formatoMoneda(cambio.costoNuevo)}</td>
                <td>
                  <OrigenCostoTag origen={cambio.origen} />
                </td>
                <td>
                  {/* Solo la recepción de mercancía tiene documento: los otros dos orígenes
                      cambian el precio sin que haya entrado nada al almacén (FR-072/FR-073). */}
                  {cambio.documentoId === null ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <Link href={`/ingresos/${cambio.documentoId}`}>Ingreso</Link>
                  )}
                </td>
                <td className="text-muted">{cambio.usuarioNombre}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
