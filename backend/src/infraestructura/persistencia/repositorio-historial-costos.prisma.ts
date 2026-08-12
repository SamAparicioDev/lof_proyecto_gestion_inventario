/**
 * Adaptador `RepositorioHistorialCostosPrisma` — implementa el puerto
 * `RepositorioHistorialCostos` del dominio con Prisma (patrón Repository/Adapter,
 * docs/arquitectura.md §3). Único punto del backend donde el modelo
 * `historial_costos_producto` se traduce a la entidad `CambioCostoProducto` del dominio
 * (`BigInt`→`number`, `Prisma.Decimal`→`number`, enum de Prisma→tipo del dominio).
 *
 * SOLO LECTURA a propósito, exactamente por el mismo motivo que
 * `RepositorioMovimientosPrisma`: la tabla es INMUTABLE (trigger de BD) y sus `INSERT` ocurren
 * dentro de las transacciones de `RepositorioProductosPrisma.actualizarCosto` y
 * `RepositorioIngresosPrisma.recibir`, que son las dueñas del `UPDATE` de
 * `productos.ultimo_costo` (FR-072 — ver TSDoc del puerto). Este adaptador nunca escribe.
 *
 * `listarPorProducto`: `findMany`/`count` simples sobre `producto_id`, ordenado por
 * `fecha_hora` DESCENDENTE (más reciente primero, contracts/api-rest.md), paginado — sin joins
 * ni agregados: el nombre del usuario lo compone el caso de uso, mismo reparto que
 * `HistorialProductoCasoUso` con los movimientos.
 *
 * Implementa: FR-072 (historial de costos consultable desde la ficha del producto).
 */
import { Injectable } from '@nestjs/common';
import type { HistorialCostoProducto as HistorialCostoProductoPrisma } from '@prisma/client';
import type { CambioCostoProducto } from '../../dominio/entidades/cambio-costo-producto';
import type {
  FiltrosHistorialCostos,
  PaginaHistorialCostos,
  RepositorioHistorialCostos,
} from '../../dominio/puertos/repositorio-historial-costos';
import { PrismaService } from './prisma.service';
import { mapearOrigenADominio } from './registrar-cambio-costo';

@Injectable()
export class RepositorioHistorialCostosPrisma implements RepositorioHistorialCostos {
  constructor(private readonly prisma: PrismaService) {}

  async listarPorProducto(productoId: number, filtros: FiltrosHistorialCostos): Promise<PaginaHistorialCostos> {
    const where = { productoId: BigInt(productoId) };
    const [registros, total] = await this.prisma.$transaction([
      this.prisma.historialCostoProducto.findMany({
        where,
        // `id` desempata dos cambios del MISMO instante (una carga masiva escribe varias filas
        // dentro de la misma transacción, así que `now()` puede repetirse): sin él, el orden
        // entre esas filas quedaría a criterio del planificador y la paginación podría repetir
        // o saltarse una.
        orderBy: [{ fechaHora: 'desc' }, { id: 'desc' }],
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
      }),
      this.prisma.historialCostoProducto.count({ where }),
    ]);
    return { datos: registros.map(aCambioCostoDominio), total };
  }
}

/** Traduce un registro Prisma de `historial_costos_producto` a la entidad de dominio. */
function aCambioCostoDominio(registro: HistorialCostoProductoPrisma): CambioCostoProducto {
  return {
    id: Number(registro.id),
    productoId: Number(registro.productoId),
    costoAnterior: registro.costoAnterior.toNumber(),
    costoNuevo: registro.costoNuevo.toNumber(),
    origen: mapearOrigenADominio(registro.origen),
    documentoId: registro.documentoId === null ? null : Number(registro.documentoId),
    fechaHora: registro.fechaHora,
    usuarioId: Number(registro.usuarioId),
  };
}
