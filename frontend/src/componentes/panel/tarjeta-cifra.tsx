/**
 * Tarjeta de una cifra del panel de control (T116, US10) — la unidad visual del dashboard de
 * `Trazo Inventarios.dc.html`: rótulo pequeño en mayúscula, la cifra grande, una línea de
 * contexto opcional y el destino al que lleva.
 *
 * **La tarjeta ENTERA es el enlace** (`<Link>`), no un botón dentro de ella: FR-061 pide que
 * al seleccionar una cifra el sistema navegue al listado correspondiente YA FILTRADO por ese
 * criterio, así que el área de clic es la cifra misma. `destino` lo decide quien la usa
 * (`app/(app)/page.tsx`), que es donde vive el mapa cifra → listado filtrado.
 *
 * Sistema de diseño (docs/diseno-nocturne.md):
 * - Contenedor `.card` + `.elev-sm` de Nocturne, sin ninguna utilidad de Tailwind que toque
 *   `padding`/`gap`/`flex-direction`/`background`: esa clase las declara y, al estar el CSS de
 *   Nocturne SIN capa, ganaría igual (regla de cascada del documento). El layout interno va en
 *   elementos hijos, que no llevan clases de Nocturne.
 * - Los `style` inline son los DOS casos que el documento autoriza: (a) texto auxiliar sin
 *   token (11px del rótulo en mayúscula, 12px de la línea de contexto — excepciones
 *   documentadas), y (b) escape hatch de cascada: `a { color: var(--color-accent) }` es CSS
 *   sin capa, así que ninguna utilidad de Tailwind puede devolverle a la tarjeta el color de
 *   texto normal; el `style` sí gana.
 * - `.card-enlace` (globals.css, fuera del bloque VENDORED) aporta el `:hover`/`:active` que
 *   `.card` no trae — Nocturne exige que todo elemento interactivo los tenga, y una tarjeta
 *   suya no lo era hasta esta pantalla.
 */
import Link from 'next/link';
import type { Icon } from '@phosphor-icons/react';

export interface TarjetaCifraProps {
  /** Rótulo corto en mayúscula ("Productos activos"). */
  etiqueta: string;
  /** Cifra YA formateada por quien la usa (número o moneda con los helpers de `lib/formato`). */
  valor: string;
  /** Ruta del listado ya filtrado por este criterio (FR-061). */
  destino: string;
  /** Texto del enlace ("Ver inventario") — nombra la pantalla a la que lleva, en español. */
  textoDestino: string;
  icono: Icon;
  /** Línea de contexto opcional bajo la cifra ("Desde el 01/08/2026"). */
  detalle?: string;
  /** Contenido opcional junto a la cifra — hoy, la etiqueta de "requiere atención". */
  distintivo?: React.ReactNode;
}

export function TarjetaCifra({
  etiqueta,
  valor,
  destino,
  textoDestino,
  icono: Icono,
  detalle,
  distintivo,
}: TarjetaCifraProps) {
  return (
    <Link
      href={destino}
      className="card card-enlace elev-sm"
      // Escape hatch de cascada documentado (ver TSDoc de cabecera): sin esto la tarjeta
      // entera se pinta en color de acento y subrayada, por ser un <a>.
      style={{ color: 'var(--color-text)', textDecoration: 'none' }}
    >
      <div className="flex items-start justify-between gap-[var(--space-3)]">
        <span
          className="text-muted"
          style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}
        >
          {etiqueta}
        </span>
        <span style={{ color: 'var(--color-accent)' }} aria-hidden="true">
          <Icono size={16} />
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <span style={{ fontSize: 22, fontFamily: 'var(--font-heading)' }}>{valor}</span>
        {distintivo}
      </div>

      {detalle && (
        <span className="text-muted" style={{ fontSize: 12 }}>
          {detalle}
        </span>
      )}

      <span style={{ fontSize: 12, color: 'var(--color-accent)' }}>{textoDestino}</span>
    </Link>
  );
}
