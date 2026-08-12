/**
 * Historial de salidas de un cliente (T045/FR-037: "¿qué le ha salido a este cliente?").
 *
 * Conectado a datos reales (hallazgo de revisión adversarial de la tanda US3, 2026-08-10):
 * hasta la tanda US3 esto era un placeholder intencional porque `GET /api/salidas` todavía
 * no existía (ver historial de este archivo) — ahora pide las salidas del cliente vía
 * `apiServidor` (Server Component, mismo patrón que `app/(app)/salidas/page.tsx`, T053) y
 * las lista con su proyecto (resuelto desde `proyectos`, que la página de detalle del
 * cliente ya trae cargados — evita una petición extra) y su `EstadoSalidaTag`.
 *
 * Muestra las 10 más recientes; el listado completo con filtros vive en `/salidas`.
 */
import Link from 'next/link';
import type { Paginado, Proyecto, Salida } from '@trazo/compartido';
import { apiServidor } from '@/lib/api/servidor';
import { formatoFecha, formatoMoneda } from '@/lib/formato';
import { EstadoSalidaTag } from '@/componentes/salidas/estado-salida-tag';

const MAS_RECIENTES = 10;

export async function HistorialSalidas({ clienteId, proyectos }: { clienteId: number; proyectos: Proyecto[] }) {
  const pagina = await apiServidor<Paginado<Salida>>(
    `/api/salidas?clienteId=${clienteId}&pagina=1&porPagina=${MAS_RECIENTES}`,
  );
  const proyectosPorId = new Map(proyectos.map((proyecto) => [proyecto.id, proyecto]));

  return (
    <div className="card gap-2 p-5">
      <h5 style={{ margin: 0 }}>Historial de salidas</h5>
      {pagina.datos.length === 0 ? (
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
          Sin salidas registradas todavía para este cliente.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>N.º salida</th>
                <th>Fecha</th>
                <th>Proyecto</th>
                <th>Estado</th>
                <th>Valor total</th>
              </tr>
            </thead>
            <tbody>
              {pagina.datos.map((salida) => (
                <tr key={salida.id}>
                  <td>
                    <Link href={`/salidas/${salida.id}`}>N.º {salida.numero}</Link>
                  </td>
                  <td>{formatoFecha(salida.fechaSalida)}</td>
                  <td>{proyectosPorId.get(salida.proyectoId)?.nombre ?? `Proyecto N.º ${salida.proyectoId}`}</td>
                  <td>
                    <EstadoSalidaTag estado={salida.estado} />
                  </td>
                  <td>{formatoMoneda(salida.valorTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagina.total > MAS_RECIENTES && (
        <Link href={`/salidas?clienteId=${clienteId}`} className="btn btn-ghost" style={{ fontSize: 12, alignSelf: 'flex-start' }}>
          Ver las {pagina.total} salidas de este cliente
        </Link>
      )}
    </div>
  );
}
