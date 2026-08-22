/**
 * `/solicitudes` — el buzón del super administrador (US36, FR-148…FR-157).
 *
 * Server Component mínimo: resuelve quién entra ANTES de pintar nada, igual que `/roles` y
 * `/usuarios`. La diferencia está en QUÉ resuelve — aquí no se consulta ningún permiso, porque no
 * hay ninguno que consultar: este módulo no se declara en la matriz y por tanto no existe casilla
 * en `/roles` capaz de concederlo (FR-148). Se mira `esSuperAdmin`, que es una columna que solo la
 * base de datos puede cambiar (US30, FR-127).
 *
 * Como en todas las pantallas, esto es UX: quien llame a `/api/solicitudes` sin ser el super
 * administrador recibe 403 de `SuperAdminGuard`, tenga los 30 permisos marcados o ninguno
 * (FR-003, SC-019).
 */
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { BuzonSolicitudes } from '@/componentes/solicitudes/buzon-solicitudes';

export default async function PaginaSolicitudes() {
  const perfil = await obtenerPerfilServidor();

  if (!perfil?.esSuperAdmin) {
    return (
      <div role="alert" className="card">
        Esta sección es exclusiva del super administrador del sistema.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Sistema</h6>
        <h2 style={{ margin: 0 }}>Solicitudes</h2>
        <p className="text-muted" style={{ margin: '4px 0 0' }}>
          Lo que le falta al sistema, anotado antes de que se olvide. Refinar convierte tu texto en
          un prompt listo para entregarle a quien lo va a implementar.
        </p>
      </div>
      <BuzonSolicitudes />
    </div>
  );
}
