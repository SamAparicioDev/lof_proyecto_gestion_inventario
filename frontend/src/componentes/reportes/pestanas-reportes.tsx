'use client';

/**
 * Navegación entre los 4 reportes (FR-039...FR-042) — el mockup "Trazo Inventarios.dc.html"
 * resuelve los 4 sub-reportes con pestañas dentro de una sola pantalla ("reportTab",
 * docs/diseno-nocturne.md), pero este proyecto los implementó como 4 rutas Next.js
 * independientes (coincide con contracts/rutas-frontend.md). Sin este componente, un
 * usuario real no tenía forma de llegar a los otros 3 reportes salvo escribiendo la URL de
 * memoria — el único enlace "Reportes" del sidebar apunta solo a consumo-cliente
 * (frontend/src/lib/navegacion.ts) — hallazgo HIGH de la revisión final, tanda US7.
 *
 * Client Component: resalta la pestaña activa según la ruta actual (usePathname), mismo
 * criterio que NavegacionLateral. No hay una clase Nocturne dedicada a pestañas de
 * navegación (".seg"/".seg-opt" son para elecciones de formulario con <input>, no enlaces
 * de página) — se reutilizan las clases existentes ".btn"/".btn-primary"/".btn-secondary"
 * en vez de inventar una paralela (docs/arquitectura.md §7).
 *
 * "no-imprimir": es navegación de la app, no contenido del reporte (FR-043) — se oculta en
 * la vista de impresión igual que los demás controles.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const REPORTES = [
  { href: '/reportes/consumo-cliente', etiqueta: 'Consumo por cliente' },
  { href: '/reportes/consumo-proyecto', etiqueta: 'Consumo por proyecto' },
  { href: '/reportes/inventario', etiqueta: 'Inventario actual' },
  { href: '/reportes/movimientos', etiqueta: 'Movimientos' },
] as const;

export function PestanasReportes() {
  const pathname = usePathname();

  return (
    <nav aria-label="Reportes" className="no-imprimir flex flex-wrap gap-2">
      {REPORTES.map((reporte) => {
        const activo = pathname === reporte.href;
        return (
          <Link
            key={reporte.href}
            href={reporte.href}
            aria-current={activo ? 'page' : undefined}
            className={activo ? 'btn btn-primary' : 'btn btn-secondary'}
          >
            {reporte.etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}
