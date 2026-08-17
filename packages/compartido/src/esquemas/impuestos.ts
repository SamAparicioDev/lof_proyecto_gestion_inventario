/**
 * Tasa de IVA de una línea de documento (US20, FR-109).
 *
 * Vive aparte porque la comparten los CUATRO documentos con precios —ingresos, salidas, órdenes
 * de compra y cotizaciones— y repetir el campo en cada esquema haría que un día se relajara en
 * uno solo. Es el mismo motivo por el que el cálculo vive en un único servicio de dominio
 * (`servicio-impuestos.ts`): la regla es una, aunque los documentos sean cuatro.
 *
 * Las tres tasas son las vigentes en Colombia y coinciden EXACTAMENTE con el `CHECK` de la base
 * de datos. Si algún día cambian, cambian en los dos sitios a la vez o el dato entra por un
 * camino y lo rechaza el otro.
 */
import { z } from 'zod';

/** Tasas admitidas, en el orden en que se ofrecen en el desplegable. */
export const TASAS_IVA = [0, 5, 19] as const;

export type TasaIva = (typeof TASAS_IVA)[number];

/** Tasa que se propone en una línea NUEVA (FR-109).
 *
 *  19% es la tasa general y la que aplica a la mayoría de la mercancía, así que proponerla
 *  ahorra el clic más frecuente. Las líneas ya registradas NO se tocan: conservan el 0% con el
 *  que se capturaron, para que ningún documento histórico cambie de valor. */
export const TASA_IVA_POR_DEFECTO: TasaIva = 19;

/**
 * Campo `tasaIva` de una línea. OPCIONAL con defecto 0: un cliente HTTP anterior a US20 —o la
 * carga masiva, que no captura impuestos— sigue funcionando sin enviarlo y produce exactamente
 * el mismo documento que producía antes.
 */
export const esquemaTasaIva = z
  .number({ invalid_type_error: 'La tasa de IVA no es válida' })
  .refine((tasa): tasa is TasaIva => (TASAS_IVA as readonly number[]).includes(tasa), {
    message: `La tasa de IVA debe ser ${TASAS_IVA.map((t) => `${t}%`).join(', ')}`,
  })
  .optional()
  .default(0);

/** Etiqueta legible de una tasa, para desplegables y documentos. */
export function etiquetaTasaIva(tasa: number): string {
  return tasa === 0 ? 'Exento (0%)' : `${tasa}%`;
}
