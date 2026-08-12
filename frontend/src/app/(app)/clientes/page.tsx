/**
 * Listado de clientes (T044) — `/clientes`, tabla paginada server-side con búsqueda
 * (nombre/NIT) y filtro de estado (FR-034). Server Component: reenvía la cookie de sesión
 * al backend vía `apiServidor` (mismo patrón que `app/(app)/ingresos/page.tsx`, T034) —
 * nunca `fetch` directo.
 *
 * El formulario de filtros es un `<form method="GET">` nativo (sin JavaScript, mismo
 * criterio que ingresos): al enviarlo, el navegador navega a
 * `/clientes?buscar=...&estado=...` y esta misma página vuelve a renderizar con los nuevos
 * `searchParams` — más simple que un Client Component con estado propio (Principio V).
 *
 * Encabezado "kicker + h2" (kicker "Relaciones", h2 "Clientes y proyectos" — así los nombra
 * `Trazo Inventarios.dc.html`) y estados vía `EstadoClienteTag` — sistema de diseño Nocturne
 * (docs/diseno-nocturne.md).
 *
 * FILTRO DE US13 (T137, FR-075/FR-076): "Ciudad", como SELECTOR alimentado por
 * `GET /api/clientes/opciones-filtro` — es texto libre capturado a mano, así que el usuario elige
 * entre las ciudades que existen en vez de adivinar si se escribió "Bogotá" o "BOGOTA". Bajo la
 * barra, `ResumenFiltros` muestra lo aplicado y ofrece "Limpiar filtros" (FR-078), y el estado
 * vacío distingue "no hay coincidencias" de "todavía no hay clientes" (FR-079).
 */
import Link from 'next/link';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import type { Cliente, EstadoCliente, OpcionesFiltroClientes, Paginado } from '@trazo/compartido';
import { apiServidor } from '@/lib/api/servidor';
import { EstadoClienteTag } from '@/componentes/clientes/estado-cliente-tag';
import { BarraFiltros, CampoFiltro } from '@/componentes/comunes/barra-filtros';
import { ResumenFiltros } from '@/componentes/comunes/resumen-filtros';
import { claveDeFiltros, filtrosActivos, mensajeListadoVacio } from '@/lib/filtros';

const POR_PAGINA = 20;

const ESTADOS: { valor: EstadoCliente; etiqueta: string }[] = [
  { valor: 'ACTIVO', etiqueta: 'Activo' },
  { valor: 'INACTIVO', etiqueta: 'Inactivo' },
];

interface ParametrosBusqueda {
  buscar?: string;
  estado?: string;
  ciudad?: string;
  pagina?: string;
}

/**
 * Ciudades que alimentan el selector de filtro (FR-076). Degrada a lista vacía si la llamada
 * falla, mismo criterio que en `/inventario` y que `rolesAsignables` en `/usuarios`: un selector
 * auxiliar caído no puede tumbar el listado que el usuario vino a ver.
 */
async function ciudadesDeFiltro(): Promise<string[]> {
  try {
    const opciones = await apiServidor<OpcionesFiltroClientes>('/api/clientes/opciones-filtro');
    return opciones.ciudades;
  } catch {
    return [];
  }
}

/**
 * Garantiza que la ciudad filtrada esté SIEMPRE entre las opciones, aunque ya no exista entre los
 * clientes (el último cliente de esa ciudad se editó con el filtro puesto) o la lista no haya
 * podido cargarse: si no, el `<select>` se pintaría en "Todas" mientras el listado sigue
 * recortado, y la pantalla estaría mintiendo sobre su propio estado.
 */
function ciudadesConValorVigente(ciudades: readonly string[], vigente: string | undefined): string[] {
  if (!vigente || ciudades.includes(vigente)) return [...ciudades];
  return [...ciudades, vigente].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Arma la query string de `/api/clientes` (o de un enlace de paginación) preservando los filtros activos. */
function construirQuery(parametros: ParametrosBusqueda, paginaDestino?: number): string {
  const query = new URLSearchParams();
  if (parametros.buscar) query.set('buscar', parametros.buscar);
  if (parametros.estado) query.set('estado', parametros.estado);
  if (parametros.ciudad) query.set('ciudad', parametros.ciudad);
  query.set('pagina', String(paginaDestino ?? parametros.pagina ?? 1));
  query.set('porPagina', String(POR_PAGINA));
  return query.toString();
}

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusqueda>;
}) {
  const parametros = await searchParams;
  const [pagina, ciudadesExistentes] = await Promise.all([
    apiServidor<Paginado<Cliente>>(`/api/clientes?${construirQuery(parametros)}`),
    ciudadesDeFiltro(),
  ]);
  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.porPagina));
  const ciudades = ciudadesConValorVigente(ciudadesExistentes, parametros.ciudad);

  // Mismo orden que los campos de la barra, para que el resumen se lea igual que se llenó (FR-078).
  const filtros = filtrosActivos([
    { etiqueta: 'Buscar', valor: parametros.buscar },
    { etiqueta: 'Ciudad', valor: parametros.ciudad },
    { etiqueta: 'Estado', valor: ESTADOS.find((estado) => estado.valor === parametros.estado)?.etiqueta },
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Relaciones</h6>
          <h2 style={{ margin: 0 }}>Clientes y proyectos</h2>
        </div>
        <Link href="/clientes/nuevo" className="btn btn-primary">
          <Plus size={16} /> Nuevo cliente
        </Link>
      </div>

      <BarraFiltros
        method="GET"
        claveDeFiltros={claveDeFiltros(filtros)}
        pie={<ResumenFiltros filtros={filtros} hrefLimpiar="/clientes" />}
      >
        <CampoFiltro ancho="largo">
          <label htmlFor="buscar">Buscar</label>
          <input
            id="buscar"
            name="buscar"
            className="input"
            placeholder="Nombre o NIT"
            defaultValue={parametros.buscar}
          />
        </CampoFiltro>
        <CampoFiltro>
          <label htmlFor="ciudad">Ciudad</label>
          <select id="ciudad" name="ciudad" className="input" defaultValue={parametros.ciudad ?? ''}>
            <option value="">Todas</option>
            {ciudades.map((ciudad) => (
              <option key={ciudad} value={ciudad}>
                {ciudad}
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
        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
      </BarraFiltros>

      <div className="card p-0" style={{ overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>NIT</th>
                <th>Ciudad</th>
                <th>Teléfono</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {pagina.datos.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    {mensajeListadoVacio('clientes', filtros.length > 0)}
                  </td>
                </tr>
              ) : (
                pagina.datos.map((cliente) => (
                  <tr key={cliente.id}>
                    <td>
                      <Link href={`/clientes/${cliente.id}`}>{cliente.nombre}</Link>
                    </td>
                    <td>{cliente.nit}</td>
                    <td>{cliente.ciudad ?? '—'}</td>
                    <td>{cliente.telefono ?? '—'}</td>
                    <td>
                      <EstadoClienteTag estado={cliente.estado} />
                    </td>
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
            Página {pagina.pagina} de {totalPaginas} — {pagina.total} cliente{pagina.total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <EnlacePagina
              href={`/clientes?${construirQuery(parametros, Math.max(1, pagina.pagina - 1))}`}
              deshabilitado={pagina.pagina <= 1}
            >
              Anterior
            </EnlacePagina>
            <EnlacePagina
              href={`/clientes?${construirQuery(parametros, Math.min(totalPaginas, pagina.pagina + 1))}`}
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
