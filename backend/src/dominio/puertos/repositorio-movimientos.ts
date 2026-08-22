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

/**
 * Cuándo se movió por última vez cada producto, visto desde la ROTACIÓN (US37, FR-159).
 *
 * Los dos campos son distintos a propósito y ninguno sobra:
 *
 * - `ultimaSalida` es lo que mide la rotación. Un producto rota cuando SALE; que entre más
 *   mercancía no es rotación, es lo contrario.
 * - `primeraEntrada` es el reloj de repuesto para el que NUNCA ha salido — el caso más grave,
 *   que sin este campo no tendría antigüedad que mostrar y se caería del reporte justo por ser
 *   el peor.
 *
 * Ambos son `null` cuando el producto no tiene ningún movimiento de ese tipo.
 */
export interface RotacionDeProducto {
  readonly productoId: number;
  readonly ultimaSalida: Date | null;
  readonly primeraEntrada: Date | null;
}

/** Existencias de UN producto a una fecha de corte (US38, FR-164). */
export interface ExistenciasAFecha {
  readonly productoId: number;
  readonly existencias: number;
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

  /**
   * Última salida y primera entrada de CADA producto que tenga movimientos (US37, FR-159).
   *
   * Una sola consulta agrupada para todo el catálogo, nunca una por producto: el reporte de
   * inmovilizado recorre el catálogo entero y N+1 aquí serían miles de viajes a la base.
   *
   * Devuelve solo los productos CON movimientos. Los que no tienen ninguno no aparecen, y eso es
   * correcto: un producto sin un solo movimiento tampoco tiene existencias (el stock solo se
   * mueve con movimientos), así que el reporte lo descarta igual por FR-160.
   */
  rotacionPorProducto(): Promise<RotacionDeProducto[]>;

  /**
   * Existencias de cada producto A UNA FECHA (US38, FR-164), reconstruidas del registro
   * inmutable de movimientos y NUNCA de `productos.stock_actual`.
   *
   * Se resuelve con el `stock_resultante` del ÚLTIMO movimiento anterior o igual a la fecha, no
   * sumando cantidades con signo. Esa columna es la foto del stock inmediatamente después de cada
   * movimiento, escrita en la MISMA transacción que lo produjo: leerla es más barato que sumar la
   * historia entera y —lo que importa más— no puede desviarse de ella.
   *
   * Un producto sin movimientos hasta esa fecha no aparece: no existía o no tenía nada, y en
   * ambos casos su lugar en un documento de cierre es la ausencia, no una fila en cero (FR-166).
   */
  existenciasAFecha(fecha: Date): Promise<ExistenciasAFecha[]>;

  /**
   * Quiénes han movido inventario alguna vez, por nombre (US25, FR-121).
   *
   * Alimenta el filtro por persona del reporte de movimientos. Devuelve SOLO quienes tienen
   * movimientos —no el listado de usuarios del sistema— por dos motivos que van juntos: son las
   * únicas respuestas que el reporte puede dar (ofrecer a alguien sin movimientos es ofrecer un
   * filtro que siempre sale vacío), y así el filtro no necesita el permiso de administrar
   * usuarios, que el Gerente no tiene aunque sí vea el reporte.
   */
  usuariosConMovimientos(): Promise<{ id: number; nombre: string }[]>;
}

/** Token de inyección de NestJS para el puerto `RepositorioMovimientos`. */
export const REPOSITORIO_MOVIMIENTOS = 'RepositorioMovimientos';
