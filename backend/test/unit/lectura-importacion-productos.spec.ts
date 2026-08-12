/**
 * Pruebas unitarias de `leerFilasImportacionProductos` — el lector de la hoja "Productos" de la
 * carga masiva (T093). Es una transformación pura de bytes `.xlsx` a filas validadas: no toca BD
 * ni NestJS, así que se prueba aquí y no en integración (research R10, mismo criterio que
 * `exportadores-documento.spec.ts`).
 *
 * ## Qué se fija aquí: cómo se lee una celda NUMÉRICA
 *
 * Corrección de la revisión adversarial de la Tanda 14 (hallazgo HIGH). `Number("22.500")` vale
 * **22,5**: mientras "Valor unitario" solo alimentaba el ingreso sintético de stock inicial, una
 * celda de texto con el separador de miles de es-CO se colaba como un precio mil veces menor; desde
 * US12 esa MISMA columna reescribe el costo de cualquier producto del catálogo (FR-070: descargar
 * el catálogo, corregir precios en Excel y volver a subirlo), así que el error corrompía la
 * valorización del inventario y quedaba blanqueado en `historial_costos_producto` como un cambio
 * querido, con usuario y fecha (FR-072).
 *
 * La regla que se prueba: un texto con FORMA de separador de miles (`22.500`, `1.234,56`) no se
 * convierte NUNCA —sus dos lecturas posibles se llevan mil veces entre sí y ninguna se puede
 * suponer—, se rechaza la fila con un mensaje en español que nombra la columna y dice cómo
 * escribir el número (FR-047); un texto sin ambigüedad (`10`, `22.5`) se sigue convirtiendo como
 * antes; y el rechazo es SIEMPRE de una fila, nunca del archivo (FR-051).
 */
import ExcelJS from 'exceljs';
import {
  leerFilasImportacionProductos,
  type ResultadoLecturaImportacionProductos,
} from '../../src/infraestructura/importacion/leer-filas-importacion-productos';

/** Una fila de la hoja "Productos" tal como se escribe en el archivo: cada celda puede llevar un
 *  número (lo normal), un texto (lo que ocurre cuando la columna tiene formato de texto o el
 *  valor se pegó desde otro sitio) o quedar vacía. */
type CeldaImportacion = string | number | null;

/** Layout POSICIONAL de la hoja que lee `leerFilasImportacionProductos` (SKU, Descripción,
 *  Categoría, Ubicación, Umbral stock bajo, Cantidad inicial, Valor unitario). */
