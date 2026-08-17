/**
 * Listado de cotizaciones (US21, T204) — `/cotizaciones`, tabla paginada server-side con filtros
 * de cliente, estado y rango de fechas. Server Component: reenvía la cookie de sesión al backend
 * vía `apiServidor` — nunca `fetch` directo (frontend/CLAUDE.md).
 *
 * Espejo de `/ordenes-compra`, con una diferencia visible: la columna de dinero muestra el
 * TOTAL con IVA. En un listado de ofertas la cifra que se compara es lo que el cliente pagaría;
 * el desglose (base, IVA, total) está en la ficha y en el PDF que se le envía.
 *
 * "Vencida" viaja resuelta desde el backend y se pinta junto al estado, no en su lugar: una
 * cotización vencida sigue ENVIADA y el cliente todavía puede responderla (FR-112).
 */
import Link from 'next/link';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import {
  formatoNumeroCotizacion,
  type Cliente,
  type Cotizacion,
  type EstadoCotizacion,
  type Paginado,
} from '@trazo/compartido';
import { POR_PAGINA_MAXIMA } from '@trazo/compartido';
import { apiServidor, apiServidorOpcional } from '@/lib/api/servidor';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { PERMISOS, tienePermiso } from '@/lib/permisos';
import { formatoFecha, formatoFechaFiltro, formatoMoneda } from '@/lib/formato';
import { EstadoCotizacionTag } from '@/componentes/cotizaciones/estado-cotizacion-tag';
import { BarraFiltros, CampoFiltro } from '@/componentes/comunes/barra-filtros';
import { CampoFecha } from '@/componentes/comunes/campo-fecha';
import { BotonesExportar } from '@/componentes/comunes/botones-exportar';
import { ResumenFiltros } from '@/componentes/comunes/resumen-filtros';
import { claveDeFiltros, filtrosActivos, mensajeListadoVacio } from '@/lib/filtros';

const POR_PAGINA = 20;

const ESTADOS: { valor: EstadoCotizacion; etiqueta: string }[] = [
  { valor: 'BORRADOR', etiqueta: 'Borrador' },
  { valor: 'ENVIADA', etiqueta: 'Enviada' },
  { valor: 'ACEPTADA', etiqueta: 'Aceptada' },
  { valor: 'RECHAZADA', etiqueta: 'Rechazada' },
  { valor: 'ANULADA', etiqueta: 'Anulada' },
];

interface ParametrosBusqueda {
  buscar?: string;
  clienteId?: string;
  estado?: string;
  desde?: string;
  hasta?: string;
  pagina?: string;
}

function construirQuery(parametros: ParametrosBusqueda, paginaDestino?: number): string {
  const query = new URLSearchParams(construirQueryExport(parametros));
  query.set('pagina', String(paginaDestino ?? parametros.pagina ?? 1));
  query.set('porPagina', String(POR_PAGINA));
  return query.toString();
}

/** Query del export: los MISMOS filtros, SIN paginación — el archivo trae todas las filas del
 *  filtro (FR-064). */
function construirQueryExport(parametros: ParametrosBusqueda): string {
  const query = new URLSearchParams();
  if (parametros.buscar) query.set('buscar', parametros.buscar);
  if (parametros.clienteId) query.set('clienteId', parametros.clienteId);
  if (parametros.estado) query.set('estado', parametros.estado);
  if (parametros.desde) query.set('desde', parametros.desde);
  if (parametros.hasta) query.set('hasta', parametros.hasta);
  return query.toString();
}

