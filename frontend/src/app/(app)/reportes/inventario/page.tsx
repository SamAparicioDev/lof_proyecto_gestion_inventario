/**
 * Página de reporte de inventario actual (T082) — `/reportes/inventario`, roles
 * Administrador/Gerente (FR-041). Server Component: solo compone y resuelve el control de
 * acceso (docs/arquitectura.md §7); el filtro, la tabla y las exportaciones viven en
 * `componentes/reportes/reporte-inventario.tsx` (Client Component: necesita estado
 * interactivo para el filtro, la carga inicial y la descarga de archivos).
 *
 * Control de acceso (mismo patrón que `app/(app)/usuarios/page.tsx`, corrección de la
 * revisión adversarial de la tanda de usuarios, hallazgo HIGH — NO el patrón más antiguo de
 * `app/(app)/reportes/consumo-cliente/page.tsx`, que no gatea a nivel de página porque ahí
 * SÍ existe un recurso auxiliar seguro que precargar): el PERMISO se resuelve PRIMERO
 * (T108: `reportes.ver`, el mismo que exige `@RequierePermiso` en el controlador — ya no un
 * nombre de rol fijo, FR-058), ANTES de montar el panel que golpea `GET
 * /api/reportes/inventario` — quien entra por URL directa (el enlace de navegación ya está
 * oculto, FR-003, pero eso es solo UX) ve un aviso claro en español (`role="alert"`) de
 * inmediato, nunca una pantalla en blanco ni el filtro de un reporte al que no tiene acceso.
 * La autoridad real sigue siendo `PermisosGuard` en el backend.
 */
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { mensajeSinPermiso, PERMISOS, tienePermiso } from '@/lib/permisos';
import { PanelReporteInventario } from '@/componentes/reportes/reporte-inventario';
import { PestanasReportes } from '@/componentes/reportes/pestanas-reportes';

const MENSAJE_SIN_PERMISO = mensajeSinPermiso('ver este reporte');

export default async function PaginaReporteInventario() {
  const perfil = await obtenerPerfilServidor();
  const puedeVerReportes = tienePermiso(perfil?.permisos, PERMISOS.REPORTES_VER);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Reportes</h6>
        <h2 style={{ margin: 0 }}>Inventario actual</h2>
      </div>
      <PestanasReportes />
      {puedeVerReportes ? (
        <PanelReporteInventario />
      ) : (
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {MENSAJE_SIN_PERMISO}
        </div>
      )}
    </div>
  );
}
