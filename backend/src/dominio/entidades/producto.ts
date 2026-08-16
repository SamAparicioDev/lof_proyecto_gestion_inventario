/**
 * Entidad de dominio `Producto` — TypeScript puro (Principio VI, NO NEGOCIABLE).
 *
 * Campos espejo de la tabla `productos` de `data-model.md`, pero como tipo PROPIO del
 * dominio: no importa el modelo/enum generado por Prisma (docs/arquitectura.md §2, regla
 * de dependencia). El adaptador `infraestructura/persistencia/repositorio-productos.prisma.ts`
 * traduce explícitamente entre el registro Prisma y esta forma.
 *
 * `stockActual` es el valor CRUDO de la columna — esta entidad NO calcula `comprometido`
 * ni `disponible` (esos valores derivados dependen de las salidas `PENDIENTE`, que no
 * existen hasta la historia US3; se agregan en esa tarea, no antes — Principio V, YAGNI).
 *
 * Implementa: FR-010 (alta de producto con SKU/descripción/ubicación/umbral de stock bajo),
 * FR-012 (baja lógica vía `estado`, nunca DELETE), FR-020 (base de la ficha de inventario) y
 * FR-052/FR-086 (`categoria`: nació en US8 como texto libre y desde US15 es una referencia al
 * catálogo de categorías — sigue siendo OPCIONAL, pero ya no se escribe a mano).
 */

/** Estado de un producto del catálogo — INACTIVO es baja lógica, nunca se elimina (FR-012). */
export type EstadoProducto = 'ACTIVO' | 'INACTIVO';

export interface Producto {
  readonly id: number;
  readonly sku: string;
  readonly descripcion: string;
  /** Referencia al catálogo (US15). Se lleva el nombre además del id porque TODAS las
   *  pantallas que muestran un producto muestran el nombre, y resolverlo aparte obligaría a una
   *  segunda consulta por fila. */
  readonly categoria: { readonly id: number; readonly nombre: string } | null;
  /**
   * En qué se mide (US17, FR-102/FR-103). Viaja con la ABREVIATURA además del nombre porque es
   * lo que se imprime junto a una cantidad, que es donde la unidad hace falta.
   *
   * `null` SOLO en los productos anteriores a US17: desde esa historia el alta y la edición la
   * exigen. La base de datos la admite nula a propósito — ver `data-model.md § unidades_medida`.
   */
  readonly unidadMedida: { readonly id: number; readonly nombre: string; readonly abreviatura: string } | null;
  readonly ubicacion: string | null;
  readonly umbralStockBajo: number;
  readonly stockActual: number;
  readonly ultimoCosto: number;
  readonly fechaUltimoMovimiento: Date | null;
  readonly estado: EstadoProducto;
}

/**
 * `true` si el `disponible` de un producto está en o por debajo de su umbral de stock bajo
 * (FR-022, US5-AS2). Función pura de dominio — es la ÚNICA fuente de verdad de este criterio:
 * `listar-inventario.caso-uso.ts` (US5) la usa contra `disponible = stockActual −
 * comprometido` (nunca contra `stockActual` crudo, que es lo que compara el filtro interno
 * `soloStockBajo` de `RepositorioProductos.listar` — ver TSDoc de ese puerto) para marcar el
 * flag `stockBajo` de cada fila y para filtrar cuando `soloStockBajo` viene activo. El
 * frontend puede reimplementar el mismo `disponible <= umbralStockBajo` para resaltar visualmente
 * sin esperar respuesta del servidor, pero el valor persistido/filtrado en la API sale de aquí.
 */
export function esStockBajo(disponible: number, umbralStockBajo: number): boolean {
  return disponible <= umbralStockBajo;
}
