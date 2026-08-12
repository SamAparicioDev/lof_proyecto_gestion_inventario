/**
 * Caso de uso `ActualizarClienteCasoUso` — edición de los datos de contacto de un cliente
 * existente (`PUT /api/clientes/:id`, FR-034). Mismo mapeo `undefined → null` de campos
 * opcionales que `CrearClienteCasoUso` (comparten exactamente el mismo esquema Zod).
 *
 * Sin pre-chequeo de existencia: el adaptador Prisma traduce `P2025` (registro inexistente)
 * a `NoEncontrado` dentro de su propio `try/catch` — repetir la búsqueda aquí sería
 * redundante (Principio V, YAGNI). El NIT duplicado se traduce a `Duplicado('nit', ...)`
 * igual que en el alta (FR-035).
 *
 * Implementa: FR-034 (edición de cliente), FR-035 (unicidad de NIT).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';

/** Entrada: datos validados por `esquemaActualizarCliente` + auditoría (FR-045). */
export interface ActualizarClienteEntrada {
  readonly clienteId: number;
  readonly nombre: string;
  readonly nit: string;
  readonly telefono?: string;
  readonly email?: string;
  readonly direccion?: string;
  readonly ciudad?: string;
  /** Quién edita el cliente — nunca confiar en un valor del body (FR-045). */
  readonly usuarioId: number;
}

@Injectable()
export class ActualizarClienteCasoUso implements CasoDeUso<ActualizarClienteEntrada, void> {
  constructor(@Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes) {}

  async ejecutar(entrada: ActualizarClienteEntrada): Promise<void> {
    await this.repositorioClientes.actualizar(
      entrada.clienteId,
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
  }
}
