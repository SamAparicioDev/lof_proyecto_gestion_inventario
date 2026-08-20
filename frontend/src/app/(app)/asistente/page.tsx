/**
 * `/asistente` — preguntarle al inventario en español (US33, FR-133).
 *
 * Server Component mínimo: resuelve el permiso ANTES de pintar nada (patrón de `/roles` y
 * `/usuarios`) y monta la conversación, que es Client Component porque el estado del hilo vive en
 * el navegador y no en ninguna parte más — la conversación es efímera a propósito.
 *
 * Tener `asistente.consultar` no equivale a poder verlo todo por chat: cada consulta interna
 * vuelve a comprobar su propio permiso en el servidor (FR-134), así que quien no tenga
 * `reportes.ver` podrá preguntar por existencias y no por consumo, exactamente igual que en el
 * menú.
 */
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { mensajeSinPermiso, PERMISOS, tienePermiso } from '@/lib/permisos';
import { ConversacionAsistente } from '@/componentes/asistente/conversacion-asistente';

export default async function PaginaAsistente() {
  const perfil = await obtenerPerfilServidor();

  if (!tienePermiso(perfil?.permisos, PERMISOS.ASISTENTE_CONSULTAR)) {
    return (
      <div role="alert" className="card">
        {mensajeSinPermiso('usar el asistente de consultas')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Consultas</h6>
        <h2 style={{ margin: 0 }}>Asistente</h2>
      </div>
      <ConversacionAsistente />
    </div>
  );
}
