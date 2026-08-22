/**
 * Adaptador `RepositorioMovimientosPrisma` — implementa el puerto `RepositorioMovimientos`
 * del dominio con Prisma (patrón Repository/Adapter, docs/arquitectura.md §3). Único punto
 * del backend donde el modelo `movimientos_inventario` de Prisma se traduce a la entidad
 * `MovimientoInventario` del dominio (`BigInt`→`number`, `Prisma.Decimal`→`number`, enum de
 * Prisma→tipo del dominio) — el dominio no conoce el tipo de columna de la BD
 * (docs/arquitectura.md §2).
 *
 * SOLO LECTURA a propósito (ver TSDoc del puerto): `movimientos_inventario` es INMUTABLE
 * (trigger de BD, Principio II/FR-046) y sus `INSERT` ya ocurren dentro de las transacciones
 * de `RepositorioIngresosPrisma`/`RepositorioSalidasPrisma` — este adaptador nunca escribe.
 *
 * `listarPorProducto`: `findMany`/`count` simples sobre `producto_id` (y `fecha_hora` cuando
 * llegan `desde`/`hasta`), ordenado por `fecha_hora` DESCENDENTE, paginado — sin agregados ni
 * joins adicionales (Principio V: la ficha de producto de US5 no los necesita todavía).
 *
 * `listar` (US7/FR-042): mismo `findMany` sin `producto_id` fijo, sin paginar, con los
 * filtros del reporte general. `clienteId` se traduce al JOIN implícito
 * `movimientos_inventario ⋈ proyectos ON proyecto_id WHERE proyectos.cliente_id = :clienteId`
 * vía la relación `proyecto` del modelo Prisma — mismo patrón que
 * `condicionesClienteProyectoFecha` en `repositorio-salidas.prisma.ts`.
 *
 * Implementa: FR-024 (historial de movimientos por producto) y FR-042 (reporte de
 * movimientos filtrable).
 */
import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type DocumentoTipo as DocumentoTipoPrisma,
  type MovimientoInventario as MovimientoInventarioPrisma,
  type TipoMovimiento as TipoMovimientoPrisma,
} from '@prisma/client';
import type {
  DocumentoTipoMovimiento,
  MovimientoInventario,
  TipoMovimientoInventario,
} from '../../dominio/entidades/movimiento-inventario';
import type {
  ExistenciasAFecha,
  FiltrosListarMovimientos,
  FiltrosListarMovimientosGeneral,
  PaginaMovimientos,
  RepositorioMovimientos,
  RotacionDeProducto,
} from '../../dominio/puertos/repositorio-movimientos';
import { PrismaService } from './prisma.service';

@Injectable()
export class RepositorioMovimientosPrisma implements RepositorioMovimientos {
  constructor(private readonly prisma: PrismaService) {}

  async listarPorProducto(productoId: number, filtros: FiltrosListarMovimientos): Promise<PaginaMovimientos> {
    const where = construirWhereListarMovimientos(productoId, filtros);
    const [registros, total] = await this.prisma.$transaction([
      this.prisma.movimientoInventario.findMany({
        where,
        orderBy: { fechaHora: 'desc' },
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
      }),
      this.prisma.movimientoInventario.count({ where }),
    ]);
    return { datos: registros.map(aMovimientoDominio), total };
  }

