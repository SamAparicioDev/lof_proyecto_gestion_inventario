/**
 * Puerto `RepositorioIngresos` — acceso a la persistencia de facturas de compra visto desde
 * el dominio (patrón Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-ingresos.prisma.ts`.
 *
 * `recibir`, `verificar` y `anular` son las transiciones de la máquina de estados de
 * `entidades/ingreso.ts` — se exponen como métodos ATÓMICOS del repositorio (no como
 * "leer + guardar" desde el caso de uso) porque `recibir`/`anular` deben bloquear filas de
 * `productos` con `FOR UPDATE` y escribir `movimientos_inventario` en la MISMA transacción
 * que el cambio de estado (Principio I, research R4) — esa orquestación es responsabilidad
 * de infraestructura, no de la capa de aplicación (docs/arquitectura.md §2).
 *
 * Implementa: FR-013 (registro de factura), FR-014 (totales), FR-015 (unicidad de factura,
 * reforzada por la BD y traducida a `Duplicado`), FR-017 (recibir suma stock), FR-018
 * (usuario que registra), FR-019 (anular, con reversa si estaba RECIBIDO).
 */
import type { DetalleIngreso, EstadoIngreso, Ingreso } from '../entidades/ingreso';

/** Línea de un ingreso nuevo o actualizado (aún sin id — lo asigna la persistencia). */
export interface LineaNuevoIngreso {
  readonly productoId: number;
  readonly cantidad: number;
  readonly precioUnitario: number;
}

/** Ingreso junto con sus líneas — forma de lectura de `buscarPorId` (detalle completo). */
export interface IngresoConDetalles extends Ingreso {
  readonly detalles: DetalleIngreso[];
}

/**
 * Criterios de BÚSQUEDA de ingresos, sin paginación (US11, FR-064). Se declara aparte —y
 * `FiltrosListarIngresos` lo EXTIENDE— para que el listado en pantalla y su exportación no
 * puedan divergir: son literalmente el mismo conjunto de filtros más (o menos) la comodidad de
 * leerlo por páginas. Si mañana se agrega un filtro, aparece en los dos a la vez o no compila.
 */
export interface CriteriosIngresos {
  readonly buscar?: string;
  readonly estado?: EstadoIngreso;
  readonly desde?: Date;
  readonly hasta?: Date;
  /**
   * Proveedor EXACTO del catálogo (US13/FR-075, reescrito en US15/FR-091: el filtro nació como
   * subcadena sobre la columna de texto y ahora se elige de un selector). NO es redundante con
   * `buscar`, que sigue cruzando `numero_factura` OR el NOMBRE del proveedor y por eso trae
   * también facturas cuyo NÚMERO contiene "3M". Se combinan con Y lógico.
   */
  readonly proveedorId?: number;
}

/** Filtros del listado de ingresos (FR-018) — paginación siempre obligatoria. */
export interface FiltrosListarIngresos extends CriteriosIngresos {
  readonly pagina: number;
  readonly porPagina: number;
}

/** Página de ingresos (cabeceras, sin líneas — igual que el listado del contrato). */
export interface PaginaIngresos {
  readonly datos: Ingreso[];
  readonly total: number;
}

/** Datos de alta de un ingreso — el usuario que registra viaja embebido (FR-018). */
export interface DatosNuevoIngreso {
  readonly numeroFactura: string;
  readonly fechaFactura: Date;
  /** Referencia al catálogo (US15, FR-091) — obligatoria: no hay ingreso sin proveedor. */
  readonly proveedorId: number;
  readonly fechaRecepcion: Date;
  readonly observaciones: string | null;
  readonly lineas: LineaNuevoIngreso[];
  readonly usuarioId: number;
}

/** Datos editables de un ingreso `PENDIENTE` (US1-AS5) — el usuario que edita va aparte,
 *  como en `actualizar()`, porque no es "quien registró" sino "quien modificó ahora". */
