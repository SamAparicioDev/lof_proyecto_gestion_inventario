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
 * Implementa: FR-013 (registro de factura con cabecera + líneas), FR-014 (totales), FR-017
 * (transición PENDIENTE→RECIBIDO que dispara el efecto de stock — research R4) y FR-019
 * (transición a ANULADO, con o sin reversa de stock según el estado de origen).
 */

/** Máquina de estados de un ingreso (data-model.md — FR-017/FR-019). */
export type EstadoIngreso = 'PENDIENTE' | 'RECIBIDO' | 'VERIFICADO' | 'ANULADO';

export interface Ingreso {
  readonly id: number;
  readonly numeroFactura: string;
  readonly fechaFactura: Date;
  /**
   * US15 (FR-091): el proveedor dejó de ser texto libre y pasó a ser una referencia al catálogo
   * (`dominio/entidades/proveedor.ts`). Viaja RESUELTO —id y nombre—, igual que
   * `Producto.categoria`, porque el nombre es lo que toda pantalla y todo documento exportado
   * muestran, y resolverlo aguas arriba evita una consulta por fila.
   *
   * Nunca es `null`, a diferencia de la categoría de un producto: una factura sin saber a quién
   * se le compró no es trazable, y por eso la FK es NOT NULL en la base de datos.
   */
  readonly proveedor: { readonly id: number; readonly nombre: string };
  readonly fechaRecepcion: Date;
  readonly observaciones: string | null;
  readonly estado: EstadoIngreso;
  readonly valorTotal: number;
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
