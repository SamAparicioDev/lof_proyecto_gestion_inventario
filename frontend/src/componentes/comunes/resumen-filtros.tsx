/**
 * Resumen de los filtros activos de un listado + "Limpiar filtros" (US13/T136, FR-078).
 *
 * ## Por qué existe
 *
 * Los 5 listados filtran por query string, así que un filtro puesto hace diez minutos (o
 * heredado de un enlace del panel, US10/FR-061) sigue vigente al volver a la pantalla. Sin nada
 * que lo diga, el usuario ve una tabla con tres filas y concluye que "el sistema perdió datos" —
 * el caso real que motivó este componente. Aquí se ve exactamente qué está recortando y se quita
 * TODO de un clic.
 *
 * Se renderiza dentro del `pie` de `BarraFiltros` (misma tarjeta, bajo los campos) y devuelve
 * `null` cuando no hay ningún filtro activo: sin filtros no hay nada que explicar ni que limpiar,
 * y una fila vacía solo empujaría la tabla hacia abajo.
 *
 * ## Detalles de diseño (Nocturne — docs/diseno-nocturne.md)
 *
 * - Cada filtro es un `.tag .tag-outline`, la etiqueta neutra del sistema: son datos, no estados.
 *   Ningún elemento con clase de Nocturne lleva además una utilidad de Tailwind que toque las
 *   mismas propiedades (regla de cascada) — el layout vive SOLO en el `<div>` contenedor.
 * - "Limpiar filtros" es un `<Link>` (no un `<button>`): navegar a la ruta sin query ES la
 *   operación, igual que los enlaces de paginación de estas mismas pantallas. Así funciona sin
 *   JavaScript y permite abrirlo en otra pestaña.
 * - El rótulo "Filtros aplicados" usa el patrón de etiqueta pequeña en mayúscula (11px,
 *   `letter-spacing: 0.06em`) documentado como excepción en diseno-nocturne.md.
 *
 * NO es Client Component: no tiene estado ni interactividad propia (igual que `BarraFiltros`).
 */
import Link from 'next/link';
import { X } from '@phosphor-icons/react/dist/ssr';
import type { FiltroAplicado } from '@/lib/filtros';

interface PropiedadesResumenFiltros {
  /** Filtros realmente activos, ya resueltos a texto legible (`lib/filtros.ts#filtrosActivos`). */
  filtros: readonly FiltroAplicado[];
  /** Ruta del listado SIN query — el destino de "Limpiar filtros" (p. ej. `/inventario`). */
  hrefLimpiar: string;
}

export function ResumenFiltros({ filtros, hrefLimpiar }: PropiedadesResumenFiltros) {
  if (filtros.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-[var(--space-3)]">
      <span
        className="text-muted"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}
      >
        Filtros aplicados
      </span>
      {filtros.map((filtro) => (
        <span key={filtro.etiqueta} className="tag tag-outline">
          {filtro.etiqueta}: {filtro.valor}
        </span>
      ))}
      <Link href={hrefLimpiar} className="btn btn-ghost">
        <X size={14} /> Limpiar filtros
      </Link>
    </div>
  );
}
