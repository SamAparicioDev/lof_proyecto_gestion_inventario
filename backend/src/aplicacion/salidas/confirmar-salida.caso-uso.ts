/**
 * Caso de uso `ConfirmarSalidaCasoUso` — transición `PENDIENTE → CONFIRMADA`
 * (`POST /api/salidas/:id/confirmar`). Delegación directa: TODA la orquestación atómica
 * (bloqueo `FOR UPDATE`, `ServicioStock.aplicarSalida` contra el `stockActual` real,
 * movimientos `SALIDA`, `usuario_autoriza_id`/`fecha_confirmacion`) vive en
 * `RepositorioSalidasPrisma.confirmar` dentro de una única transacción (research R4, mismo
 * patrón que `RecibirIngresoCasoUso`) — no hay regla de negocio adicional que aplicar en
 * esta capa antes de invocarla, y un pre-chequeo de estado aquí sería una lectura redundante
 * fuera de la transacción (el propio repositorio valida `PENDIENTE` y lanza
 * `EstadoInvalido`/`NoEncontrado`, y `DisponibilidadInsuficiente` si alguna línea excede el
 * stock real bloqueado, dentro de ella).
 *
 * Implementa: FR-028 (revalidación atómica de disponibilidad al confirmar, el invariante
 * crítico del Principio I), FR-029/FR-030 (fija autorizante y fecha de confirmación).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';

/** Entrada: `usuarioId` viene del token de sesión, nunca del body (FR-045). */
export interface ConfirmarSalidaEntrada {
  readonly salidaId: number;
  readonly usuarioId: number;
}

@Injectable()
export class ConfirmarSalidaCasoUso implements CasoDeUso<ConfirmarSalidaEntrada, void> {
  constructor(@Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas) {}

  async ejecutar(entrada: ConfirmarSalidaEntrada): Promise<void> {
    await this.repositorioSalidas.confirmar(entrada.salidaId, entrada.usuarioId);
  }
}
