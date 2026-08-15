/**
 * Caso de uso `ListarInventarioCasoUso` — listado paginado de inventario con
 * stock/comprometido/disponible y marcado de stock bajo (`GET /api/inventario`,
 * FR-020/FR-022/FR-023).
 *
 * Composición de DOS puertos (`RepositorioProductos` + `RepositorioSalidas`) — mismo
 * criterio que `ListarResumenProductosCasoUso` (`aplicacion/productos/`, US3/T052): calcular
 * `disponible` es una regla de negocio que pertenece a la capa de aplicación, no al
 * repositorio ni al controlador.
 *
 * `RepositorioProductos.listar` se llama SIEMPRE con `soloStockBajo: false` — su filtro
 * interno compara `stock_actual` (crudo) contra el umbral, comportamiento heredado de US1 y
 * documentado como obsoleto para ESTE listado (ver TSDoc de ese puerto: "comprometido" no
 * existía todavía cuando se escribió). El filtro/paginación de `soloStockBajo` de este caso
 * de uso se aplica en memoria sobre `disponible` (vía `esStockBajo`, la única fuente de
 * verdad — `dominio/entidades/producto.ts`), pidiendo TODOS los candidatos con una
 * `porPagina` grande (`LIMITE_CANDIDATOS_EN_MEMORIA`) cuando el filtro está activo — mismo
 * criterio pragmático que ya usa `RepositorioProductosPrisma.listar` para su propia versión
 * en memoria del filtro crudo (research R9, escala de un solo almacén, Principio V).
 *
 * ## Reparto de los filtros (US13, FR-075…FR-077)
 *
 * `buscar`, `estado`, `categoriaId` y `ubicacion` son columnas de `productos`: los resuelve el
 * REPOSITORIO, en SQL, con índice detrás (data-model.md § Índices). `soloStockBajo` y el rango
 * `disponibleMin`/`disponibleMax` se resuelven AQUÍ, en memoria, porque ambos se miden contra
 * `disponible` (= stock − comprometido) y `comprometido` exige el agregado sobre `salidas` que
 * `RepositorioProductos` no puede resolver solo. El orden importa y es el mismo que aplica
 * `ReporteInventarioActualCasoUso` con su `cantidadMin`/`cantidadMax`: primero se compone la
 * fila completa, después se recorta el rango (nunca sobre `stockActual` crudo — FR-077), y solo
 * al final se pagina, para que `total` cuente lo que el usuario está viendo y no el universo
 * previo al filtro.
 *
 * Rendimiento (evita N+1): `RepositorioSalidas.comprometidoPorProducto` se llama UNA sola
 * vez con TODOS los ids de los candidatos de la página, nunca una vez por producto — ver
 * `fila-inventario.ts#construirFilaInventario`.
 *
 * Implementa: FR-020 (cifras de inventario), FR-022 (alerta/filtro de stock bajo contra el
 * umbral por producto, US5-AS2), FR-023 (búsqueda por SKU/descripción, delegada al `buscar`
 * de `RepositorioProductos.listar`), FR-075 (filtros de categoría/ubicación/estado) y FR-077
 * (rango de disponible).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import type { EstadoProducto, Producto } from '../../dominio/entidades/producto';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';
import { construirFilaInventario, disponibleEnRango, type FilaInventario } from './fila-inventario';

/**
 * Límite pragmático para materializar TODOS los candidatos en memoria cuando algún filtro
 * medido sobre `disponible` (stock bajo o rango) exige recortar antes de paginar — mismo
 * criterio que `RepositorioProductosPrisma.listar` usa para su propia versión en memoria del
 * filtro crudo (research R9): el catálogo de Trazo es de miles de productos, no millones
 * (Principio V). Los filtros de columna (`buscar`/`estado`/`categoriaId`/`ubicacion`) ya acotaron
 * el conjunto en SQL antes de llegar aquí, así que en la práctica se materializa mucho menos.
 */
const LIMITE_CANDIDATOS_EN_MEMORIA = 100000;

export interface ListarInventarioEntrada {
  readonly buscar?: string;
  readonly soloStockBajo?: boolean;
  readonly categoriaId?: number;
  readonly ubicacion?: string;
  readonly estado?: EstadoProducto;
  readonly disponibleMin?: number;
  readonly disponibleMax?: number;
  readonly pagina: number;
  readonly porPagina: number;
}

export interface PaginaInventario {
  readonly datos: FilaInventario[];
  readonly total: number;
}

@Injectable()
export class ListarInventarioCasoUso implements CasoDeUso<ListarInventarioEntrada, PaginaInventario> {
  constructor(
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
  ) {}

  async ejecutar(entrada: ListarInventarioEntrada): Promise<PaginaInventario> {
    if (!exigeFiltradoEnMemoria(entrada)) {
      const pagina = await this.repositorioProductos.listar({
        ...filtrosDeColumna(entrada),
        pagina: entrada.pagina,
        porPagina: entrada.porPagina,
      });
      return { datos: await this.construirFilas(pagina.datos), total: pagina.total };
    }

    // Hay al menos un filtro medido sobre `disponible` (stock bajo o rango), y `disponible` no
    // es una columna que el repositorio pueda filtrar (depende de "comprometido"): se traen
    // TODOS los candidatos que ya pasaron los filtros de columna y se recorta/pagina aquí en
    // memoria (ver TSDoc de cabecera).
    const candidatos = await this.repositorioProductos.listar({
      ...filtrosDeColumna(entrada),
      pagina: 1,
      porPagina: LIMITE_CANDIDATOS_EN_MEMORIA,
    });
    const filas = (await this.construirFilas(candidatos.datos)).filter(
      (fila) =>
        (!entrada.soloStockBajo || fila.stockBajo) &&
        disponibleEnRango(fila.disponible, entrada.disponibleMin, entrada.disponibleMax),
    );
    const inicio = (entrada.pagina - 1) * entrada.porPagina;
    return { datos: filas.slice(inicio, inicio + entrada.porPagina), total: filas.length };
  }

  /** Calcula `comprometido` en LOTE (una sola llamada, nunca N+1 — ver TSDoc de cabecera). */
  private async construirFilas(productos: readonly Producto[]): Promise<FilaInventario[]> {
    const comprometido = await this.repositorioSalidas.comprometidoPorProducto(productos.map((p) => p.id));
    return productos.map((producto) => construirFilaInventario(producto, comprometido.get(producto.id) ?? 0));
  }
}

/** `true` si algún filtro se mide contra `disponible` y por tanto obliga a componer las filas
 *  antes de recortar y paginar (ver TSDoc de cabecera). */
function exigeFiltradoEnMemoria(entrada: ListarInventarioEntrada): boolean {
  return (
    entrada.soloStockBajo === true || entrada.disponibleMin !== undefined || entrada.disponibleMax !== undefined
  );
}

/** Los filtros que SÍ son columnas de `productos` y viajan al repositorio para resolverse en
 *  SQL. `soloStockBajo: false` es deliberado: el filtro crudo del repositorio (contra
 *  `stock_actual`) no sirve a esta pantalla — ver TSDoc de cabecera. */
function filtrosDeColumna(entrada: ListarInventarioEntrada) {
  return {
    buscar: entrada.buscar,
    estado: entrada.estado,
    categoriaId: entrada.categoriaId,
    ubicacion: entrada.ubicacion,
    soloStockBajo: false,
  };
}
