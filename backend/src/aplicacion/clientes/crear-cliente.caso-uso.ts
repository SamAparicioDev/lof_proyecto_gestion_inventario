/**
 * Caso de uso `CrearClienteCasoUso` — alta de un cliente del catálogo comercial
 * (`POST /api/clientes`, FR-034). Adapta la entrada YA VALIDADA en forma por
 * `esquemaCrearCliente` (los campos opcionales llegan como `string | undefined`) al puerto
 * `RepositorioClientes.crear`, que espera `string | null` (mismo criterio que
 * `crear-ingreso.caso-uso.ts` con `observaciones`), y embebe el `usuarioId` de auditoría
 * (FR-045).
 *
 * Delegación directa: el NIT duplicado ya lo traduce el adaptador Prisma a
 * `Duplicado('nit', ...)` (FR-035), así que este caso de uso no pre-valida unicidad ni
 * captura el error — lo hace el filtro global (docs/arquitectura.md §3).
 *
 * Implementa: FR-034 (alta de cliente con datos de contacto), FR-035 (unicidad de NIT).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';

/** Entrada: datos validados por `esquemaCrearCliente` + auditoría (FR-045). */
export interface CrearClienteEntrada {
  readonly nombre: string;
  readonly nit: string;
  readonly telefono?: string;
  readonly email?: string;
  readonly direccion?: string;
  readonly ciudad?: string;
  /** Quién da de alta el cliente — nunca confiar en un valor del body (FR-045). */
  readonly usuarioId: number;
}

export interface CrearClienteSalida {
  readonly id: number;
}

@Injectable()
export class CrearClienteCasoUso implements CasoDeUso<CrearClienteEntrada, CrearClienteSalida> {
  constructor(@Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes) {}

  async ejecutar(entrada: CrearClienteEntrada): Promise<CrearClienteSalida> {
    const cliente = await this.repositorioClientes.crear(
      {
        nombre: entrada.nombre,
        nit: entrada.nit,
        telefono: entrada.telefono ?? null,
        email: entrada.email ?? null,
        direccion: entrada.direccion ?? null,
        ciudad: entrada.ciudad ?? null,
      },
      entrada.usuarioId,
    );
    return { id: cliente.id };
  }
}
