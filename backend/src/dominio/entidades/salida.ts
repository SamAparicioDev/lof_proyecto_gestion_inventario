/**
 * Entidad de dominio `Salida` (entrega de mercancía a cliente/proyecto) y `DetalleSalida`
 * (línea) — TypeScript puro (Principio VI, NO NEGOCIABLE). Campos espejo de las tablas
 * `salidas`/`detalles_salidas` de `data-model.md`, con tipos PROPIOS del dominio (no se
 * importa el modelo/enum generado por Prisma — docs/arquitectura.md §2).
 *
 * Incluye la máquina de estados de `data-model.md` como función PURA
 * (`transicionValidaSalida`) para que los casos de uso de estado (`confirmar-salida`,
 * `completar-salida`, `cancelar-salida`, `anular-salida` — US3, tarea T051) la reutilicen y
 * rechacen transiciones inválidas con `EstadoInvalido`, en vez de repetir la lógica en cada
 * uno (mismo patrón que `transicionValidaIngreso` de `entidades/ingreso.ts`).
 *
 * El cálculo de totales (`calcularValorTotalSalida`, FR-031) reutiliza las funciones puras
 * `calcularValorTotalLinea`/`redondearDosDecimales` de `entidades/ingreso.ts` — importar
 * DENTRO del dominio (dominio → dominio) no viola la regla de dependencia de
 * docs/arquitectura.md §2 (solo prohíbe dominio → capas externas); `cantidad ×
 * precioUnitario` redondeado a 2 decimales es la MISMA regla de negocio sobre dinero en
 * ambos documentos, así que no se duplica (docs/arquitectura.md §5, DRY).
 *
 * Implementa: FR-025 (registro de salida con cabecera + líneas), FR-027 (destino
 * obligatorio — `proyectoId`), FR-029 (transición PENDIENTE→CONFIRMADA que descuenta stock,
 * research R4), FR-031 (totales) y FR-032 (transición a ANULADA, con o sin reversa de stock
 * según el estado de origen).
 */
import { calcularValorTotalLinea, redondearDosDecimales, type LineaParaCalcularTotal } from './ingreso';

/** Máquina de estados de una salida (data-model.md — FR-029/FR-032). */
export type EstadoSalida = 'PENDIENTE' | 'CONFIRMADA' | 'COMPLETADA' | 'ANULADA';

export interface Salida {
  readonly id: number;
  readonly numero: number;
  readonly fechaSalida: Date;
  readonly proyectoId: number;
  readonly observaciones: string | null;
  readonly estado: EstadoSalida;
  readonly valorTotal: number;
  /** US20 (FR-110): suma del IVA de las líneas. `valorTotal` sigue siendo la base gravable y el
   *  total con impuesto se deriva sumando los dos — nunca se almacena. */
  readonly valorIva: number;
  readonly usuarioAutorizaId: number | null;
  readonly fechaConfirmacion: Date | null;
  readonly motivoAnulacion: string | null;
}

export interface DetalleSalida {
  readonly id: number;
  readonly salidaId: number;
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
 * Transiciones válidas de la máquina de estados de `Salida` (data-model.md):
 *
 * ```text
 * PENDIENTE ──confirmar──▶ CONFIRMADA ──completar──▶ COMPLETADA
 *     │                        │
 *     └───────cancelar─────────┴────────anular───────▶ ANULADA
 * ```
 *
 * `COMPLETADA` y `ANULADA` son terminales: ninguna transición sale de ellas — en particular
 * NUNCA se llega a `ANULADA` desde `COMPLETADA` (el cierre administrativo de entrega es
 * definitivo, a diferencia de `CONFIRMADA`, que sí admite `anular` con reversa de stock).
 * Los casos de uso de estado llaman esta función ANTES de mutar nada y lanzan
 * `EstadoInvalido` si devuelve `false` (FR-029/FR-032) — así la regla vive en un solo lugar,
 * testeable sin BD.
 */
export function transicionValidaSalida(actual: EstadoSalida, siguiente: EstadoSalida): boolean {
  const transicionesValidas: Record<EstadoSalida, EstadoSalida[]> = {
    PENDIENTE: ['CONFIRMADA', 'ANULADA'],
    CONFIRMADA: ['COMPLETADA', 'ANULADA'],
    COMPLETADA: [],
    ANULADA: [],
  };
  return transicionesValidas[actual].includes(siguiente);
}

/** Valor total de la salida: suma de los valores totales de TODAS sus líneas (FR-031, columna
 *  `salidas.valor_total`). Cada línea ya llega redondeada a 2 decimales de
 *  `calcularValorTotalLinea` — no se vuelve a redondear la suma, mismo criterio que
 *  `calcularValorTotalIngreso` (entidades/ingreso.ts), preservado por consistencia entre
 *  documentos de la spec. */
export function calcularValorTotalSalida(lineas: readonly LineaParaCalcularTotal[]): number {
  return lineas.reduce((acumulado, linea) => acumulado + calcularValorTotalLinea(linea), 0);
}

/** Re-exportados para que los repositorios de salidas importen TODO el cálculo de totales
 *  desde un solo módulo (`entidades/salida.ts`), sin tener que saber que
 *  `calcularValorTotalLinea`/`redondearDosDecimales` viven físicamente en
 *  `entidades/ingreso.ts` (mismo criterio de "cantidad × precioUnitario redondeado" que
 *  reutiliza `calcularValorTotalSalida` arriba — no se duplica la regla, docs/arquitectura.md §5). */
export { calcularValorTotalLinea, redondearDosDecimales };
