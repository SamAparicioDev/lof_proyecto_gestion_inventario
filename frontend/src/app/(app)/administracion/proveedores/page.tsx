/**
 * `/administracion/proveedores` — catálogo de proveedores (US15, T162, FR-091…FR-093).
 *
 * Server Component que solo resuelve el permiso y compone: la tabla y sus diálogos son un
 * Client Component porque las cuatro operaciones vuelven a la misma pantalla.
 *
 * El permiso se comprueba ANTES de tocar el endpoint restringido (patrón de `/usuarios` y
 * `/roles`): quien entre por URL directa ve un aviso en español, no la pantalla de error de
 * Next. `proveedores.ver` NO abre esta pantalla — ese permiso sirve para registrar ingresos y
 * filtrar el listado, y lo tienen los tres roles (FR-091).
 */
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { PERMISOS, tienePermiso } from '@/lib/permisos';
import { TablaProveedores } from '@/componentes/administracion/tabla-proveedores';

export default async function PaginaProveedores() {
  const perfil = await obtenerPerfilServidor();

  if (!tienePermiso(perfil?.permisos, PERMISOS.PROVEEDORES_GESTIONAR)) {
    return (
      <div role="alert" className="card p-5">
        No tienes permiso para administrar los proveedores. Contacta a un administrador o gerente.
      </div>
    );
  }

  return <TablaProveedores />;
}