export interface DatosActualizarIngreso {
  readonly numeroFactura: string;
  readonly fechaFactura: Date;
  readonly proveedorId: number;
  readonly fechaRecepcion: Date;
  readonly observaciones: string | null;
  readonly lineas: LineaNuevoIngreso[];
}

export interface RepositorioIngresos {
  /** Ingreso con sus líneas. `null` si no existe. */
  buscarPorId(id: number): Promise<IngresoConDetalles | null>;

  /** Listado paginado de cabeceras con filtros de búsqueda/estado/fechas (FR-018). */
  listar(filtros: FiltrosListarIngresos): Promise<PaginaIngresos>;

  /**
   * TODAS las cabeceras que cumplen los criterios, SIN paginar (US11, FR-064) — la fuente del
   * listado EXPORTADO. Mismo criterio (y mismo motivo) que `listarParaConsumo` de
   * `RepositorioSalidas`: la paginación es una comodidad de LECTURA en pantalla, no un recorte
   * de los datos, así que un archivo que solo trajera la página visible sería sencillamente un
   * archivo incompleto. El adaptador REUTILIZA el mismo `where` y el mismo orden que `listar`
   * —no una consulta paralela— para que exportar sea, por construcción, lo que se ve filtrado
   * en pantalla (SC-007).
   */
  listarTodos(criterios: CriteriosIngresos): Promise<Ingreso[]>;

  /**
   * Crea un ingreso en estado `PENDIENTE` con sus líneas, calculando `valorTotal` (FR-014).
   * Sin efecto en stock — eso solo ocurre en `recibir`. El adaptador traduce la violación
   * `UNIQUE(numero_factura)` a `Duplicado('numeroFactura', ...)` (FR-015).
   */
  crear(datos: DatosNuevoIngreso): Promise<Ingreso>;

  /**
   * Reemplaza cabecera y líneas de un ingreso `PENDIENTE`, recalculando `valorTotal`
   * (US1-AS5). El adaptador rechaza con `EstadoInvalido` si el ingreso ya no es editable.
   */
  actualizar(id: number, datos: DatosActualizarIngreso, usuarioId: number): Promise<void>;

  /**
   * `PENDIENTE → RECIBIDO`: transacción ATÓMICA (research R4) — bloquea los productos de
   * las líneas con `FOR UPDATE` ordenado por id, aplica `ServicioStock.aplicarEntrada`,
   * persiste `stock_actual`/`ultimo_costo`/`fecha_ultimo_movimiento` por producto, inserta
   * un `movimientos_inventario` tipo `ENTRADA` por línea y actualiza el estado — todo o
   * nada. Lanza `NoEncontrado` si el ingreso no existe y `EstadoInvalido` si no está
   * `PENDIENTE` (FR-017).
   */
  recibir(id: number, usuarioId: number): Promise<void>;

  /**
   * `RECIBIDO → VERIFICADO`: cierre administrativo, sin efecto en stock (data-model.md:
   * `VERIFICADO` es terminal e inmutable). Lanza `EstadoInvalido` si no está `RECIBIDO`.
   */
  verificar(id: number, usuarioId: number): Promise<void>;

  /**
   * `PENDIENTE|RECIBIDO → ANULADO` (FR-019). Si el ingreso está `PENDIENTE`, solo cambia el
   * estado (nunca tocó stock). Si está `RECIBIDO`, revierte el stock ATÓMICAMENTE con
   * `ServicioStock.aplicarReversaEntrada` (movimientos `AJUSTE_SALIDA`) ANTES de marcar
   * `ANULADO`; si el disponible no alcanza para revertir, propaga
   * `DisponibilidadInsuficiente` sin capturarla (la transacción hace rollback completo —
   * `unidad-de-trabajo.ts`). `VERIFICADO` no es anulable → `EstadoInvalido`.
   */
  anular(id: number, usuarioId: number, motivo: string): Promise<void>;
}

/** Token de inyección de NestJS para el puerto `RepositorioIngresos`. */
export const REPOSITORIO_INGRESOS = 'RepositorioIngresos';
