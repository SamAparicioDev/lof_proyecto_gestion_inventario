/**
 * Página de cambio de contraseña (T024) — `/cambiar-password` (contracts/rutas-frontend.md).
 *
 * Accesible a los tres roles. El layout autenticado (frontend/src/app/(app)/layout.tsx,
 * T025) es quien decide si el usuario DEBE estar aquí (FR-004): si
 * `perfil.debeCambiarPassword` es true y la ruta actual no es esta, redirige aquí antes de
 * renderizar cualquier otra pantalla. Página = solo composición; el formulario vive en
 * `frontend/src/componentes/auth/formulario-cambiar-password.tsx`. Encabezado y tarjeta con
 * las clases del sistema de diseño Nocturne (docs/diseno-nocturne.md).
 */
import type { Metadata } from 'next';
import { FormularioCambiarPassword } from '@/componentes/auth/formulario-cambiar-password';

export const metadata: Metadata = {
  title: 'Cambiar contraseña — Trazo',
};

export default function PaginaCambiarPassword() {
  return (
    <div className="flex w-full max-w-[380px] flex-col gap-3.5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Seguridad</h6>
        <h2 style={{ margin: 0 }}>Cambiar contraseña</h2>
      </div>
      <div className="card elev-sm gap-3.5 p-[22px]">
        <FormularioCambiarPassword />
      </div>
    </div>
  );
}
