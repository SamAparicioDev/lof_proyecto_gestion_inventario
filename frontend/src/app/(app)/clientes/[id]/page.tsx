/**
 * Detalle de un cliente con sus proyectos anidados (T045) — `/clientes/[id]`. Server
 * Component: resuelve `GET /api/clientes/:id` vía `apiServidor` (T025/T044); `notFound()`
 * ante un `404` real (mismo patrón que `app/(app)/ingresos/[id]/page.tsx`, T036).
 *
 * Compone: `PanelCliente` (datos + editar + activar/desactivar, FR-034/FR-038), `LogoCliente`
 * (vista previa + cargar/reemplazar/quitar, US11/FR-066), `ProyectosCliente` (tarjetas de
 * proyecto + alta/edición/estado, FR-036/FR-038) e `HistorialSalidas` (salidas reales del
 * cliente vía `GET /api/salidas?clienteId=`, FR-037 — conectada desde la tanda US3).
 *
 */
import { notFound } from 'next/navigation';
import type { ClienteConProyectos } from '@trazo/compartido';
import { apiServidor } from '@/lib/api/servidor';
import { ErrorApi } from '@/lib/api/cliente';
import { PanelCliente } from '@/componentes/clientes/panel-cliente';
import { ProyectosCliente } from '@/componentes/clientes/proyectos-cliente';
import { HistorialSalidas } from '@/componentes/clientes/historial-salidas';

export default async function PaginaDetalleCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clienteId = Number(id);
  if (!Number.isInteger(clienteId) || clienteId <= 0) {
    notFound();
  }

  let cliente: ClienteConProyectos;
  try {
    cliente = await apiServidor<ClienteConProyectos>(`/api/clientes/${clienteId}`);
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) {
      notFound();
    }
    throw error;
  }

  // Los permisos ya no viajan por prop: los componentes de acciones (Client Components bajo
  // `<ProveedorSesion>`, T026) los leen con `usePuede()` del contexto de sesión (T108). Este
  // Server Component dejó de pedir `GET /api/auth/perfil` solo para reenviar el rol.

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Relaciones</h6>
        <h2 style={{ margin: 0 }}>{cliente.nombre}</h2>
      </div>

      <PanelCliente cliente={cliente} />
      <ProyectosCliente clienteId={cliente.id} proyectos={cliente.proyectos} />
      <HistorialSalidas clienteId={cliente.id} proyectos={cliente.proyectos} />
    </div>
  );
}
