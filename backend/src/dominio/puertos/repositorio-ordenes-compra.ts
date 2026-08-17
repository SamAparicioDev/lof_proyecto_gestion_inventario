/**
 * Puerto `RepositorioOrdenesCompra` — persistencia de las órdenes de compra vista desde el
 * dominio (patrón Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-ordenes-compra.prisma.ts`.
 *
 * `enviar`, `anular` y `marcarRecibida` son las transiciones de la máquina de estados de
 * `entidades/orden-compra.ts`. Se exponen como métodos del repositorio —no como "leer +
 * guardar" desde el caso de uso— por consistencia con `RepositorioIngresos`, aunque aquí NO
 * hay bloqueo de stock que orquestar: una orden no mueve inventario (FR-096). Lo que sí hay
 * que garantizar es que el cambio de estado y la comprobación de que era legal ocurran juntos.
 *
 * `marcarRecibida` no tiene endpoint propio a propósito: la dispara `RepositorioIngresos.recibir`
 * dentro de SU transacción (FR-099), que es el momento en que la mercancía existe de verdad.
 *
 * Implementa: FR-094 (alta con líneas y total), FR-095 (correlativo dentro de la transacción),
 * FR-096 (estados y edición solo en BORRADOR), FR-097 (el listado completo alimenta el export).
 */
import type { DetalleOrdenCompra, EstadoOrdenCompra, OrdenCompra } from '../entidades/orden-compra';

/** Línea de una orden nueva o actualizada (aún sin id — lo asigna la persistencia). */
export interface LineaNuevaOrdenCompra {
  readonly productoId: number;
  readonly cantidad: number;
  readonly precioUnitario: number;
  /** US20 (FR-109): ausente = 0, y entonces el documento vale lo que valía antes de la historia. */
  readonly tasaIva?: number;
}

/** Orden junto con sus líneas — forma de lectura de `buscarPorId` (detalle completo). */
export interface OrdenCompraConDetalles extends OrdenCompra {
  readonly detalles: DetalleOrdenCompra[];
}

/**
 * Criterios de BÚSQUEDA, sin paginación. Se declara aparte —y `FiltrosListarOrdenesCompra` lo
 * EXTIENDE— por el mismo motivo que en ingresos: el listado en pantalla y su exportación no
 * pueden divergir, así que comparten literalmente el conjunto de filtros o no compila.
 */
export interface CriteriosOrdenesCompra {
  /** Cruza el NÚMERO de la orden y el nombre del proveedor. */
  readonly buscar?: string;
  readonly proveedorId?: number;
  readonly estado?: EstadoOrdenCompra;
  readonly desde?: Date;
  readonly hasta?: Date;
}

export interface FiltrosListarOrdenesCompra extends CriteriosOrdenesCompra {
  readonly pagina: number;
  readonly porPagina: number;
}

export interface PaginaOrdenesCompra {
  readonly datos: OrdenCompra[];
  readonly total: number;
}

/** Datos de alta — el usuario que la registra viaja embebido (FR-045). */
export interface DatosNuevaOrdenCompra {
  readonly proveedorId: number;
  readonly fechaOrden: Date;
  readonly fechaEntregaEsperada: Date | null;
  readonly observaciones: string | null;
  readonly lineas: LineaNuevaOrdenCompra[];
  readonly usuarioId: number;
}

/** Datos editables de una orden en BORRADOR — el usuario que edita va aparte, porque no es
 *  "quien la creó" sino "quien la modificó ahora". */
export interface DatosActualizarOrdenCompra {
  readonly proveedorId: number;
  readonly fechaOrden: Date;
  readonly fechaEntregaEsperada: Date | null;
  readonly observaciones: string | null;
  readonly lineas: LineaNuevaOrdenCompra[];
}

export interface RepositorioOrdenesCompra {
  /** Orden con sus líneas. `null` si no existe. */
  buscarPorId(id: number): Promise<OrdenCompraConDetalles | null>;

  /** Listado paginado de cabeceras con los filtros del contrato. */
  listar(filtros: FiltrosListarOrdenesCompra): Promise<PaginaOrdenesCompra>;

  /**
   * TODAS las cabeceras que cumplen los criterios, SIN paginar — la fuente del listado
   * EXPORTADO (FR-097/FR-064). El adaptador REUTILIZA el mismo `where` y el mismo orden que
   * `listar`, no una consulta paralela, para que exportar sea por construcción lo que se ve
   * filtrado en pantalla (SC-007).
   */
  listarTodas(criterios: CriteriosOrdenesCompra): Promise<OrdenCompra[]>;

  /**
   * Crea la orden en BORRADOR con sus líneas, calculando `valorTotal` (FR-094) y pidiendo el
   * correlativo DENTRO de la misma transacción (FR-095): si la creación falla, el número se
   * revierte con ella y no queda un hueco visible (research R5).
   */
  crear(datos: DatosNuevaOrdenCompra): Promise<OrdenCompra>;

  /** Reemplaza cabecera y líneas de una orden en BORRADOR, recalculando el total. El adaptador
   *  rechaza con `EstadoInvalido` si ya no es editable (FR-096). */
  actualizar(id: number, datos: DatosActualizarOrdenCompra, usuarioId: number): Promise<void>;

  /** `BORRADOR → ENVIADA`. A partir de aquí la orden deja de ser editable. */
  enviar(id: number, usuarioId: number): Promise<void>;

  /** `BORRADOR|ENVIADA → ANULADA` con motivo. Sin efecto en stock (nunca lo tuvo). */
  anular(id: number, usuarioId: number, motivo: string): Promise<void>;

  /**
   * `ENVIADA → RECIBIDA` (FR-099). NO tiene endpoint: la invoca el flujo que recibe el ingreso
   * vinculado, dentro de SU transacción, para que la orden no pueda quedar cerrada sin que el
   * stock haya entrado ni al revés.
   */
  marcarRecibida(id: number, usuarioId: number): Promise<void>;
}

export const REPOSITORIO_ORDENES_COMPRA = 'RepositorioOrdenesCompra';

/** Clave del correlativo de órdenes de compra en la tabla `contadores` (FR-095). */
export const CLAVE_CONTADOR_ORDEN_COMPRA = 'orden_compra';
