/**
 * Página de reporte de consumo por proyecto (T072) — `/reportes/consumo-proyecto`, roles
 * Administrador/Gerente (FR-040). Server Component: solo compone (docs/arquitectura.md §7);
 * el filtro en cascada cliente→proyecto, el detalle, el gráfico y las exportaciones viven en
 * `componentes/reportes/reporte-consumo-proyecto.tsx` (Client Component). Precarga el listado
 * completo de clientes para el combobox raíz del filtro — mismo patrón que
 * `app/(app)/salidas/nueva/page.tsx` y `app/(app)/reportes/consumo-cliente/page.tsx`.
 *
 * Control de acceso (T108): mismo criterio que `reportes/consumo-cliente/page.tsx` — el
 * permiso `reportes.ver` se resuelve ANTES de montar el panel, en paralelo con la precarga de
 * clientes, que se pide con `apiServidorOpcional` porque exige `clientes.ver`, un permiso
 * DISTINTO (corrección de la revisión adversarial de la Tanda 13: un `403` en esa precarga
 * tumbaba toda la pantalla con el error genérico de Next). Ocultar la pantalla es solo UX
 * (FR-003): la autoridad real es `PermisosGuard` en el backend.
 */
import type { Cliente, Paginado } from '@trazo/compartido';
import { POR_PAGINA_MAXIMA } from '@trazo/compartido';
import { apiServidorOpcional } from '@/lib/api/servidor';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { mensajeSinPermiso, PERMISOS, tienePermiso } from '@/lib/permisos';
import { PanelConsumoProyecto } from '@/componentes/reportes/reporte-consumo-proyecto';
import { PestanasReportes } from '@/componentes/reportes/pestanas-reportes';

const MENSAJE_SIN_PERMISO = mensajeSinPermiso('ver este reporte');

export default async function PaginaReporteConsumoProyecto() {
  const [perfil, clientesPagina] = await Promise.all([
    obtenerPerfilServidor(),
    apiServidorOpcional<Paginado<Cliente> | null>(`/api/clientes?porPagina=${POR_PAGINA_MAXIMA}`, null),
  ]);
  const puedeVerReportes = tienePermiso(perfil?.permisos, PERMISOS.REPORTES_VER);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Reportes</h6>
        <h2 style={{ margin: 0 }}>Consumo por proyecto</h2>
      </div>
      <PestanasReportes />
      {puedeVerReportes ? (
        <PanelConsumoProyecto clientes={clientesPagina?.datos ?? []} />
      ) : (
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {MENSAJE_SIN_PERMISO}
        </div>
      )}
    </div>
  );
}
