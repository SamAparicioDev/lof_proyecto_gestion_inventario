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
 * FR-052 (campo `categoria`, texto libre opcional, agregado en US8 — mismo criterio que
 * `ubicacion`, sin catálogo propio de categorías en v1).
 */

/** Estado de un producto del catálogo — INACTIVO es baja lógica, nunca se elimina (FR-012). */
export type EstadoProducto = 'ACTIVO' | 'INACTIVO';

export interface Producto {
  readonly id: number;
  readonly sku: string;
  readonly descripcion: string;
  readonly categoria: string | null;
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
