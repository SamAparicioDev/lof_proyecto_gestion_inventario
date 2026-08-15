/**
 * Listado de ingresos (T034) — `/ingresos`, tabla paginada server-side con búsqueda
 * (factura/proveedor) y filtros de estado/fechas (FR-018). Server Component: reenvía la
 * cookie de sesión al backend vía `apiServidor` (frontend/src/lib/api/servidor.ts, mismo
 * patrón que `auth-servidor.ts` de T025) — nunca `fetch` directo (frontend/CLAUDE.md).
 *
 * El formulario de filtros es un `<form method="GET">` nativo (sin JavaScript): al enviarlo,
 * el navegador navega a `/ingresos?buscar=...&estado=...` y esta misma página vuelve a
 * renderizar con los nuevos `searchParams` — más simple que un Client Component con estado
 * propio para lo que es un filtro de listado (Principio V).
 *
 * FILTRO DE US13 (T137, FR-075): "Proveedor". No duplica a "Buscar", que cruza número de factura
 * OR nombre del proveedor y por eso no permite preguntar solo por uno: teclear "3M" ahí trae
 * también las facturas cuyo NÚMERO contiene "3M". Los dos se combinan. US15 (FR-091) lo convirtió
 * de campo de texto en un desplegable del CATÁLOGO, que además hace el resultado reproducible: se
 * envía `proveedorId`, no un nombre parecido. Bajo la barra,
 * `ResumenFiltros` muestra lo aplicado y ofrece "Limpiar filtros" (FR-078), y el estado vacío
 * distingue "no hay coincidencias" de "todavía no hay ingresos" (FR-079). Como el enlace de
 * exportar (US11) se arma con los MISMOS parámetros, el archivo hereda el filtro nuevo solo.
 *
 * Encabezado "kicker + h2" y estados vía `EstadoIngresoTag` — sistema de diseño Nocturne
 * (docs/diseno-nocturne.md). La columna "Registró" muestra el id del usuario que registró la
 * factura: `GET /api/ingresos` (contracts/api-rest.md) solo expone `usuarioRegistraId`, no su
 * nombre, y este módulo no está autorizado a tocar el backend de ingresos ya cerrado y
 * probado (T031-T033/T037/T038) — el único endpoint agregado en esta tanda es
 * `GET /api/productos`. Si se necesita el nombre en pantalla, es una tanda futura que
 * enriquezca `RepositorioIngresos` (fuera del alcance de T034).
 */
import Link from 'next/link';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import type { EstadoIngreso, Ingreso, Paginado } from '@trazo/compartido';
import { apiServidor, apiServidorOpcional } from '@/lib/api/servidor';
import type { ProveedorListado } from '@/lib/api/proveedores';
import { formatoFecha, formatoFechaFiltro, formatoMoneda } from '@/lib/formato';
import { EstadoIngresoTag } from '@/componentes/ingresos/estado-ingreso-tag';
import { BarraFiltros, CampoFiltro } from '@/componentes/comunes/barra-filtros';
import { CampoFecha } from '@/componentes/comunes/campo-fecha';
import { BotonesExportar } from '@/componentes/comunes/botones-exportar';
import { ResumenFiltros } from '@/componentes/comunes/resumen-filtros';
import { claveDeFiltros, filtrosActivos, mensajeListadoVacio } from '@/lib/filtros';

const POR_PAGINA = 20;

const ESTADOS: { valor: EstadoIngreso; etiqueta: string }[] = [
  { valor: 'PENDIENTE', etiqueta: 'Pendiente' },
  { valor: 'RECIBIDO', etiqueta: 'Recibido' },
  { valor: 'VERIFICADO', etiqueta: 'Verificado' },
  { valor: 'ANULADO', etiqueta: 'Anulado' },
];

interface ParametrosBusqueda {
  buscar?: string;
  proveedorId?: string;
  estado?: string;
  desde?: string;
  hasta?: string;
  pagina?: string;
}

/** Arma la query string de `/api/ingresos` (o de un enlace de paginación) preservando los filtros activos. */
function construirQuery(parametros: ParametrosBusqueda, paginaDestino?: number): string {
  const query = new URLSearchParams();
  if (parametros.buscar) query.set('buscar', parametros.buscar);
  if (parametros.proveedorId) query.set('proveedorId', parametros.proveedorId);
  if (parametros.estado) query.set('estado', parametros.estado);
  if (parametros.desde) query.set('desde', parametros.desde);
  if (parametros.hasta) query.set('hasta', parametros.hasta);
  query.set('pagina', String(paginaDestino ?? parametros.pagina ?? 1));
  query.set('porPagina', String(POR_PAGINA));
  return query.toString();
}

/** Query del export (US11/T122): los MISMOS filtros que la pantalla, SIN paginación — el archivo
 *  trae todas las filas del filtro (FR-064), así que enviar `pagina`/`porPagina` solo sugeriría
 *  lo contrario a quien lea la URL. */
