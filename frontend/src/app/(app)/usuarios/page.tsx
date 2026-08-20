/**
 * Listado de usuarios (T077) — `/usuarios`, exige el permiso `usuarios.gestionar`
 * (contracts/rutas-frontend.md; el enlace de navegación ya lo oculta a quien no lo tenga,
 * `frontend/src/lib/navegacion.ts`, T108 — recuerda: eso es solo UX, la autoridad real es
 * `@RequierePermiso('usuarios.gestionar')` a nivel de clase en el controlador, que cubre las
 * 5 rutas de `/api/usuarios*`).
 *
 * Server Component: tabla paginada server-side con filtro de estado, mismo patrón que
 * `app/(app)/clientes/page.tsx` — `<form method="GET">` nativo para el filtro (sin
 * JavaScript, Principio V) y `apiServidor` para el listado. El alta, la edición, el
 * restablecimiento de contraseña y el cambio de estado son interactivos (diálogos Nocturne)
 * y viven en los Client Components `componentes/usuarios/boton-nuevo-usuario.tsx` y
 * `componentes/usuarios/tabla-usuarios.tsx` — este archivo solo compone
 * (docs/arquitectura.md §7).
 *
 * Control de acceso (corrección revisión adversarial Tanda 7, hallazgo HIGH): aquí NO existe
 * un recurso auxiliar "seguro" que precargar — `/api/usuarios`, el propio listado, exige
 * `usuarios.gestionar`. Por eso el PERMISO se resuelve PRIMERO (mismo perfil que ya
 * necesitábamos para `usuarioActualId`) y solo entonces se llama
 * `apiServidor('/api/usuarios...')`; quien entre por URL directa sin el permiso (el enlace ya
 * está oculto, pero eso es solo UX) ve un aviso claro en español (`role="alert"`) sin llegar
 * a golpear el endpoint restringido ni a reventar con la pantalla de error genérica de
 * Next.js. T108 cambió la comparación por nombre de rol (`perfil.rol !== 'ADMINISTRADOR'`)
 * por la del permiso: un rol propio con `usuarios.gestionar` concedido debe entrar aquí, y
 * ningún nombre fijo puede saberlo (FR-058).
 *
 * A diferencia de `contracts/rutas-frontend.md` (que listaba `/usuarios/nuevo` y
 * `/usuarios/[id]` como rutas separadas, mismo patrón que clientes), esta tanda sigue el
 * diseño de `Trazo Inventarios.dc.html` para la pantalla de usuarios, que resuelve alta y
 * edición con diálogos sobre el propio listado en vez de páginas dedicadas (ver
 * docs/diseno-nocturne.md e instrucción explícita de la tanda US6) — el contrato de rutas
 * queda desactualizado en ese detalle y se anota aquí en vez de crear páginas que no
 * reflejarían el diseño real.
 */
import Link from 'next/link';
import type { Paginado, RolAsignado, RolListado, Usuario } from '@trazo/compartido';
import { apiServidor } from '@/lib/api/servidor';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { mensajeSinPermiso, PERMISOS, tienePermiso } from '@/lib/permisos';
import { BotonNuevoUsuario } from '@/componentes/usuarios/boton-nuevo-usuario';
import { TablaUsuarios } from '@/componentes/usuarios/tabla-usuarios';
import { BarraFiltros, CampoFiltro } from '@/componentes/comunes/barra-filtros';
import { ResumenFiltros } from '@/componentes/comunes/resumen-filtros';
import { claveDeFiltros, filtrosActivos } from '@/lib/filtros';

const POR_PAGINA = 20;

const MENSAJE_SIN_PERMISO = mensajeSinPermiso('administrar usuarios');

const ESTADOS: { valor: 'ACTIVO' | 'INACTIVO'; etiqueta: string }[] = [
  { valor: 'ACTIVO', etiqueta: 'Activo' },
  { valor: 'INACTIVO', etiqueta: 'Inactivo' },
];

interface ParametrosBusqueda {
  estado?: string;
  rolId?: string;
  pagina?: string;
}

/**
 * Tope del selector de rol. `POR_PAGINA_MAXIMA` (100) es el límite del contrato para cualquier
 * listado y ninguna organización de las que describe la spec tiene más de 100 roles distintos
 * — mismo criterio ya aplicado a los selectores de cliente/proyecto (ver rendimiento.md).
 */
const ROLES_MAXIMOS = 100;

/**
 * Roles ACTIVOS que el formulario de usuarios ofrece (T108, reemplaza la lista fija de tres
 * nombres): con los roles como dato, un rol propio como "Bodeguero" debe poder asignarse sin
 * tocar código (US9-AS1). Solo ACTIVOS — un rol dado de baja no debería estrenarse en un alta.
 *
 * Desde US13 (T137) esta MISMA lista alimenta el filtro "Rol" del listado (FR-076): la pantalla
 * ya la cargaba para el diálogo de alta, así que el filtro no agrega ni una petición. Un rol
 * INACTIVO no se ofrece para filtrar por el mismo motivo por el que no se ofrece para asignar, y
 * si alguno de sus usuarios necesitara buscarse, el filtro de estado y la columna "Rol" siguen
 * ahí. Consecuencia deliberada de devolver `[]` ante un `403`: sin la lista, el campo de filtro
 * NO se pinta (igual que el selector del alta se deshabilita) — filtrar por un id que no se puede
 * nombrar no le sirve a nadie.
 *
 * Devuelve `[]` en vez de propagar el error a propósito: `/api/usuarios` exige
 * `usuarios.gestionar` y `/api/roles` exige `roles.gestionar`, que son permisos DISTINTOS y un
 * rol propio podría tener el primero sin el segundo. Ese caso no debe tumbar toda la pantalla
 * de usuarios —el listado, restablecer contraseña y activar/desactivar siguen funcionando—;
 * lo que hace el formulario es deshabilitar el selector y decir por qué (`usuario-form.tsx`).
 * Fail-closed: sin lista no se ofrece ningún rol, nunca se adivina uno.
 */
