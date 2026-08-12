/**
 * Caso de uso `ReporteConsumoClienteCasoUso` — reporte de consumo de un cliente agrupado por
 * proyecto y producto (`GET /api/reportes/consumo-cliente`, FR-039).
 *
 * Composición de CUATRO puertos: `RepositorioClientes` (existencia del cliente),
 * `RepositorioProyectos` (TODOS los proyectos del cliente — `listarPorCliente`, sin filtrar
 * por estado, para que un proyecto sin consumo en el período IGUAL aparezca con estado vacío,
 * US4-AS4), `RepositorioSalidas` (`listarParaConsumo`, FR-044: SOLO salidas `CONFIRMADA`/
 * `COMPLETADA`, nunca `PENDIENTE`/`ANULADA`) y `RepositorioProductos` (`buscarPorIds` en lote
 * para resolver nombres de producto sin N+1, mismo criterio que `HistorialProductoCasoUso`).
 *
 * Agrupación: cada línea de detalle de cada salida de consumo se acumula por
 * `(proyectoId, productoId)` — sumando `cantidad` y `valorTotal` — y el resultado se ordena
 * por `valorTotal` descendente dentro de cada proyecto. `totalProyecto` es la suma de sus
 * productos; `totalCliente` es la suma de todos los `totalProyecto`. Un proyecto sin ninguna
 * salida de consumo en el rango aparece en `proyectos` con `productos: []` y
 * `totalProyecto: 0` — NUNCA se omite del array (estado vacío explícito, spec.md US4-AS4).
 *
 * Solo lectura: no muta nada, no necesita `UnidadDeTrabajo` ni bloqueo de filas (a diferencia
 * de `confirmar-salida.caso-uso.ts`).
 *
 * Implementa: FR-039 (reporte de consumo por cliente: proyectos, productos, cantidades,
 * valores y totales por proyecto/cliente, filtrable por cliente y rango de fechas), FR-044
 * (consumo = solo salidas `CONFIRMADA`/`COMPLETADA`).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { NoEncontrado } from '../../dominio/comunes/errores';
import type { EstadoProyecto } from '../../dominio/entidades/proyecto';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import { REPOSITORIO_PROYECTOS, type RepositorioProyectos } from '../../dominio/puertos/repositorio-proyectos';
import {
  REPOSITORIO_SALIDAS,
  type RepositorioSalidas,
  type SalidaConDetalles,
} from '../../dominio/puertos/repositorio-salidas';

/** `desde`/`hasta` llegan como `Date` — el controlador convierte el texto ISO ya validado por
 *  `esquemaFiltroConsumoCliente` ANTES de invocar el caso de uso, mismo patrón que
 *  `HistorialProductoCasoUso` (`controlador-inventario.ts#movimientos`). */
export interface ReporteConsumoClienteEntrada {
  readonly clienteId: number;
  readonly desde?: Date;
  readonly hasta?: Date;
}

/** Consumo de un producto dentro de un proyecto — nombre ya resuelto (FR-039). */
export interface ProductoConsumoReporte {
  readonly productoId: number;
  readonly nombre: string;
  readonly cantidad: number;
  readonly valorTotal: number;
}

/** Consumo de un proyecto: sus productos consumidos (orden descendente por valor) y el total. */
export interface ProyectoConsumoReporte {
  readonly proyecto: {
    readonly id: number;
    readonly nombre: string;
    readonly estado: EstadoProyecto;
  };
  readonly productos: ProductoConsumoReporte[];
  readonly totalProyecto: number;
}

export interface ReporteConsumoCliente {
  readonly cliente: {
    readonly id: number;
    readonly nombre: string;
    readonly nit: string;
  };
  readonly filtros: {
    readonly desde: string | null;
    readonly hasta: string | null;
  };
  readonly proyectos: ProyectoConsumoReporte[];
  readonly totalCliente: number;
}

/** Acumulador mutable de un producto dentro de un proyecto, mientras se recorren las líneas. */
interface AcumuladorProducto {
  productoId: number;
  cantidad: number;
  valorTotal: number;
}

