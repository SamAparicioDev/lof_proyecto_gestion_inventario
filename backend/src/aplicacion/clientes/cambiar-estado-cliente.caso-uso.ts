/**
 * Caso de uso `CambiarEstadoClienteCasoUso` — activa/desactiva un cliente
 * (`PUT /api/clientes/:id/estado`, baja lógica — Principio II/III: nunca DELETE).
 * Delegación directa al puerto: `RepositorioClientesPrisma.cambiarEstado` traduce `P2025`
 * a `NoEncontrado` si el id no existe.
 *
 * Nota de negocio (FR-038): un cliente `INACTIVO` deja de aportar destinos válidos de
 * salida para CUALQUIERA de sus proyectos — la regla la evalúa `esDestinoValido`
 * (`dominio/entidades/proyecto.ts`) y la aplica `proyectosDestino` en lectura; este caso de
 * uso no necesita recalcular nada, el cambio de estado por sí solo basta.
 *
 * Implementa: FR-034 (gestión del ciclo de vida del cliente), FR-038 (efecto en destino de
 * salidas de sus proyectos).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import type { EstadoCliente } from '../../dominio/entidades/cliente';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';

/** Entrada: `estado` validado por `esquemaCambiarEstadoCliente` + auditoría (FR-045). */
export interface CambiarEstadoClienteEntrada {
  readonly clienteId: number;
  readonly estado: EstadoCliente;
  readonly usuarioId: number;
}

@Injectable()
export class CambiarEstadoClienteCasoUso implements CasoDeUso<CambiarEstadoClienteEntrada, void> {
  constructor(@Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes) {}

  async ejecutar(entrada: CambiarEstadoClienteEntrada): Promise<void> {
    await this.repositorioClientes.cambiarEstado(entrada.clienteId, entrada.estado, entrada.usuarioId);
  }
}
