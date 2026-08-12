/**
 * Caso de uso `CambiarEstadoProductoCasoUso` — baja/alta lógica de un producto del catálogo
 * (`PUT /api/productos/:id/estado`, FR-012: nunca `DELETE`).
 *
 * Delega directamente en `RepositorioProductos.cambiarEstado` (YA EXISTE, US1/T029) — mismo
 * patrón que `CambiarEstadoClienteCasoUso`/`CambiarEstadoProyectoCasoUso` (US2). Un producto
 * `INACTIVO` deja de poder recibirse/despacharse en documentos nuevos, pero conserva su
 * historial de movimientos (Principio II).
 *
 * Implementa: FR-012 (baja lógica de producto).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import type { EstadoProducto } from '../../dominio/entidades/producto';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';

/** Entrada: datos validados por `esquemaCambiarEstadoProducto` + auditoría (FR-045). */
export interface CambiarEstadoProductoEntrada {
  readonly productoId: number;
  readonly estado: EstadoProducto;
  /** Quién cambia el estado — nunca confiar en un valor del body (FR-045). */
  readonly usuarioId: number;
}

@Injectable()
export class CambiarEstadoProductoCasoUso implements CasoDeUso<CambiarEstadoProductoEntrada, void> {
  constructor(@Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos) {}

  async ejecutar(entrada: CambiarEstadoProductoEntrada): Promise<void> {
    await this.repositorioProductos.cambiarEstado(entrada.productoId, entrada.estado, entrada.usuarioId);
  }
}
