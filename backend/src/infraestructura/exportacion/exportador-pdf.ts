/**
 * Estrategia `ExportadorPdf` — implementa el puerto `ExportadorReporte` con `pdfmake`
 * (research R8, patrón Strategy, docs/arquitectura.md §3). Genera título, línea de filtros
 * aplicados, fecha/hora de generación, tabla con encabezado y filas, y fila(s) de `totales`
 * en negrita al final de la misma tabla. Sin `filas` -> IGUAL genera un PDF válido con
 * encabezados y tabla vacía (FR-043 — nunca lanza por reporte vacío).
 *
 * `pdfmake` en Node exige registrar las variantes (normal/bold/italics/bolditalics) de cada
 * fuente que use el documento. En vez de depender de archivos `.ttf` propios del proyecto (o
 * de una descarga externa), se reutilizan los TTF de Roboto que el propio paquete `pdfmake`
 * embebe en `pdfmake/build/vfs_fonts` (base64) — se decodifican una sola vez a `Buffer` en
 * memoria al construir el adaptador; `pdfkit` (motor de bajo nivel de `pdfmake`) acepta un
 * `Buffer` de datos de fuente igual que aceptaría una ruta de archivo.
 *
 * ## US11 (T119): `encabezado` y `logo`
 *
 * - `encabezado` (documentos individuales, FR-065) se pinta como una tabla sin bordes de dos
 *   columnas (etiqueta en negrita / valor) entre la meta y la tabla de líneas.
 * - `logo` (FR-067) va en la esquina superior derecha, en la misma fila que el título, vía
 *   data URI base64 (la forma en que `pdfmake` acepta imágenes sin sistema de archivos).
 *
 * Regla dura FR-068: si la incrustación del logo falla —bytes truncados o corruptos, que
 * `pdfkit` rechaza al construir el documento— el PDF se genera IGUAL sin logo. `generar`
 * reintenta sin logo antes de dejar propagar nada; un error que no dependa del logo vuelve a
 * ocurrir en el reintento y sí se propaga.
 *
 * Implementa: FR-043, FR-065, FR-067, FR-068.
 */
import { Injectable } from '@nestjs/common';
import PdfPrinter from 'pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { DocumentoReporte, ExportadorReporte } from '../../aplicacion/reportes/puertos/exportador-reporte';

/** Fuentes Roboto embebidas por `pdfmake`, decodificadas de base64 a `Buffer` (ver TSDoc). */
const FUENTES_ROBOTO = {
  Roboto: {
    normal: Buffer.from(vfsFonts['Roboto-Regular.ttf'] ?? '', 'base64'),
    bold: Buffer.from(vfsFonts['Roboto-Medium.ttf'] ?? '', 'base64'),
    italics: Buffer.from(vfsFonts['Roboto-Italic.ttf'] ?? '', 'base64'),
    bolditalics: Buffer.from(vfsFonts['Roboto-MediumItalic.ttf'] ?? '', 'base64'),
  },
};

/** Formateador de fecha/hora de generación (zona horaria del negocio, research R11). */
const FORMATO_FECHA_GENERACION = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  dateStyle: 'short',
  timeStyle: 'short',
});

/** Ancho (en puntos) con el que se incrusta el logo — `pdfmake` deduce el alto conservando la
 *  proporción, así que un logo apaisado y uno cuadrado se ven bien con el mismo valor. */
const ANCHO_LOGO_PT = 110;

@Injectable()
export class ExportadorPdf implements ExportadorReporte {
  private readonly impresora = new PdfPrinter(FUENTES_ROBOTO);

  /**
   * Genera el PDF. Si falla CON logo, reintenta SIN logo antes de propagar (FR-068): el
   * archivo con los datos siempre vale más que el fallo por una imagen.
   */
  async generar(documento: DocumentoReporte): Promise<Buffer> {
    try {
      return await this.imprimir(documento);
    } catch (error) {
      if (!documento.logo) throw error;
      return this.imprimir({ ...documento, logo: undefined });
    }
  }

  /** Construye y serializa el PDF de `documento` tal cual llega (sin ninguna red de seguridad
   *  — esa vive en `generar`). */
  private imprimir(documento: DocumentoReporte): Promise<Buffer> {
    const definicion = construirDefinicionDocumento(documento);
    const documentoPdf = this.impresora.createPdfKitDocument(definicion);

    return new Promise<Buffer>((resolve, reject) => {
      const trozos: Buffer[] = [];
      documentoPdf.on('data', (trozo: Buffer) => trozos.push(trozo));
      documentoPdf.on('end', () => resolve(Buffer.concat(trozos)));
      documentoPdf.on('error', reject);
      documentoPdf.end();
    });
  }
}

/** Arma la definición pdfmake: título (con logo a la derecha), filtros aplicados, fecha de
 *  generación, cabecera del documento si la hay, y tabla de líneas. */
