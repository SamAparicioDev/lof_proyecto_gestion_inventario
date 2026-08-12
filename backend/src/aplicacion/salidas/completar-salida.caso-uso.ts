/**
 * Caso de uso `CompletarSalidaCasoUso` — transición `CONFIRMADA → COMPLETADA`
 * (`POST /api/salidas/:id/completar`). `COMPLETADA` es terminal (data-model.md): cierre
 * administrativo de la entrega física, SIN efecto en stock (ya se descontó al confirmar).
 *
 * Carga la salida primero y valida explícitamente que esté `CONFIRMADA` antes de llamar al
 * repositorio, para un mensaje de negocio claro en el camino feliz —
 * `RepositorioSalidasPrisma.completar` repite la comprobación dentro de su transacción como
 * garantía atómica final (mismo criterio que `VerificarIngresoCasoUso`).
 *
 * Implementa: FR-029 (cierre de la máquina de estados de la salida).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';

/** Entrada: `usuarioId` viene del token de sesión, nunca del body (FR-045). */
export interface CompletarSalidaEntrada {
  readonly salidaId: number;
  readonly usuarioId: number;
}

@Injectable()
export class CompletarSalidaCasoUso implements CasoDeUso<CompletarSalidaEntrada, void> {
  constructor(@Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas) {}

  async ejecutar(entrada: CompletarSalidaEntrada): Promise<void> {
    const salida = await this.repositorioSalidas.buscarPorId(entrada.salidaId);
    if (!salida) {
      throw new NoEncontrado('La salida');
    }
    if (salida.estado !== 'CONFIRMADA') {
      throw new EstadoInvalido('Solo una salida CONFIRMADA puede completarse');
    }

    await this.repositorioSalidas.completar(entrada.salidaId, entrada.usuarioId);
  }
}
