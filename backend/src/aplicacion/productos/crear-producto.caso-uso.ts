/**
 * Caso de uso `CrearProductoCasoUso` — alta de un producto del catálogo
 * (`POST /api/productos`). El mismo endpoint sirve tanto al alta explícita desde el
 * listado de inventario como al dialog de "alta rápida" que se abrirá desde el formulario
 * de ingresos (US1): no hay regla distinta según el origen de la petición, por eso es un
 * único caso de uso reutilizado (Principio V — sin duplicar reglas por pantalla).
 *
 * Delegación directa al puerto `RepositorioProductos.crear`: el SKU duplicado ya lo
 * traduce el adaptador Prisma a `Duplicado('sku', ...)` (docs/arquitectura.md §3), así que
 * este caso de uso no necesita pre-validar unicidad ni capturar el error.
 *
 * Implementa: FR-010 (alta de producto con SKU/descripción/ubicación/umbral de stock
 * bajo), FR-011 (alta rápida reutilizable desde ingresos) y FR-052 (campo `categoria`).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';

/** Entrada: datos ya validados por `esquemaCrearProducto` (pipe HTTP) + auditoría (FR-045). */
export interface CrearProductoEntrada {
  readonly sku: string;
  readonly descripcion: string;
  readonly categoria: string | null;
  readonly ubicacion: string | null;
  readonly umbralStockBajo: number;
  /** Quién da de alta el producto — nunca confiar en un valor del body (FR-045). */
  readonly usuarioId: number;
}

export interface CrearProductoSalida {
  readonly id: number;
}

@Injectable()
export class CrearProductoCasoUso implements CasoDeUso<CrearProductoEntrada, CrearProductoSalida> {
  constructor(@Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos) {}

  async ejecutar(entrada: CrearProductoEntrada): Promise<CrearProductoSalida> {
    const producto = await this.repositorioProductos.crear({
      sku: entrada.sku,
      descripcion: entrada.descripcion,
      categoria: entrada.categoria,
      ubicacion: entrada.ubicacion,
      umbralStockBajo: entrada.umbralStockBajo,
      usuarioCreacionId: entrada.usuarioId,
    });
    return { id: producto.id };
  }
}