function construirDefinicionDocumento(documento: DocumentoReporte): TDocumentDefinitions {
  const contenido: Content[] = [
    construirBloqueTitulo(documento),
    ...construirBloqueEncabezado(documento),
    {
      table: {
        headerRows: 1,
        widths: documento.columnas.map((columna) => (columna.alineacion === 'derecha' ? 'auto' : '*')),
        body: construirCuerpoTabla(documento),
      },
      layout: 'lightHorizontalLines',
    },
  ];

  return {
    content: contenido,
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    styles: {
      titulo: { fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
      filtros: { fontSize: 9, color: '#555555', margin: [0, 0, 0, 2] },
      meta: { fontSize: 8, color: '#777777', margin: [0, 0, 0, 12] },
    },
  };
}

/**
 * Título + filtros + fecha de generación a la izquierda y, si el documento trae logo, la
 * imagen del cliente a la derecha (FR-067). Sin logo se emite el MISMO bloque en una sola
 * columna, para que la maqueta de los 4 reportes existentes no cambie.
 *
 * La línea de filtros se omite cuando no hay ninguno (documentos individuales, cuyo contexto
 * va en `encabezado`): "Sin filtros aplicados" solo tiene sentido en un listado filtrable.
 */
function construirBloqueTitulo(documento: DocumentoReporte): Content {
  const textos: Content[] = [{ text: documento.titulo, style: 'titulo' }];
  if (Object.keys(documento.filtrosAplicados).length > 0) {
    textos.push({ text: lineaFiltrosAplicados(documento.filtrosAplicados), style: 'filtros' });
  }
  textos.push({ text: `Generado: ${FORMATO_FECHA_GENERACION.format(documento.generadoEn)}`, style: 'meta' });

  if (!documento.logo) return { stack: textos };

  return {
    columns: [
      { width: '*', stack: textos },
      // La imagen va ANIDADA en un `stack` a propósito: `ContentImage.width` significa "ancho
      // de la imagen en pt" y `ColumnProperties.width` significa "ancho de la columna"; puestas
      // en el mismo objeto se intersecan y obligan a un único número para las dos cosas. Con el
      // `stack` intermedio, la columna se mide con `auto` y la imagen conserva su proporción
      // dentro del recuadro de `fit`.
      {
        width: 'auto',
        alignment: 'right',
        margin: [0, 0, 0, 12],
        stack: [{ image: aDataUri(documento.logo), fit: [ANCHO_LOGO_PT, ANCHO_LOGO_PT] }],
      },
    ],
  };
}

/** Cabecera de un documento individual (FR-065) como tabla sin bordes etiqueta/valor. Vacío
 *  para los reportes tabulares, que no declaran `encabezado`. */
function construirBloqueEncabezado(documento: DocumentoReporte): Content[] {
  const encabezado = documento.encabezado ?? [];
  if (encabezado.length === 0) return [];

  return [
    {
      table: {
        widths: ['auto', '*'],
        body: encabezado.map((dato) => [
          { text: dato.etiqueta, bold: true },
          { text: dato.valor },
        ]),
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 12],
    },
  ];
}

/** Data URI base64 del logo — la forma en que `pdfmake` acepta imágenes sin tocar disco. */
function aDataUri(logo: { contenido: Uint8Array; tipoMime: string }): string {
  return `data:${logo.tipoMime};base64,${Buffer.from(logo.contenido).toString('base64')}`;
}

/** "Cliente: Jumbo | Desde: 01/06/2026" — une los filtros ya formateados por el mapeador. */
function lineaFiltrosAplicados(filtros: Record<string, string>): string {
  const pares = Object.entries(filtros).map(([etiqueta, valor]) => `${etiqueta}: ${valor}`);
  return pares.length > 0 ? pares.join(' | ') : 'Sin filtros aplicados';
}

/** Encabezado (bold) + filas de datos + fila(s) de `totales` (bold) al final de la tabla. */
function construirCuerpoTabla(documento: DocumentoReporte): TableCell[][] {
  const filaEncabezado: TableCell[] = documento.columnas.map((columna) => ({
    text: columna.etiqueta,
    bold: true,
    alignment: columna.alineacion === 'derecha' ? 'right' : 'left',
  }));

  const filasDatos: TableCell[][] = documento.filas.map((fila) =>
    documento.columnas.map((columna) => ({
      text: formatearCeldaTexto(fila[columna.clave]),
      alignment: columna.alineacion === 'derecha' ? 'right' : 'left',
    })),
  );

  const filasTotales: TableCell[][] = (documento.totales ?? []).map((total) =>
    documento.columnas.map((columna, indice) => ({
      text: indice === 0 ? total.etiqueta : indice === documento.columnas.length - 1 ? total.valor : '',
      bold: true,
      alignment: columna.alineacion === 'derecha' ? 'right' : 'left',
    })),
  );

  return [filaEncabezado, ...filasDatos, ...filasTotales];
}

/** Números con separador de miles (`es-CO`); el resto, texto tal cual. */
function formatearCeldaTexto(valor: string | number | undefined): string {
  if (valor === undefined) return '';
  return typeof valor === 'number' ? valor.toLocaleString('es-CO') : valor;
}
