/**
 * Página del reporte de INVENTARIO INMÓVIL (T289) — /reportes/inventario-inmovil (US37, FR-158…FR-162).
 *
 * Server Component: solo compone y resuelve el control de acceso (mismo patrón que `/reportes/inventario`). El permiso se comprueba ANTES de montar el panel que golpea la API,
 * para que quien entre por URL directa vea un aviso en español y no una pantalla en blanco. La
 * autoridad real sigue siendo `PermisosGuard` en el backend (FR-003).
 */
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { mensajeSinPermiso, PERMISOS, tienePermiso } from '@/lib/permisos';
import { PanelReporteInventarioInmovil } from '@/componentes/reportes/reporte-inventario-inmovil';
import { PestanasReportes } from '@/componentes/reportes/pestanas-reportes';

const MENSAJE_SIN_PERMISO = mensajeSinPermiso('ver este reporte');

export default async function PaginaReporteInventarioInmovil() {
  const perfil = await obtenerPerfilServidor();
  const puedeVerReportes = tienePermiso(perfil?.permisos, PERMISOS.REPORTES_VER);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Reportes</h6>
        <h2 style={{ margin: 0 }}>Inventario inmóvil</h2>
      </div>
      <PestanasReportes />
      {puedeVerReportes ? (
        <PanelReporteInventarioInmovil />
      ) : (
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {MENSAJE_SIN_PERMISO}
        </div>
      )}
    </div>
  );
}
