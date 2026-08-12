/**
 * Listado de salidas (T053) — `/salidas`, tabla paginada server-side con filtros de
 * cliente/proyecto/estado/fechas (FR-033). Server Component: reenvía la cookie de sesión al
 * backend vía `apiServidor` (mismo patrón que `app/(app)/ingresos/page.tsx`, T034) — nunca
 * `fetch` directo.
 *
 * El formulario de filtros es un `<form method="GET">` nativo (sin JavaScript, mismo criterio
 * que ingresos/clientes): al enviarlo, el navegador navega a
 * `/salidas?clienteId=...&proyectoId=...` y esta misma página vuelve a renderizar con los
 * nuevos `searchParams`. `clienteId` y `proyectoId` son selects independientes (SIN cascada
 * JS entre ellos, a diferencia del formulario de alta — T054): ambos son opcionales y se
 * combinan con AND si se usan los dos a la vez (`construirWhereListarSalidas` del backend);
 * el `proyectoId` ya lleva el nombre del cliente en su etiqueta ("Cliente — Proyecto") para
 * que siga siendo útil sin necesidad de elegir primero un cliente.
 *
 * `GET /api/salidas` (contracts/api-rest.md) solo trae `proyectoId` por salida, no nombres
 * (data-model.md: el cliente se deriva del proyecto, no se duplica) — por eso se resuelve
 * `Cliente`/`Proyecto` con `cargarClientesYProyectos` (ver su TSDoc para el porqué del N+1
 * acotado por número de clientes, no de salidas).
 *
 * Encabezado "kicker + h2" (kicker "Despachos", h2 "Salidas por proyecto" — Trazo
 * Inventarios.dc.html) y estados vía `EstadoSalidaTag` — sistema de diseño Nocturne
 * (docs/diseno-nocturne.md).
 *
 * FILTROS DE US13 (T137, FR-075): "N.º de salida" —el correlativo impreso en el soporte de
 * entrega, que hasta ahora solo se alcanzaba paginando— y "Autoriza".
 *
 * Por qué "Autoriza" es un campo NUMÉRICO y no un selector de usuarios, a diferencia de los
 * selectores de categoría/ciudad de las otras pantallas (FR-076): el catálogo de usuarios lo
 * publica `GET /api/usuarios`, que exige `usuarios.gestionar` — un permiso que casi nadie de
 * quienes ven esta pantalla tiene (es exclusivo del Administrador). Un selector que solo
 * funcionara para un rol sería un filtro roto para los demás. El lazo se cierra igual porque la
 * columna "Autoriza" de esta MISMA tabla muestra `Usuario N.º 7`: el número que hay que teclear
 * está a la vista. Es además el criterio ya establecido por el filtro "Usuario (ID)" del reporte
 * de movimientos (`componentes/reportes/reporte-movimientos.tsx`, FR-042).
 */
import Link from 'next/link';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import type { EstadoSalida, Paginado, Salida } from '@trazo/compartido';
import { apiServidor } from '@/lib/api/servidor';
import { cargarClientesYProyectos } from '@/lib/clientes-proyectos-servidor';
import { formatoFecha, formatoMoneda } from '@/lib/formato';
import { EstadoSalidaTag } from '@/componentes/salidas/estado-salida-tag';
import { BarraFiltros, CampoFiltro } from '@/componentes/comunes/barra-filtros';
import { BotonesExportar } from '@/componentes/comunes/botones-exportar';
import { ResumenFiltros } from '@/componentes/comunes/resumen-filtros';
import { claveDeFiltros, filtrosActivos, mensajeListadoVacio } from '@/lib/filtros';

const POR_PAGINA = 20;

const ESTADOS: { valor: EstadoSalida; etiqueta: string }[] = [
  { valor: 'PENDIENTE', etiqueta: 'Pendiente' },
  { valor: 'CONFIRMADA', etiqueta: 'Confirmada' },
  { valor: 'COMPLETADA', etiqueta: 'Completada' },
  { valor: 'ANULADA', etiqueta: 'Anulada' },
];

interface ParametrosBusqueda {
  clienteId?: string;
  proyectoId?: string;
  numero?: string;
  usuarioAutorizaId?: string;
  estado?: string;
  desde?: string;
  hasta?: string;
  pagina?: string;
}

