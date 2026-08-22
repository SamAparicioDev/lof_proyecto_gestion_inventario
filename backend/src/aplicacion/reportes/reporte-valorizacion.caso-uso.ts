/**
 * Caso de uso `ReporteValorizacionCasoUso` — cuánto valía el inventario en una fecha
 * (`GET /api/reportes/valorizacion`, US38, FR-163…FR-168).
 *
 * ## Dos reconstrucciones, y ninguna mira el presente
 *
 * Un cierre se equivoca por dos caminos distintos, y este caso de uso cierra los dos:
 *
 * 1. **Las existencias** salen de los MOVIMIENTOS, nunca de `productos.stock_actual` (FR-164). El
 *    stock de hoy no dice nada de lo que había en diciembre.
 * 2. **El costo** sale del historial vigente ESE día, nunca del último registrado (FR-165). Es el
 *    error más silencioso de los dos: valorar diciembre con el precio que se fijó en marzo
 *    siguiente produce una cifra que no existió en ningún momento, y el archivo se ve
 *    perfectamente normal.
 *
 * El segundo punto convive con FR-138 —el costo de un producto es SIEMPRE el último registrado—
 * sin contradecirlo: FR-138 habla del costo VIGENTE del producto, que es una sola cosa en cada
 * momento; esto reconstruye cuál era ese "último registrado" en una fecha pasada. Lo que hace
 * posible la reconstrucción es que US12 guardó cada cambio con su fecha (FR-072), y esa es
 * exactamente la razón por la que se guardó.
 *
 * ## Un producto sin historial de costos no es un caso raro
 *
 * Es el caso NORMAL de un producto cuyo costo nunca cambió desde que se creó. `costosVigentesAFecha`
 * no lo devuelve —habla del historial, y ahí no hay nada que contar— así que se completa con el
 * `ultimoCosto` del producto, que para él ha sido el mismo siempre.
 *
 * ## Coincide con el inventario actual, o una de las dos está mal (FR-168)
 *
 * Consultado con la fecha de hoy, el total tiene que dar exactamente el `valorTotalInventario` de
 * `ReporteInventarioActualCasoUso`. Es la comprobación más barata de que la reconstrucción es
 * correcta, y por eso es una prueba de integración y no un comentario.
 *
 * Solo lectura: no muta nada, no necesita `UnidadDeTrabajo` ni bloqueo de filas.
 *
 * Implementa: FR-163 (la valorización y su fecha obligatoria), FR-164 (existencias de los
 * movimientos), FR-165 (costo vigente a la fecha), FR-166 (sin filas en cero), FR-168 (cuadra con
 * el inventario actual).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import {
  REPOSITORIO_MOVIMIENTOS,
  type RepositorioMovimientos,
} from '../../dominio/puertos/repositorio-movimientos';
import {
  REPOSITORIO_HISTORIAL_COSTOS,
  type RepositorioHistorialCostos,
} from '../../dominio/puertos/repositorio-historial-costos';

export interface ReporteValorizacionEntrada {
  /** Fin del día de corte. El controlador la construye desde `AAAA-MM-DD`; el caso de uso la
   *  recibe ya resuelta porque interpretar una cadena de fecha es trabajo de la frontera. */
  readonly fecha: Date;
  readonly categoriaId?: number;
  readonly buscar?: string;
}

export interface FilaValorizacion {
  readonly productoId: number;
  readonly sku: string;
  readonly descripcion: string;
  readonly categoria: string | null;
  readonly unidadMedida: string | null;
  readonly existencias: number;
  readonly costoVigente: number;
  readonly valorLinea: number;
}

export interface ReporteValorizacion {
  readonly productos: FilaValorizacion[];
  readonly valorTotalInventario: number;
}

@Injectable()
export class ReporteValorizacionCasoUso
  implements CasoDeUso<ReporteValorizacionEntrada, ReporteValorizacion>
{
  constructor(
    @Inject(REPOSITORIO_PRODUCTOS) private readonly productos: RepositorioProductos,
    @Inject(REPOSITORIO_MOVIMIENTOS) private readonly movimientos: RepositorioMovimientos,
    @Inject(REPOSITORIO_HISTORIAL_COSTOS) private readonly historialCostos: RepositorioHistorialCostos,
  ) {}

  async ejecutar(entrada: ReporteValorizacionEntrada): Promise<ReporteValorizacion> {
    const [catalogo, existencias, costos] = await Promise.all([
      this.productos.listarTodos({ buscar: entrada.buscar, categoriaId: entrada.categoriaId }),
      this.movimientos.existenciasAFecha(entrada.fecha),
      this.historialCostos.costosVigentesAFecha(entrada.fecha),
    ]);

    const existenciasPorProducto = new Map(existencias.map((fila) => [fila.productoId, fila.existencias]));
    const costoPorProducto = new Map(costos.map((fila) => [fila.productoId, fila.costo]));

    const filas: FilaValorizacion[] = [];
    for (const producto of catalogo) {
      const cantidad = existenciasPorProducto.get(producto.id) ?? 0;
      // FR-166: sin existencias esa fecha —o creado después— no aparece. Una fila en cero no es
      // información y ensucia un documento que alguien va a firmar.
      if (cantidad <= 0) continue;

      // Sin historial, el costo del producto ha sido el mismo desde siempre: ese es el vigente a
      // cualquier fecha. No es un respaldo defensivo, es el caso normal de un producto estable.
      const costoVigente = costoPorProducto.get(producto.id) ?? producto.ultimoCosto;

      filas.push({
        productoId: producto.id,
        sku: producto.sku,
        descripcion: producto.descripcion,
        categoria: producto.categoria?.nombre ?? null,
        unidadMedida: producto.unidadMedida?.nombre ?? null,
        existencias: cantidad,
        costoVigente,
        valorLinea: cantidad * costoVigente,
      });
    }

    // Por valor descendente: en un cierre, lo primero que se revisa es lo que más pesa.
    filas.sort((a, b) => b.valorLinea - a.valorLinea);

    return {
      productos: filas,
      valorTotalInventario: filas.reduce((total, fila) => total + fila.valorLinea, 0),
    };
  }
}
