/**
 * Puerto `RepositorioSalidas` — acceso a la persistencia de salidas de mercancía visto desde
 * el dominio (patrón Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-salidas.prisma.ts`.
 *
 * `confirmar`, `completar`, `cancelar` y `anular` son las transiciones de la máquina de
 * estados de `entidades/salida.ts` — se exponen como métodos ATÓMICOS del repositorio (no
 * como "leer + guardar" desde el caso de uso) porque `confirmar`/`anular` deben bloquear
 * filas de `productos` con `FOR UPDATE` y escribir `movimientos_inventario` en la MISMA
 * transacción que el cambio de estado (Principio I, research R4) — esa orquestación es
 * responsabilidad de infraestructura, no de la capa de aplicación (docs/arquitectura.md §2).
 * Mismo patrón que `RepositorioIngresos` (`recibir`/`anular`, US1).
 *
 * `comprometidoPorProducto` es el ÚNICO método que calcula el agregado de "comprometido"
 * (research R4, data-model.md § productos): suma `detalles_salidas.cantidad` de TODAS las
 * salidas en estado `PENDIENTE` que referencian cada producto, agrupado por `productoId`.
 * Sirve a DOS casos de uso distintos que reutilizan el MISMO método — AMBOS de UX/negocio,
 * SIN bloqueo de filas, nunca dentro de la transacción atómica de `confirmar` (ver TSDoc de
 * `confirmar` más abajo — corrección T056: mezclar este agregado con la revalidación bajo
 * `FOR UPDATE` rompía la garantía de "exactamente una gana" bajo concurrencia real):
 *   (a) `disponible` al listar productos para el formulario de salida (US5/T050) —
 *       sin `excluirSalidaId`: TODAS las `PENDIENTE` cuentan.
 *   (b) crear/editar una salida (`validar-disponibilidad-lineas.ts`, T050) — con
 *       `excluirSalidaId` = el id de la propia salida al editar, para no restarle su propio
 *       compromiso a sí misma.
 *
 * Implementa: FR-025 (registro de salida con destino y líneas), FR-026 (correlativo vía
 * `Contadores`, research R5), FR-027 (destino obligatorio), FR-028 (revalidación atómica de
 * disponibilidad al confirmar), FR-029/FR-030 (confirmar fija autorizante y fecha), FR-031
 * (totales), FR-032 (anular con reversa cuando aplica), FR-033 (listado paginado con
 * filtros).
 */
import type { DetalleSalida, EstadoSalida, Salida } from '../entidades/salida';

/** Línea de una salida nueva o actualizada (aún sin id — lo asigna la persistencia). */
export interface LineaNuevaSalida {
  readonly productoId: number;
  readonly cantidad: number;
  readonly precioUnitario: number;
  /** US20 (FR-109): ausente = 0, y entonces el documento vale lo que valía antes de la historia. */
  readonly tasaIva?: number;
}

/** Salida junto con sus líneas — forma de lectura de `buscarPorId` (detalle completo). */
export interface SalidaConDetalles extends Salida {
  readonly detalles: DetalleSalida[];
}

/**
 * Filtros del listado de salidas (FR-033) — paginación siempre obligatoria. `clienteId` NO
 * es una columna de `salidas` (data-model.md: el cliente se deriva del proyecto) — el
 * adaptador Prisma lo traduce a un filtro sobre `proyecto.clienteId` vía el `include`/`where`
 * anidado de la relación `Salida.proyecto`, es decir, un JOIN implícito
 * `salidas ⋈ proyectos ON proyecto_id WHERE proyectos.cliente_id = :clienteId`.
 */
export interface FiltrosListarSalidas extends CriteriosSalidas {
  readonly pagina: number;
  readonly porPagina: number;
}

/**
 * Criterios de BÚSQUEDA de salidas, sin paginación (US11, FR-064) — mismo criterio y mismo
 * motivo que `CriteriosIngresos`: el listado en pantalla y su exportación comparten el
 * conjunto de filtros por CONSTRUCCIÓN (`FiltrosListarSalidas` lo extiende), de modo que
 * agregar un filtro nuevo a uno sin agregarlo al otro no compila.
 */
export interface CriteriosSalidas {
  readonly clienteId?: number;
  readonly proyectoId?: number;
  readonly estado?: EstadoSalida;
  readonly desde?: Date;
  readonly hasta?: Date;
  /**
   * Correlativo de NEGOCIO de la salida (US13, FR-075) — `salidas.numero` (FR-026), no el `id`
   * técnico: es el número que aparece impreso en el soporte de entrega. Igualdad exacta.
   */
  readonly numero?: number;
  /**
   * Quién autorizó la salida (US13, FR-075) — `salidas.usuario_autoriza_id`, que solo se puebla
   * al CONFIRMAR (FR-030). Las salidas PENDIENTE no tienen autorizante, así que no aparecen bajo
   * este filtro para ningún valor: es la semántica correcta de "qué autorizó esta persona".
   */
  readonly usuarioAutorizaId?: number;
}

