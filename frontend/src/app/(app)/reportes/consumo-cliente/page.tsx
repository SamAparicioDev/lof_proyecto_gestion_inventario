/**
 * Página de reporte de consumo por cliente (T071) — `/reportes/consumo-cliente`, roles
 * Administrador/Gerente (FR-039). Server Component: solo compone (docs/arquitectura.md §7);
 * el filtro, la tabla y las exportaciones viven en
 * `componentes/reportes/reporte-consumo-cliente.tsx` (Client Component: necesita estado
 * interactivo para el filtro y la descarga de archivos). Precarga el listado completo de
 * clientes para el combobox del filtro — mismo patrón que `app/(app)/salidas/nueva/page.tsx`.
 *
 * Control de acceso (T108): el permiso `reportes.ver` se resuelve PRIMERO y solo entonces se
 * monta el panel — las 4 rutas de reportes se comportan ahora igual (antes esta y
 * `consumo-proyecto` dejaban ver el filtro a quien no podía generar el reporte, y el aviso
 * solo aparecía tras el `403` de la API). Ocultar la pantalla es solo UX (FR-003): la
 * autoridad real es `PermisosGuard` en el backend, que responde `403` a
 * `GET /api/reportes/consumo-cliente` sin importar lo que renderice esta página.
 *
 * La precarga de clientes se pide en paralelo y con `apiServidorOpcional` (corrección de la
 * revisión adversarial de la Tanda 13): `GET /api/clientes` exige `clientes.ver`, un permiso
 * DISTINTO de `reportes.ver`, y "Reportes" del menú apunta justo a esta ruta — así que un rol
 * propio con `reportes.ver` y sin `clientes.ver` aterrizaba en la pantalla de error genérica de
 * Next al pulsar su propio enlace. Sin esa lista el combobox queda vacío y el panel lo explica;
 * el reporte en sí no depende de ella.
 */
import type { Cliente, Paginado } from '@trazo/compartido';
import { POR_PAGINA_MAXIMA } from '@trazo/compartido';
import { apiServidorOpcional } from '@/lib/api/servidor';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { mensajeSinPermiso, PERMISOS, tienePermiso } from '@/lib/permisos';
import { PanelConsumoCliente } from '@/componentes/reportes/reporte-consumo-cliente';
import { PestanasReportes } from '@/componentes/reportes/pestanas-reportes';

const MENSAJE_SIN_PERMISO = mensajeSinPermiso('ver este reporte');

export default async function PaginaReporteConsumoCliente() {
  const [perfil, clientesPagina] = await Promise.all([
    obtenerPerfilServidor(),
    apiServidorOpcional<Paginado<Cliente> | null>(`/api/clientes?porPagina=${POR_PAGINA_MAXIMA}`, null),
  ]);
  const puedeVerReportes = tienePermiso(perfil?.permisos, PERMISOS.REPORTES_VER);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Reportes</h6>
        <h2 style={{ margin: 0 }}>Consumo por cliente</h2>
      </div>
      <PestanasReportes />
      {puedeVerReportes ? (
        <PanelConsumoCliente clientes={clientesPagina?.datos ?? []} />
      ) : (
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {MENSAJE_SIN_PERMISO}
        </div>
      )}
    </div>
  );
}
