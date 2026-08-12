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
 * ## Maqueta: «exportable» no basta, tiene que VERSE
 *
 * FR-043 pide que el reporte se exporte completo, y un PDF cuyo contenido no cabe en la hoja no
 * lo cumple aunque el archivo se genere sin errores. Los reportes de inventario y movimientos
 * tienen 9 columnas: en A4 vertical la tabla medía más que el papel y la última columna se
 * dibujaba ENTERA fuera de la hoja — invisible al abrirlo y al imprimirlo, pero presente en el
 * flujo de contenido, así que una extracción de texto la encontraba y daba el archivo por bueno.
 *
 * De ahí las reglas de `construirDefinicionDocumento` y `calcularAnchosColumnas` (cada una con
 * su porqué en su TSDoc): orientación según el número de columnas, anchos calculados en puntos
 * descontando el relleno de celda, importes que nunca se parten, encabezado repetido en cada
 * página, filas que no se cortan entre páginas y pie «Página X de Y».
 * `test/unit/maqueta-pdf.spec.ts` vigila el invariante; el contrato lo documenta en
 * `contracts/api-rest.md` §«Maqueta del PDF».
 *
 * Implementa: FR-043, FR-065, FR-067, FR-068.
 */
import { Injectable } from '@nestjs/common';
import PdfPrinter from 'pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts';
import type { Content, ContentTable, CustomTableLayout, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
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

/**
 * A partir de cuántas columnas el documento se imprime APAISADO.
 *
 * El motivo es aritmético, no estético: un A4 vertical deja 515 pt útiles, así que un reporte
 * de 9 columnas —los de inventario y movimientos lo son— dispone de unos 57 pt por columna,
 * donde no cabe una descripción de producto ni un nombre de proyecto sin partirse en cuatro
 * líneas o quedar recortado. Apaisado sube a ~780 pt útiles (~87 pt por columna) y el mismo
 * contenido entra holgado. Los reportes de 4 y 6 columnas se quedan verticales, que es como se
 * imprimen y archivan de forma natural.
 */
const COLUMNAS_PARA_APAISAR = 7;

/** Paleta del documento impreso. A propósito NO son los tokens de Nocturne: ese sistema está
 *  pensado para pantalla sobre fondo oscuro, y un PDF se imprime sobre papel blanco. */
const COLOR_TEXTO = '#1f2430';
const COLOR_TENUE = '#6b7280';
const COLOR_LINEA = '#d7dae0';
const COLOR_ENCABEZADO_FONDO = '#eef0f6';
const COLOR_FILA_ALTERNA = '#f7f8fb';

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

/** Dimensiones útiles de un A4 en puntos, para calcular anchos de columna sin adivinar. */
const A4_LADO_CORTO_PT = 595.28;
const A4_LADO_LARGO_PT = 841.89;
const MARGEN_HORIZONTAL_PT = 32;
const MARGEN_SUPERIOR_PT = 34;
/** El margen inferior reserva sitio para el pie de página; si no, `pdfmake` lo dibujaría
 *  encima de la última fila de la tabla. */
const MARGEN_INFERIOR_PT = 44;

/** Aire a cada lado del texto dentro de la celda. Es una constante compartida —y no un número
 *  suelto en el layout— porque `calcularAnchosColumnas` TIENE que descontarlo: ver su TSDoc. */
const PADDING_CELDA_PT = 6;

/** Ancho de carácter, en múltiplos del tamaño de fuente, para estimar cuánto ocupa un importe
 *  en Roboto. Los dígitos avanzan 0,556 em y el punto separador bastante menos, así que 0,55
 *  sobreestima ligeramente — que es justo el lado seguro: sobra sitio, no falta. */
const ANCHO_CARACTER_EM = 0.55;

/** Techo del ancho total que pueden acaparar las columnas numéricas. Sin él, un reporte con
 *  muchos importes largos dejaría las descripciones en un hilo de dos caracteres por línea. */
const PROPORCION_MAXIMA_NUMERICAS = 0.55;

/**
 * Arma la definición pdfmake: título (con logo a la derecha), filtros aplicados, fecha de
 * generación, cabecera del documento si la hay, tabla de líneas y pie con la paginación.
 *
 * Las tres decisiones de maqueta que garantizan que NO se corte información (FR-043) son:
 *
 *  1. **Orientación según el número de columnas** (`COLUMNAS_PARA_APAISAR`).
 *  2. **Anchos de columna calculados en puntos**, nunca `'auto'`. Con `'auto'` `pdfmake` mide
 *     el contenido más ancho de cada columna y, si la suma supera la página, la tabla se sale
 *     del papel y lo que sobra se pierde al recortar. Repartiendo el ancho disponible en
 *     proporciones fijas la tabla mide SIEMPRE exactamente lo que cabe, y el texto largo se
 *     ajusta en varias líneas en vez de desbordarse.
 *  3. **`dontBreakRows`**, para que una fila alta (una descripción de tres líneas) salte
 *     entera a la página siguiente en lugar de partirse por la mitad entre dos páginas.
 *
 * El pie "Página X de Y" no es decorativo: es lo que le permite a quien recibe el PDF saber
 * que no le falta una hoja.
 */
function construirDefinicionDocumento(documento: DocumentoReporte): TDocumentDefinitions {
  const apaisado = documento.columnas.length >= COLUMNAS_PARA_APAISAR;
  const anchoPagina = apaisado ? A4_LADO_LARGO_PT : A4_LADO_CORTO_PT;
  const anchoUtil = anchoPagina - MARGEN_HORIZONTAL_PT * 2;
  const tamanoFuente = apaisado ? 8 : 9;
  const cuerpoTabla = construirCuerpoTabla(documento);
  const filaPrimerTotal = cuerpoTabla.length - (documento.totales?.length ?? 0);

  const contenido: Content[] = [
    construirBloqueTitulo(documento),
    ...construirBloqueEncabezado(documento),
    {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: calcularAnchosColumnas(documento, anchoUtil, tamanoFuente),
        body: cuerpoTabla,
      },
      layout: construirLayoutTabla(filaPrimerTotal),
    },
  ];

  return {
    pageSize: 'A4',
    pageOrientation: apaisado ? 'landscape' : 'portrait',
    pageMargins: [MARGEN_HORIZONTAL_PT, MARGEN_SUPERIOR_PT, MARGEN_HORIZONTAL_PT, MARGEN_INFERIOR_PT],
    content: contenido,
    footer: (paginaActual: number, totalPaginas: number): Content => ({
      margin: [MARGEN_HORIZONTAL_PT, 14, MARGEN_HORIZONTAL_PT, 0],
      columns: [
        { text: documento.titulo, style: 'pie', width: '*' },
        { text: `Página ${paginaActual} de ${totalPaginas}`, style: 'pie', width: 'auto', alignment: 'right' },
      ],
    }),
    defaultStyle: { font: 'Roboto', fontSize: tamanoFuente, color: COLOR_TEXTO, lineHeight: 1.15 },
    styles: {
      titulo: { fontSize: 15, bold: true, margin: [0, 0, 0, 5] },
      filtros: { fontSize: 8.5, color: COLOR_TENUE, margin: [0, 0, 0, 2] },
      meta: { fontSize: 8, color: COLOR_TENUE, margin: [0, 0, 0, 12] },
      pie: { fontSize: 7.5, color: COLOR_TENUE },
    },
  };
}

