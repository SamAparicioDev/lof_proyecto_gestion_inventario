/**
 * Ficha de producto (T062) — `/inventario/[id]`. Server Component: resuelve
 * `GET /api/inventario/:id` (T059/T060, `FilaInventario`) vía `apiServidor`; `notFound()` ante
 * un `404` real (mismo patrón que `app/(app)/clientes/[id]/page.tsx`, T045).
 *
 * Compone `PanelProducto` (cifras + edición + activar/desactivar, FR-010/FR-012/FR-020) y una
 * tabla de historial de movimientos (`GET /api/inventario/:id/movimientos`, FR-024/FR-045),
 * paginada server-side con filtro de fechas — mismo patrón de `<form method="GET">` nativo que
 * `app/(app)/ingresos/page.tsx`: al enviarlo, el navegador navega a
 * `/inventario/[id]?desde=...&hasta=...&pagina=...` y esta misma página vuelve a renderizar.
 *
 * `TipoMovimientoTag`/`signoMovimiento` (T062) traducen `tipo` a la etiqueta/color de Nocturne
 * y al signo con el que se antepone la cantidad (ENTRADA/AJUSTE_ENTRADA suman, SALIDA/
 * AJUSTE_SALIDA restan) — el historial ya llega enriquecido (numeroDocumento/usuarioNombre/
 * proyectoNombre) desde `HistorialProductoCasoUso`, sin resolver ids adicionales aquí.
 *
 * US12 (T128) suma una SEGUNDA sección de historial —"Historial de costos"
 * (`GET /api/inventario/:id/historial-costos`, FR-072)— junto a la de movimientos. Son dos
 * tablas distintas a propósito: un cambio de costo no mueve cantidades y nunca aparecerá en
 * los movimientos (FR-073). Su endpoint exige un permiso PROPIO (`inventario.ver_costos`,
 * A/G) distinto del `inventario.ver` con el que se abre esta ficha, así que se pide con
 * `apiServidorOpcional`: quien no lo tenga simplemente no ve la sección, en vez de recibir la
 * pantalla de error genérica de Next por un `403` (mismo patrón y mismo motivo que las
 * pantallas que precargan recursos auxiliares — ver TSDoc de `apiServidorOpcional`).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type {
  CambioCostoProducto,
  FilaInventario,
  MovimientoHistorialProducto,
  Paginado,
} from '@trazo/compartido';
import { apiServidor, apiServidorOpcional } from '@/lib/api/servidor';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoFechaHora } from '@/lib/formato';
import { TablaHistorialCostos } from '@/componentes/inventario/historial-costos';
import { PanelProducto } from '@/componentes/inventario/panel-producto';
import { signoMovimiento, TipoMovimientoTag } from '@/componentes/inventario/tipo-movimiento-tag';

const POR_PAGINA_MOVIMIENTOS = 20;
const POR_PAGINA_COSTOS = 10;

interface ParametrosBusqueda {
  desde?: string;
  hasta?: string;
  pagina?: string;
  /** Página de la tabla de costos — separada de `pagina` (movimientos): las dos secciones se
   *  paginan de forma independiente y navegar una no debe reiniciar la otra. */
  paginaCostos?: string;
}

/** Arma la query string de `/api/inventario/:id/movimientos` (o de un enlace de paginación) preservando los filtros activos. */
function construirQueryMovimientos(productoId: number, parametros: ParametrosBusqueda, paginaDestino?: number): string {
  const query = new URLSearchParams();
  if (parametros.desde) query.set('desde', parametros.desde);
  if (parametros.hasta) query.set('hasta', parametros.hasta);
  query.set('pagina', String(paginaDestino ?? parametros.pagina ?? 1));
  query.set('porPagina', String(POR_PAGINA_MOVIMIENTOS));
  return `/api/inventario/${productoId}/movimientos?${query.toString()}`;
}

/** Query de `/api/inventario/:id/historial-costos` (US12) — solo paginación: este historial no
 *  se filtra por fecha (ver TSDoc de `esquemaFiltroHistorialCostos` en `@trazo/compartido`). */
function construirQueryHistorialCostos(productoId: number, parametros: ParametrosBusqueda): string {
  const query = new URLSearchParams();
  query.set('pagina', String(parametros.paginaCostos ?? 1));
  query.set('porPagina', String(POR_PAGINA_COSTOS));
  return `/api/inventario/${productoId}/historial-costos?${query.toString()}`;
}

