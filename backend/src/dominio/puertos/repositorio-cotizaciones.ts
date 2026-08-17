/**
 * Puerto `RepositorioCotizaciones` — persistencia de las cotizaciones vista desde el dominio
 * (patrón Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-cotizaciones.prisma.ts`.
 *
 * Espejo de `RepositorioOrdenesCompra`, y por las mismas razones de diseño: las transiciones se
 * exponen como métodos del repositorio para que el cambio de estado y la comprobación de que
 * era legal ocurran juntos, aunque aquí tampoco haya stock que bloquear (FR-113).
 *
 * La diferencia está en `aceptar`: es la única operación del módulo que crea algo fuera de él
 * —una `Salida` PENDIENTE con las mismas líneas (FR-115)— y por eso devuelve su id. Ambas
 * escrituras van en UNA transacción: una cotización marcada aceptada sin su salida dejaría al
 * usuario creyendo que el pedido está en marcha cuando no existe en ninguna parte.
 *
 * Implementa: FR-112 (alta con correlativo, líneas y totales), FR-114 (edición solo en
 * BORRADOR), FR-115 (aceptar genera la salida enlazada), FR-116 (el listado completo alimenta
 * el export).
 */
import type { Cotizacion, DetalleCotizacion, EstadoCotizacion } from '../entidades/cotizacion';

/** Línea de una cotización nueva o actualizada (aún sin id — lo asigna la persistencia). */
export interface LineaNuevaCotizacion {
  readonly productoId: number;
  readonly cantidad: number;
  readonly precioUnitario: number;
  /** US20 (FR-109): ausente = 0. En una cotización rara vez lo estará — se le ofrece al cliente
   *  el precio con su impuesto—, pero el defecto se mantiene por coherencia con el resto. */
  readonly tasaIva?: number;
}

/** Cotización junto con sus líneas — forma de lectura de `buscarPorId` (detalle completo). */
export interface CotizacionConDetalles extends Cotizacion {
  readonly detalles: DetalleCotizacion[];
}

/**
 * Criterios de BÚSQUEDA, sin paginación. Se declara aparte —y `FiltrosListarCotizaciones` lo
 * EXTIENDE— por el mismo motivo que en ingresos y órdenes: el listado en pantalla y su
 * exportación no pueden divergir, así que comparten literalmente el conjunto de filtros o no
 * compila.
 */
export interface CriteriosCotizaciones {
  /** Cruza el NÚMERO de la cotización y el nombre del cliente. */
  readonly buscar?: string;
  readonly clienteId?: number;
  readonly estado?: EstadoCotizacion;
  readonly desde?: Date;
  readonly hasta?: Date;
}

export interface FiltrosListarCotizaciones extends CriteriosCotizaciones {
  readonly pagina: number;
  readonly porPagina: number;
}

export interface PaginaCotizaciones {
  readonly datos: Cotizacion[];
  readonly total: number;
}

/** Datos de alta — el usuario que la registra viaja embebido (FR-045). */
export interface DatosNuevaCotizacion {
  readonly clienteId: number;
  readonly proyectoId: number;
  readonly fecha: Date;
  readonly fechaValidez: Date;
  readonly observaciones: string | null;
  readonly lineas: LineaNuevaCotizacion[];
  readonly usuarioId: number;
}

/** Datos editables de una cotización en BORRADOR — el usuario que edita va aparte, porque no es
 *  "quien la creó" sino "quien la modificó ahora". */
export interface DatosActualizarCotizacion {
  readonly clienteId: number;
  readonly proyectoId: number;
  readonly fecha: Date;
  readonly fechaValidez: Date;
  readonly observaciones: string | null;
  readonly lineas: LineaNuevaCotizacion[];
}

export interface RepositorioCotizaciones {
  /** Cotización con sus líneas. `null` si no existe. */
  buscarPorId(id: number): Promise<CotizacionConDetalles | null>;

  /** Listado paginado de cabeceras con los filtros del contrato. */
  listar(filtros: FiltrosListarCotizaciones): Promise<PaginaCotizaciones>;

  /** TODAS las cabeceras que cumplen los criterios, SIN paginar — la fuente del listado
   *  EXPORTADO (FR-116/FR-064), reutilizando el mismo `where` que `listar`. */
  listarTodas(criterios: CriteriosCotizaciones): Promise<Cotizacion[]>;

  /**
   * Crea la cotización en BORRADOR con sus líneas, calculando sus totales y pidiendo el
   * correlativo DENTRO de la misma transacción (FR-112): si la creación falla, el número se
   * revierte con ella y no queda un hueco visible (research R5).
   */
  crear(datos: DatosNuevaCotizacion): Promise<Cotizacion>;

  /** Reemplaza cabecera y líneas de una cotización en BORRADOR, recalculando sus totales. */
  actualizar(id: number, datos: DatosActualizarCotizacion, usuarioId: number): Promise<void>;

  /** BORRADOR → ENVIADA (FR-112). */
  enviar(id: number, usuarioId: number): Promise<void>;

  /**
   * ENVIADA → ACEPTADA, generando la SALIDA pendiente con las mismas líneas y devolviendo su id
   * (FR-115). Las dos escrituras van en la MISMA transacción, y la salida NO mueve stock: nace
   * PENDIENTE, como cualquier salida registrada a mano, y es al confirmarla cuando el inventario
   * se compromete (FR-025).
   */
  aceptar(id: number, usuarioId: number): Promise<{ salidaId: number }>;

  /** ENVIADA → RECHAZADA (FR-112). No genera nada: el cliente dijo que no. */
  rechazar(id: number, usuarioId: number): Promise<void>;

  /** BORRADOR/ENVIADA → ANULADA, con el motivo obligatorio a nivel de aplicación. */
  anular(id: number, motivo: string, usuarioId: number): Promise<void>;
}

/** Token de inyección del puerto (Nest lo resuelve por símbolo, no por clase concreta). */
export const REPOSITORIO_COTIZACIONES = Symbol('RepositorioCotizaciones');
