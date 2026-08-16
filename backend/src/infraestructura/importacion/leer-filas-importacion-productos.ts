/**
 * Lee y valida las filas de la hoja "Productos" de un archivo de carga masiva de inventario
 * (US8, T093), consumido por el caso de uso `ImportarProductosCasoUso` (T094) — este archivo
 * NO decide crear/actualizar productos ni toca el stock, solo transforma el `.xlsx` recibido
 * en filas ya validadas o ya señaladas como inválidas, para que el caso de uso continúe
 * exactamente desde ahí (FR-049, FR-051).
 *
 * Lee las columnas por POSICIÓN (1=SKU … 7=Valor unitario), en el mismo orden que
 * `generar-plantilla-productos.ts` — nunca por texto de encabezado, para no depender de que
 * el usuario conserve el título exacto de cada columna.
 *
 * Reglas que aplica antes de devolver el resultado:
 * - Rechaza (lanza `ErrorValidacionDominio`, sin tocar ningún producto) si el buffer no es un
 *   `.xlsx` legible, si falta la hoja "Productos", o si no hay ninguna fila de datos —
 *   US8-AS5.
 * - Cada fila de datos (desde la fila 2) se valida con `esquemaFilaImportacionProducto`
 *   (`@trazo/compartido`) — la MISMA autoridad de validación que el alta manual (FR-049,
 *   FR-050).
 * - Detecta SKU repetido DENTRO del propio archivo: la primera ocurrencia se procesa: las
 *   repeticiones posteriores se reportan como fila inválida, sin mezclarlas (edge case de
 *   spec.md).
 * - Rechaza la fila cuando una columna numérica llega como TEXTO con separadores de miles
 *   (`22.500`): las dos lecturas posibles se llevan mil veces entre sí y ninguna se puede
 *   suponer — ver `valorNumerico`/`NUMERO_CON_SEPARADOR_AMBIGUO`.
 * - El procesamiento es SIEMPRE parcial a nivel de fila: una fila inválida no impide leer las
 *   demás (FR-051) — los errores se acumulan en `erroresIniciales` y se devuelven junto con
 *   las filas válidas.
 *
 * También expone `LectorImportacionProductosExcel`, la implementación `@Injectable()` del
 * puerto `LectorImportacionProductos` (`aplicacion/productos/puertos/`) que
 * `ImportarProductosCasoUso` (T094) consume por inyección — la capa de aplicación no puede
 * importar este archivo directamente (regla de dependencia, `backend/eslint.config.mjs`), así
 * que las formas `FilaValidaImportacionProducto`/`ErrorFilaImportacionProducto`/
 * `ResultadoLecturaImportacionProductos` viven en el puerto y este archivo las reexporta para
 * no duplicar la definición.
 */
import { Injectable } from '@nestjs/common';
import { esquemaFilaImportacionProducto } from '@trazo/compartido';
import ExcelJS from 'exceljs';
import type {
  ErrorFilaImportacionProducto,
  FilaValidaImportacionProducto,
  LectorImportacionProductos,
  ResultadoLecturaImportacionProductos,
} from '../../aplicacion/productos/puertos/lector-importacion-productos';
import { ErrorValidacionDominio } from '../../dominio/comunes/errores';
import { ENCABEZADOS_PRODUCTOS_IMPORTACION, HOJA_PRODUCTOS_IMPORTACION } from './generar-plantilla-productos';

export type {
  ErrorFilaImportacionProducto,
  FilaValidaImportacionProducto,
  ResultadoLecturaImportacionProductos,
} from '../../aplicacion/productos/puertos/lector-importacion-productos';

/** Primera fila con datos de la hoja "Productos" — la fila 1 es el encabezado. */
const PRIMERA_FILA_DE_DATOS = 2;

/** Posición (1-based) de cada columna de la hoja "Productos" — ver `generar-plantilla-productos.ts`. */
const COLUMNA_SKU = 1;
const COLUMNA_DESCRIPCION = 2;
const COLUMNA_CATEGORIA = 3;
const COLUMNA_UBICACION = 4;
const COLUMNA_UMBRAL_STOCK_BAJO = 5;
const COLUMNA_CANTIDAD_INICIAL = 6;
const COLUMNA_VALOR_UNITARIO = 7;
/** US17 (FR-104): al FINAL de las importables para no correr las posiciones de los archivos
 *  que los usuarios ya tienen guardados — ver `ENCABEZADOS_PRODUCTOS_IMPORTACION`. */
