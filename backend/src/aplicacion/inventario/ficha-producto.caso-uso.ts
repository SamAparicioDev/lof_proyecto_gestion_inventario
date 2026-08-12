/**
 * Caso de uso `FichaProductoCasoUso` — ficha de un producto con sus cifras actuales de
 * inventario (`GET /api/inventario/:productoId`, FR-020).
 *
 * Misma composición que una fila de `ListarInventarioCasoUso`
 * (`fila-inventario.ts#construirFilaInventario`): la única diferencia es que aquí
 * `comprometido` se calcula para UN SOLO producto
 * (`RepositorioSalidas.comprometidoPorProducto([productoId])`), no en lote sobre una página
 * completa — mismas cifras, mismo criterio, sin duplicar la fórmula.
 *
 * Implementa: FR-020 (stock/comprometido/disponible/stockBajo de un producto individual).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { NoEncontrado } from '../../dominio/comunes/errores';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';
import { construirFilaInventario, type FilaInventario } from './fila-inventario';

export interface FichaProductoEntrada {
  readonly productoId: number;
}

@Injectable()
export class FichaProductoCasoUso implements CasoDeUso<FichaProductoEntrada, FilaInventario> {
  constructor(
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
  ) {}

  async ejecutar(entrada: FichaProductoEntrada): Promise<FilaInventario> {
    const producto = await this.repositorioProductos.buscarPorId(entrada.productoId);
    if (!producto) {
      throw new NoEncontrado('El producto');
    }
    const comprometido = await this.repositorioSalidas.comprometidoPorProducto([producto.id]);
    return construirFilaInventario(producto, comprometido.get(producto.id) ?? 0);
  }
}