@Injectable()
export class ReporteConsumoClienteCasoUso implements CasoDeUso<ReporteConsumoClienteEntrada, ReporteConsumoCliente> {
  constructor(
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
    @Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos,
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
  ) {}

  async ejecutar(entrada: ReporteConsumoClienteEntrada): Promise<ReporteConsumoCliente> {
    const cliente = await this.repositorioClientes.buscarPorId(entrada.clienteId);
    if (!cliente) {
      throw new NoEncontrado('El cliente');
    }

    const [proyectos, salidas] = await Promise.all([
      this.repositorioProyectos.listarPorCliente(entrada.clienteId),
      this.repositorioSalidas.listarParaConsumo({
        clienteId: entrada.clienteId,
        desde: entrada.desde,
        hasta: entrada.hasta,
      }),
    ]);

    const nombresPorProducto = await this.resolverNombresProducto(salidas);
    const acumuladoPorProyecto = agruparPorProyectoYProducto(salidas);

    const proyectosReporte = proyectos.map((proyecto): ProyectoConsumoReporte => {
      const acumuladoProductos = acumuladoPorProyecto.get(proyecto.id);
      const productos = acumuladoProductos
        ? Array.from(acumuladoProductos.values())
            .map(
              (acumulado): ProductoConsumoReporte => ({
                productoId: acumulado.productoId,
                nombre: nombresPorProducto.get(acumulado.productoId) ?? `Producto N.º ${acumulado.productoId}`,
                cantidad: acumulado.cantidad,
                valorTotal: acumulado.valorTotal,
              }),
            )
            .sort((a, b) => b.valorTotal - a.valorTotal)
        : [];
      return {
        proyecto: { id: proyecto.id, nombre: proyecto.nombre, estado: proyecto.estado },
        productos,
        totalProyecto: productos.reduce((acumulado, producto) => acumulado + producto.valorTotal, 0),
      };
    });

    return {
      cliente: { id: cliente.id, nombre: cliente.nombre, nit: cliente.nit },
      filtros: {
        desde: entrada.desde ? entrada.desde.toISOString() : null,
        hasta: entrada.hasta ? entrada.hasta.toISOString() : null,
      },
      proyectos: proyectosReporte,
      totalCliente: proyectosReporte.reduce((acumulado, proyecto) => acumulado + proyecto.totalProyecto, 0),
    };
  }

  /** Nombres de producto en lote (`buscarPorIds`), nunca uno por línea (evita N+1). */
  private async resolverNombresProducto(salidas: readonly SalidaConDetalles[]): Promise<Map<number, string>> {
    const idsUnicos = [...new Set(salidas.flatMap((salida) => salida.detalles.map((detalle) => detalle.productoId)))];
    const productos = await this.repositorioProductos.buscarPorIds(idsUnicos);
    return new Map(productos.map((producto) => [producto.id, producto.descripcion]));
  }
}

/** Agrupa las líneas de TODAS las salidas de consumo por `proyectoId` y, dentro de cada
 *  proyecto, por `productoId` — sumando `cantidad`/`valorTotal` (FR-039). */
function agruparPorProyectoYProducto(salidas: readonly SalidaConDetalles[]): Map<number, Map<number, AcumuladorProducto>> {
  const acumuladoPorProyecto = new Map<number, Map<number, AcumuladorProducto>>();
  for (const salida of salidas) {
    const acumuladoProductos = acumuladoPorProyecto.get(salida.proyectoId) ?? new Map<number, AcumuladorProducto>();
    for (const detalle of salida.detalles) {
      const acumulado = acumuladoProductos.get(detalle.productoId) ?? {
        productoId: detalle.productoId,
        cantidad: 0,
        valorTotal: 0,
      };
      acumulado.cantidad += detalle.cantidad;
      acumulado.valorTotal += detalle.valorTotal;
      acumuladoProductos.set(detalle.productoId, acumulado);
    }
    acumuladoPorProyecto.set(salida.proyectoId, acumuladoProductos);
  }
  return acumuladoPorProyecto;
}
