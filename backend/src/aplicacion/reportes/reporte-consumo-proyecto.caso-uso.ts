/**
 * Caso de uso `ReporteConsumoProyectoCasoUso` — reporte de consumo de un proyecto, aplanado a
 * una fila por línea de salida, con margen vs presupuesto y serie para gráfico
 * (`GET /api/reportes/consumo-proyecto`, FR-040).
 *
 * Composición de CUATRO puertos: `RepositorioProyectos` (existencia del proyecto),
 * `RepositorioClientes` (nombre del cliente dueño del proyecto — chequeo defensivo de
 * integridad referencial, nunca debería fallar dado el `FK` de `data-model.md`, pero evita un
 * `cliente` opcional en el tipo de salida), `RepositorioSalidas` (`listarParaConsumo`,
 * FR-044: SOLO salidas `CONFIRMADA`/`COMPLETADA`) y `RepositorioProductos`
 * (`buscarPorIds` en lote para resolver nombres de producto sin N+1, mismo criterio que
 * `ReporteConsumoClienteCasoUso`).
 *
 * A diferencia del reporte de cliente (agrupado por proyecto→producto), este reporte se
 * APLANA: una fila por CADA línea de detalle de CADA salida (no por salida ni por producto) —
 * es el detalle que el frontend lista tal cual (fecha, número de salida, producto, cantidad,
 * valor unitario, valor total). `serie` es la única agregación de este caso de uso: las
 * mismas líneas agrupadas por producto y sumadas, para alimentar el gráfico de barras
 * "consumo por producto" (Recharts, US4).
 *
 * `margen`: si el proyecto no tiene `presupuestoEstimado` (columna nullable, data-model.md),
 * el margen es `null` — el frontend muestra "Sin presupuesto asignado", NUNCA "0%" ni una
 * división por cero (US4-AS2 solo define el caso CON presupuesto: 40% = 4.000.000/10.000.000).
 *
 * Solo lectura: no muta nada, no necesita `UnidadDeTrabajo` ni bloqueo de filas.
 *
 * Implementa: FR-040 (reporte de consumo por proyecto: datos del proyecto/cliente, detalle de
 * salidas, total consumido, margen vs presupuesto y serie para gráfico, filtrable por
 * proyecto y rango de fechas), FR-044 (consumo = solo salidas `CONFIRMADA`/`COMPLETADA`).
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
 *  `esquemaFiltroConsumoProyecto` ANTES de invocar el caso de uso, mismo patrón que
 *  `ReporteConsumoClienteCasoUso`/`HistorialProductoCasoUso`. */
export interface ReporteConsumoProyectoEntrada {
  readonly proyectoId: number;
  readonly desde?: Date;
  readonly hasta?: Date;
}

/** Una fila del detalle aplanado: una línea de una salida de consumo, con el nombre de
 *  producto ya resuelto (FR-040). */
export interface LineaConsumoReporte {
  readonly fecha: Date;
  readonly numeroSalida: number;
  readonly producto: string;
  readonly cantidad: number;
  readonly valorUnitario: number;
  readonly valorTotal: number;
}

/** Un punto de la serie del gráfico "consumo por producto" (orden descendente por valor). */
export interface PuntoSerieConsumo {
  readonly producto: string;
  readonly valor: number;
}

export interface ReporteConsumoProyecto {
  readonly proyecto: {
    readonly id: number;
    readonly nombre: string;
    readonly estado: EstadoProyecto;
  };
  readonly cliente: {
    readonly id: number;
    readonly nombre: string;
  };
  readonly filtros: {
    readonly desde: string | null;
    readonly hasta: string | null;
  };
  readonly lineas: LineaConsumoReporte[];
  readonly totalConsumo: number;
  readonly presupuestoEstimado: number | null;
  /** `totalConsumo / presupuestoEstimado`, o `null` si el proyecto no tiene presupuesto
   *  asignado O si `presupuestoEstimado` es exactamente `0` (nunca una división por cero:
   *  `Infinity`/`NaN` no son serializables como número JSON y `JSON.stringify` los convierte
   *  silenciosamente en `null`, así que se hace explícito aquí en vez de dejar que ocurra por
   *  accidente — hallazgo de revisión adversarial, tanda US4). El frontend no distingue "sin
   *  presupuesto" de "presupuesto en $0" — ambos muestran "Sin presupuesto asignado". */
  readonly margen: number | null;
  readonly serie: PuntoSerieConsumo[];
}

