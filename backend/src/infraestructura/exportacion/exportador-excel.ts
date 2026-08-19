/**
 * Estrategia `ExportadorExcel` — implementa el puerto `ExportadorReporte` con `exceljs`
 * (research R8, patrón Strategy, docs/arquitectura.md §3). Encabezados en negrita, columnas
 * `alineacion: 'derecha'` con formato de celda moneda COP (`"$" #,##0`, sin decimales —
 * research R11: la UI de Trazo no maneja centavos de COP), autofiltro en la fila de
 * encabezado y fila(s) de `totales` en negrita al final. Sin `filas` -> IGUAL genera un
 * libro válido con encabezados y cero filas de datos (FR-043 — nunca lanza por reporte
 * vacío; `T074` lo verifica releyendo el archivo con `exceljs`).
 *
 * A propósito NO escribe `titulo`/`filtrosAplicados`/`generadoEn` como filas adicionales:
 * eso desplazaría la fila de encabezado (deja de ser la fila 1) y rompería el criterio de
 * `T074` de "el xlsx contiene EXACTAMENTE las filas/totales del reporte filtrado" — esos tres
 * campos sí se usan en `ExportadorPdf`, donde no hay una grilla de celdas que desplazar.
 *
 * ## US11 (T119): `encabezado` y `logo`
 *
 * - `encabezado` (documentos individuales, FR-065) SÍ se escribe como filas `etiqueta | valor`
 *   ANTES de la tabla, seguidas de una fila en blanco. Es la única forma de que un ingreso o
 *   una salida exportados a Excel lleven su cabecera y su auditoría, que es literalmente lo
 *   que FR-065 pide. Los 4 reportes NO lo declaran, así que su fila de encabezado sigue siendo
 *   la fila 1 y `T074` no cambia ni una aserción.
 * - `logo` (FR-067) se ancla en la esquina superior DERECHA, justo después de la última
 *   columna: `exceljs` posiciona las imágenes flotando sobre la grilla, así que no desplaza
 *   ninguna fila ni tapa ningún dato, y `rowCount` sigue siendo exactamente el de las filas
 *   escritas.
 *
 * Si el logo no se puede incrustar (bytes corruptos, formato que `exceljs` no digiere), el
 * libro se genera IGUAL sin él (FR-068): ver `generar`, que reintenta sin logo antes de dejar
 * fallar nada. Nunca un error por decoración.
 *
 * Implementa: FR-043, FR-065, FR-067, FR-068.
 */
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type {
  DocumentoReporte,
  ExportadorReporte,
  LogoDocumento,
} from '../../aplicacion/reportes/puertos/exportador-reporte';

/** Formato de celda de moneda COP sin decimales (research R11). */
const FORMATO_MONEDA_COP = '"$" #,##0';

/** Límite de caracteres de un nombre de hoja de Excel (restricción del formato .xlsx). */
const LONGITUD_MAXIMA_NOMBRE_HOJA = 31;

/** Caracteres que Excel prohíbe en un nombre de hoja: `\ / ? * [ ] :`. */
const CARACTERES_INVALIDOS_NOMBRE_HOJA = /[\\/*?[\]:]/g;

/** Tamaño en píxeles con el que se incrusta el logo (US11/FR-067) — un cuadro discreto en la
 *  esquina, suficiente para identificar al cliente sin competir con los datos. */
const TAMANIO_LOGO_PX = { width: 120, height: 60 } as const;

@Injectable()
export class ExportadorExcel implements ExportadorReporte {
  /**
   * Genera el libro. Si falla CON logo, reintenta SIN logo antes de propagar (FR-068): el
   * archivo con los datos siempre vale más que el fallo por una imagen. Un fallo que no
   * dependa del logo vuelve a ocurrir en el reintento y sí se propaga, como debe ser.
   */
  async generar(documento: DocumentoReporte): Promise<Buffer> {
    try {
      return await construirLibro(documento);
    } catch (error) {
      if (!documento.logo) throw error;
      return construirLibro({ ...documento, logo: undefined });
    }
  }
}

/** Escribe el libro completo: cabecera opcional, encabezados, filas, totales y logo opcional. */
async function construirLibro(documento: DocumentoReporte): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Trazo';
  libro.created = documento.generadoEn;

  const hoja = libro.addWorksheet(nombreHojaValido(documento.titulo));

  const filasDeEncabezado = agregarFilasDeEncabezado(hoja, documento);

  // `hoja.columns` fija clave/encabezado/estilo por columna; con una cabecera ya escrita
  // arriba, `exceljs` colocaría su fila de encabezado en la fila 1 pisándola, así que la fila
  // de encabezados se escribe explícitamente y `columns` se declara SIN `header`.
  hoja.columns = documento.columnas.map((columna) => ({
    key: columna.clave,
    header: filasDeEncabezado === 0 ? columna.etiqueta : undefined,
    style:
      columna.alineacion === 'derecha'
        ? { numFmt: FORMATO_MONEDA_COP, alignment: { horizontal: 'right' } }
        : undefined,
  }));

  const filaEncabezados = filasDeEncabezado + 1;
  if (filasDeEncabezado > 0) {
    const fila = hoja.getRow(filaEncabezados);
    documento.columnas.forEach((columna, indice) => {
      fila.getCell(indice + 1).value = columna.etiqueta;
    });
    fila.commit();
  }
  hoja.getRow(filaEncabezados).font = { bold: true };
  hoja.autoFilter = {
    from: { row: filaEncabezados, column: 1 },
    to: { row: filaEncabezados, column: documento.columnas.length },
  };

  for (const fila of documento.filas) {
    hoja.addRow(fila);
  }

  agregarFilasDeTotales(hoja, documento);
  agregarFilasDeFirma(hoja, documento);
  agregarLogo(libro, hoja, documento);

  const bufferGenerado = await libro.xlsx.writeBuffer();
  return Buffer.from(bufferGenerado);
}