/** Página de salidas (cabeceras, sin líneas — igual que el listado del contrato). */
export interface PaginaSalidas {
  readonly datos: Salida[];
  readonly total: number;
}

/**
 * Filtros del reporte de consumo (FR-044, US4): a diferencia de `FiltrosListarSalidas`, NO
 * hay `estado` ni paginación — `listarParaConsumo` fija el estado a `CONFIRMADA`/`COMPLETADA`
 * internamente (PENDIENTE/ANULADA NUNCA cuentan como consumo, sin excepción) y devuelve TODAS
 * las coincidencias porque alimenta un reporte, no un listado en pantalla. `clienteId` usa el
 * MISMO JOIN implícito vía `proyecto.clienteId` que `FiltrosListarSalidas` (ver TSDoc arriba).
 */
export interface FiltrosConsumoSalidas {
  readonly clienteId?: number;
  readonly proyectoId?: number;
  readonly desde?: Date;
  readonly hasta?: Date;
}

/** Datos de alta de una salida (FR-025/FR-027). El usuario que crea viaja aparte (segundo
 *  argumento de `crear`), como en `RepositorioProyectos.crear` — no embebido en el objeto de
 *  datos, para que `actualizar` pueda reutilizar el MISMO shape sin arrastrar semántica de
 *  "quién creó" en una operación de edición. */
export interface DatosNuevaSalida {
  readonly proyectoId: number;
  readonly fechaSalida: Date;
  readonly observaciones: string | null;
  readonly lineas: LineaNuevaSalida[];
}

/** Datos editables de una salida `PENDIENTE` — mismo shape que `DatosNuevaSalida` (el
 *  contrato usa "mismo esquema" para `POST`/`PUT`), como tipo propio para que el nombre en
 *  la firma de `actualizar` sea autoexplicativo (mismo criterio que
 *  `DatosActualizarIngreso`). */
export type DatosActualizarSalida = DatosNuevaSalida;

export interface RepositorioSalidas {
  /** Salida con sus líneas. `null` si no existe. */
  buscarPorId(id: number): Promise<SalidaConDetalles | null>;

  /** Listado paginado de cabeceras con filtros de cliente/proyecto/estado/fechas (FR-033). */
  listar(filtros: FiltrosListarSalidas): Promise<PaginaSalidas>;

  /**
   * TODAS las cabeceras que cumplen los criterios, SIN paginar (US11, FR-064) — la fuente del
   * listado EXPORTADO. A diferencia de `listarParaConsumo`, NO fija estados: exporta
   * exactamente lo mismo que muestra `listar` con esos filtros, `PENDIENTE`/`ANULADA`
   * incluidas si el usuario no filtró por estado (es el historial operativo, no el reporte de
   * consumo). El adaptador reutiliza el MISMO `where` y el MISMO orden que `listar` (SC-007).
   */
  listarTodas(criterios: CriteriosSalidas): Promise<Salida[]>;

  /**
   * Salidas de "consumo" (FR-044, US4) para `aplicacion/reportes/*`: TODAS (sin paginar —
   * es la fuente de un reporte, no un listado en pantalla) las salidas en estado
   * `CONFIRMADA` o `COMPLETADA` que matchean los filtros, CON sus líneas de detalle
   * (`SalidaConDetalles`, igual forma que `buscarPorId`). Filtra por `fechaSalida` entre
   * `desde`/`hasta` si se pasan. El adaptador reutiliza la MISMA lógica de JOIN
   * cliente→proyecto que `listar` (ver TSDoc de `FiltrosConsumoSalidas`) — no la duplica.
   */
  listarParaConsumo(filtros: FiltrosConsumoSalidas): Promise<SalidaConDetalles[]>;

  /**
   * Crea una salida en estado `PENDIENTE` con sus líneas, calculando `valorTotal` (FR-031)
   * y asignando el correlativo vía `Contadores.siguienteNumero('salida')` (FR-026,
   * research R5) — DENTRO de la misma transacción que el `INSERT` de la salida, para que
   * número y fila se persistan o reviertan juntos. Sin efecto en stock (solo compromete
   * disponibilidad como agregado derivado — `comprometidoPorProducto`).
   */
  crear(datos: DatosNuevaSalida, usuarioId: number): Promise<Salida>;

  /**
   * Reemplaza cabecera y líneas de una salida `PENDIENTE`, recalculando `valorTotal`. El
   * adaptador rechaza con `EstadoInvalido` si la salida ya no es editable.
   */
  actualizar(id: number, datos: DatosActualizarSalida, usuarioId: number): Promise<void>;

