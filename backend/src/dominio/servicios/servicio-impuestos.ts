/**
 * `ServicioImpuestos` — cálculo del IVA de un documento (US20, FR-109/FR-110).
 *
 * Servicio de dominio 100% PURO (Principio VI): recibe cantidades, precios y tasas ya leídos en
 * memoria y devuelve cifras. Cero `await`, cero I/O, cero Prisma — mismo criterio que
 * `ServicioStock` y `aplicarCambioDeCosto`, y por el mismo motivo: así la regla se prueba con
 * Jest puro y no puede divergir entre los cuatro documentos que la usan (ingresos, salidas,
 * órdenes de compra y cotizaciones).
 *
 * ## Línea a línea, nunca sobre el total (FR-110)
 *
 * El IVA se calcula sobre la base de CADA línea y después se suma. Aplicar una tasa única al
 * total del documento da un número distinto en cuanto conviven dos tasas —una línea al 19% y
 * otra exenta— y es un error que no se nota hasta que alguien cuadra con contabilidad. Que la
 * función que totaliza reciba las líneas, y no un total, hace ese atajo imposible de escribir.
 *
 * ## Las tres cifras
 *
 * - `base`: cantidad × precio unitario. Es lo que el sistema llama `valor_total` desde el
 *   primer día y sigue significando lo mismo (ver la migración `*_iva_en_lineas`).
 * - `iva`: el impuesto.
 * - `total`: base + iva. Se DERIVA siempre, nunca se almacena: un total guardado es un total
 *   que algún día no coincide con sus sumandos.
 *
 * ## Redondeo
 *
 * A dos decimales por línea, no al final: las columnas son `DECIMAL(14,2)` y lo que se guarda
 * tiene que ser exactamente lo que se sumó. Redondear solo el total dejaría un documento cuyas
 * líneas no suman su propia cabecera por uno o dos pesos, que es el tipo de diferencia que
 * obliga a revisar todo un mes de facturas para encontrarla.
 *
 * Implementa: FR-109 (tasa por línea), FR-110 (cálculo por línea y totalización).
 */
import { ErrorValidacionDominio } from '../comunes/errores';

/** Tasas de IVA vigentes en Colombia. Es la MISMA lista que el `CHECK` de la base de datos y
 *  que el esquema Zod compartido; las tres tienen que decir lo mismo o el dato entra por un
 *  camino y es rechazado por otro. */
export const TASAS_IVA = [0, 5, 19] as const;

export type TasaIva = (typeof TASAS_IVA)[number];

/** Lo mínimo que hace falta de una línea para calcular su impuesto. Deliberadamente no es
 *  ninguna de las cuatro entidades de detalle: el servicio no tiene por qué saber si lo que
 *  está calculando es una compra o una venta. */
export interface LineaGravable {
  readonly cantidad: number;
  readonly precioUnitario: number;
  /** Ausente = 0. Las líneas anteriores a US20 no la tienen y valen exactamente lo que valían. */
  readonly tasaIva?: number;
}

/** Las tres cifras de una línea o de un documento. */
export interface Impuestos {
  /** Base gravable — lo que el sistema guarda como `valor_total`. */
  readonly base: number;
  readonly iva: number;
  /** Derivado: `base + iva`. Nunca se almacena. */
  readonly total: number;
}

/** `true` si el número es una de las tasas admitidas. Se usa para validar lo que llega por
 *  HTTP antes de intentar guardarlo y chocar contra el `CHECK` de la base. */
export function esTasaIvaValida(tasa: number): tasa is TasaIva {
  return (TASAS_IVA as readonly number[]).includes(tasa);
}

/** Redondeo a dos decimales, el mismo que admite `DECIMAL(14,2)`. */
function aDosDecimales(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Impuestos de UNA línea. Rechaza una tasa no admitida en vez de calcular con ella: dejarla
 * pasar produciría un impuesto que ningún contador podría explicar, y el error señala el campo
 * para que el formulario lo pinte donde toca.
 */
export function impuestosDeLinea(linea: LineaGravable): Impuestos {
  const tasa = linea.tasaIva ?? 0;
  if (!esTasaIvaValida(tasa)) {
    throw new ErrorValidacionDominio(`La tasa de IVA ${tasa}% no es válida`, {
      tasaIva: `La tasa de IVA debe ser ${TASAS_IVA.join('%, ')}%`,
    });
  }

  const base = aDosDecimales(linea.cantidad * linea.precioUnitario);
  const iva = aDosDecimales((base * tasa) / 100);
  return { base, iva, total: aDosDecimales(base + iva) };
}

/**
 * Impuestos de un DOCUMENTO: la suma de los de sus líneas (FR-110).
 *
 * Recibe las líneas y no un total, a propósito — ver el TSDoc de arriba.
 */
export function impuestosDeDocumento(lineas: readonly LineaGravable[]): Impuestos {
  return lineas.reduce<Impuestos>(
    (acumulado, linea) => {
      const { base, iva } = impuestosDeLinea(linea);
      return {
        base: aDosDecimales(acumulado.base + base),
        iva: aDosDecimales(acumulado.iva + iva),
        total: aDosDecimales(acumulado.total + base + iva),
      };
    },
    { base: 0, iva: 0, total: 0 },
  );
}
