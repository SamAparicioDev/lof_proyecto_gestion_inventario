/**
 * Adaptador `RepositorioOrdenesCompraPrisma` — implementa el puerto del dominio con Prisma
 * (patrón Repository/Adapter, docs/arquitectura.md §3).
 *
 * Dos piezas merecen atención:
 *
 * 1. **El correlativo** (FR-095): `crear` pide el número con
 *    `siguienteNumeroEnTransaccion(tx, …)` DENTRO de la transacción que inserta la orden,
 *    exactamente igual que `RepositorioSalidasPrisma.crear` y por el mismo motivo (research
 *    R5): si el `INSERT` falla después de incrementar el contador, el `UPDATE ... RETURNING`
 *    se revierte con él y el número no queda quemado de forma visible.
 * 2. **Los cambios de estado se validan DENTRO de la transacción**, releyendo la orden. Aquí
 *    no hay stock que bloquear —una orden no mueve inventario (FR-096)—, pero sí una carrera
 *    real: dos usuarios enviando la misma orden a la vez, o uno editándola mientras el otro la
 *    envía. Leer y escribir en la misma transacción es lo que impide que la segunda operación
 *    se aplique sobre un estado que ya cambió.
 *
 * Implementa: FR-094…FR-097 y FR-099 (`marcarRecibida`, que invoca el flujo del ingreso).
 */
