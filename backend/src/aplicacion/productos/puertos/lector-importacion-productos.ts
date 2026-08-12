/**
 * Puerto `LectorImportacionProductos` — lee y valida las filas de un archivo de carga masiva
 * de inventario (US8, T094) visto desde la capa de aplicación (patrón Strategy/Adapter, mismo
 * criterio que `ExportadorReporte` en `aplicacion/reportes/puertos/exportador-reporte.ts`,
 * docs/arquitectura.md §3). Implementado por
 * `infraestructura/importacion/leer-filas-importacion-productos.ts` (exceljs).
 *
 * Por qué existe este puerto (y no un import directo): `ImportarProductosCasoUso` vive en
 * `aplicacion/` y la regla de dependencia (docs/arquitectura.md §2, reforzada por
 * `backend/eslint.config.mjs`) le PROHÍBE importar `infraestructura/*` — solo puede depender
 * de `dominio` y `@trazo/compartido`. Este puerto es la frontera: describe la FORMA del
 * resultado que el caso de uso necesita para decidir crear/actualizar productos y agrupar el
 * `Ingreso` sintético, sin que la capa de aplicación conozca `exceljs`. De regalo, habilita
 * las pruebas unitarias de T098 (`puertos falsos en memoria`, sin construir un `.xlsx` real
 * por caso de prueba).
 *
 * Implementa: FR-048 (plantilla — ver `generarPlantillaProductos`, sin puerto propio por ser
 * una función pura sin estado usada solo desde el controlador), FR-049…FR-051.
 */
import type { FilaImportacionProducto } from '@trazo/compartido';

/** Fila ya validada en FORMA, lista para que el caso de uso decida crear/actualizar el producto. */
export interface FilaValidaImportacionProducto {
  /** Número de fila real del Excel (1 = encabezado; la primera fila de datos es la 2). */
  readonly numeroFila: number;
  readonly datos: FilaImportacionProducto;
}

/** Fila inválida, con su mensaje en español listo para `ResumenImportacion.errores`. */
export interface ErrorFilaImportacionProducto {
  readonly fila: number;
  readonly mensaje: string;
}

/** Resultado de leer el archivo: filas listas para procesar + errores ya detectados en la lectura. */
export interface ResultadoLecturaImportacionProductos {
  readonly filasValidas: FilaValidaImportacionProducto[];
  readonly erroresIniciales: ErrorFilaImportacionProducto[];
}

export interface LectorImportacionProductos {
  /**
   * Lee y valida el archivo `.xlsx` de carga masiva de inventario. Lanza
   * `ErrorValidacionDominio` (`dominio/comunes/errores.ts`) si el archivo no es un `.xlsx`
   * legible, no tiene la hoja de datos esperada, o no contiene ninguna fila de datos —
   * en cualquiera de esos casos el caso de uso NUNCA debe llegar a tocar el catálogo
   * (US8-AS5, FR-051).
   */
  leer(archivo: Buffer): Promise<ResultadoLecturaImportacionProductos>;
}

/** Token de inyección de NestJS para el puerto `LectorImportacionProductos`. */
export const LECTOR_IMPORTACION_PRODUCTOS = 'LectorImportacionProductos';
