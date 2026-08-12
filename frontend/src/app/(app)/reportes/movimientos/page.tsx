/**
 * Página de reporte de movimientos de inventario (T082) — `/reportes/movimientos`, roles
 * Administrador/Gerente (FR-042). Server Component: solo compone, resuelve el control de
 * acceso y precarga el listado completo de clientes para el filtro en cascada
 * cliente→proyecto (docs/arquitectura.md §7) — mismo patrón de precarga que
 * `app/(app)/reportes/consumo-cliente/page.tsx`. El filtro, la tabla y las exportaciones
 * viven en `componentes/reportes/reporte-movimientos.tsx` (Client Component).
 *
 * Control de acceso (mismo patrón que `app/(app)/usuarios/page.tsx`, corrección de la
 * revisión adversarial de la tanda de usuarios, hallazgo HIGH): el PERMISO `reportes.ver` se
 * resuelve PRIMERO (T108 — el mismo que exige `@RequierePermiso` en el controlador, ya no un
 * nombre de rol fijo, FR-058), en paralelo con la precarga de clientes. Sin `reportes.ver` se
 * descarta el resultado de esa precarga y se muestra un aviso claro en español (`role="alert"`)
 * de inmediato, sin montar el panel que golpea `GET /api/reportes/movimientos` — nunca una
 * pantalla en blanco. La autoridad real sigue siendo `PermisosGuard` en el backend.
 *
 * La precarga usa `apiServidorOpcional` desde la revisión adversarial de la Tanda 13. Este
 * mismo comentario decía antes que `GET /api/clientes` exige `clientes.ver`, "que tienen los
 * tres roles del sistema — así que no hay problema en pedirla antes": US9 invalidó ese
 * razonamiento por definición, porque el Administrador puede crear un rol con `reportes.ver` y
 * sin `clientes.ver`, y ese rol recibía la pantalla de error genérica de Next en vez del
 * reporte. Sin la lista, el filtro de cliente queda vacío y el reporte sigue funcionando.
 */
import type { Cliente, Paginado } from '@trazo/compartido';
import { POR_PAGINA_MAXIMA } from '@trazo/compartido';
import { apiServidorOpcional } from '@/lib/api/servidor';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { mensajeSinPermiso, PERMISOS, tienePermiso } from '@/lib/permisos';
import { PanelReporteMovimientos } from '@/componentes/reportes/reporte-movimientos';
import { PestanasReportes } from '@/componentes/reportes/pestanas-reportes';

const MENSAJE_SIN_PERMISO = mensajeSinPermiso('ver este reporte');

export default async function PaginaReporteMovimientos() {
  const [perfil, clientesPagina] = await Promise.all([
    obtenerPerfilServidor(),
    apiServidorOpcional<Paginado<Cliente> | null>(`/api/clientes?porPagina=${POR_PAGINA_MAXIMA}`, null),
  ]);
  const puedeVerReportes = tienePermiso(perfil?.permisos, PERMISOS.REPORTES_VER);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Reportes</h6>
        <h2 style={{ margin: 0 }}>Movimientos de inventario</h2>
      </div>
      <PestanasReportes />
      {puedeVerReportes ? (
        <PanelReporteMovimientos clientes={clientesPagina?.datos ?? []} />
      ) : (
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {MENSAJE_SIN_PERMISO}
        </div>
      )}
    </div>
  );
}
