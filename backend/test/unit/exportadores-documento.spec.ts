/**
 * Pruebas unitarias de las DOS estrategias de `ExportadorReporte` (T119, US11) — sin BD, sin
 * NestJS levantado: los adaptadores de exportación son transformaciones puras de un
 * `DocumentoReporte` a bytes (research R10).
 *
 * Qué se prueba aquí y no en integración:
 *
 * 1. **FR-068 — el logo NUNCA impide generar el archivo.** Un logo con la firma correcta de PNG
 *    pero el cuerpo corrupto (lo que quedaría en `clientes.logo` tras una escritura truncada, o
 *    tras restaurar un respaldo a medias) hace que `pdfkit` falle al incrustarlo. El PDF debe
 *    salir IGUAL, sin logo. Es el caso que la tarea pide cubrir explícitamente y que por
 *    definición NO se puede provocar desde el endpoint de carga, porque ese endpoint valida los
 *    bytes antes de guardarlos: solo se puede ejercitar aquí y sembrando la BD a mano
 *    (`test/integracion/export-procesos.spec.ts` hace lo segundo).
 * 2. **La cabecera de documento (`encabezado`, FR-065) no rompe la grilla del xlsx**: los 4
 *    reportes que NO la declaran conservan su fila de encabezados en la fila 1 (invariante de
 *    T074), y un documento que SÍ la declara la escribe arriba, con una fila en blanco de
 *    separación, sin perder ninguna fila de datos.
 * 3. **El logo se incrusta de verdad** cuando los bytes son válidos, y NO se incrusta cuando el
 *    documento no lo trae (export multi-cliente, US11-AS4).
 *
 * El xlsx se relee con `exceljs` en un `Workbook` NUEVO (nunca reutilizando el del adaptador),
 * mismo criterio que `test/integracion/export.spec.ts`. El PDF no se parsea: basta la firma
 * `%PDF-` y comparar TAMAÑOS entre variantes del mismo documento, que es una forma directa de
 * verificar si el logo terminó dentro del archivo o no, sin depender de un parser de PDF.
 */
import { deflateSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import type { DocumentoReporte } from '../../src/aplicacion/reportes/puertos/exportador-reporte';
import { ExportadorExcel } from '../../src/infraestructura/exportacion/exportador-excel';
import { ExportadorPdf } from '../../src/infraestructura/exportacion/exportador-pdf';

describe('Estrategias de exportación con logo y cabecera (T119, US11)', () => {
  const exportadorExcel = new ExportadorExcel();
  const exportadorPdf = new ExportadorPdf();

  describe('FR-068: el logo nunca impide que el archivo se genere', () => {
    it('PDF: un logo CORRUPTO (firma PNG válida, cuerpo ilegible) produce el MISMO PDF que sin logo — nunca un error', async () => {
      const sinLogo = await exportadorPdf.generar(documentoDePrueba());
      const conLogoValido = await exportadorPdf.generar(conLogo(pngValido()));
      const conLogoCorrupto = await exportadorPdf.generar(conLogo(pngCorrupto()));

      expect(conLogoCorrupto.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      // Un logo VÁLIDO agranda el archivo (los bytes de la imagen viajan dentro)...
      expect(conLogoValido.length).toBeGreaterThan(sinLogo.length);
      // ...y uno corrupto produce exactamente el mismo archivo que no pasarle logo: la
      // decoración se descartó y el contenido de datos quedó intacto (FR-068).
      expect(conLogoCorrupto.length).toBe(sinLogo.length);
    });

    it('Excel: con un logo CORRUPTO genera igual un libro válido con TODAS sus filas de datos', async () => {
      const hoja = await primeraHoja(await exportadorExcel.generar(conLogo(pngCorrupto())));

      expect(valoresFila(hoja, 1, 3)).toEqual(['SKU', 'Descripción', 'Valor']);
      expect(valoresFila(hoja, 2, 3)).toEqual(['CEM-001', 'Cemento gris', 1000]);
      expect(valoresFila(hoja, 3, 3)).toEqual(['VAR-002', 'Varilla 1/2', 2000]);
    });
  });

  describe('FR-067: el logo se incrusta solo cuando el documento lo trae', () => {
    it('Excel: con un PNG válido el libro contiene la imagen; sin logo, ninguna (US11-AS4)', async () => {
      const libroConLogo = await cargarLibro(await exportadorExcel.generar(conLogo(pngValido())));
      expect(libroConLogo.worksheets[0]?.getImages()).toHaveLength(1);

      const libroSinLogo = await cargarLibro(await exportadorExcel.generar(documentoDePrueba()));
      expect(libroSinLogo.worksheets[0]?.getImages()).toHaveLength(0);
    });

    it('Excel: la imagen flota fuera de la grilla — no desplaza ni tapa ninguna fila de datos', async () => {
      const hoja = await primeraHoja(await exportadorExcel.generar(conLogo(pngValido())));

      // Mismas filas que sin logo: encabezados en la 1, datos en la 2 y la 3.
      expect(hoja.rowCount).toBe(3);
      expect(hoja.getRow(1).getCell(2).value).toBe('Descripción');
      expect(hoja.getRow(3).getCell(3).value).toBe(2000);
    });
  });

  describe('FR-065: la cabecera del documento se escribe en el xlsx sin romper la grilla', () => {
    it('sin `encabezado` (los 4 reportes) la fila de encabezados sigue siendo la fila 1 — invariante de T074', async () => {
      const hoja = await primeraHoja(await exportadorExcel.generar(documentoDePrueba()));

      expect(valoresFila(hoja, 1, 3)).toEqual(['SKU', 'Descripción', 'Valor']);
      expect(valoresFila(hoja, 2, 3)).toEqual(['CEM-001', 'Cemento gris', 1000]);
      expect(hoja.getRow(3).getCell(1).value).toBe('VAR-002');
      expect(hoja.rowCount).toBe(3);
    });

    it('con `encabezado` lo escribe arriba, deja una fila en blanco y NO pierde filas de datos ni totales', async () => {
      const documento = documentoDePrueba({
        encabezado: [
          { etiqueta: 'Proveedor', valor: 'Ferretería El Tornillo' },
          { etiqueta: 'Estado', valor: 'Recibido' },
          { etiqueta: 'Registró', valor: 'Usuario N.º 7' },
        ],
        totales: [{ etiqueta: 'Valor total', valor: '$ 3.000' }],
      });

      const hoja = await primeraHoja(await exportadorExcel.generar(documento));

      expect(valoresFila(hoja, 1, 2)).toEqual(['Proveedor', 'Ferretería El Tornillo']);
      expect(valoresFila(hoja, 2, 2)).toEqual(['Estado', 'Recibido']);
      expect(valoresFila(hoja, 3, 2)).toEqual(['Registró', 'Usuario N.º 7']);
      // Fila 4 en blanco (separación); fila 5, los encabezados de la tabla.
      expect(valoresFila(hoja, 5, 3)).toEqual(['SKU', 'Descripción', 'Valor']);
      expect(valoresFila(hoja, 6, 3)).toEqual(['CEM-001', 'Cemento gris', 1000]);
      expect(valoresFila(hoja, 7, 3)).toEqual(['VAR-002', 'Varilla 1/2', 2000]);
      expect(hoja.getRow(8).getCell(1).value).toBe('Valor total');
      expect(hoja.rowCount).toBe(8);
    });

    it('con `encabezado` y logo a la vez, el PDF también se genera (documento individual de un cliente)', async () => {
      const pdf = await exportadorPdf.generar({
        ...conLogo(pngValido()),
        encabezado: [{ etiqueta: 'Cliente', valor: 'Constructora Jumbo' }],
      });

      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });
  });
});

/** Documento tabular mínimo (2 filas + 1 total), al que cada prueba le agrega lo que ejercita. */
function documentoDePrueba(extra: Partial<DocumentoReporte> = {}): DocumentoReporte {
  return {
    titulo: 'Documento de prueba',
    generadoEn: new Date('2026-08-12T10:00:00Z'),
    filtrosAplicados: {},
    columnas: [
      { clave: 'sku', etiqueta: 'SKU' },
      { clave: 'descripcion', etiqueta: 'Descripción' },
      { clave: 'valor', etiqueta: 'Valor', alineacion: 'derecha' },
    ],
    filas: [
      { sku: 'CEM-001', descripcion: 'Cemento gris', valor: 1000 },
      { sku: 'VAR-002', descripcion: 'Varilla 1/2', valor: 2000 },
    ],
    ...extra,
  };
}

/** El documento de prueba con un logo PNG adjunto. */
function conLogo(contenido: Uint8Array): DocumentoReporte {
  return documentoDePrueba({ logo: { contenido, tipoMime: 'image/png' } });
}

/**
 * PNG REAL de 1×1 píxel, construido byte a byte (firma + IHDR + IDAT + IEND con sus CRC32): la
 * prueba no depende de ningún binario en el repositorio ni de un blob base64 opaco, y
 * cualquiera puede verificar leyendo esta función que es un PNG legítimo.
 */
function pngValido(): Uint8Array {
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const datosIhdr = Buffer.alloc(13);
  datosIhdr.writeUInt32BE(1, 0); // ancho
  datosIhdr.writeUInt32BE(1, 4); // alto
  datosIhdr[8] = 8; // profundidad de bits
  datosIhdr[9] = 2; // tipo de color: RGB (10..12 = compresión/filtro/entrelazado, todos 0)

  // Un scanline: byte de filtro (0) + un píxel RGB, comprimido con zlib (como exige el formato).
  const datosIdat = deflateSync(Buffer.from([0x00, 0xff, 0x00, 0x00]));

  return Uint8Array.from(
    Buffer.concat([firma, trozoPng('IHDR', datosIhdr), trozoPng('IDAT', datosIdat), trozoPng('IEND', Buffer.alloc(0))]),
  );
}

/** Un "chunk" PNG: longitud (4B) + tipo (4B) + datos + CRC32 de (tipo + datos). */
function trozoPng(tipo: string, datos: Buffer): Buffer {
  const longitud = Buffer.alloc(4);
  longitud.writeUInt32BE(datos.length, 0);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([longitud, cuerpo, crc]);
}

/** CRC-32 (polinomio estándar de PNG/zlib) — implementación directa, sin dependencias. */
function crc32(datos: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of datos) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Bytes con la FIRMA de un PNG y basura detrás: pasan la validación de formato por números
 *  mágicos (`servicio-imagen-logo.ts`) pero ninguna librería puede decodificarlos — el caso
 *  "el logo falla su lectura" de FR-068. */
function pngCorrupto(): Uint8Array {
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('no soy un png', 'latin1'),
    ]),
  );
}

/** Relee un xlsx en un `Workbook` NUEVO — ver TSDoc de `cargarLibroXlsx` en
 *  `test/integracion/export.spec.ts` para el porqué del cast (los tipos de `exceljs` declaran su
 *  propia interfaz `Buffer`, que sombrea la de Node). */
async function cargarLibro(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer as unknown as Parameters<typeof libro.xlsx.load>[0]);
  return libro;
}

/** Primera hoja del xlsx recién releído. */
async function primeraHoja(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const libro = await cargarLibro(buffer);
  const hoja = libro.worksheets[0];
  if (!hoja) throw new Error('El xlsx generado no tiene ninguna hoja.');
  return hoja;
}

/** Valores de las celdas 1..`cantidadColumnas` de una fila (mismo helper que export.spec.ts). */
function valoresFila(hoja: ExcelJS.Worksheet, numeroFila: number, cantidadColumnas: number): unknown[] {
  const fila = hoja.getRow(numeroFila);
  const valores: unknown[] = [];
  for (let columna = 1; columna <= cantidadColumnas; columna += 1) {
    valores.push(fila.getCell(columna).value);
  }
  return valores;
}
