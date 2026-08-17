/**
 * Listado de inventario (T061) — `/inventario`, tabla paginada server-side con búsqueda por
 * SKU/descripción y filtro "Solo stock bajo" (FR-020…FR-023). Server Component: reenvía la
 * cookie de sesión al backend vía `apiServidor` (mismo patrón que `app/(app)/salidas/page.tsx`,
 * T053) — nunca `fetch` directo.
 *
 * El formulario de filtros es un `<form method="GET">` nativo (sin JavaScript, mismo criterio
 * que ingresos/salidas): al enviarlo, el navegador navega a
 * `/inventario?buscar=...&soloStockBajo=true` y esta misma página vuelve a renderizar con los
 * nuevos `searchParams`. El checkbox de "Solo stock bajo" solo envía su `name` cuando está
 * marcado (comportamiento nativo de HTML) — coincide exactamente con lo que espera
 * `esquemaFiltroInventario` en `@trazo/compartido` (ausente/"false" → `false`).
 *
 * FILTROS DE US13 (T137, FR-075…FR-079): categoría, ubicación, estado del producto y rango de
 * disponible. Los dos primeros se ofrecen como SELECTORES alimentados por
 * `GET /api/inventario/opciones-filtro` (FR-076) — son texto libre sin catálogo (FR-052), así que
 * un campo de texto obligaría a adivinar cómo los escribió otra persona. El de estado no cambia
 * el default de la pantalla: sin filtro se siguen viendo activos e inactivos (T111). El rango se
 * mide contra `disponible`, no contra el stock crudo (FR-077); el backend es quien lo aplica.
 * Bajo la barra, `ResumenFiltros` muestra lo que está recortando el listado y ofrece "Limpiar
 * filtros" (FR-078), y la tabla recibe `hayFiltros` para que su estado vacío diga si está vacía
 * por los filtros o porque el catálogo aún no tiene productos (FR-079).
 *
 * La tabla en sí (con el enlace a la ficha `/inventario/[id]`, la `AlertaStockBajo` de las
 * filas cuyo `stockBajo` calculó el backend contra `disponible` —FR-022, nunca reimplementado
 * en el frontend— y, desde T111, el estado del producto y las acciones de editar/activar/
 * desactivar por fila) vive en el Client Component
 * `componentes/inventario/tabla-inventario.tsx`: esta página solo compone
 * (docs/arquitectura.md §7), igual que `app/(app)/usuarios/page.tsx` con `TablaUsuarios`.
 *
 * Encabezado "kicker + h2" (kicker "Almacén", h2 "Inventario" — Trazo Inventarios.dc.html) y
 * sistema de diseño Nocturne (docs/diseno-nocturne.md).
 *
 * CONTROL DE ACCESO (corrección de la revisión adversarial de la Tanda 13, hallazgo CRITICAL):
 * `inventario.ver` se resuelve ANTES de llamar a `GET /api/inventario` —mismo patrón que
 * `app/(app)/usuarios/page.tsx` y `app/(app)/roles/page.tsx`, y el que exige
 * frontend/CLAUDE.md—, y sin él se muestra un `<div role="alert">` en español.
 *
 * Por qué importa MÁS aquí que en cualquier otra pantalla: esta es la portada de la app. El
 * login empuja a `/` y `/` reparte hacia el primer módulo permitido, que para casi todo el
 * mundo es este. Antes de la corrección, un rol propio sin `inventario.ver` iniciaba sesión
 * directo contra un `403` no capturado y veía la pantalla de error genérica de Next —sin
 * español, sin navegación y sin salida— es decir, NO PODÍA USAR LA APLICACIÓN aunque su rol
 * tuviera otros módulos concedidos. El sidebar sí ocultaba bien el enlace "Panel": la app
 * escondía el enlace y luego te empujaba a él.
 *
 * Botones del encabezado y PERMISOS (T108: se resuelven con `obtenerPerfilServidor` en
 * paralelo al listado; ocultar UI es solo UX, la autoridad real son los guards del backend):
 * - "Nuevo producto" (T111, `BotonNuevoProducto`) — `productos.crear`, que los tres roles del
 *   sistema traen: es la misma alta rápida que el formulario de ingresos ya ofrecía al
 *   Operario. El botón se oculta a un rol propio que no lo tenga, en vez de ofrecerle un
 *   diálogo que terminaría en `403`.
 * - "Importar desde Excel" (T096, US8) → `/inventario/importar` — `productos.importar`, con su
 *   propio gate en `app/(app)/inventario/importar/page.tsx`.
 * - Editar y activar/desactivar por fila los resuelve `TablaInventario` con `usePuede()`
 *   (`productos.editar` / `productos.cambiar_estado`, cada acción con SU permiso): es un
 *   Client Component bajo `<ProveedorSesion>` y no necesita que esta página le reenvíe nada.
 */