function construirQueryExport(parametros: ParametrosBusqueda): string {
  const query = new URLSearchParams();
  if (parametros.buscar) query.set('buscar', parametros.buscar);
  if (parametros.proveedorId) query.set('proveedorId', parametros.proveedorId);
  if (parametros.estado) query.set('estado', parametros.estado);
  if (parametros.desde) query.set('desde', parametros.desde);
  if (parametros.hasta) query.set('hasta', parametros.hasta);
  return query.toString();
}

export default async function PaginaIngresos({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusqueda>;
}) {
  const parametros = await searchParams;
  const pagina = await apiServidor<Paginado<Ingreso>>(`/api/ingresos?${construirQuery(parametros)}`);
  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.porPagina));

  // US15 (FR-091): el filtro por proveedor se alimenta del CATÁLOGO. Se piden todos —también los
  // inactivos— porque filtrar por un proveedor ya retirado sigue siendo una consulta legítima
  // sobre el historial. Va con `apiServidorOpcional` porque `proveedores.ver` es un permiso
  // distinto de `ingresos.ver`: un rol propio que pueda consultar ingresos pero no el catálogo
  // debe ver el listado sin el desplegable, no la pantalla de error genérica de Next.
  const proveedores = await apiServidorOpcional<ProveedorListado[]>('/api/proveedores', []);
  const proveedorFiltrado = proveedores.find((proveedor) => String(proveedor.id) === parametros.proveedorId);

  // Mismo orden que los campos de la barra, para que el resumen se lea igual que se llenó (FR-078).
  const filtros = filtrosActivos([
    { etiqueta: 'Buscar', valor: parametros.buscar },
    { etiqueta: 'Proveedor', valor: proveedorFiltrado?.nombre },
    { etiqueta: 'Estado', valor: ESTADOS.find((estado) => estado.valor === parametros.estado)?.etiqueta },
    { etiqueta: 'Desde', valor: formatoFechaFiltro(parametros.desde) },
    { etiqueta: 'Hasta', valor: formatoFechaFiltro(parametros.hasta) },
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Compras</h6>
          <h2 style={{ margin: 0 }}>Ingresos de mercancía</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BotonesExportar
            hrefBase={`/api/ingresos/export?${construirQueryExport(parametros)}`}
            descripcion="el listado de ingresos"
          />
          <Link href="/ingresos/nuevo" className="btn btn-primary">
            <Plus size={16} /> Nuevo ingreso
          </Link>
        </div>
      </div>

      <BarraFiltros
        method="GET"
        claveDeFiltros={claveDeFiltros(filtros)}
        pie={<ResumenFiltros filtros={filtros} hrefLimpiar="/ingresos" />}
      >
        <CampoFiltro ancho="largo">
          <label htmlFor="buscar">Buscar</label>
          <input
            id="buscar"
            name="buscar"
            className="input"
            placeholder="Factura o proveedor"
            defaultValue={parametros.buscar}
          />
        </CampoFiltro>
        <CampoFiltro>
          <label htmlFor="proveedorId">Proveedor</label>
          <select id="proveedorId" name="proveedorId" className="input" defaultValue={parametros.proveedorId ?? ''}>
            <option value="">Todos</option>
            {proveedores.map((proveedor) => (
              <option key={proveedor.id} value={proveedor.id}>
                {proveedor.nombre}
                {proveedor.estado === 'INACTIVO' ? ' (inactivo)' : ''}
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
                <th>Factura</th>
                <th>Proveedor</th>
                <th>Fecha factura</th>
                <th>Recepción</th>
                <th>Estado</th>
                <th>Valor total</th>
                <th>Registró</th>
              </tr>
            </thead>
            <tbody>
              {pagina.datos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    {mensajeListadoVacio('ingresos', filtros.length > 0)}
                  </td>
                </tr>
              ) : (
                pagina.datos.map((ingreso) => (
                  <tr key={ingreso.id}>
                    <td>
                      <Link href={`/ingresos/${ingreso.id}`}>{ingreso.numeroFactura}</Link>
                    </td>
                    <td>{ingreso.proveedor.nombre}</td>
                    <td>{formatoFecha(ingreso.fechaFactura)}</td>
                    <td>{formatoFecha(ingreso.fechaRecepcion)}</td>
                    <td>
                      <EstadoIngresoTag estado={ingreso.estado} />
                    </td>
                    <td>{formatoMoneda(ingreso.valorTotal)}</td>
                    <td className="text-muted">Usuario N.º {ingreso.usuarioRegistraId}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagina.total > 0 && (
        <div className="flex items-center justify-between text-muted" style={{ fontSize: 13 }}>
          <span>
            Página {pagina.pagina} de {totalPaginas} — {pagina.total} ingreso{pagina.total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <EnlacePagina
              href={`/ingresos?${construirQuery(parametros, Math.max(1, pagina.pagina - 1))}`}
              deshabilitado={pagina.pagina <= 1}
            >
              Anterior
            </EnlacePagina>
            <EnlacePagina
              href={`/ingresos?${construirQuery(parametros, Math.min(totalPaginas, pagina.pagina + 1))}`}
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