/**
 * Escribe la cabecera de un documento individual (US11/FR-065) como filas `etiqueta | valor`
 * en negrita, más una fila en blanco de separación. Devuelve cuántas filas ocupó (0 si el
 * documento no declara `encabezado`, que es el caso de los 4 reportes).
 */
function agregarFilasDeEncabezado(hoja: ExcelJS.Worksheet, documento: DocumentoReporte): number {
  const encabezado = documento.encabezado ?? [];
  if (encabezado.length === 0) return 0;

  encabezado.forEach((dato, indice) => {
    const fila = hoja.getRow(indice + 1);
    fila.getCell(1).value = dato.etiqueta;
    fila.getCell(1).font = { bold: true };
    fila.getCell(2).value = dato.valor;
    fila.commit();
  });
  // +1 por la fila en blanco que separa la cabecera de la tabla.
  return encabezado.length + 1;
}

/** Guiones bajos de la línea de firma en Excel (US27) — el equivalente al `canvas` del PDF. */
const LARGO_LINEA_FIRMA = 42;

/** Nombre de hoja válido para Excel: sin caracteres prohibidos y máximo 31 caracteres. */
function nombreHojaValido(titulo: string): string {
  const limpio = titulo.replace(CARACTERES_INVALIDOS_NOMBRE_HOJA, '').trim();
  return (limpio || 'Reporte').slice(0, LONGITUD_MAXIMA_NOMBRE_HOJA);
}

/**
 * Escribe `totales` como fila(s) finales en negrita: la etiqueta va en la primera columna y
 * el valor (ya formateado como texto por el mapeador) en la última columna con
 * `alineacion: 'derecha'` — la misma columna donde vive el valor monetario principal del
 * reporte (ej. `valorTotal`). Si el reporte no declara ninguna columna `alineacion: 'derecha'`
 * (no debería ocurrir en los reportes de consumo, pero el adaptador no lo asume), el valor
 * cae en la última columna sin más.
 */
function agregarFilasDeTotales(hoja: ExcelJS.Worksheet, documento: DocumentoReporte): void {
  if (!documento.totales || documento.totales.length === 0) return;
  const primeraClave = documento.columnas[0]?.clave;
  if (!primeraClave) return;

  const columnaValor =
    [...documento.columnas].reverse().find((columna) => columna.alineacion === 'derecha') ??
    documento.columnas[documento.columnas.length - 1];

  for (const total of documento.totales) {
    const datosFila: Record<string, string> = { [primeraClave]: total.etiqueta };
    if (columnaValor) datosFila[columnaValor.clave] = total.valor;
    const fila = hoja.addRow(datosFila);
    fila.font = { bold: true };
  }
}

/**
 * Escribe el espacio de firma al cierre de la hoja (US27, FR-123). Ausente en todo documento que
 * no declare `firmas`, que hoy son todos menos el de una salida.
 *
 * En Excel no hay cómo dibujar una línea sobre la que firmar sin recurrir a una forma flotante,
 * así que se usa una fila de guiones bajos —que es exactamente lo que el archivo va a mostrar al
 * imprimirse— y encima dos filas en blanco para la firma. El resultado en papel es el mismo que
 * el del PDF; el medio es el que impone la diferencia.
 *
 * Va DESPUÉS de los totales y separado por una fila vacía, para que el autofiltro de la tabla no
 * lo alcance: una firma no es una fila de datos que alguien deba poder ordenar.
 */
function agregarFilasDeFirma(hoja: ExcelJS.Worksheet, documento: DocumentoReporte): void {
  const firmas = documento.firmas ?? [];
  if (firmas.length === 0) return;

  for (const firma of firmas) {
    hoja.addRow([]);
    hoja.addRow([]);
    hoja.addRow(['_'.repeat(LARGO_LINEA_FIRMA)]);
    const filaNombre = hoja.addRow([firma.nombre]);
    filaNombre.font = { bold: true };
    hoja.addRow([firma.etiqueta]);
    hoja.addRow(['Fecha: ____ / ____ / ________']);
  }
}

/**
 * Incrusta el logo del cliente flotando en la esquina superior derecha, después de la última
 * columna de datos (US11/FR-067) — así no desplaza filas (`rowCount` no cambia) ni tapa
 * ninguna celda con contenido.
 *
 * `tl` usa el sistema de coordenadas base-0 de `exceljs` (columna/fila 0 = la primera).
 */
function agregarLogo(libro: ExcelJS.Workbook, hoja: ExcelJS.Worksheet, documento: DocumentoReporte): void {
  const logo = documento.logo;
  if (!logo) return;

  const idImagen = libro.addImage({
    buffer: Buffer.from(logo.contenido) as unknown as ExcelJS.Buffer,
    extension: extensionDeImagen(logo),
  });
  hoja.addImage(idImagen, {
    tl: { col: documento.columnas.length, row: 0 },
    ext: { ...TAMANIO_LOGO_PX },
  });
}

/** Extensión que `exceljs` espera en `addImage` a partir del tipo MIME ya validado. */
function extensionDeImagen(logo: LogoDocumento): 'png' | 'jpeg' {
  return logo.tipoMime === 'image/png' ? 'png' : 'jpeg';
}