/**
 * Medidas de la maqueta de `documento`, EXPUESTAS para que una prueba pueda comprobar el
 * invariante de FR-043 «nada se sale de la hoja» sin necesidad de un parser de PDF.
 *
 * Se expone porque el fallo que motivó esta función era invisible desde fuera: la tabla salía
 * más ancha que el papel, la última columna se dibujaba fuera de la hoja y el PDF seguía
 * conteniendo ese texto — una extracción de texto lo encontraba y daba el archivo por bueno,
 * pero al abrirlo o imprimirlo la columna no estaba. El invariante que hay que vigilar es
 * `anchoTabla <= anchoUtilPagina`.
 */
export function medirMaquetaTabla(documento: DocumentoReporte): {
  anchoTabla: number;
  anchoUtilPagina: number;
  apaisado: boolean;
} {
  const apaisado = documento.columnas.length >= COLUMNAS_PARA_APAISAR;
  const anchoUtilPagina = (apaisado ? A4_LADO_LARGO_PT : A4_LADO_CORTO_PT) - MARGEN_HORIZONTAL_PT * 2;
  const anchos = calcularAnchosColumnas(documento, anchoUtilPagina, apaisado ? 8 : 9);
  const anchoTabla =
    anchos.reduce((suma, ancho) => suma + ancho, 0) + documento.columnas.length * PADDING_CELDA_PT * 2;

  return { anchoTabla, anchoUtilPagina, apaisado };
}