  /**
   * Quiénes han movido inventario, ordenados por nombre (US25, FR-121).
   *
   * `groupBy` sobre `usuario_id` y una segunda consulta con los nombres: deduplica en PostgreSQL
   * —no trayendo un movimiento por fila para descartarlos en memoria— y el `IN` posterior es
   * sobre un puñado de ids. Con `movimientos_usuario_id_idx` (FR-042) el agrupamiento no
   * recorre la tabla entera.
   */
  async usuariosConMovimientos(): Promise<{ id: number; nombre: string }[]> {
    const grupos = await this.prisma.movimientoInventario.groupBy({ by: ['usuarioId'] });
    if (grupos.length === 0) return [];

    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: grupos.map((grupo) => grupo.usuarioId) } },
      select: { id: true, nombreCompleto: true },
      orderBy: { nombreCompleto: 'asc' },
    });
    return usuarios.map((usuario) => ({ id: Number(usuario.id), nombre: usuario.nombreCompleto }));
  }

  /**
   * Última salida y primera entrada de cada producto (US37, FR-159), en DOS consultas agrupadas
   * para todo el catálogo — nunca una por producto.
   *
   * Solo cuenta `SALIDA` como salida, no `AJUSTE_SALIDA`. Un ajuste de salida es una corrección
   * —una rotura, un conteo que aparece de menos—, no mercancía que se fue a un cliente. Si
   * contara, dar de baja producto averiado parecería rotación y sacaría del reporte justo lo que
   * lleva años sin venderse.
   *
   * En la entrada, en cambio, sí cuentan las dos: para el producto que nunca ha salido lo que se
   * busca es desde CUÁNDO está en la bodega, y ahí da igual si llegó por factura o apareció en
   * un ajuste.
   */
  async rotacionPorProducto(): Promise<RotacionDeProducto[]> {
    const [salidas, entradas] = await Promise.all([
      this.prisma.movimientoInventario.groupBy({
        by: ['productoId'],
        where: { tipo: 'SALIDA' },
        _max: { fechaHora: true },
      }),
      this.prisma.movimientoInventario.groupBy({
        by: ['productoId'],
        where: { tipo: { in: ['ENTRADA', 'AJUSTE_ENTRADA'] } },
        _min: { fechaHora: true },
      }),
    ]);

    const porProducto = new Map<number, { ultimaSalida: Date | null; primeraEntrada: Date | null }>();
    for (const grupo of salidas) {
      const id = Number(grupo.productoId);
      porProducto.set(id, { ultimaSalida: grupo._max.fechaHora, primeraEntrada: null });
    }
    for (const grupo of entradas) {
      const id = Number(grupo.productoId);
      const previo = porProducto.get(id);
      if (previo) porProducto.set(id, { ...previo, primeraEntrada: grupo._min.fechaHora });
      else porProducto.set(id, { ultimaSalida: null, primeraEntrada: grupo._min.fechaHora });
    }

    return [...porProducto.entries()].map(([productoId, fechas]) => ({ productoId, ...fechas }));
  }

  /**
   * Existencias de cada producto a una fecha (US38, FR-164).
   *
   * `DISTINCT ON` de PostgreSQL: por cada `producto_id`, la primera fila del orden — que aquí es
   * el movimiento MÁS RECIENTE anterior o igual a la fecha. Se lee su `stock_resultante`, la foto
   * del stock justo después de ese movimiento, en vez de sumar cantidades con signo sobre toda la
   * historia: es una sola pasada y no puede desviarse de lo que quedó escrito.
   *
   * El desempate por `id DESC` no es decorativo: dos movimientos pueden compartir `fecha_hora` al
   * milisegundo (una salida de varias líneas se escribe en la misma transacción), y sin él cuál
   * gana quedaría a criterio del planificador — la misma consulta podría dar dos cifras distintas.
   *
   * SQL crudo y no Prisma porque `groupBy` sabe devolver el `MAX(fecha_hora)` pero no la COLUMNA
   * de esa fila; resolverlo con el ORM costaría una segunda consulta con un `OR` de miles de
   * pares. Va parametrizado, como exige backend/CLAUDE.md.
   */
  async existenciasAFecha(fecha: Date): Promise<ExistenciasAFecha[]> {
    const filas = await this.prisma.$queryRaw<{ producto_id: bigint; stock_resultante: unknown }[]>`
      SELECT DISTINCT ON (producto_id) producto_id, stock_resultante
      FROM movimientos_inventario
      WHERE fecha_hora <= ${fecha}
      ORDER BY producto_id, fecha_hora DESC, id DESC
    `;
    return filas.map((fila) => ({
      productoId: Number(fila.producto_id),
      existencias: Number(fila.stock_resultante),
    }));
  }

  async listar(filtros: FiltrosListarMovimientosGeneral): Promise<MovimientoInventario[]> {
    const registros = await this.prisma.movimientoInventario.findMany({
      where: construirWhereListarMovimientosGeneral(filtros),
      orderBy: { fechaHora: 'desc' },
    });
    return registros.map(aMovimientoDominio);
  }
}

/** `producto_id` fijo más el rango opcional `desde`/`hasta` sobre `fecha_hora`. */
function construirWhereListarMovimientos(
  productoId: number,
  filtros: FiltrosListarMovimientos,
): Prisma.MovimientoInventarioWhereInput {
  const fechaHora: Prisma.DateTimeFilter = {};
  if (filtros.desde) fechaHora.gte = filtros.desde;
  if (filtros.hasta) fechaHora.lte = filtros.hasta;

  return {
    productoId: BigInt(productoId),
    ...(filtros.desde || filtros.hasta ? { fechaHora } : {}),
  };
}

