/**
 * Caso de uso `RecibirIngresoCasoUso` — transición `PENDIENTE → RECIBIDO`
 * (`POST /api/ingresos/:id/recibir`). Delegación directa: toda la orquestación atómica
 * (bloqueo `FOR UPDATE`, `ServicioStock.aplicarEntrada`, movimientos `ENTRADA`,
 * `ultimo_costo`/`fecha_ultimo_movimiento`) vive en `RepositorioIngresosPrisma.recibir`
 * dentro de una única transacción (research R4) — no hay regla de negocio adicional que
 * aplicar en esta capa antes de invocarla; el propio repositorio valida el estado y lanza
 * `EstadoInvalido`/`NoEncontrado` si corresponde.
 *
 * Implementa: FR-017 (recibir sube el stock atómicamente) y FR-021 (movimientos con
 * `stock_resultante` auditado).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_INGRESOS, type RepositorioIngresos } from '../../dominio/puertos/repositorio-ingresos';
import { AvisadorDeNotificaciones } from '../notificaciones/avisador-notificaciones';

/** Entrada: `usuarioId` viene del token de sesión, nunca del body (FR-045). */
export interface RecibirIngresoEntrada {
  readonly ingresoId: number;
  readonly usuarioId: number;
}

@Injectable()
export class RecibirIngresoCasoUso implements CasoDeUso<RecibirIngresoEntrada, void> {
  constructor(
    @Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos,
    private readonly avisador: AvisadorDeNotificaciones,
  ) {}

  async ejecutar(entrada: RecibirIngresoEntrada): Promise<void> {
    await this.repositorioIngresos.recibir(entrada.ingresoId, entrada.usuarioId);

    // US35 (FR-139): entró mercancía y el stock ya subió. Sin umbrales que revisar — recibir
    // solo puede sacar a un producto de "bajo", nunca meterlo.
    await this.avisador.ingresoRecibido(entrada.ingresoId, entrada.usuarioId);
  }
}