import Link from 'next/link';
import { FileXls } from '@phosphor-icons/react/dist/ssr';
import type { FilaInventario, OpcionesFiltroInventario, Paginado } from '@trazo/compartido';
import { apiServidor } from '@/lib/api/servidor';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { claveDeFiltros, filtrosActivos } from '@/lib/filtros';
import { mensajeSinPermiso, PERMISOS, tienePermiso } from '@/lib/permisos';
import { BotonNuevoProducto } from '@/componentes/inventario/boton-nuevo-producto';
import { TablaInventario } from '@/componentes/inventario/tabla-inventario';
import { BarraFiltros, CampoFiltro, OpcionFiltro } from '@/componentes/comunes/barra-filtros';
import { ResumenFiltros } from '@/componentes/comunes/resumen-filtros';

const POR_PAGINA = 20;

const MENSAJE_SIN_PERMISO = mensajeSinPermiso('consultar el inventario');

const ESTADOS: { valor: 'ACTIVO' | 'INACTIVO'; etiqueta: string }[] = [
  { valor: 'ACTIVO', etiqueta: 'Activo' },
  { valor: 'INACTIVO', etiqueta: 'Inactivo' },
];

/** Etiqueta legible de un estado para el resumen de filtros — el chip dice "Activo", no "ACTIVO". */
function etiquetaEstado(valor: string | undefined): string | undefined {
  return ESTADOS.find((estado) => estado.valor === valor)?.etiqueta;
}

/** Encabezado "kicker + h2" de la pantalla — se pinta igual con o sin permiso, para que quien
 *  no lo tenga sepa dónde está en vez de ver una tarjeta de aviso suelta. */
function EncabezadoInventario() {
  return (
    <div>
      <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Almacén</h6>
      <h2 style={{ margin: 0 }}>Inventario</h2>
    </div>
  );
}

interface ParametrosBusqueda {
  buscar?: string;
  soloStockBajo?: string;
  categoriaId?: string;
  ubicacion?: string;
  estado?: string;
  disponibleMin?: string;
  disponibleMax?: string;
  pagina?: string;
}

/** Arma la query string de `/api/inventario` (o de un enlace de paginación) preservando los filtros activos. */
function construirQuery(parametros: ParametrosBusqueda, paginaDestino?: number): string {
  const query = new URLSearchParams();
  if (parametros.buscar) query.set('buscar', parametros.buscar);
  if (parametros.soloStockBajo === 'true') query.set('soloStockBajo', 'true');
  if (parametros.categoriaId) query.set('categoriaId', parametros.categoriaId);
  if (parametros.ubicacion) query.set('ubicacion', parametros.ubicacion);
  if (parametros.estado) query.set('estado', parametros.estado);
  if (parametros.disponibleMin) query.set('disponibleMin', parametros.disponibleMin);
  if (parametros.disponibleMax) query.set('disponibleMax', parametros.disponibleMax);
  query.set('pagina', String(paginaDestino ?? parametros.pagina ?? 1));
  query.set('porPagina', String(POR_PAGINA));
  return query.toString();
}

/**
 * Opciones de los selectores de categoría y ubicación (FR-076). Degrada a listas vacías si la
 * llamada falla, mismo criterio que `rolesAsignables` en `/usuarios`: el listado es lo que el
 * usuario vino a ver, y un selector auxiliar caído no puede tumbar la pantalla — se ofrece sin
 * opciones (con el valor vigente conservado, ver `opcionesConValorVigente`), nunca un error.
 */
async function opcionesDeFiltro(): Promise<OpcionesFiltroInventario> {
  try {
    return await apiServidor<OpcionesFiltroInventario>('/api/inventario/opciones-filtro');
  } catch {
    return { categorias: [], ubicaciones: [] };
  }
}

/**
 * Garantiza que el valor filtrado esté SIEMPRE entre las opciones del selector, aunque ya no
 * exista en el catálogo (el último producto de esa categoría se editó mientras el filtro seguía
 * puesto) o la lista de opciones no haya podido cargarse. Sin esto el `<select>` se pintaría en
 * "Todas" mientras el listado sigue recortado: la pantalla estaría mintiendo sobre su estado.
 */
function opcionesConValorVigente(opciones: readonly string[], valorVigente: string | undefined): string[] {
  if (!valorVigente || opciones.includes(valorVigente)) return [...opciones];
  return [...opciones, valorVigente].sort((a, b) => a.localeCompare(b, 'es'));
}

