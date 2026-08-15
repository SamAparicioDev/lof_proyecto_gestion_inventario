/**
 * Puerto `RepositorioProductos` — acceso a la persistencia del catálogo de productos visto
 * desde el dominio (patrón Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-productos.prisma.ts`.
 *
 * Alcance de esta tarea (US1 — T029): alta rápida (FR-011), lectura por id/SKU (necesarias
 * para `ServicioStock` y para validar unicidad), edición/cambio de estado (FR-010/FR-012) y
 * el listado paginado que usará US5 (`listar`). `listar` expone `stockActual` TAL CUAL —
 * las columnas derivadas `comprometido`/`disponible` dependen de las salidas `PENDIENTE`,
 * que no existen hasta US3; agregarlas ahora sería infraestructura especulativa
 * (Principio V, YAGNI). Se incluye el método ahora porque el modelo de datos ya lo soporta
 * y evita reabrir este puerto en US5 solo para sumar un método.
 *
 * Extensión Tanda 9 (US7 — T080, reporte de inventario actual): `listarTodos` agrega una
 * lectura del catálogo completo SIN paginar, mismo criterio ya usado por
 * `RepositorioSalidas.listarParaConsumo` (US4) para alimentar reportes — no toca ni
 * reemplaza `listar`, que sigue siendo el paginado de `/inventario` (US5).
 *
 * Extensión Tanda 14 (US12 — T124/T126): `actualizarCosto` es el ÚNICO camino por el que la
 * edición manual y la carga masiva mutan `productos.ultimo_costo`, y lo hace junto con su
 * fila de `historial_costos_producto` en la MISMA transacción (FR-072). Se deja fuera de
 * `actualizar` a propósito: cambiar una descripción y cambiar un precio tienen consecuencias
 * distintas (el segundo altera la valorización del inventario y de los reportes), así que son
 * dos operaciones con contratos distintos y no un campo más del mismo `UPDATE`.
 *
 * Implementa: FR-010 (alta/edición de producto), FR-011 (alta rápida reutilizable desde
 * ingresos), FR-012 (baja lógica vía `cambiarEstado`, nunca DELETE), FR-041 (universo
 * completo de productos para el reporte de inventario actual, vía `listarTodos`), FR-071/
 * FR-072/FR-074 (costo corregible, con registro atómico y solo si cambió — `actualizarCosto`).
 */
import type { OrigenCambioCosto } from '../entidades/cambio-costo-producto';
import type { EstadoProducto, Producto } from '../entidades/producto';

/** Datos de alta de un producto — auditoría incluida (FR-045: quién lo creó). `categoriaId`
 *  referencia el catálogo y sigue siendo opcional (US15, FR-086). */
export interface DatosNuevoProducto {
  readonly sku: string;
  readonly descripcion: string;
  readonly categoriaId: number | null;
  readonly ubicacion: string | null;
  readonly umbralStockBajo: number;
  readonly usuarioCreacionId: number;
}

/** Datos editables de un producto (el SKU no se edita tras el alta — ver entidad `Producto`).
 *  `categoriaId` referencia el catálogo y sigue siendo opcional (US15, FR-086). */
export interface DatosActualizarProducto {
  readonly descripcion: string;
  readonly categoriaId: number | null;
  readonly ubicacion: string | null;
  readonly umbralStockBajo: number;
  readonly usuarioModificacionId: number;
}

/**
 * Contexto de auditoría de un cambio de costo (US12, FR-072): quién lo hace y por qué camino.
 * `documentoId` solo aplica a `RECEPCION_INGRESO` (el id del ingreso recibido).
 */
export interface ContextoCambioCosto {
  readonly usuarioId: number;
  readonly origen: OrigenCambioCosto;
  readonly documentoId?: number | null;
}