import {
  impuestosDeDocumento,
  impuestosDeLinea,
} from '../../dominio/servicios/servicio-impuestos';
import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type DetalleOrdenCompra as DetalleOrdenCompraPrisma,
  type EstadoOrdenCompra as EstadoOrdenCompraPrisma,
  type OrdenCompra as OrdenCompraPrisma,
} from '@prisma/client';
import { EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import {
  calcularValorTotalLineaOrden,
  calcularValorTotalOrdenCompra,
  puedeEditarseOrdenCompra,
  transicionValidaOrdenCompra,
  type DetalleOrdenCompra,
  type EstadoOrdenCompra,
  type OrdenCompra,
} from '../../dominio/entidades/orden-compra';
import {
  CLAVE_CONTADOR_ORDEN_COMPRA,
  type CriteriosOrdenesCompra,
  type DatosActualizarOrdenCompra,
  type DatosNuevaOrdenCompra,
  type LineaNuevaOrdenCompra,
  type FiltrosListarOrdenesCompra,
  type OrdenCompraConDetalles,
  type PaginaOrdenesCompra,
  type RepositorioOrdenesCompra,
} from '../../dominio/puertos/repositorio-ordenes-compra';
import { ContadoresPrisma } from './contadores.prisma';
import { PrismaService } from './prisma.service';
import { UnidadDeTrabajo, type PrismaTransactionClient } from './unidad-de-trabajo';

/** El proveedor viaja RESUELTO en la entidad de dominio, así que toda lectura lo incluye —
 *  mismo criterio (y mismo motivo) que `INCLUIR_PROVEEDOR` en el adaptador de ingresos. */
const INCLUIR_PROVEEDOR = { proveedor: { select: { id: true, nombre: true } } } as const;

type OrdenCompraPrismaConProveedor = OrdenCompraPrisma & { proveedor: { id: bigint; nombre: string } };

/**
 * Orden del listado, compartido por la vista paginada y su exportación completa — el archivo
 * trae las filas en el MISMO orden en que se leen en pantalla.
 *
 * El desempate por `id` no es estético: `fecha_orden` es `DATE` y se repite, así que ordenar
 * solo por ella deja un orden INESTABLE y `skip`/`take` duplicaría unas filas y escondería
 * otras al pasar de página (mismo defecto ya corregido en ingresos y salidas).
 */
const ORDEN_LISTADO: Prisma.OrdenCompraOrderByWithRelationInput[] = [{ fechaOrden: 'desc' }, { id: 'desc' }];

@Injectable()
export class RepositorioOrdenesCompraPrisma implements RepositorioOrdenesCompra {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unidadDeTrabajo: UnidadDeTrabajo,
    private readonly contadores: ContadoresPrisma,
  ) {}

  async buscarPorId(id: number): Promise<OrdenCompraConDetalles | null> {
    const registro = await this.prisma.ordenCompra.findUnique({
      where: { id: BigInt(id) },
      include: { detalles: true, ...INCLUIR_PROVEEDOR },
    });
    return registro
      ? { ...aOrdenDominio(registro), detalles: registro.detalles.map(aDetalleDominio) }
      : null;
  }

  async listar(filtros: FiltrosListarOrdenesCompra): Promise<PaginaOrdenesCompra> {
    const where = construirWhere(filtros);
    const [registros, total] = await this.prisma.$transaction([
      this.prisma.ordenCompra.findMany({
        where,
        include: INCLUIR_PROVEEDOR,
        orderBy: ORDEN_LISTADO,
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
      }),
      this.prisma.ordenCompra.count({ where }),
    ]);
    return { datos: registros.map(aOrdenDominio), total };
  }

  async listarTodas(criterios: CriteriosOrdenesCompra): Promise<OrdenCompra[]> {
    const registros = await this.prisma.ordenCompra.findMany({
      where: construirWhere(criterios),
      include: INCLUIR_PROVEEDOR,
      orderBy: ORDEN_LISTADO,
    });
    return registros.map(aOrdenDominio);
  }

  async crear(datos: DatosNuevaOrdenCompra): Promise<OrdenCompra> {
    return this.unidadDeTrabajo.ejecutar(async (tx) => {
      const numero = await this.contadores.siguienteNumeroEnTransaccion(tx, CLAVE_CONTADOR_ORDEN_COMPRA);

      const registro = await tx.ordenCompra.create({
        data: {
          numero: BigInt(numero),
          proveedorId: BigInt(datos.proveedorId),
          fechaOrden: datos.fechaOrden,
          fechaEntregaEsperada: datos.fechaEntregaEsperada,
          observaciones: datos.observaciones,
          valorTotal: calcularValorTotalOrdenCompra(datos.lineas),
        valorIva: impuestosDeDocumento(datos.lineas).iva,
          usuarioCreacionId: BigInt(datos.usuarioId),
          detalles: { create: datos.lineas.map(aLineaPrisma) },
        },
        include: INCLUIR_PROVEEDOR,
      });
      return aOrdenDominio(registro);
    });
  }

  async actualizar(id: number, datos: DatosActualizarOrdenCompra, usuarioId: number): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const orden = await cargarParaMutar(tx, id);
      if (!puedeEditarseOrdenCompra({ estado: aEstadoDominio(orden.estado) })) {
        throw new EstadoInvalido('Solo una orden en BORRADOR puede editarse');
      }

      await tx.detalleOrdenCompra.deleteMany({ where: { ordenCompraId: BigInt(id) } });
      await tx.ordenCompra.update({
        where: { id: BigInt(id) },
        data: {
          proveedorId: BigInt(datos.proveedorId),
          fechaOrden: datos.fechaOrden,
          fechaEntregaEsperada: datos.fechaEntregaEsperada,
          observaciones: datos.observaciones,
          valorTotal: calcularValorTotalOrdenCompra(datos.lineas),
        valorIva: impuestosDeDocumento(datos.lineas).iva,
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
          detalles: { create: datos.lineas.map(aLineaPrisma) },
        },
      });
    });
  }

  async enviar(id: number, usuarioId: number): Promise<void> {
    await this.cambiarEstado(id, 'ENVIADA', usuarioId, 'Solo una orden en BORRADOR puede enviarse');
  }

  async anular(id: number, usuarioId: number, motivo: string): Promise<void> {
    await this.cambiarEstado(
      id,
      'ANULADA',
      usuarioId,
      'Solo una orden en BORRADOR o ENVIADA puede anularse',
      motivo,
    );
  }

  async marcarRecibida(id: number, usuarioId: number): Promise<void> {
    await this.cambiarEstado(id, 'RECIBIDA', usuarioId, 'Solo una orden ENVIADA puede marcarse recibida');
  }

  /** Relee la orden y valida la transición DENTRO de la transacción — ver el TSDoc de cabecera
   *  sobre por qué no basta con comprobarlo antes. */
  private async cambiarEstado(
    id: number,
    siguiente: EstadoOrdenCompra,
    usuarioId: number,
    mensajeSiInvalida: string,
    motivo?: string,
  ): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const orden = await cargarParaMutar(tx, id);
      if (!transicionValidaOrdenCompra(aEstadoDominio(orden.estado), siguiente)) {
        throw new EstadoInvalido(mensajeSiInvalida);
      }

      await tx.ordenCompra.update({
        where: { id: BigInt(id) },
        data: {
          estado: siguiente,
          motivoAnulacion: motivo ?? undefined,
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
        },
      });
    });
  }
}

/**
 * Marca una orden como RECIBIDA desde la transacción de OTRO adaptador (FR-099).
 *
 * Se exporta como función suelta —no como método— porque quien la necesita es
 * `RepositorioIngresosPrisma.recibir`, que ya tiene su propia transacción abierta con los
 * productos bloqueados: abrir aquí una segunda transacción rompería la atomicidad que da
 * sentido al vínculo (la orden no puede quedar cerrada sin que el stock haya entrado, ni al
 * revés). Es un detalle de integración entre dos adaptadores de infraestructura, igual que
 * `siguienteNumeroEnTransaccion` en `contadores.prisma.ts`.
 *
 * No valida la transición ni falla si la orden ya está RECIBIDA: recibir dos ingresos parciales
 * contra la misma orden es legítimo y el segundo no debe romper nada.
 */
