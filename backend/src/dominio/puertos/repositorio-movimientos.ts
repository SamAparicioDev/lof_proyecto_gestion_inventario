/**
 * Puerto `RepositorioMovimientos` — acceso de SOLO LECTURA a la persistencia de
 * `movimientos_inventario` visto desde el dominio (patrón Repository, docs/arquitectura.md
 * §3). Implementado por `infraestructura/persistencia/repositorio-movimientos.prisma.ts`.
 *
 * Por qué solo lectura: `movimientos_inventario` es INMUTABLE (trigger de BD, Principio
 * II/FR-046) — los `INSERT` ya viven dentro de las transacciones atómicas de
 * `RepositorioIngresos.recibir`/`anular` y `RepositorioSalidas.confirmar`/`anular`
 * (research R4). Este puerto no expone ningún método de escritura a propósito: no hay nada
 * que este repositorio deba insertar.
 *
 * Origen (preparación US5, T059): el primer método, `listarPorProducto`, es lo que necesita
 * `historial-producto.caso-uso.ts` para la ficha de producto (FR-024). El TSDoc original
 * anticipaba esta extensión para US7 (Phase 9, reporte de movimientos general —
 * `GET /api/reportes/movimientos`); `listar` es ese segundo método: mismos datos, sin
 * `productoId` obligatorio y con los filtros que pide el contrato de US7 (tipo, usuario,
 * cliente/proyecto), sin tocar `listarPorProducto`.
 *
 * Implementa: FR-024 (historial de movimientos por producto, más reciente primero) y FR-042
 * (reporte general de movimientos filtrable).
 */
import type { MovimientoInventario, TipoMovimientoInventario } from '../entidades/movimiento-inventario';

/** Filtros del historial de movimientos de un producto (US5/FR-024) — paginación siempre
 *  obligatoria (Principio V, rendimiento). `desde`/`hasta` filtran por `fecha_hora`. */
export interface FiltrosListarMovimientos {
  readonly desde?: Date;
  readonly hasta?: Date;
  readonly pagina: number;
  readonly porPagina: number;
}

/** Página de movimientos (mismo shape que `Paginado<T>` de `@trazo/compartido`, sin
 *  importarlo: el dominio no depende de ningún paquete externo — docs/arquitectura.md §2). */
export interface PaginaMovimientos {
  readonly datos: MovimientoInventario[];
  readonly total: number;
}

/**
 * Filtros del reporte general de movimientos (US7/FR-042): a diferencia de
 * `FiltrosListarMovimientos`, no hay `productoId` obligatorio ni paginación — `listar`
 * devuelve TODAS las coincidencias porque alimenta un reporte, no un listado en pantalla
 * (mismo criterio que `FiltrosConsumoSalidas` en `repositorio-salidas.ts`). `clienteId` usa
 * el mismo JOIN implícito vía `proyecto.clienteId` que `FiltrosListarSalidas` — un movimiento
 * sin `proyectoId` (p. ej. una ENTRADA) nunca matchea un filtro de `clienteId`/`proyectoId`.
 */
export interface FiltrosListarMovimientosGeneral {
  readonly desde?: Date;
  readonly hasta?: Date;
  readonly tipo?: TipoMovimientoInventario;
  readonly usuarioId?: number;
  readonly clienteId?: number;
  readonly proyectoId?: number;
}

export interface RepositorioMovimientos {
  /**
   * Historial de movimientos de UN producto, ordenado por `fecha_hora` DESCENDENTE (más
   * reciente primero — FR-024), con filtro opcional de rango de fechas y paginación.
   */
  listarPorProducto(productoId: number, filtros: FiltrosListarMovimientos): Promise<PaginaMovimientos>;

  /**
   * TODOS los movimientos que matcheen los filtros, ordenados por `fecha_hora` DESCENDENTE,
   * SIN paginar (reporte, no listado de UI — FR-042). Alimenta `GET /api/reportes/movimientos`.
   */
  listar(filtros: FiltrosListarMovimientosGeneral): Promise<MovimientoInventario[]>;
}

/** Token de inyección de NestJS para el puerto `RepositorioMovimientos`. */
export const REPOSITORIO_MOVIMIENTOS = 'RepositorioMovimientos';
