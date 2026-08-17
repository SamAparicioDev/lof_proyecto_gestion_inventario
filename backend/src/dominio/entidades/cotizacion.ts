/**
 * Entidad de dominio `Cotizacion` (oferta a un cliente) y `DetalleCotizacion` (línea) —
 * TypeScript puro (Principio VI, NO NEGOCIABLE). Campos espejo de las tablas
 * `cotizaciones`/`detalles_cotizaciones` de `data-model.md`, con tipos PROPIOS del dominio.
 *
 * Es el reflejo de `orden-compra.ts` mirando al cliente en vez de al proveedor, y comparte su
 * afirmación central: **una cotización no mueve stock en ningún estado** (FR-113). Hay que
 * decirlo aquí explícitamente porque su forma es casi la de una salida y la intuición dice lo
 * contrario — ofrecer 100 sacos no es entregarlos, ni siquiera apartarlos. `ACEPTADA` no
 * significa que esta entidad haya restado nada: significa que nació una `Salida` PENDIENTE
 * (FR-115), y es esa la que compromete y mueve el inventario cuando se confirma.
 *
 * ## "Vencida" no es un estado
 *
 * Se DERIVA comparando `fechaValidez` con hoy. Un estado exigiría que alguien —o un proceso
 * programado que no existe— lo marcara, y produciría documentos "vigentes" solo porque nadie
 * pasó a caducarlos. Además una cotización vencida sigue siendo una cotización ENVIADA: el
 * cliente todavía puede responderla y el vendedor decidir si sostiene el precio. Modelarlo como
 * estado obligaría a inventar transiciones para volver atrás.
 *
 * Implementa: FR-112 (documento con correlativo, cliente/proyecto y líneas), FR-113 (no mueve
 * inventario), FR-114 (solo editable en BORRADOR), FR-115 (aceptar genera la salida).
 */

/** Máquina de estados de una cotización (data-model.md — FR-112). */
export type EstadoCotizacion = 'BORRADOR' | 'ENVIADA' | 'ACEPTADA' | 'RECHAZADA' | 'ANULADA';

export interface Cotizacion {
  readonly id: number;
  /** Correlativo asignado por el sistema al crearla (FR-112). */
  readonly numero: number;
  /** Viajan RESUELTOS —id y nombre—, igual que `Ingreso.proveedor`: el nombre es lo que muestran
   *  todas las pantallas y el documento que se le envía al cliente. */
  readonly cliente: { readonly id: number; readonly nombre: string };
  readonly proyecto: { readonly id: number; readonly nombre: string };
  readonly fecha: Date;
  /** Hasta cuándo se sostiene el precio ofrecido. */
  readonly fechaValidez: Date;
  readonly observaciones: string | null;
  readonly estado: EstadoCotizacion;
  /** Base gravable. El total con impuesto se deriva sumándole `valorIva` (US20, FR-110). */
  readonly valorTotal: number;
  readonly valorIva: number;
  readonly motivoAnulacion: string | null;
  /** Salida generada al aceptarla (FR-115), o `null` mientras no se haya aceptado. */
  readonly salidaId: number | null;
}

export interface DetalleCotizacion {
  readonly id: number;
  readonly cotizacionId: number;
  readonly productoId: number;
  readonly cantidad: number;
  /** Precio OFRECIDO al cliente. Es el que viaja a la salida al aceptar la cotización, para que
   *  se le facture lo mismo que se le cotizó. */
  readonly precioUnitario: number;
  readonly valorTotal: number;
  readonly tasaIva: number;
  readonly valorIva: number;
}

/**
 * Transiciones válidas (data-model.md — FR-112):
 *
 * ```text
 * BORRADOR ──enviar──▶ ENVIADA ──aceptar──▶ ACEPTADA
 *     │                    │
 *     │                    ├──rechazar────▶ RECHAZADA
 *     └──────anular────────┴──────────────▶ ANULADA
 * ```
 *
 * Las tres finales son terminales. `ACEPTADA` no se anula: para entonces ya existe una salida
 * con vida propia (FR-115), y lo que hay que anular es esa — anular la cotización dejaría el
 * documento que sí compromete inventario colgando de una oferta cancelada.
 */
export function transicionValidaCotizacion(actual: EstadoCotizacion, siguiente: EstadoCotizacion): boolean {
  const transicionesValidas: Record<EstadoCotizacion, EstadoCotizacion[]> = {
    BORRADOR: ['ENVIADA', 'ANULADA'],
    ENVIADA: ['ACEPTADA', 'RECHAZADA', 'ANULADA'],
    ACEPTADA: [],
    RECHAZADA: [],
    ANULADA: [],
  };
  return transicionesValidas[actual].includes(siguiente);
}

/**
 * Una cotización solo se edita mientras es BORRADOR (FR-114).
 *
 * Mismo criterio que la orden de compra, y por el mismo motivo: en cuanto se envía, el cliente
 * tiene en la mano un PDF con precios concretos. Cambiarlos en el sistema sin que él se entere
 * haría que los dos lados creyeran cosas distintas sobre el mismo documento. Para cambiar la
 * oferta se anula y se hace otra, que deja rastro de las dos.
 */
export function puedeEditarseCotizacion(cotizacion: Pick<Cotizacion, 'estado'>): boolean {
  return cotizacion.estado === 'BORRADOR';
}

/**
 * `true` si la validez ya pasó (FR-112). Se compara por DÍA, no por instante: una cotización
 * válida "hasta el 20" lo es durante todo el día 20, que es como lo lee cualquiera que reciba
 * el documento.
 *
 * `hoy` se recibe como parámetro en vez de leer el reloj aquí dentro: así la función es pura y
 * la prueba no depende de cuándo se ejecute.
 */
export function estaVencida(cotizacion: Pick<Cotizacion, 'fechaValidez' | 'estado'>, hoy: Date): boolean {
  // Solo tiene sentido hablar de vencimiento mientras la oferta sigue viva: una cotización ya
  // aceptada, rechazada o anulada terminó su camino, y marcarla "vencida" sería ruido.
  if (cotizacion.estado !== 'ENVIADA' && cotizacion.estado !== 'BORRADOR') return false;

  const soloDia = (fecha: Date): number =>
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  return soloDia(cotizacion.fechaValidez) < soloDia(hoy);
}