export default async function PaginaInventario({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusqueda>;
}) {
  const parametros = await searchParams;
  const soloStockBajo = parametros.soloStockBajo === 'true';

  // El permiso se resuelve PRIMERO: `GET /api/inventario` exige `inventario.ver` y no hay aquí
  // ningún recurso auxiliar "seguro" que precargar en paralelo (ver TSDoc de cabecera).
  const perfil = await obtenerPerfilServidor();
  if (!tienePermiso(perfil?.permisos, PERMISOS.INVENTARIO_VER)) {
    return (
      <div className="flex flex-col gap-5">
        <EncabezadoInventario />
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {MENSAJE_SIN_PERMISO}
        </div>
      </div>
    );
  }

  const [pagina, opciones] = await Promise.all([
    apiServidor<Paginado<FilaInventario>>(`/api/inventario?${construirQuery(parametros)}`),
    opcionesDeFiltro(),
  ]);
  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.porPagina));
  const puedeImportar = tienePermiso(perfil?.permisos, PERMISOS.PRODUCTOS_IMPORTAR);
  const puedeCrear = tienePermiso(perfil?.permisos, PERMISOS.PRODUCTOS_CREAR);
  // US15: las categorías llegan del CATÁLOGO ya resueltas (activas + inactivas en uso), así que
  // no hace falta `opcionesConValorVigente`: la lista ya contiene la que esté filtrada.
  const categorias = opciones.categorias;
  const ubicaciones = opcionesConValorVigente(opciones.ubicaciones, parametros.ubicacion);

  // El orden es el mismo de los campos de la barra, para que el resumen se lea igual que se llenó.
  const filtros = filtrosActivos([
    { etiqueta: 'Buscar', valor: parametros.buscar },
    { etiqueta: 'Categoría', valor: categorias.find((c) => String(c.id) === parametros.categoriaId)?.nombre },
    { etiqueta: 'Ubicación', valor: parametros.ubicacion },
    { etiqueta: 'Estado', valor: etiquetaEstado(parametros.estado) },
    { etiqueta: 'Disponible desde', valor: parametros.disponibleMin },
    { etiqueta: 'Disponible hasta', valor: parametros.disponibleMax },
    { etiqueta: 'Solo stock bajo', valor: soloStockBajo ? 'Sí' : undefined },
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EncabezadoInventario />
        <div className="flex flex-wrap items-center gap-2">
          {puedeImportar && (
            <Link href="/inventario/importar" className="btn btn-secondary">
              <FileXls size={16} /> Importar desde Excel
            </Link>
          )}
          {puedeCrear && <BotonNuevoProducto />}
        </div>
      </div>

      <BarraFiltros
        method="GET"
        claveDeFiltros={claveDeFiltros(filtros)}
        pie={<ResumenFiltros filtros={filtros} hrefLimpiar="/inventario" />}
      >
        <CampoFiltro ancho="largo">
          <label htmlFor="buscar">Buscar</label>
          <input
            id="buscar"
            name="buscar"
            className="input"
            placeholder="SKU, descripción, ubicación o categoría — ej. cemento gris"
            defaultValue={parametros.buscar}
          />
        </CampoFiltro>
        <CampoFiltro>
          <label htmlFor="categoria">Categoría</label>
          <select id="categoria" name="categoriaId" className="input" defaultValue={parametros.categoriaId ?? ''}>
            <option value="">Todas</option>
            {categorias.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.nombre}
              </option>
            ))}
          </select>
        </CampoFiltro>
        <CampoFiltro>
          <label htmlFor="ubicacion">Ubicación</label>
          <select id="ubicacion" name="ubicacion" className="input" defaultValue={parametros.ubicacion ?? ''}>
            <option value="">Todas</option>
            {ubicaciones.map((ubicacion) => (
              <option key={ubicacion} value={ubicacion}>
                {ubicacion}
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
          <label htmlFor="disponibleMin">Disponible desde</label>
          <input
            id="disponibleMin"
            name="disponibleMin"
            type="number"
            min="0"
            step="0.01"
            className="input"
            defaultValue={parametros.disponibleMin}
          />
        </CampoFiltro>
        <CampoFiltro ancho="corto">
          <label htmlFor="disponibleMax">Disponible hasta</label>
          <input
            id="disponibleMax"
            name="disponibleMax"
            type="number"
            min="0"
            step="0.01"
            className="input"
            defaultValue={parametros.disponibleMax}
          />
        </CampoFiltro>
        <OpcionFiltro>
          <input type="checkbox" name="soloStockBajo" value="true" defaultChecked={soloStockBajo} />
          Solo stock bajo
        </OpcionFiltro>
        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
      </BarraFiltros>

      <TablaInventario filas={pagina.datos} hayFiltros={filtros.length > 0} />

      {pagina.total > 0 && (
        <div className="flex items-center justify-between text-muted" style={{ fontSize: 13 }}>
          <span>
            Página {pagina.pagina} de {totalPaginas} — {pagina.total} producto{pagina.total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <EnlacePagina
              href={`/inventario?${construirQuery(parametros, Math.max(1, pagina.pagina - 1))}`}
              deshabilitado={pagina.pagina <= 1}
            >
              Anterior
            </EnlacePagina>
            <EnlacePagina
              href={`/inventario?${construirQuery(parametros, Math.min(totalPaginas, pagina.pagina + 1))}`}
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