export async function marcarOrdenRecibidaEnTransaccion(
  tx: PrismaTransactionClient,
  ordenCompraId: number,
  usuarioId: number,
): Promise<void> {
  await tx.ordenCompra.updateMany({
    where: { id: BigInt(ordenCompraId), estado: 'ENVIADA' },
    data: {
      estado: 'RECIBIDA',
      usuarioModificacionId: BigInt(usuarioId),
      fechaModificacion: new Date(),
    },
  });
}

async function cargarParaMutar(tx: PrismaTransactionClient, id: number): Promise<OrdenCompraPrisma> {
  const orden = await tx.ordenCompra.findUnique({ where: { id: BigInt(id) } });
  if (!orden) throw new NoEncontrado('La orden de compra');
  return orden;
}

function aLineaPrisma(linea: LineaNuevaOrdenCompra) {
  return {
    productoId: BigInt(linea.productoId),
    cantidad: linea.cantidad,
    precioUnitario: linea.precioUnitario,
    valorTotal: calcularValorTotalLineaOrden(linea),
    // US20 (FR-109/FR-110) — ver el mismo bloque en `repositorio-ingresos.prisma.ts`.
    tasaIva: linea.tasaIva ?? 0,
    valorIva: impuestosDeLinea(linea).iva,
  };
}

/** `buscar` cruza el NÚMERO de la orden y el nombre del proveedor; el resto son igualdades y
 *  rangos, combinados con Y lógico (mismo criterio que el resto de listados, FR-075). */
function construirWhere(filtros: CriteriosOrdenesCompra): Prisma.OrdenCompraWhereInput {
  const condiciones: Prisma.OrdenCompraWhereInput[] = [];

  const termino = filtros.buscar?.trim();
  if (termino) {
    const alternativas: Prisma.OrdenCompraWhereInput[] = [
      { proveedor: { nombre: { contains: termino, mode: 'insensitive' } } },
    ];
    // El número es un entero, así que solo se cruza cuando lo escrito ES un número — buscar
    // "3M" no debe reventar la consulta ni devolver un resultado arbitrario.
    const soloDigitos = termino.replace(/\D/g, '');
    if (soloDigitos !== '') alternativas.push({ numero: BigInt(soloDigitos) });
    condiciones.push({ OR: alternativas });
  }

  if (filtros.proveedorId) condiciones.push({ proveedorId: BigInt(filtros.proveedorId) });
  if (filtros.estado) condiciones.push({ estado: filtros.estado });
  if (filtros.desde) condiciones.push({ fechaOrden: { gte: filtros.desde } });
  if (filtros.hasta) condiciones.push({ fechaOrden: { lte: filtros.hasta } });

  return condiciones.length > 0 ? { AND: condiciones } : {};
}

function aOrdenDominio(registro: OrdenCompraPrismaConProveedor): OrdenCompra {
  return {
    id: Number(registro.id),
    numero: Number(registro.numero),
    proveedor: { id: Number(registro.proveedor.id), nombre: registro.proveedor.nombre },
    fechaOrden: registro.fechaOrden,
    fechaEntregaEsperada: registro.fechaEntregaEsperada,
    observaciones: registro.observaciones,
    estado: aEstadoDominio(registro.estado),
    valorTotal: registro.valorTotal.toNumber(),
    valorIva: registro.valorIva.toNumber(),
    motivoAnulacion: registro.motivoAnulacion,
  };
}

function aDetalleDominio(registro: DetalleOrdenCompraPrisma): DetalleOrdenCompra {
  return {
    id: Number(registro.id),
    ordenCompraId: Number(registro.ordenCompraId),
    productoId: Number(registro.productoId),
    cantidad: registro.cantidad.toNumber(),
    precioUnitario: registro.precioUnitario.toNumber(),
    valorTotal: registro.valorTotal.toNumber(),
    tasaIva: registro.tasaIva.toNumber(),
    valorIva: registro.valorIva.toNumber(),
  };
}

/** El enum de Prisma y el del dominio coinciden en valores, pero se traducen explícitamente
 *  (docs/arquitectura.md §2: el dominio no importa tipos generados). El `switch` exhaustivo
 *  hace que agregar un estado al esquema sin decidir su mapeo NO compile. */
function aEstadoDominio(estado: EstadoOrdenCompraPrisma): EstadoOrdenCompra {
  switch (estado) {
    case 'BORRADOR':
      return 'BORRADOR';
    case 'ENVIADA':
      return 'ENVIADA';
    case 'RECIBIDA':
      return 'RECIBIDA';
    case 'ANULADA':
      return 'ANULADA';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de orden de compra sin mapeo al dominio: ${String(valorInesperado)}`);
    }
  }
}
