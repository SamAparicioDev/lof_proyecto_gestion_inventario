/**
 * Bloque de totales de un documento exportado, con IVA cuando lo hay (US20, FR-110).
 *
 * Vive aquí y no en cada mapeador porque los cuatro documentos exportables —ingreso, salida,
 * orden de compra y cotización— tienen que presentar las MISMAS tres cifras con los mismos
 * nombres. Un contador que reciba un PDF de compra y otro de venta debe poder leerlos igual.
 *
 * **Sin IVA se muestra una sola línea.** Un documento anterior a US20, o uno legítimamente
 * exento, no gana nada con dos filas que digan "IVA $ 0" y "Total" repitiendo la cifra de
 * arriba: sería ruido en el 100% de los documentos históricos. La regla es "si hay impuesto, se
 * desglosa", que es exactamente cuando el desglose informa.
 */
import { formatoMonedaCop } from './formato-documento';

/** Lo mínimo que necesita un documento para presentar sus totales. */
export interface DocumentoConImpuestos {
  /** Base gravable — lo que el sistema guarda como `valor_total`. */
  readonly valorTotal: number;
  readonly valorIva: number;
}

/** Filas de la sección "totales" del documento exportado, en el orden en que se leen. */
export function totalesConIva(documento: DocumentoConImpuestos): Array<{ etiqueta: string; valor: string }> {
  if (documento.valorIva <= 0) {
    return [{ etiqueta: 'Valor total', valor: formatoMonedaCop(documento.valorTotal) }];
  }

  return [
    { etiqueta: 'Base gravable', valor: formatoMonedaCop(documento.valorTotal) },
    { etiqueta: 'IVA', valor: formatoMonedaCop(documento.valorIva) },
    { etiqueta: 'Total', valor: formatoMonedaCop(documento.valorTotal + documento.valorIva) },
  ];
}
