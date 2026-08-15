/**
 * Adaptador `SugerenciasCompraPrisma` — la consulta de FR-098: "¿qué le pido hoy a este
 * proveedor?".
 *
 * Es SQL crudo y no una composición de consultas de Prisma, por una razón concreta: la pregunta
 * cruza tres cosas que Prisma no sabe combinar en una sola pasada — el stock del producto, su
 * COMPROMETIDO (la suma de salidas pendientes, que no es una columna sino un agregado) y el
 * historial de quién se lo ha suministrado. Resolverlo con el cliente exigiría traer todo el
 * catálogo a memoria y filtrar en Node, que es justo lo que un índice existe para evitar.
 *
 * La regla de NEGOCIO —cuánto pedir— no está en el SQL: la aplica `cantidadSugeridaDeCompra`
 * (dominio, función pura) sobre los hechos que esta consulta devuelve. Así la fórmula se puede
 * cambiar y probar sin tocar la base de datos.
 *
 * Implementa: FR-098.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cantidadSugeridaDeCompra } from '../../dominio/entidades/orden-compra';
import type { SugerenciaCompra, SugerenciasCompra } from '../../dominio/puertos/sugerencias-compra';
import { PrismaService } from './prisma.service';

/** Fila cruda de la consulta de sugerencias. */
interface FilaSugerencia {
  producto_id: bigint;
  sku: string;
  descripcion: string;
  disponible: Prisma.Decimal;
  umbral_stock_bajo: Prisma.Decimal;
  ultimo_costo: Prisma.Decimal;
}

@Injectable()
export class SugerenciasCompraPrisma implements SugerenciasCompra {
  constructor(private readonly prisma: PrismaService) {}

  async paraProveedor(proveedorId: number): Promise<SugerenciaCompra[]> {
    const filas = await this.prisma.$queryRaw<FilaSugerencia[]>`
      SELECT p.id                AS producto_id,
             p.sku,
             p.descripcion,
             -- disponible = stock_actual − comprometido (data-model.md § productos, research R4).
             -- El COALESCE cubre el caso normal: un producto sin salidas pendientes no aparece
             -- en el agregado y su comprometido es 0, no NULL.
             p.stock_actual - COALESCE(c.comprometido, 0) AS disponible,
             p.umbral_stock_bajo,
             p.ultimo_costo
      FROM productos p
      LEFT JOIN (
        SELECT ds.producto_id, SUM(ds.cantidad) AS comprometido
        FROM detalles_salidas ds
        JOIN salidas s ON s.id = ds.salida_id
        WHERE s.estado = 'PENDIENTE'
        GROUP BY ds.producto_id
      ) c ON c.producto_id = p.id
      WHERE p.estado = 'ACTIVO'
        -- Bajo umbral, MISMA regla que el inventario (esStockBajo usa <=, no <).
        AND p.stock_actual - COALESCE(c.comprometido, 0) <= p.umbral_stock_bajo
        -- Y que ESTE proveedor ya lo haya suministrado alguna vez: es lo que separa una
        -- sugerencia útil de un volcado del inventario bajo mínimos (FR-098).
        AND EXISTS (
          SELECT 1
          FROM detalles_ingresos di
          JOIN ingresos i ON i.id = di.ingreso_id
          WHERE di.producto_id = p.id
            AND i.proveedor_id = ${BigInt(proveedorId)}
            -- Un ingreso ANULADO no acredita a nadie como suministrador.
            AND i.estado <> 'ANULADO'
        )
      ORDER BY p.descripcion ASC
    `;

    return filas.map((fila) => {
      const disponible = fila.disponible.toNumber();
      const umbral = fila.umbral_stock_bajo.toNumber();
      return {
        productoId: Number(fila.producto_id),
        sku: fila.sku,
        descripcion: fila.descripcion,
        disponible,
        umbralStockBajo: umbral,
        cantidadSugerida: cantidadSugeridaDeCompra(disponible, umbral),
        precioSugerido: fila.ultimo_costo.toNumber(),
      };
    });
  }
}