const COLUMNA_UNIDAD_MEDIDA = 8;
const COLUMNAS_DE_DATOS = [
  COLUMNA_SKU,
  COLUMNA_DESCRIPCION,
  COLUMNA_CATEGORIA,
  COLUMNA_UBICACION,
  COLUMNA_UMBRAL_STOCK_BAJO,
  COLUMNA_CANTIDAD_INICIAL,
  COLUMNA_VALOR_UNITARIO,
  COLUMNA_UNIDAD_MEDIDA,
];

/**
 * Lee y valida la hoja "Productos" de `archivo`. Lanza `ErrorValidacionDominio` si el archivo
 * no es un `.xlsx` legible, no tiene la hoja "Productos", o no contiene ninguna fila de datos
 * — en cualquiera de esos casos el caso de uso NUNCA debe llegar a tocar el catálogo
 * (US8-AS5). Implementa: FR-048…FR-051.
 */
export async function leerFilasImportacionProductos(archivo: Buffer): Promise<ResultadoLecturaImportacionProductos> {
  const hoja = await cargarHojaProductos(archivo);

  const filasValidas: FilaValidaImportacionProducto[] = [];
  const erroresIniciales: ErrorFilaImportacionProducto[] = [];
  const primeraFilaPorSku = new Map<string, number>();

  for (let numeroFila = PRIMERA_FILA_DE_DATOS; numeroFila <= hoja.rowCount; numeroFila++) {
    const fila = hoja.getRow(numeroFila);
    if (filaSinDatos(fila)) continue;

    procesarFilaDeDatos(fila, numeroFila, primeraFilaPorSku, filasValidas, erroresIniciales);
  }

  if (filasValidas.length === 0 && erroresIniciales.length === 0) {
    throw new ErrorValidacionDominio('El archivo no tiene filas de datos para procesar.');
  }

  return { filasValidas, erroresIniciales };
}

/**
 * Carga el buffer con `exceljs` y devuelve la hoja "Productos" ya verificada.
 *
 * El cast `unknown` en `load(...)` atraviesa una discrepancia de tipos de terceros: el
 * `Buffer` de `@types/node` no es estructuralmente el `Buffer`/`ArrayBuffer` que declara
 * `exceljs` (mismo caso documentado en `test/integracion/export.spec.ts`, función
 * `cargarLibroXlsx`), aunque en tiempo de ejecución es exactamente lo que `exceljs` espera.
 */
async function cargarHojaProductos(archivo: Buffer): Promise<ExcelJS.Worksheet> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(archivo as unknown as Parameters<typeof libro.xlsx.load>[0]);
  } catch {
    throw new ErrorValidacionDominio('El archivo no es un Excel (.xlsx) válido.');
  }

  const hoja = libro.getWorksheet(HOJA_PRODUCTOS_IMPORTACION);
  if (!hoja) {
    throw new ErrorValidacionDominio(
      `El archivo no contiene la hoja "${HOJA_PRODUCTOS_IMPORTACION}" esperada por la plantilla de carga masiva.`,
    );
  }
  return hoja;
}

/** Valida una fila de datos con `esquemaFilaImportacionProducto` y detecta SKU repetido. */
function procesarFilaDeDatos(
  fila: ExcelJS.Row,
  numeroFila: number,
  primeraFilaPorSku: Map<string, number>,
  filasValidas: FilaValidaImportacionProducto[],
  erroresIniciales: ErrorFilaImportacionProducto[],
): void {
  // Las tres columnas numéricas se leen ANTES del esquema porque una celda ambigua no tiene
  // ningún valor que pasarle a Zod: no se puede validar lo que no se sabe cuánto vale.
  const numericos = leerColumnasNumericas(fila);
  if (!numericos.ok) {
    erroresIniciales.push({ fila: numeroFila, mensaje: numericos.mensaje });
    return;
  }

  const resultado = esquemaFilaImportacionProducto.safeParse({
    sku: valorTexto(fila, COLUMNA_SKU),
    descripcion: valorTexto(fila, COLUMNA_DESCRIPCION),
    categoria: valorTexto(fila, COLUMNA_CATEGORIA),
    unidadMedida: valorTexto(fila, COLUMNA_UNIDAD_MEDIDA),
    ubicacion: valorTexto(fila, COLUMNA_UBICACION),
    umbralStockBajo: numericos.umbralStockBajo,
    cantidadInicial: numericos.cantidadInicial,
    valorUnitario: numericos.valorUnitario,
  });

  if (!resultado.success) {
    const primerError = resultado.error.issues[0];
    erroresIniciales.push({ fila: numeroFila, mensaje: primerError?.message ?? 'La fila no es válida.' });
    return;
  }

  const filaConElMismoSku = primeraFilaPorSku.get(resultado.data.sku);
  if (filaConElMismoSku !== undefined) {
    erroresIniciales.push({
      fila: numeroFila,
      mensaje: `El SKU "${resultado.data.sku}" está repetido en el archivo (ya aparece en la fila ${filaConElMismoSku}).`,
    });
    return;
  }

  primeraFilaPorSku.set(resultado.data.sku, numeroFila);
  filasValidas.push({ numeroFila, datos: resultado.data });
}

