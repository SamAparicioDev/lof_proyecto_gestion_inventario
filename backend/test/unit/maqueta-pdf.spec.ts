/**
 * Pruebas de MAQUETA del PDF (FR-043 — «el reporte exportado sale completo»).
 *
 * ## Por qué existe este archivo
 *
 * El reporte de inventario y el de movimientos tienen 9 columnas. Maquetados en A4 vertical,
 * la tabla medía más que el papel y la última columna («Valor total») se dibujaba ENTERA fuera
 * de la hoja: invisible en pantalla y en la impresora. Lo traicionero es que el texto SÍ queda
 * escrito en el archivo, así que una prueba que solo extraiga texto del PDF encuentra la
 * columna y da el reporte por correcto. Por eso aquí no se busca texto: se comprueban las dos
 * cosas que el fallo violaba y que se pueden medir sin parser.
 *
 *  1. **La tabla cabe en el papel** (`medirMaquetaTabla`). En `pdfmake` un `width` numérico es
 *     el ancho del CONTENIDO de la celda y el relleno lateral se suma por fuera; olvidarlo es
 *     exactamente lo que hacía la tabla 108 pt más ancha que la hoja.
 *  2. **La orientación se adapta al número de columnas**, leyendo el `/MediaBox` del PDF ya
 *     generado — el dato real del archivo, no lo que creemos haberle pedido a `pdfmake`.
 */
import type { ColumnaDocumentoReporte, DocumentoReporte } from '../../src/aplicacion/reportes/puertos/exportador-reporte';
import { ExportadorPdf, medirMaquetaTabla } from '../../src/infraestructura/exportacion/exportador-pdf';

/** Tolerancia al comparar puntos: los anchos salen de divisiones en coma flotante. */
const TOLERANCIA_PT = 0.5;

describe('Maqueta del PDF exportado (FR-043)', () => {
  const exportadorPdf = new ExportadorPdf();

  describe('la tabla nunca es más ancha que la página', () => {
    it.each([2, 3, 4, 6, 7, 9, 12])('con %i columnas', (numeroColumnas) => {
      const { anchoTabla, anchoUtilPagina } = medirMaquetaTabla(documentoDe(numeroColumnas));

      expect(anchoTabla).toBeLessThanOrEqual(anchoUtilPagina + TOLERANCIA_PT);
    });

    it('aprovecha TODO el ancho disponible (no deja la tabla flotando estrecha)', () => {
      const { anchoTabla, anchoUtilPagina } = medirMaquetaTabla(documentoDe(9));

      expect(anchoTabla).toBeGreaterThanOrEqual(anchoUtilPagina - TOLERANCIA_PT);
    });

    it('sigue cabiendo cuando TODAS las columnas son numéricas con importes muy largos', () => {
      const documento = documentoDe(9, { todasNumericas: true, valorLargo: true });
      const { anchoTabla, anchoUtilPagina } = medirMaquetaTabla(documento);

      expect(anchoTabla).toBeLessThanOrEqual(anchoUtilPagina + TOLERANCIA_PT);
    });

    it('deja sitio real a las columnas de texto aunque los importes sean larguísimos', () => {
      // El caso que motiva `PROPORCION_MAXIMA_NUMERICAS`: sin tope, los importes se comerían el
      // ancho y la descripción quedaría en un hilo ilegible de dos caracteres por línea.
      const documento = documentoDe(9, { valorLargo: true });
      const { anchoTabla, anchoUtilPagina } = medirMaquetaTabla(documento);

      expect(anchoTabla).toBeLessThanOrEqual(anchoUtilPagina + TOLERANCIA_PT);
    });
  });

  describe('orientación según el número de columnas (leída del PDF generado)', () => {
    it('un reporte ANCHO (9 columnas: inventario, movimientos) se imprime apaisado', async () => {
      const { ancho, alto } = await medirPaginaDelPdf(await exportadorPdf.generar(documentoDe(9)));

      expect(ancho).toBeGreaterThan(alto);
    });

    it('un reporte ESTRECHO (4 columnas: consumo por cliente) se imprime vertical', async () => {
      const { ancho, alto } = await medirPaginaDelPdf(await exportadorPdf.generar(documentoDe(4)));

      expect(alto).toBeGreaterThan(ancho);
    });
  });

  it('un reporte SIN filas sigue generando un PDF válido (FR-043)', async () => {
    const pdf = await exportadorPdf.generar({ ...documentoDe(9), filas: [], totales: undefined });

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

/** Documento tabular con `numeroColumnas` columnas y contenido largo de verdad — el contenido
 *  corto nunca desborda nada y no probaría lo que interesa. */
function documentoDe(
  numeroColumnas: number,
  opciones: { todasNumericas?: boolean; valorLargo?: boolean } = {},
): DocumentoReporte {
  const columnas: ColumnaDocumentoReporte[] = Array.from({ length: numeroColumnas }, (_, indice) => ({
    clave: `c${indice}`,
    etiqueta: `Encabezado de columna ${indice}`,
    // Por defecto, una de cada tres es numérica (proporción parecida a la de los reportes reales).
    ...(opciones.todasNumericas || indice % 3 === 2 ? { alineacion: 'derecha' as const } : {}),
  }));

  const valorNumerico = opciones.valorLargo ? '$ 15.432.098.765.432' : '$ 1.234.567';

  return {
    titulo: 'Reporte de prueba de maqueta',
    generadoEn: new Date('2026-08-12T10:00:00Z'),
    filtrosAplicados: { Categoría: 'Ferretería y fijaciones industriales' },
    columnas,
    filas: Array.from({ length: 3 }, () =>
      Object.fromEntries(
        columnas.map((columna) => [
          columna.clave,
          columna.alineacion === 'derecha'
            ? valorNumerico
            : 'Tornillo autoperforante cabeza hexagonal galvanizado 1/4 x 2 pulgadas',
        ]),
      ),
    ),
    totales: [{ etiqueta: 'Valor total del inventario valorizado', valor: valorNumerico }],
  };
}

/** Tamaño de página REAL del PDF, leído de su `/MediaBox` (sin dependencias de parseo). */
async function medirPaginaDelPdf(pdf: Buffer): Promise<{ ancho: number; alto: number }> {
  const mediaBox = /\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
  if (!mediaBox) throw new Error('El PDF generado no declara /MediaBox');

  return { ancho: Number(mediaBox[1]), alto: Number(mediaBox[2]) };
}