/** Arma la query string de `/api/salidas` (o de un enlace de paginación) preservando los filtros activos. */
function construirQuery(parametros: ParametrosBusqueda, paginaDestino?: number): string {
  const query = new URLSearchParams();
  if (parametros.clienteId) query.set('clienteId', parametros.clienteId);
  if (parametros.proyectoId) query.set('proyectoId', parametros.proyectoId);
  if (parametros.numero) query.set('numero', parametros.numero);
  if (parametros.usuarioAutorizaId) query.set('usuarioAutorizaId', parametros.usuarioAutorizaId);
  if (parametros.estado) query.set('estado', parametros.estado);
  if (parametros.desde) query.set('desde', parametros.desde);
  if (parametros.hasta) query.set('hasta', parametros.hasta);
  query.set('pagina', String(paginaDestino ?? parametros.pagina ?? 1));
  query.set('porPagina', String(POR_PAGINA));
  return query.toString();
}

/** Query del export (US11/T122): los MISMOS filtros que la pantalla, SIN paginación — el archivo
 *  trae todas las filas del filtro (FR-064). Filtrar por `clienteId` es además lo que hace que
 *  el archivo lleve el logo de ese cliente (FR-067): sin ese filtro abarca varios y va sin logo. */
function construirQueryExport(parametros: ParametrosBusqueda): string {
  const query = new URLSearchParams();
  if (parametros.clienteId) query.set('clienteId', parametros.clienteId);
  if (parametros.proyectoId) query.set('proyectoId', parametros.proyectoId);
  if (parametros.numero) query.set('numero', parametros.numero);
  if (parametros.usuarioAutorizaId) query.set('usuarioAutorizaId', parametros.usuarioAutorizaId);
  if (parametros.estado) query.set('estado', parametros.estado);
  if (parametros.desde) query.set('desde', parametros.desde);
  if (parametros.hasta) query.set('hasta', parametros.hasta);
  return query.toString();
}