/** `true` si NINGUNA de las columnas de datos de la fila tiene contenido — fila de relleno a ignorar. */
function filaSinDatos(fila: ExcelJS.Row): boolean {
  return COLUMNAS_DE_DATOS.every((columna) => valorCrudo(fila, columna) === undefined);
}

/** Valor crudo de una celda, normalizado a `undefined` cuando está vacía (fórmulas/texto enriquecido incluidos). */
function valorCrudo(fila: ExcelJS.Row, columna: number): unknown {
  const valor = fila.getCell(columna).value;
  if (valor === null || valor === undefined) return undefined;

  if (typeof valor === 'object' && !(valor instanceof Date)) {
    if ('result' in valor) {
      const resultado = (valor as ExcelJS.CellFormulaValue).result;
      return resultado === null || resultado === undefined ? undefined : resultado;
    }
    if ('richText' in valor) {
      const texto = (valor as ExcelJS.CellRichTextValue).richText.map((parte) => parte.text).join('');
      return texto.trim() === '' ? undefined : texto;
    }
    if ('text' in valor) {
      const texto = (valor as ExcelJS.CellHyperlinkValue).text;
      return texto?.trim() === '' ? undefined : texto;
    }
  }
  return valor;
}

/** Celda leída como texto recortado; cadena vacía se normaliza a `undefined` (campo opcional/ausente). */
function valorTexto(fila: ExcelJS.Row, columna: number): string | undefined {
  const crudo = valorCrudo(fila, columna);
  if (crudo === undefined) return undefined;
  const texto = String(crudo).trim();
  return texto === '' ? undefined : texto;
}

/**
 * Texto que un humano lee como número de DOS maneras incompatibles según de dónde venga el
 * archivo: `22.500` son 22500 con el separador de miles de es-CO y 22,5 con el separador decimal
 * de en-US; `22,500`, exactamente al revés. La forma es siempre la misma —1 a 3 dígitos y
 * después grupos de EXACTAMENTE 3 dígitos separados por `.` o `,`, con un decimal final
 * opcional—, así que se puede reconocer sin adivinar cuál de las dos lecturas quiso el usuario.
 *
 * `22.5` o `1234.500` NO entran aquí: no tienen forma de agrupación de miles, así que su punto
 * solo puede ser decimal y se convierten con normalidad.
 */
const NUMERO_CON_SEPARADOR_AMBIGUO = /^[+-]?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?$/;

/** Lectura de una celda numérica: el valor listo para el esquema, o el motivo por el que la
 *  celda no se puede interpretar sin adivinar (ver `NUMERO_CON_SEPARADOR_AMBIGUO`). */
type LecturaNumerica = { readonly ok: true; readonly valor: unknown } | { readonly ok: false; readonly mensaje: string };

/** Las tres columnas numéricas de la fila ya leídas, o el primer motivo (de izquierda a derecha,
 *  el mismo orden en que se leen las columnas) por el que la fila no se puede procesar. */
type LecturaColumnasNumericas =
  | {
      readonly ok: true;
      readonly umbralStockBajo: unknown;
      readonly cantidadInicial: unknown;
      readonly valorUnitario: unknown;
    }
  | { readonly ok: false; readonly mensaje: string };

