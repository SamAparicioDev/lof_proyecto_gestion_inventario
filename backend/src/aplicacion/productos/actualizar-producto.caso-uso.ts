/**
 * Caso de uso `ActualizarProductoCasoUso` — edición de los campos editables de un producto
 * del catálogo (`PUT /api/productos/:id`, FR-010/FR-071).
 *
 * Delega en `RepositorioProductos.actualizar` (YA EXISTE, US1/T029) — no hay regla de negocio
 * adicional que validar para los campos de catálogo: el SKU (el único campo que tendría reglas
 * de unicidad) no es editable tras el alta y queda fuera de `esquemaActualizarProducto` (ver
 * TSDoc de ese esquema en `@trazo/compartido`). El adaptador Prisma traduce `P2025` a
 * `NoEncontrado` si el id no existe (contrato: `404`).
 *
 * US12 (T126) agrega el COSTO, y lo hace con una llamada aparte —
 * `RepositorioProductos.actualizarCosto`— en vez de sumarlo a `actualizar`:
 *
 * - Cambiar el costo no es "un campo más": altera la valorización del inventario y de los
 *   reportes, así que exige su registro inmutable con usuario/fecha/origen (FR-072). Ese par
 *   "UPDATE del costo + INSERT del historial" tiene que ser atómico, y esa atomicidad es el
 *   contrato de `actualizarCosto` (ver TSDoc del puerto) — no algo que este caso de uso pueda
 *   garantizar orquestando dos escrituras sueltas.
 * - Si el cuerpo no trae `ultimoCosto` (una edición que solo corrige la descripción), no se
 *   llama y no pasa NADA con el costo (FR-074). Tampoco se registra nada cuando el valor
 *   enviado coincide con el vigente: esa decisión vive en el dominio
 *   (`servicio-costo-producto.ts#aplicarCambioDeCosto`), no aquí.
 *
 * Que los datos de catálogo y el costo se escriban en transacciones distintas es deliberado y
 * sin consecuencia para el invariante que importa: lo que NUNCA puede quedar a medias es
 * "costo cambiado sin su registro", y eso ocurre íntegramente dentro de `actualizarCosto`.
 *
 * Un cambio de costo NO toca el stock ni escribe movimientos de inventario (FR-073).
 *
 * Implementa: FR-010 (edición de descripción/ubicación/umbral de stock bajo), FR-052 (campo
 * `categoriaId` del catálogo, US15), FR-071/FR-072/FR-074 (costo corregible, registrado y solo si cambió).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import {
  REPOSITORIO_UNIDADES_MEDIDA,
  type RepositorioUnidadesMedida,
} from '../../dominio/puertos/repositorio-unidades-medida';
import { verificarUnidadMedidaAsignable } from './verificar-unidad-medida-asignable';

/** Entrada: datos validados por `esquemaActualizarProducto` + auditoría (FR-045). */
export interface ActualizarProductoEntrada {
  readonly productoId: number;
  readonly descripcion: string;
  readonly categoriaId: number | null;
  /**
   * US17 (FR-102/FR-103): obligatoria TAMBIÉN al editar, y ese es el punto. Los productos
   * anteriores a la historia llegan sin unidad; exigirla aquí hace que el catálogo se limpie
   * con el uso en lugar de con una tarea de migración que tendría que inventar los datos.
   */
  readonly unidadMedidaId: number;
  readonly ubicacion: string | null;
  readonly umbralStockBajo: number;
  /**
   * Costo de referencia (US12, FR-071). `undefined` = "el cuerpo no lo trae" → el costo queda
   * intacto y no se registra nada. NUNCA se interpreta como 0 (ver `aplicarCambioDeCosto`).
   */
  readonly ultimoCosto?: number;
  /** Quién edita — nunca confiar en un valor del body (FR-045). */
  readonly usuarioId: number;
}

@Injectable()
export class ActualizarProductoCasoUso implements CasoDeUso<ActualizarProductoEntrada, void> {
  constructor(
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_UNIDADES_MEDIDA) private readonly repositorioUnidades: RepositorioUnidadesMedida,
  ) {}

  async ejecutar(entrada: ActualizarProductoEntrada): Promise<void> {
    // La unidad que el producto ya tiene se pasa como excepción: reenviarla se acepta aunque
    // esté inactiva, porque desactivar una unidad impide asignarla, no bloquea al producto que
    // la referencia (ver el TSDoc de `verificarUnidadMedidaAsignable`).
    const actual = await this.repositorioProductos.buscarPorId(entrada.productoId);
    await verificarUnidadMedidaAsignable(
      this.repositorioUnidades,
      entrada.unidadMedidaId,
      actual?.unidadMedida?.id ?? null,
    );

    await this.repositorioProductos.actualizar(entrada.productoId, {
      descripcion: entrada.descripcion,
      categoriaId: entrada.categoriaId,
      unidadMedidaId: entrada.unidadMedidaId,
      ubicacion: entrada.ubicacion,
      umbralStockBajo: entrada.umbralStockBajo,
      usuarioModificacionId: entrada.usuarioId,
    });

    if (entrada.ultimoCosto === undefined) return;

    await this.repositorioProductos.actualizarCosto(entrada.productoId, entrada.ultimoCosto, {
      usuarioId: entrada.usuarioId,
      origen: 'EDICION_MANUAL',
    });
  }
}
