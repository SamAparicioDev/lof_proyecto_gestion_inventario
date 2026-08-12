/**
 * Caso de uso `AnularSalidaCasoUso` — transición `CONFIRMADA → ANULADA` (FR-032,
 * `POST /api/salidas/:id/anular`, solo Gerente/Administrador, motivo obligatorio).
 * `COMPLETADA` (terminal) nunca se anula, y `PENDIENTE` se CANCELA, no se anula (ver
 * `CancelarSalidaCasoUso`) — por eso se valida con IGUALDAD DIRECTA contra `CONFIRMADA`, NO
 * con `transicionValidaSalida` (mismo criterio documentado en el TSDoc de cabecera de
 * `repositorio-salidas.prisma.ts`: ambas transiciones de la máquina terminan en `ANULADA`,
 * así que el chequeo genérico aceptaría erróneamente un origen `PENDIENTE` aquí).
 *
 * El motivo se valida aquí (el body `{motivo}` no tiene esquema Zod nombrado en el
 * contrato), mismo criterio que `AnularIngresoCasoUso`. Si la salida estaba `CONFIRMADA`,
 * `RepositorioSalidasPrisma.anular` revierte el stock atómicamente
 * (`ServicioStock.aplicarEntrada`, movimiento tipo `AJUSTE_ENTRADA`) ANTES de marcar
 * `ANULADA` — esta capa no captura esa reversa, solo valida el origen antes de invocarla.
 *
 * Implementa: FR-032 (anulación con motivo y reversa de stock).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { ErrorValidacionDominio, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';

/** Entrada: `usuarioId` viene del token de sesión, nunca del body (FR-045). */
export interface AnularSalidaEntrada {
  readonly salidaId: number;
  readonly usuarioId: number;
  readonly motivo: string;
}

@Injectable()
export class AnularSalidaCasoUso implements CasoDeUso<AnularSalidaEntrada, void> {
  constructor(@Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas) {}

  async ejecutar(entrada: AnularSalidaEntrada): Promise<void> {
    const motivo = entrada.motivo.trim();
    if (!motivo) {
      throw new ErrorValidacionDominio('El motivo de anulación es obligatorio', {
        motivo: 'El motivo de anulación es obligatorio',
      });
    }

    const salida = await this.repositorioSalidas.buscarPorId(entrada.salidaId);
    if (!salida) {
      throw new NoEncontrado('La salida');
    }
    if (salida.estado !== 'CONFIRMADA') {
      throw new EstadoInvalido(`Una salida ${salida.estado} no puede anularse`);
    }

    await this.repositorioSalidas.anular(entrada.salidaId, entrada.usuarioId, motivo);
  }
}
