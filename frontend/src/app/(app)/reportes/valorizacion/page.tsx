/**
 * Página de la VALORIZACIÓN DE INVENTARIO A UNA FECHA (T296) — /reportes/valorizacion (US38, FR-163…FR-168).
 *
 * Server Component: solo compone y resuelve el control de acceso (mismo patrón que `/reportes/inventario`). El permiso se comprueba ANTES de montar el panel que golpea la API,
 * para que quien entre por URL directa vea un aviso en español y no una pantalla en blanco. La
 * autoridad real sigue siendo `PermisosGuard` en el backend (FR-003).
 */
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { mensajeSinPermiso, PERMISOS, tienePermiso } from '@/lib/permisos';
import { PanelReporteValorizacion } from '@/componentes/reportes/reporte-valorizacion';
import { PestanasReportes } from '@/componentes/reportes/pestanas-reportes';

const MENSAJE_SIN_PERMISO = mensajeSinPermiso('ver este reporte');

export default async function PaginaReporteValorizacion() {
  const perfil = await obtenerPerfilServidor();
  const puedeVerReportes = tienePermiso(perfil?.permisos, PERMISOS.REPORTES_VER);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Reportes</h6>
        <h2 style={{ margin: 0 }}>Valorización a una fecha</h2>
      </div>
      <PestanasReportes />
      {puedeVerReportes ? (
        <PanelReporteValorizacion />
      ) : (
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {MENSAJE_SIN_PERMISO}
        </div>
      )}
    </div>
  );
}