/**
 * Reparte el ancho disponible entre las columnas, de modo que la tabla mida siempre exactamente
 * lo que cabe en la página. Ver punto 2 del TSDoc de `construirDefinicionDocumento` para por qué
 * no se usa `'auto'`.
 *
 * El criterio no es el mismo para los dos tipos de columna, porque no fallan igual:
 *
 * - Una columna NUMÉRICA recibe el ancho que su contenido REALMENTE necesita (estimado a partir
 *   del texto más largo de la columna, encabezado incluido). Un importe partido en varias líneas
 *   —`$` / `15.432.098.76` / `5`— no es un texto ajustado, es una cifra rota: quien la lee tiene
 *   que recomponerla mentalmente y puede equivocarse. Las numéricas nunca deben ajustarse.
 * - Una columna de TEXTO se reparte el resto a partes iguales y sí se ajusta en varias líneas,
 *   que es el comportamiento natural y legible de una descripción larga.
 *
 * OJO con el padding: en `pdfmake` un `width` numérico es el ancho del CONTENIDO de la celda, y
 * el relleno lateral se suma por fuera. Repartir el ancho útil completo hacía una tabla
 * `anchoUtil + columnas * 2 * PADDING_CELDA_PT` de ancho —con 9 columnas, 108 pt más que el
 * papel— y la última columna terminaba fuera de la hoja: seguía escrita en el PDF (por eso una
 * extracción de texto la encuentra) pero no se ve ni se imprime. Por eso el relleno se descuenta
 * ANTES de repartir.
 */
function calcularAnchosColumnas(documento: DocumentoReporte, anchoUtil: number, tamanoFuente: number): number[] {
  const anchoParaContenido = anchoUtil - documento.columnas.length * PADDING_CELDA_PT * 2;

  // `null` marca "columna de texto": se resuelve después, con lo que sobre.
  const necesidades = documento.columnas.map((columna) =>
    columna.alineacion === 'derecha' ? anchoNecesarioColumna(documento, columna, tamanoFuente) : null,
  );

  const totalCrudo = necesidades.reduce((suma: number, ancho) => suma + (ancho ?? 0), 0);
  const columnasTexto = necesidades.filter((ancho) => ancho === null).length;

  // Sin columnas de texto que proteger, las numéricas se reparten TODO el ancho (si no, la
  // tabla quedaría flotando estrecha en medio de la hoja).
  const tope = columnasTexto === 0 ? anchoParaContenido : anchoParaContenido * PROPORCION_MAXIMA_NUMERICAS;
  const escala = totalCrudo > 0 && (totalCrudo > tope || columnasTexto === 0) ? tope / totalCrudo : 1;

  const anchosNumericos = necesidades.map((ancho) => (ancho === null ? null : ancho * escala));
  const totalNumericas = anchosNumericos.reduce((suma: number, ancho) => suma + (ancho ?? 0), 0);
  const anchoPorColumnaTexto = columnasTexto > 0 ? (anchoParaContenido - totalNumericas) / columnasTexto : 0;

  return anchosNumericos.map((ancho) => ancho ?? anchoPorColumnaTexto);
}