export default async function PaginaSalidas({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusqueda>;
}) {
  const parametros = await searchParams;
  const [pagina, { clientes, proyectos }] = await Promise.all([
    apiServidor<Paginado<Salida>>(`/api/salidas?${construirQuery(parametros)}`),
    cargarClientesYProyectos(),
  ]);
  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.porPagina));
  const proyectosPorId = new Map(proyectos.map((proyecto) => [proyecto.id, proyecto]));

  // Mismo orden que los campos de la barra (FR-078). Cliente y proyecto se muestran por NOMBRE:
  // un chip que dijera "Cliente: 4" no le explica nada a nadie. `usuarioAutorizaId` sí viaja como
  // id porque la columna "Autoriza" de esta misma tabla también muestra `Usuario N.º 7` — el
  // resumen enseña exactamente lo que enseña la tabla, ni más ni menos.
  const filtros = filtrosActivos([
    { etiqueta: 'Cliente', valor: clientes.find((cliente) => String(cliente.id) === parametros.clienteId)?.nombre },
    { etiqueta: 'Proyecto', valor: proyectos.find((proyecto) => String(proyecto.id) === parametros.proyectoId)?.nombre },
    { etiqueta: 'Estado', valor: ESTADOS.find((estado) => estado.valor === parametros.estado)?.etiqueta },
    { etiqueta: 'Desde', valor: parametros.desde },
    { etiqueta: 'Hasta', valor: parametros.hasta },
    { etiqueta: 'N.º de salida', valor: parametros.numero },
    { etiqueta: 'Autoriza', valor: parametros.usuarioAutorizaId ? `Usuario N.º ${parametros.usuarioAutorizaId}` : undefined },
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Despachos</h6>
          <h2 style={{ margin: 0 }}>Salidas por proyecto</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BotonesExportar
            hrefBase={`/api/salidas/export?${construirQueryExport(parametros)}`}
            descripcion="el listado de salidas"
          />
          <Link href="/salidas/nueva" className="btn btn-primary">
            <Plus size={16} /> Nueva salida
          </Link>
        </div>
      </div>

      <BarraFiltros
        method="GET"
        claveDeFiltros={claveDeFiltros(filtros)}
        pie={<ResumenFiltros filtros={filtros} hrefLimpiar="/salidas" />}
      >
        <CampoFiltro ancho="largo">
          <label htmlFor="clienteId">Cliente</label>
          <select id="clienteId" name="clienteId" className="input" defaultValue={parametros.clienteId ?? ''}>
            <option value="">Todos</option>
            {clientes.map((cliente) => (
              <option key={cliente.id} value={cliente.id}>
                {cliente.nombre}
              </option>
            ))}
          </select>
        </CampoFiltro>
        <CampoFiltro ancho="largo">
          <label htmlFor="proyectoId">Proyecto</label>
          <select id="proyectoId" name="proyectoId" className="input" defaultValue={parametros.proyectoId ?? ''}>
            <option value="">Todos</option>
            {proyectos.map((proyecto) => (
              <option key={proyecto.id} value={proyecto.id}>
                {proyecto.clienteNombre} — {proyecto.nombre}
              </option>
            ))}
          </select>
        </CampoFiltro>
        <CampoFiltro>
          <label htmlFor="estado">Estado</label>
          <select id="estado" name="estado" className="input" defaultValue={parametros.estado ?? ''}>
            <option value="">Todos</option>
            {ESTADOS.map((estado) => (
              <option key={estado.valor} value={estado.valor}>
                {estado.etiqueta}
              </option>
            ))}
          </select>
        </CampoFiltro>
        <CampoFiltro ancho="corto">
          <label htmlFor="desde">Desde</label>
          <input id="desde" name="desde" type="date" className="input" defaultValue={parametros.desde} />
        </CampoFiltro>
        <CampoFiltro ancho="corto">
          <label htmlFor="hasta">Hasta</label>
          <input id="hasta" name="hasta" type="date" className="input" defaultValue={parametros.hasta} />
        </CampoFiltro>
        <CampoFiltro ancho="corto">
          <label htmlFor="numero">N.º de salida</label>
          <input
            id="numero"
            name="numero"
            type="number"
            min="1"
            step="1"
            className="input"
            defaultValue={parametros.numero}
          />
        </CampoFiltro>
        <CampoFiltro ancho="corto">
          <label htmlFor="usuarioAutorizaId">Autoriza (N.º de usuario)</label>
          <input
            id="usuarioAutorizaId"
            name="usuarioAutorizaId"
            type="number"
            min="1"
            step="1"
            className="input"
            defaultValue={parametros.usuarioAutorizaId}
          />
        </CampoFiltro>
        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
      </BarraFiltros>

      <div className="card p-0" style={{ overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>N.º salida</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Proyecto</th>
                <th>Estado</th>
                <th>Valor total</th>
                <th>Autoriza</th>
              </tr>
            </thead>
            <tbody>
              {pagina.datos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    {mensajeListadoVacio('salidas', filtros.length > 0)}
                  </td>
                </tr>
              ) : (
                pagina.datos.map((salida) => {
                  const proyecto = proyectosPorId.get(salida.proyectoId);
                  return (
                    <tr key={salida.id}>
                      <td>
                        <Link href={`/salidas/${salida.id}`}>N.º {salida.numero}</Link>
                      </td>
                      <td>{formatoFecha(salida.fechaSalida)}</td>
                      <td>{proyecto?.clienteNombre ?? '—'}</td>
                      <td>{proyecto?.nombre ?? `Proyecto N.º ${salida.proyectoId}`}</td>
                      <td>
                        <EstadoSalidaTag estado={salida.estado} />
                      </td>
                      <td>{formatoMoneda(salida.valorTotal)}</td>
                      <td className="text-muted">
                        {salida.usuarioAutorizaId ? `Usuario N.º ${salida.usuarioAutorizaId}` : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagina.total > 0 && (
        <div className="flex items-center justify-between text-muted" style={{ fontSize: 13 }}>
          <span>
            Página {pagina.pagina} de {totalPaginas} — {pagina.total} salida{pagina.total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <EnlacePagina
              href={`/salidas?${construirQuery(parametros, Math.max(1, pagina.pagina - 1))}`}
              deshabilitado={pagina.pagina <= 1}
            >
              Anterior
            </EnlacePagina>
            <EnlacePagina
              href={`/salidas?${construirQuery(parametros, Math.min(totalPaginas, pagina.pagina + 1))}`}
              deshabilitado={pagina.pagina >= totalPaginas}
            >
              Siguiente
            </EnlacePagina>
          </div>
        </div>
      )}
    </div>
  );
}

function EnlacePagina({ href, deshabilitado, children }: { href: string; deshabilitado: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="btn btn-secondary"
      aria-disabled={deshabilitado}
      style={deshabilitado ? { pointerEvents: 'none', opacity: 0.45 } : undefined}
    >
      {children}
    </Link>
  );
}