/** Filtro fecha/tipo/usuario/cliente/proyecto del reporte general de movimientos (FR-042).
 *  `clienteId` vía el JOIN implícito sobre `proyecto.clienteId` (ver TSDoc de archivo);
 *  `proyectoId` es columna propia de `movimientos_inventario`, sin JOIN. */
function construirWhereListarMovimientosGeneral(
  filtros: FiltrosListarMovimientosGeneral,
): Prisma.MovimientoInventarioWhereInput {
  const condiciones: Prisma.MovimientoInventarioWhereInput[] = [];
  if (filtros.desde) condiciones.push({ fechaHora: { gte: filtros.desde } });
  if (filtros.hasta) condiciones.push({ fechaHora: { lte: filtros.hasta } });
  if (filtros.tipo) condiciones.push({ tipo: mapearTipoAPrisma(filtros.tipo) });
  if (filtros.usuarioId !== undefined) condiciones.push({ usuarioId: BigInt(filtros.usuarioId) });
  if (filtros.proyectoId !== undefined) condiciones.push({ proyectoId: BigInt(filtros.proyectoId) });
  if (filtros.clienteId !== undefined) condiciones.push({ proyecto: { clienteId: BigInt(filtros.clienteId) } });
  return condiciones.length > 0 ? { AND: condiciones } : {};
}

/** Traduce el tipo de movimiento del dominio al enum de Prisma (inverso de
 *  `mapearTipoADominio`) — lo necesita `construirWhereListarMovimientosGeneral` para filtrar. */
function mapearTipoAPrisma(tipo: TipoMovimientoInventario): TipoMovimientoPrisma {
  switch (tipo) {
    case 'ENTRADA':
      return 'ENTRADA';
    case 'SALIDA':
      return 'SALIDA';
    case 'AJUSTE_ENTRADA':
      return 'AJUSTE_ENTRADA';
    case 'AJUSTE_SALIDA':
      return 'AJUSTE_SALIDA';
    default: {
      const valorInesperado: never = tipo;
      throw new Error(`Tipo de movimiento de dominio sin mapeo a Prisma: ${String(valorInesperado)}`);
    }
  }
}

/** Traduce un registro Prisma de `movimientos_inventario` a la entidad de dominio. */
function aMovimientoDominio(registro: MovimientoInventarioPrisma): MovimientoInventario {
  return {
    id: Number(registro.id),
    fechaHora: registro.fechaHora,
    tipo: mapearTipoADominio(registro.tipo),
    productoId: Number(registro.productoId),
    cantidad: registro.cantidad.toNumber(),
    stockResultante: registro.stockResultante.toNumber(),
    documentoTipo: mapearDocumentoTipoADominio(registro.documentoTipo),
    documentoId: Number(registro.documentoId),
    proyectoId: registro.proyectoId === null ? null : Number(registro.proyectoId),
    usuarioId: Number(registro.usuarioId),
    motivo: registro.motivo,
  };
}

function mapearTipoADominio(tipo: TipoMovimientoPrisma): TipoMovimientoInventario {
  switch (tipo) {
    case 'ENTRADA':
      return 'ENTRADA';
    case 'SALIDA':
      return 'SALIDA';
    case 'AJUSTE_ENTRADA':
      return 'AJUSTE_ENTRADA';
    case 'AJUSTE_SALIDA':
      return 'AJUSTE_SALIDA';
    default: {
      const valorInesperado: never = tipo;
      throw new Error(`Tipo de movimiento de Prisma sin mapeo al dominio: ${String(valorInesperado)}`);
    }
  }
}

function mapearDocumentoTipoADominio(documentoTipo: DocumentoTipoPrisma): DocumentoTipoMovimiento {
  switch (documentoTipo) {
    case 'INGRESO':
      return 'INGRESO';
    case 'SALIDA':
      return 'SALIDA';
    case 'AJUSTE':
      return 'AJUSTE';
    default: {
      const valorInesperado: never = documentoTipo;
      throw new Error(`Tipo de documento de Prisma sin mapeo al dominio: ${String(valorInesperado)}`);
    }
  }
}
