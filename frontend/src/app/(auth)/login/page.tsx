/**
 * Página de inicio de sesión (T023) — `/login`, pública (contracts/rutas-frontend.md).
 *
 * Página = solo composición (docs/arquitectura.md §7); el formulario y su lógica viven en
 * `frontend/src/componentes/auth/formulario-login.tsx`. Fondo y tarjeta tomados tal cual de
 * la pantalla `showLogin` del mockup Nocturne (Nocturne — docs/diseno-nocturne.md).
 *
 * `Suspense` es obligatorio aquí: el formulario usa `useSearchParams()` (para leer
 * `sesionExpirada`/`next`) y Next.js exige que todo uso de `useSearchParams` esté envuelto
 * en un límite de Suspense para no bloquear el renderizado estático del resto de la ruta.
 */
import { Suspense } from 'react';
import { LogoLof } from '@/componentes/comunes/logo-lof';
import type { Metadata } from 'next';
import { FormularioLogin } from '@/componentes/auth/formulario-login';
import { InterruptorTema } from '@/componentes/layout/interruptor-tema';

export const metadata: Metadata = {
  title: 'Iniciar sesión — LOF',
};

export default function PaginaLogin() {
  return (
    <main
      className="relative grid min-h-screen place-items-center p-6"
      style={{ background: 'radial-gradient(80% 60% at 50% 0%, var(--color-bg-glow) 0%, var(--color-bg) 70%)' }}
    >
      {/* US19: el control también aquí — quien prefiere claro no debería tener que iniciar
          sesión en oscuro para poder cambiarlo después. */}
      <div className="absolute right-4 top-4">
        <InterruptorTema />
      </div>

      <div className="flex w-full max-w-[380px] flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <LogoLof alto={44} tamanoTextoRespaldo={26} />
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
