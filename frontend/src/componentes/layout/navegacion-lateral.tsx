'use client';

/**
 * Lista de navegación de la barra lateral (T025), filtrada por PERMISO desde T108.
 *
 * Client Component: el resaltado del elemento activo depende de la ruta actual
 * (`usePathname()`), algo que solo se conoce en el navegador tras cada navegación —
 * exactamente el mismo criterio (`S.view === n.id`) de `Trazo Inventarios.dc.html`.
 *
 * Recibe los permisos efectivos de la sesión por prop (el layout ya los resolvió con el
 * perfil) en vez de leerlos del contexto: así el sidebar sigue siendo un componente sin
 * dependencias de sesión, igual que cuando recibía `rol`. Recuerda: este filtrado es solo UX
 * (frontend/src/lib/permisos.ts) — la autoridad de acceso son los guards del backend
 * (FR-003).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navegacionPermitida } from '@/lib/navegacion';

/** Un elemento del menú se considera activo si la ruta actual es él o cuelga de él. */
function esRutaActiva(pathname: string, href: string): boolean {
  if (href === '/') {
    return pathname === '/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavegacionLateral({ permisos }: { permisos: string[] }) {
  const pathname = usePathname();
  const elementos = navegacionPermitida(permisos);

  return (
    <nav id="navlist" aria-label="Navegación principal" className="flex flex-col gap-0.5">
      {elementos.map((elemento) => {
        const activo = esRutaActiva(pathname, elemento.href);
        const Icono = elemento.icono;
        return (
          <Link
            key={elemento.href}
            href={elemento.href}
            aria-current={activo ? 'page' : undefined}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] no-underline transition-colors hover:bg-white/[0.06]"
            style={{
              background: activo ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent',
              color: activo ? 'var(--color-accent-300)' : 'var(--color-text)',
            }}
          >
            <Icono size={17} weight="regular" />
            <span className="nav-label">{elemento.etiqueta}</span>
          </Link>
        );
      })}
    </nav>
  );
}