export default async function PaginaCotizaciones({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusqueda>;
}) {
  const parametros = await searchParams;
  const perfil = await obtenerPerfilServidor();

  if (!tienePermiso(perfil?.permisos, PERMISOS.COTIZACIONES_VER)) {
    return (
      <div role="alert" className="card p-5">
        No tienes permiso para consultar las cotizaciones. Contacta a un administrador o gerente.
      </div>
    );
  }

  const pagina = await apiServidor<Paginado<Cotizacion>>(`/api/cotizaciones?${construirQuery(parametros)}`);
  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.porPagina));

  // El catálogo alimenta el filtro por cliente. `apiServidorOpcional` porque `clientes.ver` es
  // un permiso distinto: sin él la pantalla se muestra sin el desplegable, no rota.
  // `GET /api/clientes` devuelve un PAGINADO (no un arreglo) y su máximo por página es
  // `POR_PAGINA_MAXIMA` — pedir más se rechaza con 400, que es como se rompió esta pantalla
  // la primera vez. `apiServidorOpcional` porque `clientes.ver` es un permiso distinto.
  const clientesPagina = await apiServidorOpcional<Paginado<Cliente>>(
    `/api/clientes?porPagina=${POR_PAGINA_MAXIMA}`,
    { datos: [], total: 0, pagina: 1, porPagina: POR_PAGINA_MAXIMA },
  );
  const listaClientes = clientesPagina.datos;
  const clienteFiltrado = listaClientes.find((cliente) => String(cliente.id) === parametros.clienteId);

  const filtros = filtrosActivos([
    { etiqueta: 'Buscar', valor: parametros.buscar },
    { etiqueta: 'Cliente', valor: clienteFiltrado?.nombre },
    { etiqueta: 'Estado', valor: ESTADOS.find((estado) => estado.valor === parametros.estado)?.etiqueta },
    { etiqueta: 'Desde', valor: formatoFechaFiltro(parametros.desde) },
    { etiqueta: 'Hasta', valor: formatoFechaFiltro(parametros.hasta) },
  ]);

  const puedeCrear = tienePermiso(perfil?.permisos, PERMISOS.COTIZACIONES_CREAR);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Ventas</h6>
          <h2 style={{ margin: 0 }}>Cotizaciones</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BotonesExportar
            hrefBase={`/api/cotizaciones/export?${construirQueryExport(parametros)}`}
            descripcion="el listado de cotizaciones"
          />
          {puedeCrear && (
            <Link href="/cotizaciones/nueva" className="btn btn-primary">
              <Plus size={16} /> Nueva cotización
            </Link>
          )}
        </div>
      </div>

      <BarraFiltros
        method="GET"
        claveDeFiltros={claveDeFiltros(filtros)}
        pie={<ResumenFiltros filtros={filtros} hrefLimpiar="/cotizaciones" />}
      >
        <CampoFiltro ancho="largo">
          <label htmlFor="buscar">Buscar</label>
          <input
            id="buscar"
            name="buscar"
            className="input"
            placeholder="Número o cliente"
            defaultValue={parametros.buscar}
          />
        </CampoFiltro>
        <CampoFiltro>
          <label htmlFor="clienteId">Cliente</label>
          <select id="clienteId" name="clienteId" className="input" defaultValue={parametros.clienteId ?? ''}>
            <option value="">Todos</option>
            {listaClientes.map((cliente) => (
              <option key={cliente.id} value={cliente.id}>
                {cliente.nombre}
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
          <CampoFecha id="desde" name="desde" defaultValue={parametros.desde} />
        </CampoFiltro>
        <CampoFiltro ancho="corto">
          <label htmlFor="hasta">Hasta</label>
          <CampoFecha id="hasta" name="hasta" defaultValue={parametros.hasta} />
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
                <th>Cotización</th>
                <th>Cliente</th>
                <th>Proyecto</th>
                <th>Fecha</th>
                <th>Válida hasta</th>
                <th>Estado</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {pagina.datos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    {mensajeListadoVacio('cotizaciones', filtros.length > 0)}
                  </td>
                </tr>
              ) : (
                pagina.datos.map((cotizacion) => (
                  <tr key={cotizacion.id}>
                    <td>
                      <Link href={`/cotizaciones/${cotizacion.id}`}>
                        {formatoNumeroCotizacion(cotizacion.numero)}
                      </Link>
                    </td>
                    <td>{cotizacion.cliente.nombre}</td>
                    <td className="text-muted">{cotizacion.proyecto.nombre}</td>
                    <td>{formatoFecha(cotizacion.fecha)}</td>
                    <td className="text-muted">{formatoFecha(cotizacion.fechaValidez)}</td>
                    <td>
                      <EstadoCotizacionTag estado={cotizacion.estado} vencida={cotizacion.vencida} />
                    </td>
                    <td>{formatoMoneda(cotizacion.valorTotal + cotizacion.valorIva)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-muted" style={{ fontSize: 13 }}>
          Página {pagina.pagina} de {totalPaginas} — {pagina.total} cotizaciones
        </span>
        <div className="flex gap-2">
          <Link
            href={`/cotizaciones?${construirQuery(parametros, Math.max(1, pagina.pagina - 1))}`}
            className="btn btn-secondary"
            aria-disabled={pagina.pagina <= 1}
            style={pagina.pagina <= 1 ? { pointerEvents: 'none', opacity: 0.5 } : undefined}
          >
            Anterior
          </Link>
          <Link
            href={`/cotizaciones?${construirQuery(parametros, Math.min(totalPaginas, pagina.pagina + 1))}`}
            className="btn btn-secondary"
            aria-disabled={pagina.pagina >= totalPaginas}
            style={pagina.pagina >= totalPaginas ? { pointerEvents: 'none', opacity: 0.5 } : undefined}
          >
            Siguiente
          </Link>
        </div>
      </div>
    </div>
  );
}
