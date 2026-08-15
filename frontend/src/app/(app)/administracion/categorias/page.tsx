/**
 * `/administracion/categorias` — catálogo de categorías de producto (US15, T154, FR-084…FR-087).
 *
 * Server Component que solo resuelve el permiso y compone: la tabla y sus diálogos son un
 * Client Component porque las cuatro operaciones vuelven a la misma pantalla.
 *
 * El permiso se comprueba ANTES de tocar el endpoint restringido (patrón de `/usuarios` y
 * `/roles`): quien entre por URL directa ve un aviso en español, no la pantalla de error de
 * Next. `categorias.ver` NO abre esta pantalla — ese permiso sirve para clasificar productos y
 * filtrar el inventario, y lo tienen los tres roles (FR-088).
 */
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { PERMISOS, tienePermiso } from '@/lib/permisos';
import { TablaCategorias } from '@/componentes/administracion/tabla-categorias';

export default async function PaginaCategorias() {
  const perfil = await obtenerPerfilServidor();

  if (!tienePermiso(perfil?.permisos, PERMISOS.CATEGORIAS_GESTIONAR)) {
    return (
      <div role="alert" className="card p-5">
        No tienes permiso para administrar las categorías. Contacta a un administrador o gerente.
      </div>
    );
  }

  return <TablaCategorias />;
}
