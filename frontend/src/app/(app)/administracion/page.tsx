/**
 * `/administracion` no tiene contenido propio: reparte hacia la primera sección que la sesión
 * pueda abrir.
 *
 * Redirigir en vez de fijar un destino único es la lección de US9 (T108): con roles a medida no
 * se puede asumir que quien entra al módulo tenga permiso sobre su primera sección. Un rol que
 * solo administre proveedores debe aterrizar en proveedores, no en un aviso de "no tienes
 * permiso" que le haría creer que el módulo entero no es para él.
 */
import { redirect } from 'next/navigation';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { PERMISOS, tienePermiso } from '@/lib/permisos';

export default async function PaginaAdministracion() {
  const perfil = await obtenerPerfilServidor();

  if (tienePermiso(perfil?.permisos, PERMISOS.CATEGORIAS_GESTIONAR)) {
    redirect('/administracion/categorias');
  }
  if (tienePermiso(perfil?.permisos, PERMISOS.PROVEEDORES_GESTIONAR)) {
    redirect('/administracion/proveedores');
  }

  return (
    <div role="alert" className="card p-5">
      No tienes permiso para administrar los catálogos del sistema. Contacta a un administrador.
    </div>
  );
}
