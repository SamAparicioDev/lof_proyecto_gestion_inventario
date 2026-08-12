/**
 * Caso de uso `ListarResumenProductosCasoUso` — catálogo simple con `ultimoCosto` y
 * `disponible` por producto (`GET /api/productos?buscar=`, extensión T052 de
 * contracts/api-rest.md § Productos). Reemplaza la lógica que antes vivía inline en
 * `ControladorProductos.listar` (docs/arquitectura.md — controladores delgados, cero
 * negocio): calcular `disponible` es una regla de negocio (`stockActual − comprometido` de
 * TODAS las salidas `PENDIENTE`) que necesita DOS puertos (`RepositorioProductos` +
 * `RepositorioSalidas`) — orquestarla pertenece a la capa de aplicación, no al controlador.
 *
 * `disponible` reutiliza `RepositorioSalidas.comprometidoPorProducto` SIN `excluirSalidaId`
 * (caso de uso (a) del TSDoc de ese método, research R4): TODAS las salidas `PENDIENTE`
 * cuentan, porque este catálogo alimenta el formulario de una salida nueva (o en edición) —
 * no está calculando el disponible neto de una salida específica en confirmación (eso lo
 * hace `RepositorioSalidasPrisma.confirmar`, dentro de su propia transacción).
 *
 * Mantiene el mismo límite de "página única" que la extensión T035 original (no hay UI de
 * paginación en un `<select>`, exponerla aquí sería complejidad especulativa — Principio V).
 *
 * Implementa: FR-010/FR-011 (catálogo simple para selectores), FR-020 (disponible visible al
 * operar) y FR-028 (el mismo `disponible` que validan `crear-salida`/`actualizar-salida`,
 * para que el formulario muestre exactamente el número contra el que se validará).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';

/** Tamaño de la única "página" que sirve el selector — igual límite que la extensión T035. */
const LIMITE_PRODUCTOS_SELECTOR = 500;

/** Filtro de búsqueda — mismo shape que `esquemaListarProductos` (@trazo/compartido). */
export interface ListarResumenProductosEntrada {
  readonly buscar?: string;
}

/** Fila del catálogo simple, extendida con costo de referencia y disponibilidad (T052). */
export interface ResumenProducto {
  readonly id: number;
  readonly sku: string;
  readonly descripcion: string;
  readonly ultimoCosto: number;
  readonly disponible: number;
}

@Injectable()
export class ListarResumenProductosCasoUso implements CasoDeUso<ListarResumenProductosEntrada, ResumenProducto[]> {
  constructor(
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
  ) {}

  async ejecutar(entrada: ListarResumenProductosEntrada): Promise<ResumenProducto[]> {
    const pagina = await this.repositorioProductos.listar({
      buscar: entrada.buscar,
      // Solo productos ACTIVOS (FR-012): este catálogo alimenta las líneas de ingresos y
      // salidas NUEVOS, y ofrecer ahí un producto dado de baja vaciaría de sentido la baja
      // lógica — el botón "Desactivar" no tendría ningún efecto observable. Mismo criterio
      // que `RepositorioProyectos.proyectosDestino` (FR-038). La vista de inventario (US5)
      // SÍ los sigue mostrando, con su etiqueta de estado.
      estado: 'ACTIVO',
      pagina: 1,
      porPagina: LIMITE_PRODUCTOS_SELECTOR,
    });

    const productoIds = pagina.datos.map((producto) => producto.id);
    const comprometido = await this.repositorioSalidas.comprometidoPorProducto(productoIds);

    return pagina.datos.map((producto) => ({
      id: producto.id,
      sku: producto.sku,
      descripcion: producto.descripcion,
      ultimoCosto: producto.ultimoCosto,
      disponible: producto.stockActual - (comprometido.get(producto.id) ?? 0),
    }));
  }
}
