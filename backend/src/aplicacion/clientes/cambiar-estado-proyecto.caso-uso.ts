/**
 * Caso de uso `CambiarEstadoProyectoCasoUso` — transición de estado de un proyecto
 * (`PUT /api/proyectos/:id/estado` → ACTIVO/COMPLETADO/SUSPENDIDO, US2-AS4). Delegación
 * directa: `RepositorioProyectosPrisma.cambiarEstado` traduce `P2025` a `NoEncontrado`.
 *
 * Nota de negocio (FR-038): un proyecto que deja de estar `ACTIVO` deja de ser destino
 * válido de nuevas salidas de inmediato — `esDestinoValido` (`dominio/entidades/
 * proyecto.ts`) ya lo refleja porque `proyectosDestino` filtra en lectura; no hay estado
 * derivado que recalcular aquí.
 *
 * Implementa: FR-036 (máquina de estados del proyecto), FR-038 (efecto en destino de
 * salidas).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import type { EstadoProyecto } from '../../dominio/entidades/proyecto';
import { REPOSITORIO_PROYECTOS, type RepositorioProyectos } from '../../dominio/puertos/repositorio-proyectos';

/** Entrada: `estado` validado por `esquemaCambiarEstadoProyecto` + auditoría (FR-045). */
export interface CambiarEstadoProyectoEntrada {
  readonly proyectoId: number;
  readonly estado: EstadoProyecto;
  readonly usuarioId: number;
}

@Injectable()
export class CambiarEstadoProyectoCasoUso implements CasoDeUso<CambiarEstadoProyectoEntrada, void> {
  constructor(@Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos) {}

  async ejecutar(entrada: CambiarEstadoProyectoEntrada): Promise<void> {
    await this.repositorioProyectos.cambiarEstado(entrada.proyectoId, entrada.estado, entrada.usuarioId);
  }
}