@Injectable()
export class ReporteConsumoProyectoCasoUso
  implements CasoDeUso<ReporteConsumoProyectoEntrada, ReporteConsumoProyecto>
{
  constructor(
    @Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos,
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
  ) {}

  async ejecutar(entrada: ReporteConsumoProyectoEntrada): Promise<ReporteConsumoProyecto> {
    const proyecto = await this.repositorioProyectos.buscarPorId(entrada.proyectoId);
    if (!proyecto) {
      throw new NoEncontrado('El proyecto');
    }
    const cliente = await this.repositorioClientes.buscarPorId(proyecto.clienteId);
    if (!cliente) {
      throw new NoEncontrado('El cliente');
    }

    const salidas = await this.repositorioSalidas.listarParaConsumo({
      proyectoId: entrada.proyectoId,
      desde: entrada.desde,
      hasta: entrada.hasta,
    });
    const nombresPorProducto = await this.resolverNombresProducto(salidas);
    const lineas = aplanarLineas(salidas, nombresPorProducto);
    const totalConsumo = lineas.reduce((acumulado, linea) => acumulado + linea.valorTotal, 0);

    return {
      proyecto: { id: proyecto.id, nombre: proyecto.nombre, estado: proyecto.estado },
      cliente: { id: cliente.id, nombre: cliente.nombre },
      filtros: {
        desde: entrada.desde ? entrada.desde.toISOString() : null,
        hasta: entrada.hasta ? entrada.hasta.toISOString() : null,
      },
      lineas,
      totalConsumo,
      presupuestoEstimado: proyecto.presupuestoEstimado,
      margen:
        proyecto.presupuestoEstimado === null || proyecto.presupuestoEstimado === 0
          ? null
          : totalConsumo / proyecto.presupuestoEstimado,
      serie: construirSerie(salidas, nombresPorProducto),
    };
  }

  /** Nombres de producto en lote (`buscarPorIds`), nunca uno por línea (evita N+1). */
  private async resolverNombresProducto(salidas: readonly SalidaConDetalles[]): Promise<Map<number, string>> {
    const idsUnicos = [...new Set(salidas.flatMap((salida) => salida.detalles.map((detalle) => detalle.productoId)))];
    const productos = await this.repositorioProductos.buscarPorIds(idsUnicos);
    return new Map(productos.map((producto) => [producto.id, producto.descripcion]));
  }
}

/** Aplana TODAS las salidas de consumo a una fila por línea de detalle (FR-040). */
function aplanarLineas(
  salidas: readonly SalidaConDetalles[],
  nombresPorProducto: ReadonlyMap<number, string>,
): LineaConsumoReporte[] {
  return salidas.flatMap((salida) =>
    salida.detalles.map(
      (detalle): LineaConsumoReporte => ({
        fecha: salida.fechaSalida,
        numeroSalida: salida.numero,
        producto: nombresPorProducto.get(detalle.productoId) ?? `Producto N.º ${detalle.productoId}`,
        cantidad: detalle.cantidad,
        valorUnitario: detalle.precioUnitario,
        valorTotal: detalle.valorTotal,
      }),
    ),
  );
}

/**
 * Agrupa por `productoId` (NUNCA por el nombre ya resuelto: `productos.descripcion` no es
 * `UNIQUE` en `data-model.md` — solo `sku` lo es — así que dos productos con la misma
 * descripción fusionarían su consumo en una sola barra si se agrupara por nombre; hallazgo
 * de revisión adversarial, tanda US4), sumando `valorTotal`, ordenado descendente — alimenta
 * el gráfico de barras "consumo por producto" (FR-040).
 */
function construirSerie(
  salidas: readonly SalidaConDetalles[],
  nombresPorProducto: ReadonlyMap<number, string>,
): PuntoSerieConsumo[] {
  const acumuladoPorProducto = new Map<number, number>();
  for (const salida of salidas) {
    for (const detalle of salida.detalles) {
      acumuladoPorProducto.set(
        detalle.productoId,
        (acumuladoPorProducto.get(detalle.productoId) ?? 0) + detalle.valorTotal,
      );
    }
  }
  return Array.from(acumuladoPorProducto.entries())
    .map(([productoId, valor]) => ({
      producto: nombresPorProducto.get(productoId) ?? `Producto N.º ${productoId}`,
      valor,
    }))
    .sort((a, b) => b.valor - a.valor);
}
