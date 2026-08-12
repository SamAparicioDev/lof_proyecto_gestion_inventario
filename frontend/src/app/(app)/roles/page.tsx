/**
 * Gestión de roles y su matriz de permisos (T107) — `/roles`, exige el permiso
 * `roles.gestionar` (contracts/rutas-frontend.md; el enlace de navegación ya lo oculta a quien
 * no lo tenga, `frontend/src/lib/navegacion.ts` — recuerda: eso es solo UX, la autoridad real
 * es `@RequierePermiso('roles.gestionar')` en el backend).
 *
 * Es la pantalla que hace configurable el control de acceso sin tocar código (US9, FR-054…
 * FR-059): lista los roles con cuántos usuarios los tienen y cuántos permisos conceden, y el
 * editor marca su matriz de permisos agrupada por módulo.
 *
 * Server Component: tabla paginada server-side con filtro de estado, mismo patrón que
 * `app/(app)/usuarios/page.tsx` — `<form method="GET">` nativo para el filtro (sin JavaScript,
 * Principio V) y `apiServidor` para el listado. El alta, la edición, el cambio de estado y la
 * eliminación son interactivos (diálogos Nocturne) y viven en los Client Components
 * `componentes/roles/boton-nuevo-rol.tsx` y `componentes/roles/tabla-roles.tsx` — este archivo
 * solo compone (docs/arquitectura.md §7).
 *
 * ## Control de acceso (patrón del hallazgo HIGH de la revisión adversarial de la Tanda 7)
 *
 * Igual que `/usuarios` y a diferencia de los reportes, aquí NO existe ningún recurso auxiliar
 * "seguro" que precargar: las DOS llamadas de la pantalla (`GET /api/roles` y `GET
 * /api/permisos`) exigen `roles.gestionar`. Por eso el permiso se resuelve PRIMERO y solo
 * entonces se llaman; quien entre por URL directa sin él ve un aviso claro en español
 * (`role="alert"`) sin golpear ningún endpoint restringido ni reventar con la pantalla de error
 * genérica de Next.js.
 *
 * ## El catálogo se pide una vez, aquí
 *
 * `GET /api/permisos` devuelve el catálogo completo agrupado por módulo (FR-056, solo lectura).
 * Se resuelve en esta página y se pasa al botón de alta y a la tabla, en vez de que cada
 * diálogo lo pida al abrirse: es el mismo dato para todos, no cambia mientras la pantalla está
 * abierta (se versiona con el despliegue, no con la operación) y así ningún diálogo estrena un
 * estado de carga.
 */
import Link from 'next/link';
import type { ModuloPermisos, Paginado, RolListado } from '@trazo/compartido';
import { apiServidor } from '@/lib/api/servidor';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { claveDeFiltros } from '@/lib/filtros';
import { mensajeSinPermiso, PERMISOS, tienePermiso } from '@/lib/permisos';
import { BotonNuevoRol } from '@/componentes/roles/boton-nuevo-rol';
import { TablaRoles } from '@/componentes/roles/tabla-roles';
import { BarraFiltros, CampoFiltro } from '@/componentes/comunes/barra-filtros';

const POR_PAGINA = 20;

const MENSAJE_SIN_PERMISO = mensajeSinPermiso('administrar roles y permisos');

const ESTADOS: { valor: 'ACTIVO' | 'INACTIVO'; etiqueta: string }[] = [
  { valor: 'ACTIVO', etiqueta: 'Activo' },
  { valor: 'INACTIVO', etiqueta: 'Inactivo' },
];

interface ParametrosBusqueda {
  estado?: string;
  pagina?: string;
}

/** Arma la query string de `/api/roles` (o de un enlace de paginación) preservando los filtros activos. */
function construirQuery(parametros: ParametrosBusqueda, paginaDestino?: number): string {
  const query = new URLSearchParams();
  if (parametros.estado) query.set('estado', parametros.estado);
  query.set('pagina', String(paginaDestino ?? parametros.pagina ?? 1));
  query.set('porPagina', String(POR_PAGINA));
  return query.toString();
}

export default async function PaginaRoles({ searchParams }: { searchParams: Promise<ParametrosBusqueda> }) {
  const parametros = await searchParams;
  const perfil = await obtenerPerfilServidor();

  if (!tienePermiso(perfil?.permisos, PERMISOS.ROLES_GESTIONAR)) {
    return (
      <div className="flex flex-col gap-5">
        <Encabezado />
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {MENSAJE_SIN_PERMISO}
        </div>
      </div>
    );
  }

  const [pagina, catalogo] = await Promise.all([
    apiServidor<Paginado<RolListado>>(`/api/roles?${construirQuery(parametros)}`),
    apiServidor<ModuloPermisos[]>('/api/permisos'),
  ]);
  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.porPagina));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Encabezado />
        <BotonNuevoRol catalogo={catalogo} />
      </div>

      <p className="text-muted" style={{ margin: 0, maxWidth: 760, fontSize: 13 }}>
        Un rol es un conjunto de permisos con nombre. Lo que marques aquí decide qué puede hacer cada usuario que lo
        tenga, y rige desde su siguiente acción: no necesita volver a iniciar sesión. El catálogo de permisos lo define
        el sistema —cada uno corresponde a una operación real— y no se puede modificar desde esta pantalla.
      </p>

      {/* Esta pantalla no lleva `ResumenFiltros` (los chips de FR-078 son de los 5 listados de
          US13), así que su clave se arma con el único filtro que tiene. */}
      <BarraFiltros method="GET" claveDeFiltros={claveDeFiltros([{ etiqueta: 'Estado', valor: parametros.estado }])}>
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

      <TablaRoles roles={pagina.datos} catalogo={catalogo} />

      {pagina.total > 0 && (
        <div className="flex items-center justify-between text-muted" style={{ fontSize: 13 }}>
          <span>
            Página {pagina.pagina} de {totalPaginas} — {pagina.total} rol{pagina.total === 1 ? '' : 'es'}
          </span>
          <div className="flex gap-2">
            <EnlacePagina
              href={`/roles?${construirQuery(parametros, Math.max(1, pagina.pagina - 1))}`}
              deshabilitado={pagina.pagina <= 1}
            >
              Anterior
            </EnlacePagina>
            <EnlacePagina
              href={`/roles?${construirQuery(parametros, Math.min(totalPaginas, pagina.pagina + 1))}`}
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

/** Encabezado "kicker + h2" del mockup (Trazo Inventarios.dc.html) — igual en ambas ramas. */
function Encabezado() {
  return (
    <div>
      <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Administración</h6>
      <h2 style={{ margin: 0 }}>Roles y permisos</h2>
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
