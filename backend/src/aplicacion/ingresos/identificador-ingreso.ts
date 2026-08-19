/**
 * Cómo se identifica un ingreso a ojos de quien lo lee (US29, FR-126).
 *
 * Hasta esta historia la respuesta era una sola —el número de factura— y por eso vivía escrita
 * a mano en cada sitio que la necesitaba. Con el AJUSTE de inventario hay dos, y una regla
 * repetida en tres lugares es una regla que va a divergir: el reporte de movimientos diría
 * `AJU-000042`, el historial del producto diría `7` y el documento exportado diría otra cosa.
 *
 * Vive en `aplicacion` y no en `dominio` porque `formatoNumeroAjuste` es PRESENTACIÓN y vive en
 * `@trazo/compartido` —el mismo formato que usa el navegador—, y el dominio no importa nada
 * externo (Principio VI). Que el backend y el frontend lean el correlativo igual es justamente
 * lo que se busca: `AJU-000042` en pantalla y `AJU-000042` en el archivo exportado.
 *
 * Implementa: FR-126 (el ajuste se identifica por su correlativo propio), FR-045 (todo
 * movimiento nombra su documento asociado).
 */
import { formatoNumeroAjuste } from '@trazo/compartido';
import type { Ingreso } from '../../dominio/entidades/ingreso';

/**
 * El número que identifica este ingreso: el de la factura, o el correlativo del ajuste ya
 * formateado. El respaldo por `id` no debería ocurrir nunca —el `CHECK` de la base garantiza
 * que uno de los dos está presente— pero un documento sin identificador en pantalla sería peor
 * que uno con su id técnico.
 */
export function identificadorIngreso(ingreso: Pick<Ingreso, 'id' | 'numeroFactura' | 'numeroAjuste'>): string {
  if (ingreso.numeroFactura !== null) return ingreso.numeroFactura;
  if (ingreso.numeroAjuste !== null) return formatoNumeroAjuste(ingreso.numeroAjuste);
  return String(ingreso.id);
}
