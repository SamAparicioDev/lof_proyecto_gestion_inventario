/**
 * Entidad de dominio `Ingreso` (factura de compra) y `DetalleIngreso` (línea) — TypeScript
 * puro (Principio VI, NO NEGOCIABLE). Campos espejo de las tablas `ingresos`/
 * `detalles_ingresos` de `data-model.md`, con tipos PROPIOS del dominio (no se importa el
 * modelo/enum generado por Prisma — docs/arquitectura.md §2).
 *
 * Incluye la máquina de estados de `data-model.md` como función PURA
 * (`transicionValidaIngreso`) para que los casos de uso de estado (`recibir-ingreso`,
 * `verificar-ingreso`, `anular-ingreso` — US1, tarea T032) la reutilicen y rechacen
 * transiciones inválidas con `EstadoInvalido`, en vez de repetir la lógica en cada uno.
 *
 * También incluye el cálculo de totales (FR-014) como funciones PURAS
 * (`calcularValorTotalLinea`/`calcularValorTotalIngreso`, T038): `cantidad × precioUnitario`
 * es una regla de negocio sobre dinero, no un detalle de Postgres, así que vive aquí en vez
 * de en `RepositorioIngresosPrisma` (que las importa y aplica dentro de la transacción de
 * `crear`/`actualizar`) — así se prueban en `backend/test/unit/ingresos.spec.ts` sin BD.
 *
 * US29 (FR-126): un ingreso puede ser una FACTURA o un AJUSTE de inventario. Lo único que
 * cambia en el dominio es qué campos pueden faltar; la máquina de estados, los totales y el
 * efecto sobre el stock son los mismos — con una diferencia deliberada al recibirlo, que el
 * movimiento sea `AJUSTE_ENTRADA` y no `ENTRADA` para que el historial distinga una compra de
 * una corrección.
 *
 * Implementa: FR-013 (registro de factura con cabecera + líneas), FR-014 (totales), FR-017
 * (transición PENDIENTE→RECIBIDO que dispara el efecto de stock — research R4) y FR-019
 * (transición a ANULADO, con o sin reversa de stock según el estado de origen).
 */

/** Máquina de estados de un ingreso (data-model.md — FR-017/FR-019). */
export type EstadoIngreso = 'PENDIENTE' | 'RECIBIDO' | 'VERIFICADO' | 'ANULADO';

/** De qué clase es la entrada de mercancía (US29, FR-126). */
export type TipoIngreso = 'FACTURA' | 'AJUSTE';

export interface Ingreso {
  readonly id: number;
  /**
   * US29 (FR-126): `FACTURA` es una compra; `AJUSTE` es una corrección de inventario — un
   * conteo físico que aparece de más, una devolución, mercancía encontrada. El tipo decide qué
   * campos de esta entidad pueden ser `null`, y lo garantiza un CHECK en la base.
   */
  readonly tipo: TipoIngreso;
  /** `null` en los AJUSTE: no hay factura detrás. */
  readonly numeroFactura: string | null;
  /** Correlativo propio del AJUSTE (`contadores['ajuste']`), `null` en las facturas. Un
   *  documento sin identificador no es trazable (Principio II), y el del ajuste es este. */
  readonly numeroAjuste: number | null;
  /** `null` en los AJUSTE: un ajuste no tiene factura que fechar; su fecha es la de recepción. */
  readonly fechaFactura: Date | null;
  /**
   * US15 (FR-091): el proveedor dejó de ser texto libre y pasó a ser una referencia al catálogo
   * (`dominio/entidades/proveedor.ts`). Viaja RESUELTO —id y nombre—, igual que
   * `Producto.categoria`, porque el nombre es lo que toda pantalla y todo documento exportado
   * muestran, y resolverlo aguas arriba evita una consulta por fila.
   *
   * `null` SOLO en los AJUSTE (US29, FR-126): una factura sin saber a quién se le compró no es
   * trazable, pero a un ajuste no se le compra a nadie — y obligarlo a elegir un proveedor de
   * relleno ensuciaría el catálogo y el reporte de compras con una compra que nunca ocurrió.
   */
  readonly proveedor: { readonly id: number; readonly nombre: string } | null;
  readonly fechaRecepcion: Date;
  readonly observaciones: string | null;
  readonly estado: EstadoIngreso;
  readonly valorTotal: number;
  /** US20 (FR-110): suma del IVA de las líneas. `valorTotal` sigue siendo la base gravable y el
   *  total con impuesto se deriva sumando los dos — nunca se almacena. */
  readonly valorIva: number;
  readonly usuarioRegistraId: number;
  readonly motivoAnulacion: string | null;
  /** Orden de compra que este ingreso surte (US16, FR-099), o `null` si se registró sin orden
   *  previa — que es como funcionó el sistema hasta esa historia y sigue siendo válido. */
  readonly ordenCompraId: number | null;
}