/** Ancho estimado que necesita una columna para que su valor más largo (encabezado incluido)
 *  quepa en UNA sola línea. Ver `ANCHO_CARACTER_EM`. */
function anchoNecesarioColumna(
  documento: DocumentoReporte,
  columna: DocumentoReporte['columnas'][number],
  tamanoFuente: number,
): number {
  const textos = [columna.etiqueta, ...documento.filas.map((fila) => formatearCeldaTexto(fila[columna.clave]))];
  const caracteres = Math.max(...textos.map((texto) => texto.length));
  return caracteres * ANCHO_CARACTER_EM * tamanoFuente;
}

/**
 * Estética de la tabla: encabezado con fondo, filas alternas muy suaves para seguir la línea
 * con la vista en un reporte ancho, líneas horizontales finas y ninguna vertical (las rejillas
 * completas ensucian y hacen ilegible un reporte de 9 columnas), y el bloque de totales
 * separado por una línea más marcada.
 *
 * `filaPrimerTotal` es el índice de la primera fila de totales dentro del cuerpo; cuando el
 * reporte no tiene totales coincide con el final de la tabla y las reglas siguen siendo
 * correctas (la línea "de separación" cae justo en el borde inferior).
 */
function construirLayoutTabla(filaPrimerTotal: number): CustomTableLayout {
  const esLineaFuerte = (i: number, node: ContentTable): boolean =>
    i === 0 || i === 1 || i === filaPrimerTotal || i === node.table.body.length;

  return {
    hLineWidth: (i, node) => (esLineaFuerte(i, node) ? 0.8 : 0.4),
    vLineWidth: () => 0,
    hLineColor: (i, node) => (esLineaFuerte(i, node) ? COLOR_TENUE : COLOR_LINEA),
    fillColor: (i) => {
      if (i === 0 || i >= filaPrimerTotal) return COLOR_ENCABEZADO_FONDO;
      return i % 2 === 0 ? COLOR_FILA_ALTERNA : null;
    },
    paddingTop: () => 5,
    paddingBottom: () => 5,
    paddingLeft: () => PADDING_CELDA_PT,
    paddingRight: () => PADDING_CELDA_PT,
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
    construirFilaTotal(total, documento.columnas.length),
  );

  return [filaEncabezado, ...filasDatos, ...filasTotales];
}

/**
 * Fila de total: la etiqueta ocupa TODAS las columnas menos la última (`colSpan`) alineada a la
 * derecha, y el importe cae en la última, justo debajo de la columna de importes.
 *
 * Antes la etiqueta se metía en la primera celda, de ~57 pt: "Valor total del inventario" no
 * cabía y se partía o se recortaba, y encima quedaba en el extremo opuesto a su propio número.
 * `colSpan` le da todo el ancho de la fila y la pega al valor que describe.
 *
 * `pdfmake` exige que tras una celda con `colSpan: n` vengan n-1 celdas vacías de relleno; si
 * faltan, descuadra el resto de la tabla.
 */
function construirFilaTotal(total: { etiqueta: string; valor: string }, numeroColumnas: number): TableCell[] {
  const columnasEtiqueta = numeroColumnas - 1;
  if (columnasEtiqueta < 1) {
    return [{ text: `${total.etiqueta}: ${total.valor}`, bold: true, alignment: 'right' }];
  }

  return [
    { text: total.etiqueta, bold: true, alignment: 'right', colSpan: columnasEtiqueta },
    ...Array.from({ length: columnasEtiqueta - 1 }, (): TableCell => ({})),
    { text: total.valor, bold: true, alignment: 'right' },
  ];
}

/** Números con separador de miles (`es-CO`); el resto, texto tal cual. */
function formatearCeldaTexto(valor: string | number | undefined): string {
  if (valor === undefined) return '';
  return typeof valor === 'number' ? valor.toLocaleString('es-CO') : valor;
}
