/**
 * Forma de la API de productos consumida por selectores del frontend
 * (`GET /api/productos?buscar=` — extensión T035 de contracts/api-rest.md § Productos,
 * ampliada en T052 con `ultimoCosto`/`disponible` para el formulario de salidas: el precio
 * de referencia de una línea se prellena con `ultimoCosto` y las líneas dinámicas muestran
 * el `disponible` real por producto, FR-020/FR-028). Vive en `tipos/` (no en
 * `esquemas/productos.ts`) porque no es un cuerpo de entrada validado con Zod, sino la forma
 * de una RESPUESTA — mismo criterio que `Paginado<T>`/`ApiError` en `tipos/api.ts`.
 */

/** Estado de un producto del catálogo — INACTIVO es baja lógica, nunca se elimina (FR-012).
 *  Espejo de `EstadoProducto` en `backend/src/dominio/entidades/producto.ts`. */
export type EstadoProducto = 'ACTIVO' | 'INACTIVO';

export interface ProductoResumen {
  id: number;
  sku: string;
  descripcion: string;
  ultimoCosto: number;
  disponible: number;
}

/**
 * Fila con error del resultado de una carga masiva (US8) — `fila` es el número REAL de fila
 * del Excel (1 = encabezado; la primera fila de datos es la 2), para que el usuario la ubique
 * directo en su archivo sin contar filas a mano.
 */
export interface ErrorFilaImportacion {
  fila: number;
  mensaje: string;
}

/**
 * Forma de la respuesta `POST /api/productos/importar` (contracts/api-rest.md § Carga masiva
 * de inventario, FR-048…FR-051). Reporta el resultado COMPLETO fila por fila — nunca un
 * mensaje genérico de éxito (FR-051): `errores` puede convivir con `creados`/`actualizados`
 * mayores a cero en la MISMA respuesta (procesamiento parcial, US8-AS3).
 */
export interface ResumenImportacion {
  creados: number;
  actualizados: number;
  conStockInicial: number;
  /**
   * Cuántas filas cambiaron REALMENTE el costo del producto (US12, FR-074): solo cuenta las
   * que traían un "Valor unitario" distinto del costo vigente — una fila con el mismo costo,
   * o con la columna vacía, no suma aquí ni deja registro en el historial. Existe para
   * responder la pregunta con la que se descarga el catálogo: "¿cuántos precios cambió mi
   * archivo?" (contracts/api-rest.md § Historial de costos del producto).
   */
  costosActualizados: number;
  errores: ErrorFilaImportacion[];
}