/** Lee las tres columnas numéricas de una fila; corta en la primera que sea ambigua. */
function leerColumnasNumericas(fila: ExcelJS.Row): LecturaColumnasNumericas {
  const umbralStockBajo = valorNumerico(fila, COLUMNA_UMBRAL_STOCK_BAJO);
  if (!umbralStockBajo.ok) return umbralStockBajo;
  const cantidadInicial = valorNumerico(fila, COLUMNA_CANTIDAD_INICIAL);
  if (!cantidadInicial.ok) return cantidadInicial;
  const valorUnitario = valorNumerico(fila, COLUMNA_VALOR_UNITARIO);
  if (!valorUnitario.ok) return valorUnitario;

  return {
    ok: true,
    umbralStockBajo: umbralStockBajo.valor,
    cantidadInicial: cantidadInicial.valor,
    valorUnitario: valorUnitario.valor,
  };
}

/**
 * Celda leída como número. Si ya es un número, se devuelve tal cual; si es texto convertible
 * (ej. "10"), se convierte; si es texto NO convertible (ej. "diez"), se devuelve el texto
 * original SIN convertir para que `esquemaFilaImportacionProducto` reporte el mensaje de tipo
 * inválido en español, en vez de que el parser silencie el dato incorrecto.
 *
 * Y si el texto trae separadores con forma de miles (`22.500`, `1.234,56`) se RECHAZA la fila:
 * `Number("22.500")` vale 22,5, así que convertirlo guardaría el costo dividido por mil sin un
 * solo aviso. Desde US12 esta columna es el canal de corrección masiva de precios (FR-070: se
 * descarga el catálogo con el costo actual, se edita en Excel y se vuelve a subir), y el
 * historial de costos presentaría ese destrozo como un cambio querido, con usuario y fecha
 * (FR-072). Entre adivinar el separador y no entregar el dato, se rechaza la fila —el resto del
 * archivo se procesa igual (FR-051)— explicando cómo escribirlo.
 */
function valorNumerico(fila: ExcelJS.Row, columna: number): LecturaNumerica {
  const crudo = valorCrudo(fila, columna);
  if (crudo === undefined || typeof crudo === 'number') return { ok: true, valor: crudo };
  if (typeof crudo === 'string') {
    const texto = crudo.trim();
    if (texto === '') return { ok: true, valor: undefined };
    if (NUMERO_CON_SEPARADOR_AMBIGUO.test(texto)) {
      return { ok: false, mensaje: mensajeSeparadorAmbiguo(texto, columna) };
    }
    const numero = Number(texto);
    return { ok: true, valor: Number.isNaN(numero) ? crudo : numero };
  }
  return { ok: true, valor: crudo };
}

/** Explica en español, y con la corrección esperada (FR-047), por qué no se puede leer la celda. */
function mensajeSeparadorAmbiguo(texto: string, columna: number): string {
  return (
    `El texto "${texto}" de la columna "${etiquetaDeColumna(columna)}" no se puede leer como número sin ambigüedad: ` +
    'el punto o la coma pueden ser separador de miles (22.500 = 22500) o separador decimal (22.500 = 22,5). ' +
    'Escribe el número sin separadores de miles (22500, o 22500.75 si tiene decimales) o dale formato de número a la celda.'
  );
}

/** Título que la plantilla escribe en la fila 1 para esa columna — solo para redactar mensajes;
 *  la lectura sigue siendo por POSICIÓN (ver `ENCABEZADOS_PRODUCTOS_IMPORTACION`). */
function etiquetaDeColumna(columna: number): string {
  return ENCABEZADOS_PRODUCTOS_IMPORTACION[columna - 1] ?? `columna ${columna}`;
}

/**
 * Implementación `@Injectable()` del puerto `LectorImportacionProductos`
 * (`aplicacion/productos/puertos/lector-importacion-productos.ts`) — adapter delgado que
 * delega en `leerFilasImportacionProductos` (la función pura de este mismo archivo, ya
 * verificada en T093). Registrada bajo el token `LECTOR_IMPORTACION_PRODUCTOS` en
 * `importacion.module.ts`, mismo patrón que `ExportadorExcel`/`ExportadorPdf` con
 * `ExportadorReporte` (docs/arquitectura.md §3).
 */
@Injectable()
export class LectorImportacionProductosExcel implements LectorImportacionProductos {
  leer(archivo: Buffer): Promise<ResultadoLecturaImportacionProductos> {
    return leerFilasImportacionProductos(archivo);
  }
}