async function construirArchivo(filas: CeldaImportacion[][]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Productos');
  hoja.addRow(['SKU', 'Descripción', 'Categoría', 'Ubicación', 'Umbral stock bajo', 'Cantidad inicial', 'Valor unitario']);
  for (const fila of filas) {
    hoja.addRow(fila);
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** Fila completa con un "Valor unitario" concreto — el resto de columnas en su valor mínimo válido. */
function filaConValorUnitario(sku: string, valorUnitario: CeldaImportacion): CeldaImportacion[] {
  return [sku, `Producto ${sku}`, null, null, null, null, valorUnitario];
}

/** Lee el archivo y devuelve el resultado ya listo para afirmar sobre él. */
async function leer(filas: CeldaImportacion[][]): Promise<ResultadoLecturaImportacionProductos> {
  return leerFilasImportacionProductos(await construirArchivo(filas));
}

describe('leerFilasImportacionProductos — celdas numéricas escritas como TEXTO', () => {
  it('RECHAZA la fila cuyo "Valor unitario" es texto con separador de miles, en vez de guardarlo dividido por mil', async () => {
    const resultado = await leer([filaConValorUnitario('ADV-TXT', '22.500')]);

    expect(resultado.filasValidas).toHaveLength(0);
    expect(resultado.erroresIniciales).toHaveLength(1);
    const error = resultado.erroresIniciales[0];
    expect(error?.fila).toBe(2);
    // El mensaje (español, FR-047) cita el texto exacto y NOMBRA la columna, para que el usuario
    // sepa qué celda abrir de las siete.
    expect(error?.mensaje).toContain('"22.500"');
    expect(error?.mensaje).toContain('Valor unitario');
    expect(error?.mensaje).toContain('sin separadores de miles');
  });

  it('rechaza igual el separador de miles con coma y el formato completo con decimales', async () => {
    const resultado = await leer([
      filaConValorUnitario('ADV-COMA', '22,500'),
      filaConValorUnitario('ADV-COMPLETO', '1.234,56'),
      filaConValorUnitario('ADV-MILLON', '1.234.567'),
    ]);

    expect(resultado.filasValidas).toHaveLength(0);
    expect(resultado.erroresIniciales.map((error) => error.fila)).toEqual([2, 3, 4]);
  });

  it('vigila las TRES columnas numéricas, no solo el costo (una cantidad mil veces menor también miente)', async () => {
    const porUmbral = await leer([['ADV-UMBRAL', 'Umbral con miles', null, null, '1.200', null, null]]);
    expect(porUmbral.filasValidas).toHaveLength(0);
    expect(porUmbral.erroresIniciales[0]?.mensaje).toContain('Umbral stock bajo');

    const porCantidad = await leer([['ADV-CANT', 'Cantidad con miles', null, null, null, '1.500', 2000]]);
    expect(porCantidad.filasValidas).toHaveLength(0);
    expect(porCantidad.erroresIniciales[0]?.mensaje).toContain('Cantidad inicial');
  });

  it('el rechazo es de la FILA, nunca del archivo: las demás se leen igual (FR-051)', async () => {
    const resultado = await leer([
      filaConValorUnitario('OK-ANTES', 15000),
      filaConValorUnitario('ADV-MEDIO', '22.500'),
      filaConValorUnitario('OK-DESPUES', 18000),
    ]);

    expect(resultado.filasValidas.map((fila) => fila.datos.sku)).toEqual(['OK-ANTES', 'OK-DESPUES']);
    expect(resultado.erroresIniciales.map((error) => error.fila)).toEqual([3]);
  });
});

describe('leerFilasImportacionProductos — celdas numéricas que SÍ se pueden leer', () => {
  it('un número de verdad (el caso normal: lo que escribe el catálogo descargado) llega intacto', async () => {
    const resultado = await leer([filaConValorUnitario('NUM-001', 22500)]);

    expect(resultado.erroresIniciales).toHaveLength(0);
    expect(resultado.filasValidas[0]?.datos.valorUnitario).toBe(22500);
  });

  it('un texto SIN ambigüedad se sigue convirtiendo: "10" es 10 y "22.5" es 22,5 (no hay agrupación de miles posible)', async () => {
    const resultado = await leer([filaConValorUnitario('TXT-ENTERO', '10'), filaConValorUnitario('TXT-DECIMAL', '22.5')]);

    expect(resultado.erroresIniciales).toHaveLength(0);
    expect(resultado.filasValidas.map((fila) => fila.datos.valorUnitario)).toEqual([10, 22.5]);
  });

  it('un texto que no es un número ("diez") sigue reportando el mensaje de tipo del esquema, en español', async () => {
    const resultado = await leer([filaConValorUnitario('TXT-PALABRA', 'diez')]);

    expect(resultado.filasValidas).toHaveLength(0);
    expect(resultado.erroresIniciales[0]?.mensaje).toBe('El valor unitario debe ser un número');
  });

  it('la columna vacía sigue significando "no lo toques" (FR-074), no cero', async () => {
    const resultado = await leer([filaConValorUnitario('SIN-COSTO', null)]);

    expect(resultado.erroresIniciales).toHaveLength(0);
    expect(resultado.filasValidas[0]?.datos.valorUnitario).toBeUndefined();
  });
});
