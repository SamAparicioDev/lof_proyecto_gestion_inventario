/**
 * Caso de uso `CrearProyectoCasoUso` — alta de un proyecto para un cliente existente
 * (`POST /api/clientes/:id/proyectos`, FR-036). El `:id` de la ruta ES el `clienteId`: no
 * viaja en el body (ruta anidada, ver TSDoc de `DatosNuevoProyecto`).
 *
 * Verifica primero que el cliente exista — `NoEncontrado` si no — ANTES de intentar el
 * alta: a diferencia del NIT (constraint física en `clientes`), aquí no hay ninguna
 * violación que Postgres reporte de forma legible si el `clienteId` no existe (sería una
 * violación de FK sin traducción en `repositorio-proyectos.prisma.ts`); comprobarlo aquí da
 * el `404` correcto del contrato en vez de un error técnico sin traducir.
 *
 * Adapta los campos opcionales ya validados en forma por `esquemaCrearProyecto`
 * (`string | undefined`, fechas en texto ISO) al puerto `RepositorioProyectos.crear`
 * (`string | null` / `Date | null`), mismo criterio que `crear-ingreso.caso-uso.ts`.
 *
 * Implementa: FR-036 (alta de proyecto asociado a un cliente, con nombre único por
 * cliente — `Duplicado('nombre', ...)` lo traduce el adaptador, no se captura aquí).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { NoEncontrado } from '../../dominio/comunes/errores';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';
import { REPOSITORIO_PROYECTOS, type RepositorioProyectos } from '../../dominio/puertos/repositorio-proyectos';

/** Entrada: datos validados por `esquemaCrearProyecto` + `clienteId` de la ruta + auditoría (FR-045). */
export interface CrearProyectoEntrada {
  readonly clienteId: number;
  readonly nombre: string;
  readonly descripcion?: string;
  readonly fechaInicio?: string;
  readonly fechaCierreEstimada?: string;
  readonly responsable?: string;
  readonly presupuestoEstimado?: number;
  /** Quién da de alta el proyecto — nunca confiar en un valor del body (FR-045). */
  readonly usuarioId: number;
}

export interface CrearProyectoSalida {
  readonly id: number;
}

@Injectable()
export class CrearProyectoCasoUso implements CasoDeUso<CrearProyectoEntrada, CrearProyectoSalida> {
  constructor(
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
    @Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos,
  ) {}

  async ejecutar(entrada: CrearProyectoEntrada): Promise<CrearProyectoSalida> {
    const cliente = await this.repositorioClientes.buscarPorId(entrada.clienteId);
    if (!cliente) {
      throw new NoEncontrado('El cliente');
    }

    const proyecto = await this.repositorioProyectos.crear(
      {
        clienteId: entrada.clienteId,
        nombre: entrada.nombre,
        descripcion: entrada.descripcion ?? null,
        fechaInicio: entrada.fechaInicio ? new Date(entrada.fechaInicio) : null,
        fechaCierreEstimada: entrada.fechaCierreEstimada ? new Date(entrada.fechaCierreEstimada) : null,
        responsable: entrada.responsable ?? null,
        presupuestoEstimado: entrada.presupuestoEstimado ?? null,
      },
      entrada.usuarioId,
    );
    return { id: proyecto.id };
  }
}