async function rolesAsignables(): Promise<RolAsignado[]> {
  try {
    const pagina = await apiServidor<Paginado<RolListado>>(
      `/api/roles?estado=ACTIVO&pagina=1&porPagina=${ROLES_MAXIMOS}`,
    );
    // US30 (FR-128): el rol de respaldo NO se ofrece — no se asigna desde la aplicación, así que
    // enseñarlo en el selector solo llevaría a un 400 con el rol ya elegido. Sigue siendo visible
    // en /roles, donde se explica por qué.
    return pagina.datos
      .filter((rol) => !rol.esSuperAdmin)
      .map((rol) => ({ id: rol.id, nombre: rol.nombre }));
  } catch {
    return [];
  }
}

/** Arma la query string de `/api/usuarios` (o de un enlace de paginación) preservando los filtros activos. */
function construirQuery(parametros: ParametrosBusqueda, paginaDestino?: number): string {
  const query = new URLSearchParams();
  if (parametros.estado) query.set('estado', parametros.estado);
  if (parametros.rolId) query.set('rolId', parametros.rolId);
  query.set('pagina', String(paginaDestino ?? parametros.pagina ?? 1));
  query.set('porPagina', String(POR_PAGINA));
  return query.toString();
}

export default async function PaginaUsuarios({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusqueda>;
}) {
  const parametros = await searchParams;
  const perfil = await obtenerPerfilServidor();

  // `/api/usuarios` exige `usuarios.gestionar` y no hay ningún recurso auxiliar seguro que
  // precargar: se resuelve el permiso ANTES de llamar al endpoint restringido para no reventar
  // con la pantalla de error de Next.js ante un 403 de quien entra por URL directa (el enlace
  // de navegación ya está oculto, pero eso es solo UX — la autoridad real es
  // `@RequierePermiso('usuarios.gestionar')` del backend).
  if (!tienePermiso(perfil?.permisos, PERMISOS.USUARIOS_GESTIONAR)) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Administración</h6>
          <h2 style={{ margin: 0 }}>Usuarios</h2>
        </div>
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {MENSAJE_SIN_PERMISO}
        </div>
      </div>
    );
  }

  const [pagina, roles] = await Promise.all([
    apiServidor<Paginado<Usuario>>(`/api/usuarios?${construirQuery(parametros)}`),
    rolesAsignables(),
  ]);
  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.porPagina));

  // Mismo orden que los campos de la barra (FR-078). El rol se muestra por NOMBRE resolviéndolo
  // contra la lista ya cargada: un chip que dijera "Rol: 3" no le explica nada a nadie.
  const filtros = filtrosActivos([
    { etiqueta: 'Estado', valor: ESTADOS.find((estado) => estado.valor === parametros.estado)?.etiqueta },
    { etiqueta: 'Rol', valor: roles.find((rol) => String(rol.id) === parametros.rolId)?.nombre },
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Administración</h6>
          <h2 style={{ margin: 0 }}>Usuarios</h2>
        </div>
        <BotonNuevoUsuario roles={roles} />
      </div>

      <BarraFiltros
        method="GET"
        claveDeFiltros={claveDeFiltros(filtros)}
        pie={<ResumenFiltros filtros={filtros} hrefLimpiar="/usuarios" />}
      >
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
        {roles.length > 0 && (
          <CampoFiltro>
            <label htmlFor="rolId">Rol</label>
            <select id="rolId" name="rolId" className="input" defaultValue={parametros.rolId ?? ''}>
              <option value="">Todos</option>
              {roles.map((rol) => (
                <option key={rol.id} value={rol.id}>
                  {rol.nombre}
                </option>
              ))}
            </select>
          </CampoFiltro>
        )}
        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
      </BarraFiltros>

      <TablaUsuarios
        usuarios={pagina.datos}
        usuarioActualId={perfil?.id ?? null}
        roles={roles}
        hayFiltros={filtros.length > 0}
      />

      {pagina.total > 0 && (
        <div className="flex items-center justify-between text-muted" style={{ fontSize: 13 }}>
          <span>
            Página {pagina.pagina} de {totalPaginas} — {pagina.total} usuario{pagina.total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <EnlacePagina
              href={`/usuarios?${construirQuery(parametros, Math.max(1, pagina.pagina - 1))}`}
              deshabilitado={pagina.pagina <= 1}
            >
              Anterior
            </EnlacePagina>
            <EnlacePagina
              href={`/usuarios?${construirQuery(parametros, Math.min(totalPaginas, pagina.pagina + 1))}`}
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