export interface DetalleIngreso {
  readonly id: number;
  readonly ingresoId: number;
  readonly productoId: number;
  readonly cantidad: number;
  readonly precioUnitario: number;
  readonly valorTotal: number;
  /** US20 (FR-109): tasa aplicada a ESTA línea y el impuesto que resulta. `0` en todo lo
   *  registrado antes de la historia. */
  readonly tasaIva: number;
  readonly valorIva: number;
}

/**
 * Transiciones válidas de la máquina de estados de `Ingreso` (data-model.md):
 *
 * ```text
 * PENDIENTE ──recibir──▶ RECIBIDO ──verificar──▶ VERIFICADO
 *     │                      │
 *     └──────anular──────────┴──────anular──────▶ ANULADO
 * ```
 *
 * `VERIFICADO` y `ANULADO` son terminales: ninguna transición sale de ellos. Los casos de
 * uso de estado llaman esta función ANTES de mutar nada y lanzan `EstadoInvalido` si
 * devuelve `false` (FR-017/FR-019) — así la regla vive en un solo lugar, testeable sin BD.
 */
export function transicionValidaIngreso(actual: EstadoIngreso, siguiente: EstadoIngreso): boolean {
  const transicionesValidas: Record<EstadoIngreso, EstadoIngreso[]> = {
    PENDIENTE: ['RECIBIDO', 'ANULADO'],
    RECIBIDO: ['VERIFICADO', 'ANULADO'],
    VERIFICADO: [],
    ANULADO: [],
  };
  return transicionesValidas[actual].includes(siguiente);
}

/** Cantidad y precio de una línea, lo mínimo que exige el cálculo de su valor total (FR-014). */
export interface LineaParaCalcularTotal {
  readonly cantidad: number;
  readonly precioUnitario: number;
}

/** Redondeo monetario a 2 decimales (columnas `DECIMAL(_,2)` de data-model.md — FR-014/FR-016).
 *  Regla de negocio sobre dinero: nunca se maneja como `float` binario sin este control
 *  (docs/arquitectura.md §5). */
export function redondearDosDecimales(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Valor total de una línea de ingreso: `cantidad × precioUnitario`, redondeado a 2 decimales
 *  (FR-014, columna `detalles_ingresos.valor_total`). */
export function calcularValorTotalLinea(linea: LineaParaCalcularTotal): number {
  return redondearDosDecimales(linea.cantidad * linea.precioUnitario);
}

/** Valor total del ingreso: suma de los valores totales de TODAS sus líneas (FR-014, columna
 *  `ingresos.valor_total`). Cada línea ya llega redondeada a 2 decimales de
 *  `calcularValorTotalLinea` — no se vuelve a redondear la suma, para no alterar el total
 *  exacto que ve el usuario en cada línea del formulario (mismo comportamiento que la
 *  implementación original de `RepositorioIngresosPrisma`, preservado al mover el cálculo
 *  aquí). */
export function calcularValorTotalIngreso(lineas: readonly LineaParaCalcularTotal[]): number {
  return lineas.reduce((acumulado, linea) => acumulado + calcularValorTotalLinea(linea), 0);
}
