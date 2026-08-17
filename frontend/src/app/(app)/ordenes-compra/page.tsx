/**
 * Listado de órdenes de compra (US16, T173) — `/ordenes-compra`, tabla paginada server-side con
 * filtros de proveedor, estado y rango de fechas. Server Component: reenvía la cookie de sesión
 * al backend vía `apiServidor` — nunca `fetch` directo (frontend/CLAUDE.md).
 *
 * El formulario de filtros es un `<form method="GET">` nativo, igual que el de ingresos: al
 * enviarlo el navegador navega a `/ordenes-compra?...` y esta misma página vuelve a renderizar
 * con los nuevos `searchParams`.
 *
 * La columna "Pendiente de llegar" no existe como dato: ES el estado ENVIADA. Se decidió no
 * agregar una columna calculada porque duplicaría lo que el tag ya dice, y una segunda forma de
 * leer el mismo hecho es una oportunidad de que las dos discrepen.
 */
import Link from 'next/link';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { formatoNumeroOrdenCompra, type EstadoOrdenCompra, type OrdenCompra, type Paginado } from '@trazo/compartido';
import { apiServidor, apiServidorOpcional } from '@/lib/api/servidor';
import type { ProveedorListado } from '@/lib/api/proveedores';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { PERMISOS, tienePermiso } from '@/lib/permisos';
import { formatoFecha, formatoFechaFiltro, formatoMoneda } from '@/lib/formato';
import { EstadoOrdenCompraTag } from '@/componentes/ordenes-compra/estado-orden-compra-tag';
import { BarraFiltros, CampoFiltro } from '@/componentes/comunes/barra-filtros';
import { CampoFecha } from '@/componentes/comunes/campo-fecha';
import { BotonesExportar } from '@/componentes/comunes/botones-exportar';
import { ResumenFiltros } from '@/componentes/comunes/resumen-filtros';
import { claveDeFiltros, filtrosActivos, mensajeListadoVacio } from '@/lib/filtros';

const POR_PAGINA = 20;

const ESTADOS: { valor: EstadoOrdenCompra; etiqueta: string }[] = [
  { valor: 'BORRADOR', etiqueta: 'Borrador' },
  { valor: 'ENVIADA', etiqueta: 'Enviada' },
  { valor: 'RECIBIDA', etiqueta: 'Recibida' },
  { valor: 'ANULADA', etiqueta: 'Anulada' },
];

interface ParametrosBusqueda {
  buscar?: string;
  proveedorId?: string;
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
 *  filtro (FR-064), así que enviar `pagina` solo sugeriría lo contrario a quien lea la URL. */
function construirQueryExport(parametros: ParametrosBusqueda): string {
  const query = new URLSearchParams();
  if (parametros.buscar) query.set('buscar', parametros.buscar);
  if (parametros.proveedorId) query.set('proveedorId', parametros.proveedorId);
  if (parametros.estado) query.set('estado', parametros.estado);
  if (parametros.desde) query.set('desde', parametros.desde);
  if (parametros.hasta) query.set('hasta', parametros.hasta);
  return query.toString();
}

export default async function PaginaOrdenesCompra({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusqueda>;
}) {
  const parametros = await searchParams;
  const perfil = await obtenerPerfilServidor();

  if (!tienePermiso(perfil?.permisos, PERMISOS.ORDENES_COMPRA_VER)) {
    return (
      <div role="alert" className="card p-5">
        No tienes permiso para consultar las órdenes de compra. Contacta a un administrador o gerente.
      </div>
    );
  }

  const pagina = await apiServidor<Paginado<OrdenCompra>>(`/api/ordenes-compra?${construirQuery(parametros)}`);
  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.porPagina));

  // El catálogo alimenta el filtro por proveedor. `apiServidorOpcional` porque `proveedores.ver`
  // es un permiso distinto: sin él la pantalla se muestra sin el desplegable, no rota.
  const proveedores = await apiServidorOpcional<ProveedorListado[]>('/api/proveedores', []);
  const proveedorFiltrado = proveedores.find((proveedor) => String(proveedor.id) === parametros.proveedorId);

  const filtros = filtrosActivos([
    { etiqueta: 'Buscar', valor: parametros.buscar },
    { etiqueta: 'Proveedor', valor: proveedorFiltrado?.nombre },
    { etiqueta: 'Estado', valor: ESTADOS.find((estado) => estado.valor === parametros.estado)?.etiqueta },
    { etiqueta: 'Desde', valor: formatoFechaFiltro(parametros.desde) },
    { etiqueta: 'Hasta', valor: formatoFechaFiltro(parametros.hasta) },
  ]);

  const puedeCrear = tienePermiso(perfil?.permisos, PERMISOS.ORDENES_COMPRA_CREAR);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Compras</h6>
          <h2 style={{ margin: 0 }}>Órdenes de compra</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BotonesExportar
            hrefBase={`/api/ordenes-compra/export?${construirQueryExport(parametros)}`}
            descripcion="el listado de órdenes de compra"
          />
          {puedeCrear && (
            <Link href="/ordenes-compra/nueva" className="btn btn-primary">
              <Plus size={16} /> Nueva orden
            </Link>
          )}
        </div>
      </div>

      <BarraFiltros
        method="GET"
        claveDeFiltros={claveDeFiltros(filtros)}
        pie={<ResumenFiltros filtros={filtros} hrefLimpiar="/ordenes-compra" />}
      >
        <CampoFiltro ancho="largo">
          <label htmlFor="buscar">Buscar</label>
          <input
            id="buscar"
            name="buscar"
            className="input"
            placeholder="Número o proveedor — ej. 42 formex"
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
                <th>Orden</th>
                <th>Proveedor</th>
                <th>Fecha</th>
                <th>Entrega esperada</th>
                <th>Estado</th>
                <th>Valor total</th>
              </tr>
            </thead>
            <tbody>
              {pagina.datos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    {mensajeListadoVacio('órdenes de compra', filtros.length > 0)}
                  </td>
                </tr>
              ) : (
                pagina.datos.map((orden) => (
                  <tr key={orden.id}>
                    <td>
                      <Link href={`/ordenes-compra/${orden.id}`}>{formatoNumeroOrdenCompra(orden.numero)}</Link>
                    </td>
                    <td>{orden.proveedor.nombre}</td>
                    <td>{formatoFecha(orden.fechaOrden)}</td>
                    <td className="text-muted">
                      {orden.fechaEntregaEsperada ? formatoFecha(orden.fechaEntregaEsperada) : 'Sin fecha'}
                    </td>
                    <td>
                      <EstadoOrdenCompraTag estado={orden.estado} />
                    </td>
                    <td>{formatoMoneda(orden.valorTotal)}</td>
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
            Página {pagina.pagina} de {totalPaginas} — {pagina.total} orden{pagina.total === 1 ? '' : 'es'}
          </span>
          <div className="flex gap-2">
            <EnlacePagina
              href={`/ordenes-compra?${construirQuery(parametros, Math.max(1, pagina.pagina - 1))}`}
              deshabilitado={pagina.pagina <= 1}
            >
              Anterior
            </EnlacePagina>
            <EnlacePagina
              href={`/ordenes-compra?${construirQuery(parametros, Math.min(totalPaginas, pagina.pagina + 1))}`}
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
