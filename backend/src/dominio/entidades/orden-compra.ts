/**
 * Entidad de dominio `OrdenCompra` (pedido a un proveedor) y `DetalleOrdenCompra` (línea) —
 * TypeScript puro (Principio VI, NO NEGOCIABLE). Campos espejo de las tablas
 * `ordenes_compra`/`detalles_ordenes_compra` de `data-model.md`, con tipos PROPIOS del dominio
 * (no se importa el modelo/enum generado por Prisma — docs/arquitectura.md §2).
 *
 * ## Qué NO hace una orden, y por qué importa decirlo aquí
 *
 * Una orden de compra **no mueve stock en ningún estado** (FR-096). Es el único documento del
 * sistema del que hay que afirmarlo explícitamente, porque su forma es casi la de un ingreso y
 * la intuición dice lo contrario: pedir 100 sacos no es tenerlos. `RECIBIDA` no significa que
 * esta entidad haya sumado nada, sino que llegó el INGRESO que la surte (FR-099) — y ese sí
 * pasa por el flujo atómico de `ServicioStock`, como cualquier otro.
 *
 * Incluye la máquina de estados y el cálculo de totales como funciones PURAS, mismo criterio
 * que `ingreso.ts`: son reglas de negocio, no detalles de Postgres, y así se prueban sin BD.
 *
 * Implementa: FR-094 (una orden se dirige a un proveedor y lleva líneas con su total), FR-096
 * (máquina de estados y edición solo en BORRADOR), FR-099 (el cierre lo dispara el ingreso).
 */

/** Máquina de estados de una orden de compra (data-model.md — FR-096). */
export type EstadoOrdenCompra = 'BORRADOR' | 'ENVIADA' | 'RECIBIDA' | 'ANULADA';

export interface OrdenCompra {
  readonly id: number;
  /** Correlativo asignado por el sistema al crearla (FR-095). */
  readonly numero: number;
  /** Viaja RESUELTO —id y nombre—, igual que `Ingreso.proveedor`: el nombre es lo que muestran
   *  todas las pantallas y el documento que se le envía al proveedor. */
  readonly proveedor: { readonly id: number; readonly nombre: string };
  readonly fechaOrden: Date;
  readonly fechaEntregaEsperada: Date | null;
  readonly observaciones: string | null;
  readonly estado: EstadoOrdenCompra;
  readonly valorTotal: number;
  /** US20 (FR-110): suma del IVA de las líneas. `valorTotal` sigue siendo la base gravable y el
   *  total con impuesto se deriva sumando los dos — nunca se almacena. */
  readonly valorIva: number;
  readonly motivoAnulacion: string | null;
}

export interface DetalleOrdenCompra {
  readonly id: number;
  readonly ordenCompraId: number;
  readonly productoId: number;
  readonly cantidad: number;
  /** Precio ESTIMADO. El real lo fija la factura del proveedor cuando la mercancía llega, y es
   *  el del ingreso —no este— el que alimenta el costo del inventario (FR-071). */
  readonly precioUnitario: number;
  readonly valorTotal: number;
  /** US20 (FR-109): tasa aplicada a ESTA línea y el impuesto que resulta. `0` en todo lo
   *  registrado antes de la historia. */
  readonly tasaIva: number;
  readonly valorIva: number;
}

/**
 * Transiciones válidas (data-model.md):
 *
 * ```text
 * BORRADOR ──enviar──▶ ENVIADA ──(el ingreso vinculado se recibe)──▶ RECIBIDA
 *     │                    │
 *     └──────anular────────┴──────────────────────────────────────▶ ANULADA
 * ```
 *
 * `RECIBIDA` y `ANULADA` son terminales. La transición a `RECIBIDA` NO la dispara una acción
 * del usuario sobre la orden: la dispara `recibir` del ingreso vinculado (FR-099), que es el
 * momento en que la mercancía existe de verdad.
 */
export function transicionValidaOrdenCompra(actual: EstadoOrdenCompra, siguiente: EstadoOrdenCompra): boolean {
  const transicionesValidas: Record<EstadoOrdenCompra, EstadoOrdenCompra[]> = {
    BORRADOR: ['ENVIADA', 'ANULADA'],
    ENVIADA: ['RECIBIDA', 'ANULADA'],
    RECIBIDA: [],
    ANULADA: [],
  };
  return transicionesValidas[actual].includes(siguiente);
}

/**
 * Una orden solo se edita mientras es BORRADOR (FR-096).
 *
 * No es una restricción técnica sino de honestidad documental: en cuanto se envía, el proveedor
 * tiene en la mano un PDF con un contenido concreto, y cambiarlo en el sistema sin que él se
 * entere haría que los dos lados creyeran cosas distintas sobre lo mismo. Para cambiar lo
 * pedido se anula y se crea otra, que deja rastro de las dos.
 */
export function puedeEditarseOrdenCompra(orden: Pick<OrdenCompra, 'estado'>): boolean {
  return orden.estado === 'BORRADOR';
}

/** Cantidad y precio de una línea, lo mínimo que exige el cálculo de su valor (FR-094). */
export interface LineaParaCalcularTotalOrden {
  readonly cantidad: number;
  readonly precioUnitario: number;
}

/** Redondeo monetario a 2 decimales (columnas `DECIMAL(_,2)`) — mismo criterio que `ingreso.ts`:
 *  el dinero nunca se maneja como `float` binario sin este control. */
export function redondearDosDecimales(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Valor de una línea: `cantidad × precioUnitario`, redondeado a 2 decimales (FR-094). */
export function calcularValorTotalLineaOrden(linea: LineaParaCalcularTotalOrden): number {
  return redondearDosDecimales(linea.cantidad * linea.precioUnitario);
}

/** Valor total de la orden: suma de sus líneas ya redondeadas (FR-094). No se vuelve a redondear
 *  la suma, para que el total coincida exactamente con lo que el usuario ve línea a línea —
 *  mismo comportamiento que `calcularValorTotalIngreso`. */
export function calcularValorTotalOrdenCompra(lineas: readonly LineaParaCalcularTotalOrden[]): number {
  return lineas.reduce((acumulado, linea) => acumulado + calcularValorTotalLineaOrden(linea), 0);
}

/**
 * Cantidad que se sugiere pedir de un producto bajo umbral (FR-098).
 *
 * Regla: llevar el disponible al DOBLE del umbral. Reponer justo hasta el umbral dejaría el
 * producto en alerta permanente —la alerta es `disponible <= umbral`, no `<`—, así que el doble
 * es el primer valor con margen real y explicable. Se redondea hacia arriba porque no se piden
 * fracciones de saco.
 *
 * Es una PROPUESTA: el usuario la cambia en el formulario antes de crear la orden. Por eso vive
 * en el dominio pero no se impone en ninguna validación.
 */
export function cantidadSugeridaDeCompra(disponible: number, umbralStockBajo: number): number {
  return Math.max(1, Math.ceil(umbralStockBajo * 2 - disponible));
}
