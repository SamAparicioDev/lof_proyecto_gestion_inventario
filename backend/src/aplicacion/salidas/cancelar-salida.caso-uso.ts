/**
 * Caso de uso `CancelarSalidaCasoUso` — transición `PENDIENTE → ANULADA` ("cancelar",
 * `POST /api/salidas/:id/cancelar`, contracts/api-rest.md § Salidas: body `{motivo}`). SIN
 * efecto en stock: una salida `PENDIENTE` nunca descontó `stock_actual`, solo comprometía
 * disponibilidad como agregado derivado (`RepositorioSalidas.comprometidoPorProducto`) — al
 * dejar de estar `PENDIENTE`, el compromiso se libera automáticamente, sin ninguna reversa
 * que aplicar.
 *
 * El motivo se valida aquí (mismo criterio que `AnularIngresoCasoUso`/`AnularSalidaCasoUso`:
 * el body `{motivo}` no tiene un esquema Zod nombrado en el contrato) con
 * `ErrorValidacionDominio`. Carga la salida primero y valida explícitamente que esté
 * `PENDIENTE` ANTES de llamar al repositorio, para un mensaje de negocio claro en el camino
 * feliz — `RepositorioSalidasPrisma.cancelar` repite la comprobación dentro de su propia
 * transacción como garantía final (mismo criterio que `VerificarIngresoCasoUso`).
 *
 * Implementa: FR-029 (una salida PENDIENTE es cancelable, libera el compromiso).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { ErrorValidacionDominio, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';

/** Entrada: `usuarioId` viene del token de sesión, nunca del body (FR-045). */
export interface CancelarSalidaEntrada {
  readonly salidaId: number;
  readonly usuarioId: number;
  readonly motivo: string;
}

@Injectable()
export class CancelarSalidaCasoUso implements CasoDeUso<CancelarSalidaEntrada, void> {
  constructor(@Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas) {}

  async ejecutar(entrada: CancelarSalidaEntrada): Promise<void> {
    const motivo = entrada.motivo.trim();
    if (!motivo) {
      throw new ErrorValidacionDominio('El motivo de cancelación es obligatorio', {
        motivo: 'El motivo de cancelación es obligatorio',
      });
    }

    const salida = await this.repositorioSalidas.buscarPorId(entrada.salidaId);
    if (!salida) {
      throw new NoEncontrado('La salida');
    }
    if (salida.estado !== 'PENDIENTE') {
      throw new EstadoInvalido('Solo una salida PENDIENTE puede cancelarse');
    }

    await this.repositorioSalidas.cancelar(entrada.salidaId, entrada.usuarioId, motivo);
  }
}
