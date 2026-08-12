/**
 * Caso de uso `ActualizarProyectoCasoUso` — edición de un proyecto existente
 * (`PUT /api/proyectos/:id`, FR-036). Ruta NO anidada bajo cliente (contracts/api-rest.md):
 * el `clienteId` no se edita tras el alta, por eso `DatosActualizarProyecto` (puerto) no lo
 * incluye y esta entrada tampoco.
 *
 * Delegación directa, sin pre-chequeo de existencia: el adaptador Prisma traduce `P2025`
 * a `NoEncontrado` dentro de su propio `try/catch` (mismo criterio que
 * `ActualizarClienteCasoUso`). El nombre duplicado dentro del cliente se traduce a
 * `Duplicado('nombre', ...)`.
 *
 * Implementa: FR-036 (edición de proyecto).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_PROYECTOS, type RepositorioProyectos } from '../../dominio/puertos/repositorio-proyectos';

/** Entrada: datos validados por `esquemaActualizarProyecto` + auditoría (FR-045). */
export interface ActualizarProyectoEntrada {
  readonly proyectoId: number;
  readonly nombre: string;
  readonly descripcion?: string;
  readonly fechaInicio?: string;
  readonly fechaCierreEstimada?: string;
  readonly responsable?: string;
  readonly presupuestoEstimado?: number;
  /** Quién edita el proyecto — nunca confiar en un valor del body (FR-045). */
  readonly usuarioId: number;
}

@Injectable()
export class ActualizarProyectoCasoUso implements CasoDeUso<ActualizarProyectoEntrada, void> {
  constructor(@Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos) {}

  async ejecutar(entrada: ActualizarProyectoEntrada): Promise<void> {
    await this.repositorioProyectos.actualizar(
      entrada.proyectoId,
      {
        nombre: entrada.nombre,
        descripcion: entrada.descripcion ?? null,
        fechaInicio: entrada.fechaInicio ? new Date(entrada.fechaInicio) : null,
        fechaCierreEstimada: entrada.fechaCierreEstimada ? new Date(entrada.fechaCierreEstimada) : null,
        responsable: entrada.responsable ?? null,
        presupuestoEstimado: entrada.presupuestoEstimado ?? null,
      },
      entrada.usuarioId,
    );
  }
}
