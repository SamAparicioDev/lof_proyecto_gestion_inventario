/**
 * `registrarCambioDeCosto` — helper de persistencia compartido por los DOS repositorios que
 * escriben `productos.ultimo_costo` (US12, T126):
 *
 *   - `RepositorioProductosPrisma.actualizarCosto` → edición manual y carga masiva
 *   - `RepositorioIngresosPrisma.recibir`          → recepción de mercancía
 *
 * Por qué existe (DRY, docs/arquitectura.md §5): los dos deben aplicar la MISMA regla —
 * consultar al dominio si el costo cambió y, solo entonces, insertar la fila de
 * `historial_costos_producto` en la MISMA transacción que el `UPDATE` del costo. Duplicar ese
 * par en dos adaptadores es exactamente cómo aparece, con el tiempo, un camino que actualiza
 * el costo sin dejar rastro (el hueco preexistente que US12 cierra en `recibir`).
 *
 * Recibe el `tx` YA ABIERTO por el llamador y no abre ninguno propio: la atomicidad
 * "costo + registro" es responsabilidad de la transacción de quien llama (research R4, mismo
 * criterio con el que `ServicioStock` se usa dentro de `recibir`/`confirmar`). La DECISIÓN de
 * negocio no vive aquí: la toma `aplicarCambioDeCosto` (dominio puro, FR-074); este archivo
 * solo traduce su resultado a un `INSERT` de Prisma.
 *
 * Lo que NO hace, a propósito: NO escribe en `movimientos_inventario` (FR-073) ni toca
 * `stock_actual`. Un cambio de costo no mueve cantidades; registrarlo como movimiento rompería
 * el invariante `stock = Σ movimientos` (invariante 2 de data-model.md).
 *
 * Implementa: FR-072 (registro permanente de todo cambio de costo, en la misma transacción),
 * FR-073 (nunca un movimiento de inventario), FR-074 (solo si el costo REALMENTE cambió).
 */
import type { OrigenCambioCosto as OrigenCambioCostoPrisma } from '@prisma/client';
import type { OrigenCambioCosto } from '../../dominio/entidades/cambio-costo-producto';
import {
  aplicarCambioDeCosto,
  type SolicitudCambioCosto,
} from '../../dominio/servicios/servicio-costo-producto';
import type { PrismaTransactionClient } from './unidad-de-trabajo';

/**
 * Registra el cambio de costo si lo hay. Devuelve el costo que debe quedar en
 * `productos.ultimo_costo` (ya redondeado a los decimales de la columna) o `null` si no hubo
 * cambio — en cuyo caso el llamador no debe escribir nada.
 *
 * El valor devuelto y el `costo_nuevo` de la fila insertada son el MISMO número: es lo que
 * garantiza que la ficha del producto y su historial nunca muestren cifras distintas.
 */
export async function registrarCambioDeCosto(
  tx: PrismaTransactionClient,
  solicitud: SolicitudCambioCosto,
): Promise<number | null> {
  const registro = aplicarCambioDeCosto(solicitud);
  if (!registro) return null;

  await tx.historialCostoProducto.create({
    data: {
      productoId: BigInt(registro.productoId),
      costoAnterior: registro.costoAnterior,
      costoNuevo: registro.costoNuevo,
      origen: mapearOrigenAPrisma(registro.origen),
      documentoId: registro.documentoId === null ? null : BigInt(registro.documentoId),
      usuarioId: BigInt(registro.usuarioId),
    },
  });

  return registro.costoNuevo;
}

/** Traduce el origen del dominio al enum de Prisma — el `default` inalcanzable obliga al
 *  compilador a revisar este `switch` si mañana se agrega un cuarto origen (mismo patrón que
 *  los mapeos de estado del resto de adaptadores). */
export function mapearOrigenAPrisma(origen: OrigenCambioCosto): OrigenCambioCostoPrisma {
  switch (origen) {
    case 'IMPORTACION':
      return 'IMPORTACION';
    case 'EDICION_MANUAL':
      return 'EDICION_MANUAL';
    case 'RECEPCION_INGRESO':
      return 'RECEPCION_INGRESO';
    default: {
      const valorInesperado: never = origen;
      throw new Error(`Origen de cambio de costo de dominio sin mapeo a Prisma: ${String(valorInesperado)}`);
    }
  }
}

/** Traduce el origen de Prisma al tipo del dominio — inverso de `mapearOrigenAPrisma`; lo usa
 *  `repositorio-historial-costos.prisma.ts` al leer. */
export function mapearOrigenADominio(origen: OrigenCambioCostoPrisma): OrigenCambioCosto {
  switch (origen) {
    case 'IMPORTACION':
      return 'IMPORTACION';
    case 'EDICION_MANUAL':
      return 'EDICION_MANUAL';
    case 'RECEPCION_INGRESO':
      return 'RECEPCION_INGRESO';
    default: {
      const valorInesperado: never = origen;
      throw new Error(`Origen de cambio de costo de Prisma sin mapeo al dominio: ${String(valorInesperado)}`);
    }
  }
}