export default async function PaginaFichaProducto({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParametrosBusqueda>;
}) {
  const { id } = await params;
  const productoId = Number(id);
  if (!Number.isInteger(productoId) || productoId <= 0) {
    notFound();
  }

  let ficha: FilaInventario;
  try {
    ficha = await apiServidor<FilaInventario>(`/api/inventario/${productoId}`);
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const parametros = await searchParams;
  // `PanelProducto` lee sus permisos con `usePuede()` del contexto de sesión (T108), así que
  // esta página ya no pide `GET /api/auth/perfil` solo para reenviarle el rol.
  const [historial, historialCostos] = await Promise.all([
    apiServidor<Paginado<MovimientoHistorialProducto>>(construirQueryMovimientos(productoId, parametros)),
    // `null` cuando la sesión no tiene `inventario.ver_costos` (403): la sección no se pinta.
    apiServidorOpcional<Paginado<CambioCostoProducto> | null>(
      construirQueryHistorialCostos(productoId, parametros),
      null,
    ),
  ]);
  const totalPaginas = Math.max(1, Math.ceil(historial.total / historial.porPagina));
  const totalPaginasCostos = historialCostos
    ? Math.max(1, Math.ceil(historialCostos.total / historialCostos.porPagina))
    : 1;

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Almacén</h6>
        <h2 style={{ margin: 0 }}>{ficha.producto.descripcion}</h2>
      </div>

      <PanelProducto fila={ficha} />

      <div className="card gap-3 p-5">
        <h5 style={{ margin: 0 }}>Historial de movimientos</h5>

        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="field">
            <label htmlFor="desde">Desde</label>
            <input id="desde" name="desde" type="date" className="input" defaultValue={parametros.desde} />
          </div>
          <div className="field">
            <label htmlFor="hasta">Hasta</label>
            <input id="hasta" name="hasta" type="date" className="input" defaultValue={parametros.hasta} />
          </div>
          <button type="submit" className="btn btn-secondary">
            Filtrar
          </button>
        </form>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Documento</th>
                <th>Cantidad</th>
                <th>Usuario</th>
                <th>Proyecto</th>
              </tr>
            </thead>
            <tbody>
              {historial.datos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    Este producto no tiene movimientos registrados con los filtros aplicados.
                  </td>
                </tr>
              ) : (
                historial.datos.map((movimiento) => (
                  <tr key={movimiento.id}>
                    <td>{formatoFechaHora(movimiento.fechaHora)}</td>
                    <td>
                      <TipoMovimientoTag tipo={movimiento.tipo} />
                    </td>
                    <td>
                      {movimiento.documentoTipo === 'INGRESO' ? (
                        <Link href={`/ingresos/${movimiento.documentoId}`}>{movimiento.numeroDocumento}</Link>
                      ) : (
                        <Link href={`/salidas/${movimiento.documentoId}`}>N.º {movimiento.numeroDocumento}</Link>
                      )}
                    </td>
                    <td>
                      {signoMovimiento(movimiento.tipo) > 0 ? '+' : '-'}
                      {movimiento.cantidad}
                    </td>
                    <td className="text-muted">{movimiento.usuarioNombre}</td>
                    <td className="text-muted">{movimiento.proyectoNombre ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {historial.total > 0 && (
          <div className="flex items-center justify-between text-muted" style={{ fontSize: 13 }}>
            <span>
              Página {historial.pagina} de {totalPaginas} — {historial.total} movimiento{historial.total === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <EnlacePagina
                href={`/inventario/${productoId}?${paginaComoQuery(parametros, Math.max(1, historial.pagina - 1))}`}
                deshabilitado={historial.pagina <= 1}
              >
                Anterior
              </EnlacePagina>
              <EnlacePagina
                href={`/inventario/${productoId}?${paginaComoQuery(parametros, Math.min(totalPaginas, historial.pagina + 1))}`}
                deshabilitado={historial.pagina >= totalPaginas}
              >
                Siguiente
              </EnlacePagina>
            </div>
          </div>
        )}
      </div>

      {/* Historial de COSTOS (US12/FR-072) — tabla aparte de la de movimientos a propósito:
          cambiar un precio no mueve inventario (FR-073). Solo se pinta si la sesión tiene
          `inventario.ver_costos`; sin ese permiso, `historialCostos` llega `null`. */}
      {historialCostos && (
        <div className="card">
          <h5 style={{ margin: 0 }}>Historial de costos</h5>
          <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
            Cada corrección del costo unitario, con quién la hizo y de dónde vino. Cambiar el costo no altera el
            stock del producto.
          </p>

          <TablaHistorialCostos cambios={historialCostos.datos} />

          {historialCostos.total > 0 && (
            <div className="flex items-center justify-between text-muted" style={{ fontSize: 13 }}>
              <span>
                Página {historialCostos.pagina} de {totalPaginasCostos} — {historialCostos.total} cambio
                {historialCostos.total === 1 ? '' : 's'} de costo
              </span>
              <div className="flex gap-2">
                <EnlacePagina
                  href={`/inventario/${productoId}?${paginaCostosComoQuery(
                    parametros,
                    Math.max(1, historialCostos.pagina - 1),
                  )}`}
                  deshabilitado={historialCostos.pagina <= 1}
                >
                  Anterior
                </EnlacePagina>
                <EnlacePagina
                  href={`/inventario/${productoId}?${paginaCostosComoQuery(
                    parametros,
                    Math.min(totalPaginasCostos, historialCostos.pagina + 1),
                  )}`}
                  deshabilitado={historialCostos.pagina >= totalPaginasCostos}
                >
                  Siguiente
                </EnlacePagina>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Query string para los enlaces de paginación del historial de MOVIMIENTOS (preserva
 *  `desde`/`hasta` y la página en la que esté el historial de costos: las dos tablas viven en
 *  la misma URL, así que avanzar una no debe reiniciar la otra). */
function paginaComoQuery(parametros: ParametrosBusqueda, paginaDestino: number): string {
  const query = new URLSearchParams();
  if (parametros.desde) query.set('desde', parametros.desde);
  if (parametros.hasta) query.set('hasta', parametros.hasta);
  if (parametros.paginaCostos) query.set('paginaCostos', parametros.paginaCostos);
  query.set('pagina', String(paginaDestino));
  return query.toString();
}

/** Query string para los enlaces de paginación del historial de COSTOS — el simétrico del de
 *  arriba: mueve `paginaCostos` y conserva los filtros y la página de movimientos. */
function paginaCostosComoQuery(parametros: ParametrosBusqueda, paginaDestino: number): string {
  const query = new URLSearchParams();
  if (parametros.desde) query.set('desde', parametros.desde);
  if (parametros.hasta) query.set('hasta', parametros.hasta);
  if (parametros.pagina) query.set('pagina', parametros.pagina);
  query.set('paginaCostos', String(paginaDestino));
  return query.toString();
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
