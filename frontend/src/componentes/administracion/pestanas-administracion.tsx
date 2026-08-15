'use client';

/**
 * Navegación interna del módulo de Administración (US15).
 *
 * Este módulo agrupa el mantenimiento de los CATÁLOGOS del sistema —los datos de apoyo que el
 * negocio parametriza y que el resto de pantallas solo consume—, empezando por categorías y
 * proveedores. Vive aparte del menú principal a propósito: son pantallas de configuración que
 * se tocan de vez en cuando, y una entrada por catálogo en la barra lateral la haría crecer sin
 * fin a medida que aparezcan más (que es exactamente lo que se espera que ocurra).
 *
 * Cada sección declara el permiso que la abre y solo se muestran las que la sesión puede usar:
 * un Gerente ve las dos, un rol propio con solo `proveedores.gestionar` ve una. Mostrar una
 * pestaña que lleva a un aviso de "no tienes permiso" sería peor que no mostrarla. Esto es UX;
 * la autoridad real son los guards del backend (FR-003).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePuede } from '@/lib/sesion';
import { PERMISOS } from '@/lib/permisos';

/** Secciones del módulo, en el orden en que se muestran. Añadir un catálogo nuevo es añadir
 *  una línea aquí y su página — ese es el objetivo de tener módulo propio. */
export const SECCIONES_ADMINISTRACION = [
  { href: '/administracion/categorias', etiqueta: 'Categorías', permiso: PERMISOS.CATEGORIAS_GESTIONAR },
  { href: '/administracion/proveedores', etiqueta: 'Proveedores', permiso: PERMISOS.PROVEEDORES_GESTIONAR },
] as const;

export function PestanasAdministracion() {
  const pathname = usePathname();
  const puedeCategorias = usePuede(PERMISOS.CATEGORIAS_GESTIONAR);
  const puedeProveedores = usePuede(PERMISOS.PROVEEDORES_GESTIONAR);

  const permitidas: Record<string, boolean> = {
    [PERMISOS.CATEGORIAS_GESTIONAR]: puedeCategorias,
    [PERMISOS.PROVEEDORES_GESTIONAR]: puedeProveedores,
  };

  const visibles = SECCIONES_ADMINISTRACION.filter((seccion) => permitidas[seccion.permiso]);
  if (visibles.length <= 1) return null; // con una sola sección, unas pestañas no informan de nada

  return (
    <nav aria-label="Administración" className="flex flex-wrap gap-2">
      {visibles.map((seccion) => {
        const activo = pathname === seccion.href;
        return (
          <Link
            key={seccion.href}
            href={seccion.href}
            aria-current={activo ? 'page' : undefined}
            className={activo ? 'btn btn-primary' : 'btn btn-secondary'}
          >
            {seccion.etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}
