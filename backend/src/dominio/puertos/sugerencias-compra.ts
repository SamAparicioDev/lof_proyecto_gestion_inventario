/**
 * Puerto `SugerenciasCompra` — la consulta que responde "¿qué le pido hoy a este proveedor?"
 * (US16, FR-098).
 *
 * Vive en su propio puerto y no dentro de `RepositorioOrdenesCompra` por la "I" de SOLID
 * (docs/arquitectura.md §4): no es persistencia de órdenes, es una lectura CRUZADA sobre
 * productos e ingresos que ninguna otra operación del módulo necesita. Meterla ahí obligaría a
 * cualquier implementación del repositorio —incluido un falso en memoria de una prueba— a
 * arrastrar una consulta que no le hace falta.
 *
 * La regla de negocio de la sugerencia (cuánto pedir) NO vive aquí sino en
 * `entidades/orden-compra.ts` (`cantidadSugeridaDeCompra`): este puerto solo trae los hechos
 * —qué está bajo umbral y quién lo ha suministrado— y el adaptador aplica esa función pura.
 */

/** Una propuesta de línea de orden. Trae el PORQUÉ a la vista (`disponible` contra
 *  `umbralStockBajo`) para que el usuario no tenga que confiar a ciegas en la cantidad. */
export interface SugerenciaCompra {
  readonly productoId: number;
  readonly sku: string;
  readonly descripcion: string;
  readonly disponible: number;
  readonly umbralStockBajo: number;
  readonly cantidadSugerida: number;
  /** El último costo conocido del producto — lo último que se pagó por él. */
  readonly precioSugerido: number;
}

export interface SugerenciasCompra {
  /**
   * Productos ACTIVOS bajo umbral (`disponible <= umbralStockBajo`, misma regla que el
   * inventario) **que ese proveedor ya haya suministrado** en algún ingreso anterior.
   *
   * La restricción por proveedor es lo que hace útil la sugerencia: una lista con todo el
   * inventario bajo mínimos mezclaría productos que ese proveedor no vende, y el usuario
   * tendría que filtrarla a mano cada vez, que es justo el trabajo que se quiere ahorrar.
   *
   * Una lista vacía es una respuesta legítima: significa que a ese proveedor no hay nada que
   * pedirle hoy.
   */
  paraProveedor(proveedorId: number): Promise<SugerenciaCompra[]>;
}

export const SUGERENCIAS_COMPRA = 'SugerenciasCompra';
