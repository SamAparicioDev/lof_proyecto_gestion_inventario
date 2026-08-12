/**
 * Página de inicio de sesión (T023) — `/login`, pública (contracts/rutas-frontend.md).
 *
 * Página = solo composición (docs/arquitectura.md §7); el formulario y su lógica viven en
 * `frontend/src/componentes/auth/formulario-login.tsx`. Fondo y tarjeta tomados tal cual de
 * la pantalla `showLogin` de `Trazo Inventarios.dc.html` (Nocturne — docs/diseno-nocturne.md).
 *
 * `Suspense` es obligatorio aquí: el formulario usa `useSearchParams()` (para leer
 * `sesionExpirada`/`next`) y Next.js exige que todo uso de `useSearchParams` esté envuelto
 * en un límite de Suspense para no bloquear el renderizado estático del resto de la ruta.
 */
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CubeTransparent } from '@phosphor-icons/react/dist/ssr';
import { FormularioLogin } from '@/componentes/auth/formulario-login';

export const metadata: Metadata = {
  title: 'Iniciar sesión — Trazo',
};

export default function PaginaLogin() {
  return (
    <main
      className="grid min-h-screen place-items-center p-6"
      style={{ background: 'radial-gradient(80% 60% at 50% 0%, var(--color-bg-glow) 0%, var(--color-bg) 70%)' }}
    >
      <div className="flex w-full max-w-[380px] flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <div
              className="flex size-[34px] items-center justify-center rounded-lg"
              style={{ border: '1px solid var(--color-accent)', color: 'var(--color-accent)' }}
            >
              <CubeTransparent size={20} />
            </div>
            <h3 style={{ margin: 0 }}>Trazo</h3>
          </div>
          <div className="text-muted text-[13px]">Gestión de inventarios y proyectos</div>
        </div>

        <div className="card elev-md gap-3.5 p-[22px]">
          <Suspense fallback={null}>
            <FormularioLogin />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