  /**
   * Agregado de "comprometido" por producto (research R4, ver TSDoc de cabecera): suma
   * `detalles_salidas.cantidad` de salidas en estado `PENDIENTE` que referencian cada
   * `productoId`, agrupado. Si `productoIds` se omite, agrega sobre TODOS los productos con
   * al menos una línea `PENDIENTE`. Si `excluirSalidaId` se pasa, esa salida se excluye de
   * la suma (caso de uso (b) de la cabecera). Productos sin ninguna salida `PENDIENTE`
   * simplemente no aparecen en el `Map` devuelto (comprometido implícito = 0).
   */
  comprometidoPorProducto(productoIds?: readonly number[], excluirSalidaId?: number): Promise<Map<number, number>>;

  /**
   * `PENDIENTE → CONFIRMADA` (FR-028/FR-029/FR-030): transacción ATÓMICA — bloquea los
   * productos de las líneas con `FOR UPDATE` ordenado por id y aplica
   * `ServicioStock.aplicarSalida` contra el `stockActual` REAL así bloqueado (NO contra un
   * "disponible" neto de `comprometidoPorProducto` de otras salidas `PENDIENTE` — ver
   * corrección de diseño T056 en el TSDoc de `dominio/servicios/servicio-stock.ts`: esa
   * fórmula hacía que dos confirmaciones concurrentes se rechazaran mutuamente en vez de que
   * exactamente una ganara, violando SC-002). El propio `FOR UPDATE` es el mecanismo de
   * serialización correcto: la segunda transacción, al adquirir el candado, ya ve el stock
   * actualizado por la primera. Persiste `stock_actual` por producto, inserta un
   * `movimientos_inventario` tipo `SALIDA` por línea (con `proyecto_id` de la salida,
   * FR-042) y fija `estado='CONFIRMADA'`, `usuario_autoriza_id`, `fecha_confirmacion`. Lanza
   * `NoEncontrado` si la salida no existe, `EstadoInvalido` si no está `PENDIENTE`, y propaga
   * sin capturar `DisponibilidadInsuficiente` (con el disponible REAL) si alguna línea
   * excede — Prisma revierte todo (Principio I).
   */
  confirmar(id: number, usuarioId: number): Promise<void>;

  /**
   * `CONFIRMADA → COMPLETADA`: cierre administrativo de entrega, SIN efecto en stock
   * (data-model.md: `COMPLETADA` es terminal e inmutable). `UPDATE` simple con guarda de
   * estado — no requiere `UnidadDeTrabajo` ni bloqueo de filas. Lanza `EstadoInvalido` si no
   * está `CONFIRMADA`.
   */
  completar(id: number, usuarioId: number): Promise<void>;

  /**
   * `PENDIENTE → ANULADA` ("cancelar", contracts/api-rest.md § Salidas: body `{motivo}`):
   * SIN efecto en stock — la salida `PENDIENTE` nunca tocó `stock_actual`, solo comprometía
   * disponibilidad como agregado derivado de `comprometidoPorProducto`; al dejar de estar
   * `PENDIENTE`, el compromiso se libera automáticamente (no hay reversa que aplicar).
   * `UPDATE` simple con guarda de estado — no requiere `UnidadDeTrabajo` ni bloqueo de filas
   * (mismo patrón que `completar`). `motivo` se persiste en la MISMA columna
   * `motivo_anulacion` que usa `anular` (data-model.md no reserva esa columna a un único
   * origen de transición — ambas terminan en `ANULADA`, y el llamador ya validó que no esté
   * vacío antes de invocar este método, mismo criterio que `anular`). Lanza `EstadoInvalido`
   * si no está `PENDIENTE`.
   */
  cancelar(id: number, usuarioId: number, motivo: string): Promise<void>;

  /**
   * `CONFIRMADA → ANULADA` (FR-032): transacción ATÓMICA — reutiliza
   * `ServicioStock.aplicarEntrada` (YA EXISTE, US1) para la reversa: sumar sin restricción
   * es exactamente lo que se necesita para devolver a `stock_actual` la cantidad que
   * `confirmar` había descontado. El único cambio respecto a una entrada real es que el
   * `movimientos_inventario` insertado por el adaptador es tipo `AJUSTE_ENTRADA` (no
   * `ENTRADA`) — `ServicioStock` no sabe ni le importa el tipo, eso lo decide el repositorio
   * al insertar. `motivo` es obligatorio a nivel de aplicación (el adaptador/caso de uso lo
   * exige antes de llegar aquí). Lanza `EstadoInvalido` si no está `CONFIRMADA` (nunca desde
   * `COMPLETADA`).
   */
  anular(id: number, usuarioId: number, motivo: string): Promise<void>;
}

/** Token de inyección de NestJS para el puerto `RepositorioSalidas`. */
export const REPOSITORIO_SALIDAS = 'RepositorioSalidas';
