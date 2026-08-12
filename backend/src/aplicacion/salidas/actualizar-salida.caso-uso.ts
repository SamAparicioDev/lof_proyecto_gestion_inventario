/**
 * Caso de uso `ActualizarSalidaCasoUso` — reemplaza cabecera y líneas de una salida
 * `PENDIENTE` (`PUT /api/salidas/:id`). Mismas dos validaciones de negocio que
 * `CrearSalidaCasoUso` (destino válido + disponibilidad por línea, ver
 * `validar-destino-salida.ts`/`validar-disponibilidad-lineas.ts`), con una diferencia clave
 * en la segunda: el cálculo de `disponible` EXCLUYE el compromiso de la propia salida
 * (`excluirSalidaId`) — de lo contrario, editar una salida existente le restaría su propio
 * compromiso a sí misma, rechazando ediciones válidas que no cambian la cantidad total.
 *
 * Carga la salida primero y valida el estado ANTES de las validaciones de negocio más
 * costosas — mismo criterio que `ActualizarIngresoCasoUso`: la comprobación real y atómica
 * contra carreras sigue viviendo en `RepositorioSalidasPrisma.actualizar` (dentro de su
 * propia transacción), esta capa solo mejora el mensaje del camino feliz.
 *
 * Implementa: FR-025 (edición de cabecera y líneas), FR-027/FR-038 (destino válido) y
 * FR-028 (disponibilidad por línea, excluyendo el compromiso propio).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import { REPOSITORIO_PROYECTOS, type RepositorioProyectos } from '../../dominio/puertos/repositorio-proyectos';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';
import type { LineaCrearSalidaEntrada } from './crear-salida.caso-uso';
import { validarDestinoSalida } from './validar-destino-salida';
import { validarDisponibilidadLineas } from './validar-disponibilidad-lineas';

/** Entrada: datos validados por `esquemaActualizarSalida` + auditoría (FR-045). */
export interface ActualizarSalidaEntrada {
  readonly salidaId: number;
  readonly proyectoId: number;
  readonly fechaSalida: string;
  readonly observaciones: string | null;
  readonly lineas: readonly LineaCrearSalidaEntrada[];
  /** Quién edita la salida — nunca confiar en un valor del body (FR-045). */
  readonly usuarioId: number;
}

@Injectable()
export class ActualizarSalidaCasoUso implements CasoDeUso<ActualizarSalidaEntrada, void> {
  constructor(
    @Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos,
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
  ) {}

  async ejecutar(entrada: ActualizarSalidaEntrada): Promise<void> {
    const salida = await this.repositorioSalidas.buscarPorId(entrada.salidaId);
    if (!salida) {
      throw new NoEncontrado('La salida');
    }
    if (salida.estado !== 'PENDIENTE') {
      throw new EstadoInvalido('Solo una salida PENDIENTE puede editarse');
    }

    await validarDestinoSalida(this.repositorioProyectos, this.repositorioClientes, entrada.proyectoId);
    await validarDisponibilidadLineas(
      this.repositorioProductos,
      this.repositorioSalidas,
      entrada.lineas,
      entrada.salidaId,
    );

    await this.repositorioSalidas.actualizar(
      entrada.salidaId,
      {
        proyectoId: entrada.proyectoId,
        fechaSalida: new Date(entrada.fechaSalida),
        observaciones: entrada.observaciones,
        lineas: entrada.lineas.map((linea) => ({ ...linea })),
      },
      entrada.usuarioId,
    );
  }
}
