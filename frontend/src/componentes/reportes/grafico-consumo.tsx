'use client';

/**
 * Gráfico de barras "consumo por producto" (T072) — Recharts, alimentado por `serie` del
 * reporte de consumo por proyecto (FR-040: "...con un gráfico de consumo"). Tema oscuro
 * Nocturne (docs/diseno-nocturne.md).
 *
 * Colores HARDCODEADOS a los hex de `--color-accent`/`--color-divider`/`.text-muted` en vez de
 * `var(--color-accent)`: Recharts pasa `fill`/`stroke` como atributos SVG normales, así que
 * `var()` ahí SÍ resuelve en los navegadores objetivo, pero Nocturne no tiene alternancia de
 * tema en runtime (docs/diseno-nocturne.md — un único fondo oscuro fijo, "esquema mono: no hay
 * un segundo acento real"), así que leer la variable con `getComputedStyle` en un efecto solo
 * añadiría un parpadeo del gráfico sin color en el primer render para una ganancia nula —
 * mismo criterio que la excepción de "valores de layout puntuales sin token" ya documentada
 * ahí para donde no aplica una `var()` real.
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PuntoSerieConsumo } from '@trazo/compartido';
import { formatoMoneda } from '@/lib/formato';

const COLOR_BARRA = '#9184d9'; // --color-accent
const COLOR_REJILLA = 'rgba(233, 233, 237, 0.16)'; // --color-divider
const COLOR_TEXTO_EJE = 'rgba(233, 233, 237, 0.55)'; // .text-muted
const COLOR_TOOLTIP_FONDO = '#232532'; // select.input option (fondo de superficie elevada)

export function GraficoConsumo({ serie }: { serie: PuntoSerieConsumo[] }) {
  if (serie.length === 0) {
    return (
      <div className="card p-4 text-muted" style={{ textAlign: 'center' }}>
        Sin datos para graficar en el período seleccionado.
      </div>
    );
  }

  return (
    <div className="card p-4" style={{ height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={serie} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid stroke={COLOR_REJILLA} vertical={false} />
          <XAxis dataKey="producto" stroke={COLOR_TEXTO_EJE} fontSize={12} tickLine={false} />
          <YAxis
            stroke={COLOR_TEXTO_EJE}
            fontSize={12}
            tickLine={false}
            width={90}
            tickFormatter={(valor: number) => formatoMoneda(valor)}
          />
          <Tooltip
            formatter={(valor: number) => formatoMoneda(valor)}
            contentStyle={{
              background: COLOR_TOOLTIP_FONDO,
              border: '1px solid rgba(233, 233, 237, 0.16)',
              borderRadius: 8,
              color: '#e9e9ed',
            }}
            labelStyle={{ color: '#e9e9ed' }}
          />
          <Bar dataKey="valor" fill={COLOR_BARRA} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
