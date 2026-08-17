'use client';

/**
 * Los dos elementos de IVA que comparten los formularios de documento (US20, FR-109/FR-110):
 * el selector de tasa de una línea y el resumen de las tres cifras del documento.
 *
 * Viven juntos y en `comunes/` porque los usan los CUATRO formularios con líneas —ingreso,
 * salida, orden de compra y cotización— y son presentación pura. El cálculo autoritativo lo
 * hace el backend (`servicio-impuestos.ts`); lo de aquí es el mismo cálculo repetido en el
 * cliente para que el usuario vea el total mientras teclea, que es exactamente el papel que ya
 * tenía el `total` en vivo de estos formularios antes de US20.
 */
import { TASAS_IVA, etiquetaTasaIva } from '@trazo/compartido';
import { formatoMoneda } from '@/lib/formato';

interface SelectorTasaIvaProps {
  /** Número de línea, solo para el `aria-label` — las celdas de estas tablas no tienen `<label>`. */
  indice: number;
  /** Lo que devuelve `register(...)` de react-hook-form. */
  registro: Record<string, unknown>;
  invalido?: boolean;
}

export function SelectorTasaIva({ indice, registro, invalido }: SelectorTasaIvaProps): React.JSX.Element {
  return (
    <select
      className="input"
      aria-label={`Tasa de IVA de la línea ${indice + 1}`}
      aria-invalid={invalido}
      {...registro}
    >
      {TASAS_IVA.map((tasa) => (
        <option key={tasa} value={tasa}>
          {etiquetaTasaIva(tasa)}
        </option>
      ))}
    </select>
  );
}

/** Línea tal como la ve el formulario mientras se teclea: los números pueden llegar a medio
 *  escribir, así que todo se normaliza con `Number(...) || 0`. */
interface LineaEnVivo {
  cantidad?: number;
  precioUnitario?: number;
  tasaIva?: number;
}

export interface TotalesDocumento {
  base: number;
  iva: number;
  total: number;
}

/**
 * Las tres cifras del documento, calculadas LÍNEA A LÍNEA (FR-110).
 *
 * Es el mismo criterio que el servicio de dominio, y por el mismo motivo: aplicar una tasa
 * única sobre el total daría otro número en cuanto conviven dos tasas. Aquí importa además que
 * coincida con lo que el backend va a guardar — si la pantalla dijera un total y el documento
 * guardado otro, el usuario no sabría a cuál creerle.
 */
export function calcularTotales(lineas: readonly LineaEnVivo[] | undefined): TotalesDocumento {
  const totales = (lineas ?? []).reduce<TotalesDocumento>(
    (acumulado, linea) => {
      const base = (Number(linea?.cantidad) || 0) * (Number(linea?.precioUnitario) || 0);
      const iva = (base * (Number(linea?.tasaIva) || 0)) / 100;
      return { base: acumulado.base + base, iva: acumulado.iva + iva, total: 0 };
    },
    { base: 0, iva: 0, total: 0 },
  );
  return { ...totales, total: totales.base + totales.iva };
}

interface ResumenTotalesProps {
  totales: TotalesDocumento;
  /** "Total" en un ingreso o una salida; "Total estimado" en una orden de compra. */
  etiquetaTotal?: string;
}

/** Base, IVA y total del documento. Sin impuesto se muestra una sola cifra: repetir el mismo
 *  número tres veces no informa de nada (mismo criterio que los documentos exportados). */
export function ResumenTotales({ totales, etiquetaTotal = 'Total' }: ResumenTotalesProps): React.JSX.Element {
  if (totales.iva <= 0) {
    return (
      <div className="flex justify-end" style={{ fontSize: 16, fontFamily: 'var(--font-heading)' }}>
        {etiquetaTotal}: {formatoMoneda(totales.total)}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="text-muted" style={{ fontSize: 13 }}>
        Base gravable: {formatoMoneda(totales.base)}
      </div>
      <div className="text-muted" style={{ fontSize: 13 }}>
        IVA: {formatoMoneda(totales.iva)}
      </div>
      <div style={{ fontSize: 16, fontFamily: 'var(--font-heading)' }}>
        {etiquetaTotal}: {formatoMoneda(totales.total)}
      </div>
    </div>
  );
}
