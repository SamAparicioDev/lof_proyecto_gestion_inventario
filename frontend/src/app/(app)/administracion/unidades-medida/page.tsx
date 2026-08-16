/**
 * `/administracion/unidades-medida` — catálogo de unidades de medida (US17, T183, FR-101/FR-104).
 *
 * Server Component que resuelve el permiso y compone; la tabla y sus diálogos son un Client
 * Component porque las cuatro operaciones vuelven a esta misma pantalla.
 *
 * El permiso se comprueba ANTES de tocar el endpoint restringido (patrón de `/usuarios` y
 * `/roles`). `unidades_medida.ver` NO abre esta pantalla: ese permiso alimenta el selector
 * obligatorio del formulario de producto y lo tienen los tres roles (FR-102).
 */
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { PERMISOS, tienePermiso } from '@/lib/permisos';
import { TablaUnidadesMedida } from '@/componentes/administracion/tabla-unidades-medida';

export default async function PaginaUnidadesMedida() {
  const perfil = await obtenerPerfilServidor();

  if (!tienePermiso(perfil?.permisos, PERMISOS.UNIDADES_MEDIDA_GESTIONAR)) {
    return (
      <div role="alert" className="card p-5">
        No tienes permiso para administrar las unidades de medida. Contacta a un administrador o
        gerente.
      </div>
    );
  }

  return <TablaUnidadesMedida />;
}