/** Filtros del listado de inventario (US5) — paginación siempre obligatoria (Principio V, rendimiento). */
export interface FiltrosListarProductos {
  readonly buscar?: string;
  readonly soloStockBajo?: boolean;
  /**
   * Filtra por estado del producto. OPCIONAL a propósito y con semánticas distintas según
   * quién llama (FR-012):
   * - La vista de inventario (US5) lo omite MIENTRAS el usuario no filtre: por defecto debe
   *   ver también los productos dados de baja, con su etiqueta de estado — para eso existe la
   *   columna "Estado". Desde US13 (FR-075) esa pantalla puede además ACOTAR a uno de los dos
   *   estados a petición del usuario; lo que no cambia es el default.
   * - Los SELECTORES de documentos nuevos (`ListarResumenProductosCasoUso`, que alimenta las
   *   líneas de ingresos y salidas) pasan `'ACTIVO'`: un producto INACTIVO no puede
   *   ofrecerse para documentos nuevos, o la baja lógica no significaría nada. Mismo
   *   criterio que `RepositorioProyectos.proyectosDestino` con FR-038 (solo proyectos ACTIVOS
   *   de clientes ACTIVOS son destino válido de una salida).
   */
  readonly estado?: EstadoProducto;
  /**
   * Categoría y ubicación EXACTAS (US13, FR-075/FR-076) — no subcadena: los valores salen del
   * selector que alimenta `valoresDeClasificacion`, y con valores tomados de ahí una subcadena
   * solo introduciría falsos positivos ("Bodega 1" arrastraría "Bodega 10").
   */
  readonly categoriaId?: number;
  readonly ubicacion?: string;
  readonly pagina: number;
  readonly porPagina: number;
}

/**
 * Valores DISTINTOS de los dos campos de clasificación de texto libre del catálogo (US13,
 * FR-076): lo que hay que ofrecer en un filtro para que el usuario elija en vez de adivinar
 * cómo se escribió una categoría que capturó otra persona hace tres meses.
 *
 * Ordenados alfabéticamente y sin nulos: un producto sin categoría no aporta una opción vacía.
 */
export interface ValoresClasificacionProductos {
  /** Desde US15 salen del CATÁLOGO (activas + inactivas todavía en uso), no de un DISTINCT
   *  sobre productos: el filtro ofrece lo que el negocio administra (FR-088). */
  readonly categorias: { readonly id: number; readonly nombre: string }[];
  readonly ubicaciones: string[];
}

/** Página de productos (mismo shape que `Paginado<T>` de `@trazo/compartido`, sin importarlo:
 *  el dominio no depende de ningún paquete externo — docs/arquitectura.md §2). */
export interface PaginaProductos {
  readonly datos: Producto[];
  readonly total: number;
}

/**
 * Filtros del reporte de inventario actual (FR-041, US7): a diferencia de
 * `FiltrosListarProductos`, NO hay paginación — `listarTodos` devuelve TODAS las
 * coincidencias porque alimenta un reporte, no un listado en pantalla (mismo criterio que
 * `FiltrosConsumoSalidas`/`listarParaConsumo` de `RepositorioSalidas`, US4). Tampoco hay
 * `cantidadMin`/`cantidadMax`: ese filtro corre sobre `disponible` (= `stockActual` −
 * `comprometido`), una cifra que este repositorio no puede resolver solo porque
 * `comprometido` requiere el JOIN a través de `salidas` que expone
 * `RepositorioSalidas.comprometidoPorProducto` — se aplica en el caso de uso, EN MEMORIA,
 * después de componer `disponible` (ver `reporte-inventario-actual.caso-uso.ts`).
 */
export interface FiltrosListarTodosProductos {
  readonly buscar?: string;
}

export interface RepositorioProductos {
  /** Busca un producto por id. `null` si no existe. */
  buscarPorId(id: number): Promise<Producto | null>;

  /** Busca un producto por SKU único — usado para validar duplicados antes de crear (FR-010). */
  buscarPorSku(sku: string): Promise<Producto | null>;

  /**
   * Lectura en lote por id (FR-044, US4): resuelve nombres de producto sin N+1 al componer
   * los reportes de consumo (`aplicacion/reportes/*`) sobre el set de `productoId` únicos de
   * las líneas de salida devueltas por `RepositorioSalidas.listarParaConsumo`. Si `ids` está
   * vacío, devuelve `[]` sin ir a la base de datos.
   */
  buscarPorIds(ids: readonly number[]): Promise<Producto[]>;

