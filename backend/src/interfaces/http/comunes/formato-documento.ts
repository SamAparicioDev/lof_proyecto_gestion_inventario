/**
 * Formateadores de presentación compartidos por TODOS los mapeadores a `DocumentoReporte`
 * (`reportes/mapeadores-documento-reporte.ts`, `ingresos/mapeadores-documento-ingreso.ts`,
 * `salidas/mapeadores-documento-salida.ts`).
 *
 * Viven en `interfaces/http/comunes` —y no en `aplicacion` ni en `dominio`— porque son
 * PRESENTACIÓN pura: convierten números y fechas en el texto que se imprime en un archivo. El
 * dominio no formatea moneda; el caso de uso ya devolvió sus cifras.
 *
 * Existen como módulo propio (US11/T120) por una razón concreta: hasta esta tanda estas
 * funciones eran privadas de `mapeadores-documento-reporte.ts`, y los mapeadores nuevos de
 * ingresos y salidas las necesitan IGUALES. Copiarlas habría dejado tres definiciones de
 * `Intl.NumberFormat` que podrían derivar y hacer que el mismo valor se viera distinto según
 * qué archivo lo exportara.
 *
 * Criterio de cada formato (research R11: COP, locale `es-CO`, zona `America/Bogota`):
 * replican EXACTAMENTE lo que hace `frontend/src/lib/formato.ts` en pantalla. El backend no
 * importa código del frontend (docs/arquitectura.md §2), así que la misma llamada a `Intl` se
 * escribe aquí — ese es el mecanismo por el que "exportar = lo que se ve en pantalla" (SC-007)
 * se cumple también en el TEXTO, no solo en las cifras.
 */

/** Moneda COP con el mismo `Intl.NumberFormat` que `formatoMoneda` del frontend. */
const FORMATEADOR_MONEDA = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' });

/** `4000000` → `"$ 4.000.000"`. */
export function formatoMonedaCop(valor: number): string {
  return FORMATEADOR_MONEDA.format(valor);
}

/** Fecha SOLO DÍA en huso `UTC` — mismo criterio que `formatoFecha` del frontend: las fechas de
 *  filtro, de salida y de factura son columnas `DATE`, que Postgres serializa como medianoche
 *  UTC; usar `America/Bogota` las mostraría un día antes. */
const FORMATEADOR_FECHA = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** `2026-08-01T00:00:00.000Z` → `"01/08/2026"`. */
export function formatoFechaSoloDia(fecha: string | Date): string {
  return FORMATEADOR_FECHA.format(new Date(fecha));
}

/** Fecha Y HORA en zona `America/Bogota` — para instantes reales (`timestamptz`), como
 *  `fecha_confirmacion` de una salida, donde la hora sí es información del documento. Mismo
 *  criterio que `formatoFechaHora` del frontend. */
const FORMATEADOR_FECHA_HORA = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  dateStyle: 'short',
  timeStyle: 'short',
});

/** `2026-08-01T15:04:00.000Z` → `"1/08/2026, 10:04 a. m."`. */
export function formatoFechaHoraBogota(fecha: string | Date): string {
  return FORMATEADOR_FECHA_HORA.format(new Date(fecha));
}

/** `0.4` → `"40%"` — redondeado al entero más cercano, igual que el frontend. */
export function formatoPorcentaje(valor: number): string {
  return `${Math.round(valor * 100)}%`;
}

/** Marca de "este filtro no se aplicó". Es un centinela INTERNO de esta capa: los mapeadores lo
 *  producen y `soloFiltrosAplicados` lo elimina antes de construir el `DocumentoReporte`. */
export const SIN_FILTRO = 'Sin filtro';

/** Texto de un filtro de fecha opcional para `filtrosAplicados` — `SIN_FILTRO` si no se
 *  aplicó (contrato del `DocumentoReporte`: solo texto ya formateado para mostrar). */
export function textoFechaFiltro(fechaIso: string | null | undefined): string {
  return fechaIso ? formatoFechaSoloDia(fechaIso) : SIN_FILTRO;
}

/** Texto de un filtro opcional cualquiera — `SIN_FILTRO` cuando no se aplicó. */
export function textoFiltroOpcional(valor: string | number | null | undefined): string {
  return valor === null || valor === undefined || valor === '' ? SIN_FILTRO : String(valor);
}

/**
 * Deja en `filtrosAplicados` SOLO los filtros que de verdad se aplicaron.
 *
 * El campo se llama "filtros aplicados", y un reporte sin filtrar imprimía en la cabecera del
 * PDF `Desde: Sin filtro | Hasta: Sin filtro | Tipo: Sin filtro | Usuario: Sin filtro |
 * Cliente: Sin filtro | Proyecto: Sin filtro`: seis veces la misma no-información, que estorba
 * justo donde se busca de un vistazo el contexto del reporte. Quitarlos no pierde nada — que un
 * filtro no aparezca ES la forma de decir que no se aplicó.
 *
 * El descarte se hace AQUÍ, en la capa que sabe qué significa cada valor, y no en el exportador:
 * las estrategias de `ExportadorReporte` solo pintan los pares que reciben, nunca interpretan su
 * significado (TSDoc del puerto).
 */
export function soloFiltrosAplicados(filtros: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(filtros).filter(([, valor]) => valor !== SIN_FILTRO));
}
