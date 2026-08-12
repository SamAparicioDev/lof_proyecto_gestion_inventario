/**
 * Caso de uso `VerificarIngresoCasoUso` — transición `RECIBIDO → VERIFICADO`
 * (`POST /api/ingresos/:id/verificar`, solo Gerente/Administrador). `VERIFICADO` es
 * terminal e inmutable (data-model.md): sin efecto en stock, es un cierre administrativo.
 *
 * Carga el ingreso primero y valida explícitamente que esté `RECIBIDO` antes de llamar al
 * repositorio, para un mensaje de negocio claro en el camino feliz — el propio
 * `RepositorioIngresosPrisma.verificar` repite la comprobación dentro de su transacción
 * como garantía atómica final (mismo criterio que `actualizar-ingreso.caso-uso.ts`).
 *
 * Implementa: FR-017 (máquina de estados del ingreso — cierre de la transición RECIBIDO→VERIFICADO).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import { REPOSITORIO_INGRESOS, type RepositorioIngresos } from '../../dominio/puertos/repositorio-ingresos';

/** Entrada: `usuarioId` viene del token de sesión, nunca del body (FR-045). */
export interface VerificarIngresoEntrada {
  readonly ingresoId: number;
  readonly usuarioId: number;
}

@Injectable()
export class VerificarIngresoCasoUso implements CasoDeUso<VerificarIngresoEntrada, void> {
  constructor(@Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos) {}

  async ejecutar(entrada: VerificarIngresoEntrada): Promise<void> {
    const ingreso = await this.repositorioIngresos.buscarPorId(entrada.ingresoId);
    if (!ingreso) {
      throw new NoEncontrado('El ingreso');
    }
    if (ingreso.estado !== 'RECIBIDO') {
      throw new EstadoInvalido('Solo un ingreso RECIBIDO puede verificarse');
    }

    await this.repositorioIngresos.verificar(entrada.ingresoId, entrada.usuarioId);
  }
}