  /**
   * Da de alta un producto (FR-010/FR-011). El adaptador traduce la violación `UNIQUE(sku)`
   * de PostgreSQL a `Duplicado('sku', ...)` — el caso de uso no necesita pre-chequear con
   * `buscarPorSku` para ese caso, aunque puede hacerlo para dar feedback más rápido.
   */
  crear(datos: DatosNuevoProducto): Promise<Producto>;

  /** Actualiza los campos editables de un producto existente (FR-010). NO toca el costo: eso
   *  es `actualizarCosto`, que además debe dejar rastro (FR-072). */
  actualizar(id: number, datos: DatosActualizarProducto): Promise<void>;

  /**
   * Aplica `costoNuevo` a `productos.ultimo_costo` y registra el cambio en
   * `historial_costos_producto` DENTRO DE LA MISMA TRANSACCIÓN (US12, FR-071/FR-072) —
   * atomicidad garantizada por el contrato de este método, no por la disciplina de quien lo
   * llame: jamás puede quedar un costo cambiado sin su registro, ni un registro sin su costo.
   *
   * Devuelve `true` si el costo REALMENTE cambió (y por tanto se escribió algo) y `false` si
   * `costoNuevo` coincidía con el vigente, en cuyo caso NO se escribe nada — ni una fila de
   * historial ni un `UPDATE` inútil (FR-074). Ese booleano es lo que alimenta
   * `ResumenImportacion.costosActualizados`.
   *
   * NUNCA escribe en `movimientos_inventario` (FR-073): un cambio de costo no altera
   * cantidades y hacerlo rompería el invariante `stock = Σ movimientos`. `stock_actual` queda
   * intacto.
   *
   * `NoEncontrado` si el producto no existe (contrato: `404`).
   */
  actualizarCosto(id: number, costoNuevo: number, contexto: ContextoCambioCosto): Promise<boolean>;

  /** Cambia el estado (baja/alta lógica) de un producto — nunca DELETE (FR-012). */
  cambiarEstado(id: number, estado: EstadoProducto, usuarioModificacionId: number): Promise<void>;

  /**
   * Lista productos paginados para la vista de inventario (US5, FR-020/FR-023). Expone
   * `stockActual` de la columna sin calcular `comprometido`/`disponible` (ver nota de
   * alcance arriba).
   */
  listar(filtros: FiltrosListarProductos): Promise<PaginaProductos>;

  /**
   * Lista TODOS los productos que matchean `buscar`, SIN paginar (FR-041, US7): el reporte
   * de inventario actual necesita el universo completo para calcular `valorTotalInventario`
   * y `cantidadBajoUmbral` sobre todo el catálogo, no una página. Igual que `listar`, expone
   * `stockActual` tal cual — `comprometido`/`disponible` y el filtro de rango de cantidad se
   * componen después, en el caso de uso (ver TSDoc de `FiltrosListarTodosProductos`). Si se
   * omite `filtros`, no hay término de búsqueda (equivalente a `{}`). Distinto método de
   * `listar`: no lo reemplaza, no lo toca (ese sigue paginado para `/inventario` UI).
   */
  listarTodos(filtros?: FiltrosListarTodosProductos): Promise<Producto[]>;

  /**
   * Categorías y ubicaciones DISTINTAS presentes hoy en el catálogo (US13, FR-076) — alimenta
   * los dos selectores de filtro de `/inventario`.
   *
   * Es una lectura aparte y no un derivado de `listarTodos` a propósito: el universo de valores
   * no depende de la página que se está viendo (si dependiera, filtrar por una categoría dejaría
   * de ofrecer las demás y el filtro sería una trampa de un solo uso), y traer el catálogo
   * entero a memoria para calcular dos listas cortas sería desperdiciar la agregación que la
   * base sabe hacer sola.
   */
  valoresDeClasificacion(): Promise<ValoresClasificacionProductos>;
}

/** Token de inyección de NestJS para el puerto `RepositorioProductos`. */
export const REPOSITORIO_PRODUCTOS = 'RepositorioProductos';
