/**
 * Caso de uso `ReporteInventarioActualCasoUso` — reporte de inventario actual: TODOS los
 * productos del catálogo que matchean `buscar` (sin paginar — `GET /api/reportes/inventario`,
 * FR-041), con stock/comprometido/disponible/ubicación, valor de línea, valor total del
 * inventario y conteo de productos bajo umbral, filtrable por producto (`buscar`) y rango de
 * cantidad disponible (`cantidadMin`/`cantidadMax`).
 *
 * Composición de DOS puertos — MISMO patrón que `ListarInventarioCasoUso` (US5,
 * `aplicacion/inventario/listar-inventario.caso-uso.ts`), pero SIN paginar:
 * `RepositorioProductos.listarTodos` (universo completo que matchea `buscar`) +
 * `RepositorioSalidas.comprometidoPorProducto` (UNA sola llamada en lote con TODOS los ids de
 * los candidatos, nunca N+1). Cada fila se compone con `construirFilaInventario`
 * (`aplicacion/inventario/fila-inventario.ts`) — la MISMA función que ya usa el listado
 * paginado de US5, para no duplicar el cálculo de `disponible`/`stockBajo` (docs/arquitectura.md
 * §5, DRY; `esStockBajo` de `dominio/entidades/producto.ts` sigue siendo la ÚNICA fuente de
 * verdad de ese criterio) — y se le agrega `valorLinea = stockActual × ultimoCosto` (FR-041).
 *
 * Orden de las operaciones (decisión de diseño explícita — contracts/api-rest.md § Reportes,
 * spec.md FR-041): `cantidadMin`/`cantidadMax` filtran sobre `disponible` DESPUÉS de componer
 * comprometido/disponible, EN MEMORIA (nunca sobre `stockActual` crudo) porque `comprometido`
 * requiere el JOIN a través de `salidas` que `RepositorioProductos` no puede resolver solo (ver
 * TSDoc de `FiltrosListarTodosProductos`, `dominio/puertos/repositorio-productos.ts`).
 * `valorTotalInventario` y `cantidadBajoUmbral` se calculan sobre el conjunto YA FILTRADO —
 * mismo criterio que `ReporteConsumoClienteCasoUso`/`ReporteConsumoProyectoCasoUso`: los
 * totales de un reporte filtrado reflejan SIEMPRE lo que el reporte muestra, nunca un universo
 * distinto al de sus filas (garantiza SC-007 también para este reporte).
 *
 * Solo lectura: no muta nada, no necesita `UnidadDeTrabajo` ni bloqueo de filas.
 *
 * Implementa: FR-041 (reporte de inventario actual: stock/comprometido/disponible/ubicación,
 * valor total del inventario, productos bajo umbral, filtrable por producto y rango de
 * cantidad).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import type { Producto } from '../../dominio/entidades/producto';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';
import { construirFilaInventario, disponibleEnRango, type FilaInventario } from '../inventario/fila-inventario';

export interface ReporteInventarioActualEntrada {
  readonly buscar?: string;
  readonly cantidadMin?: number;
  readonly cantidadMax?: number;
}

/** Una fila del reporte: la MISMA `FilaInventario` que usa US5 + su valor monetario (FR-041). */
export interface FilaReporteInventario extends FilaInventario {
  readonly valorLinea: number;
}

export interface ReporteInventarioActual {
  readonly productos: FilaReporteInventario[];
  readonly valorTotalInventario: number;
  readonly cantidadBajoUmbral: number;
  readonly filtros: {
    readonly buscar: string | null;
    readonly cantidadMin: number | null;
    readonly cantidadMax: number | null;
  };
}

@Injectable()
export class ReporteInventarioActualCasoUso
  implements CasoDeUso<ReporteInventarioActualEntrada, ReporteInventarioActual>
{
  constructor(
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
  ) {}

  async ejecutar(entrada: ReporteInventarioActualEntrada): Promise<ReporteInventarioActual> {
    const productos = await this.repositorioProductos.listarTodos({ buscar: entrada.buscar });
    const filas = await this.construirFilas(productos);
    const filasFiltradas = filas.filter((fila) =>
      disponibleEnRango(fila.disponible, entrada.cantidadMin, entrada.cantidadMax),
    );

    return {
      productos: filasFiltradas,
      valorTotalInventario: filasFiltradas.reduce((acumulado, fila) => acumulado + fila.valorLinea, 0),
      cantidadBajoUmbral: filasFiltradas.filter((fila) => fila.stockBajo).length,
      filtros: {
        buscar: entrada.buscar ?? null,
        cantidadMin: entrada.cantidadMin ?? null,
        cantidadMax: entrada.cantidadMax ?? null,
      },
    };
  }

  /** Calcula `comprometido` en LOTE (una sola llamada, nunca N+1 — mismo patrón que
   *  `ListarInventarioCasoUso#construirFilas`) y agrega `valorLinea` a cada fila. */
  private async construirFilas(productos: readonly Producto[]): Promise<FilaReporteInventario[]> {
    const comprometido = await this.repositorioSalidas.comprometidoPorProducto(productos.map((producto) => producto.id));
    return productos.map((producto) => {
      const fila = construirFilaInventario(producto, comprometido.get(producto.id) ?? 0);
      return { ...fila, valorLinea: producto.stockActual * producto.ultimoCosto };
    });
  }
}
