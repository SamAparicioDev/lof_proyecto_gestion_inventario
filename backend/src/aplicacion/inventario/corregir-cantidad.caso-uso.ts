/**
 * Caso de uso `CorregirCantidadCasoUso` — cuadra el stock de un producto con el conteo físico
 * (`PUT /api/inventario/:productoId/cantidad`, US31, FR-130).
 *
 * ## Por qué existe pudiendo hacerse con documentos
 *
 * Hasta esta historia, corregir una diferencia de conteo obligaba a fabricar un documento: un
 * ingreso para lo que sobraba y una salida —con cliente— para lo que faltaba. Inventar un cliente
 * para justificar una merma mete un dato falso en la tabla que responde "¿cuánto consumió el
 * cliente X?", que es la pregunta que justifica el sistema entero. US29 quitó esa mentira de la
 * entrada; esta la quita de la salida.
 *
 * ## Lo que NO es
 *
 * No es una excepción a la trazabilidad. La corrección corre dentro de la `UnidadDeTrabajo` con
 * `FOR UPDATE` (Principio I) y deja un `movimientos_inventario` por la DIFERENCIA, con su motivo
 * obligatorio y su usuario (Principio II). Lo único que no tiene es documento — y por eso el
 * movimiento nace con `documentoTipo: AJUSTE`, en vez de fingir que lo respalda una factura.
 *
 * El caso de uso es delgado a propósito: las dos reglas de negocio (no corregir a la misma
 * cantidad, no dejar el stock negativo) viven en `ServicioStock.aplicarCorreccion`, y la atomicidad
 * en el adaptador — que es donde puede garantizarse. Aquí solo se compone.
 *
 * Implementa: FR-130 (corrección con motivo y movimiento por la diferencia), FR-045 (quién y
 * cuándo), FR-131 (la protege el permiso `inventario.ajustar`, exigido en el controlador).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import { AvisadorDeNotificaciones } from '../notificaciones/avisador-notificaciones';

/** Entrada: lo validado por `esquemaCorregirCantidad` más quién ejecuta (FR-045). */
export interface CorregirCantidadEntrada {
  readonly productoId: number;
  /** Cantidad CONTADA, no la diferencia — ver `ServicioStock.aplicarCorreccion`. */
  readonly cantidad: number;
  readonly motivo: string;
  /** Quién corrige — del token, nunca del cuerpo (FR-045). */
  readonly usuarioId: number;
}

@Injectable()
export class CorregirCantidadCasoUso implements CasoDeUso<CorregirCantidadEntrada, void> {
  constructor(
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    private readonly avisador: AvisadorDeNotificaciones,
  ) {}

  async ejecutar(entrada: CorregirCantidadEntrada): Promise<void> {
    // US35: la cantidad ANTERIOR se lee antes de corregir porque después ya no existe en ninguna
    // parte salvo en el movimiento de ajuste. Es una lectura FUERA de la transacción y solo
    // alimenta el texto del aviso: si otro usuario mueve el producto en ese instante, el aviso
    // podría citar una cifra de hace un segundo, pero el stock que queda lo decide la
    // transacción de `corregirCantidad` (Principio I), no esto.
    const [antes] = await this.repositorioProductos.buscarPorIds([entrada.productoId]);

    await this.repositorioProductos.corregirCantidad({
      productoId: entrada.productoId,
      cantidad: entrada.cantidad,
      motivo: entrada.motivo,
      usuarioId: entrada.usuarioId,
    });

    if (!antes) return;

    // Escribir el stock a mano es la única operación capaz de desmentir a todos los documentos
    // (FR-130), así que se avisa SIEMPRE, suba o baje. Y si bajó, además puede cruzar el umbral.
    await this.avisador.cantidadCorregida(entrada.productoId, entrada.usuarioId, {
      anterior: antes.stockActual,
      nueva: entrada.cantidad,
      motivo: entrada.motivo,
    });
    const baja = antes.stockActual - entrada.cantidad;
    if (baja > 0) {
      await this.avisador.revisarUmbrales([{ productoId: entrada.productoId, cantidad: baja }], entrada.usuarioId);
    }
  }
}
