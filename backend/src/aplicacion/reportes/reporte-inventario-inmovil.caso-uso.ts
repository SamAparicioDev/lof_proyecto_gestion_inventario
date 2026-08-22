/**
 * Caso de uso `ReporteInventarioInmovilCasoUso` — el capital dormido en la bodega
 * (`GET /api/reportes/inventario-inmovil`, US37, FR-158…FR-162).
 *
 * ## La pregunta que responde, y por qué ninguna otra pantalla la responde
 *
 * Un producto inmóvil no dispara ninguna alerta del sistema: no está bajo umbral —le SOBRA stock,
 * ese es justamente el problema— y no sale en el panel, que muestra lo que se movió, no lo que no.
 * Es el único punto ciego que quedaba sobre el inventario, y el más caro: plata ya gastada que no
 * ha vuelto.
 *
 * ## El reloj cuenta desde la última SALIDA (FR-159)
 *
 * Es la decisión que da forma a todo el reporte. Si contara el último movimiento cualquiera,
 * recibir mercancía de un producto que no rota lo sacaría del listado — justo cuando el problema
 * empeoró, porque acaba de inmovilizarse más plata en lo mismo que no sale. El producto que nunca
 * ha tenido una salida cuenta desde su primera entrada: es el caso más grave y tiene que verse
 * como fila, no desaparecer por falta de dato.
 *
 * ## Solo lectura, y sin proponer nada (FR-162)
 *
 * No corrige, no da de baja y no sugiere comprar menos. Qué hacer con un producto detenido
 * —liquidarlo, devolverlo al proveedor, darlo de baja— es una decisión de negocio que se ejecuta
 * desde las pantallas que ya existen, donde queda auditada con su motivo y su responsable. Un
 * reporte que además actuara escondería decisiones dentro de una consulta.
 *
 * Composición de dos puertos, ambos de lectura, en DOS llamadas en lote — nunca N+1:
 * `RepositorioProductos.listarTodos` (el catálogo que matchea los filtros) y
 * `RepositorioMovimientos.rotacionPorProducto` (última salida y primera entrada de todos).
 *
 * Implementa: FR-158 (el reporte y su umbral configurable), FR-159 (el reloj desde la última
 * salida), FR-160 (sin existencias no hay inmovilizado), FR-161 (ordenado por valor), FR-162
 * (solo lectura).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import {
  REPOSITORIO_MOVIMIENTOS,
  type RepositorioMovimientos,
} from '../../dominio/puertos/repositorio-movimientos';

export interface ReporteInventarioInmovilEntrada {
  readonly diasSinSalida: number;
  readonly categoriaId?: number;
  readonly buscar?: string;
  /** El "ahora" del cálculo, inyectado para que las pruebas no dependan del reloj de la máquina. */
  readonly ahora?: Date;
}

export interface FilaInventarioInmovil {
  readonly productoId: number;
  readonly sku: string;
  readonly descripcion: string;
  readonly categoria: string | null;
  readonly unidadMedida: string | null;
  readonly existencias: number;
  readonly ultimoCosto: number;
  readonly valorInmovilizado: number;
  readonly ultimaSalida: Date | null;
  readonly diasSinSalida: number;
  readonly nuncaHaSalido: boolean;
}

export interface ReporteInventarioInmovil {
  readonly productos: FilaInventarioInmovil[];
  readonly valorTotalInmovilizado: number;
}

/** Milisegundos de un día — el divisor del contador de antigüedad. */
const UN_DIA_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ReporteInventarioInmovilCasoUso
  implements CasoDeUso<ReporteInventarioInmovilEntrada, ReporteInventarioInmovil>
{
  constructor(
    @Inject(REPOSITORIO_PRODUCTOS) private readonly productos: RepositorioProductos,
    @Inject(REPOSITORIO_MOVIMIENTOS) private readonly movimientos: RepositorioMovimientos,
  ) {}

  async ejecutar(entrada: ReporteInventarioInmovilEntrada): Promise<ReporteInventarioInmovil> {
    const ahora = entrada.ahora ?? new Date();

    const [catalogo, rotaciones] = await Promise.all([
      this.productos.listarTodos({ buscar: entrada.buscar, categoriaId: entrada.categoriaId }),
      this.movimientos.rotacionPorProducto(),
    ]);

    const porProducto = new Map(rotaciones.map((rotacion) => [rotacion.productoId, rotacion]));
    const filas: FilaInventarioInmovil[] = [];

    for (const producto of catalogo) {
      // FR-160: sin existencias no hay capital detenido. Va PRIMERO porque descarta la mayoría
      // del catálogo sin necesidad de mirar su historia.
      if (producto.stockActual <= 0) continue;

      const rotacion = porProducto.get(producto.id);
      // El reloj: última salida, o la primera entrada si nunca salió (FR-159). Sin ninguna de las
      // dos el producto no tiene movimientos, y entonces tampoco puede tener existencias — pero
      // se descarta explícitamente en vez de asumirlo, porque una fila sin fecha de referencia no
      // tendría antigüedad que mostrar.
      const referencia = rotacion?.ultimaSalida ?? rotacion?.primeraEntrada ?? null;
      if (!referencia) continue;

      const dias = Math.floor((ahora.getTime() - referencia.getTime()) / UN_DIA_MS);
      if (dias < entrada.diasSinSalida) continue;

      const valorInmovilizado = producto.stockActual * producto.ultimoCosto;
      filas.push({
        productoId: producto.id,
        sku: producto.sku,
        descripcion: producto.descripcion,
        categoria: producto.categoria?.nombre ?? null,
        unidadMedida: producto.unidadMedida?.nombre ?? null,
        existencias: producto.stockActual,
        ultimoCosto: producto.ultimoCosto,
        valorInmovilizado,
        ultimaSalida: rotacion?.ultimaSalida ?? null,
        diasSinSalida: dias,
        nuncaHaSalido: !rotacion?.ultimaSalida,
      });
    }

    // FR-161: por VALOR, no por antigüedad. La pregunta es dónde está la plata detenida, y lo más
    // viejo de una bodega suele ser también lo más barato.
    filas.sort((a, b) => b.valorInmovilizado - a.valorInmovilizado);

    return {
      productos: filas,
      valorTotalInmovilizado: filas.reduce((total, fila) => total + fila.valorInmovilizado, 0),
    };
  }
}
