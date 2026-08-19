/**
 * Adaptador `RepositorioCotizacionesPrisma` — implementa el puerto del dominio con Prisma
 * (patrón Repository/Adapter, docs/arquitectura.md §3).
 *
 * Espejo de `repositorio-ordenes-compra.prisma.ts` y con sus mismas dos piezas delicadas: el
 * correlativo se pide DENTRO de la transacción que inserta el documento (research R5), y los
 * cambios de estado se validan releyendo la cotización dentro de la transacción, que es lo que
 * impide que dos usuarios enviándola a la vez apliquen la segunda operación sobre un estado que
 * ya cambió.
 *
 * ## Lo propio de este adaptador: `aceptar`
 *
 * Es la única operación del módulo que escribe fuera de sus tablas. Crea la `Salida` PENDIENTE
 * con las mismas líneas y marca la cotización ACEPTADA **en la misma transacción**: una
 * cotización aceptada sin su salida dejaría al usuario creyendo que el pedido está en marcha
 * cuando no existe en ninguna parte, y una salida sin su cotización marcada volvería a
 * generarse al siguiente clic.
 *
 * La salida nace PENDIENTE y NO toca stock (FR-113/FR-115). Por eso aquí no hay `FOR UPDATE` ni
 * movimientos: crear una salida pendiente nunca los tuvo — el inventario se compromete al
 * CONFIRMARLA, con el flujo atómico que ya existe en `RepositorioSalidasPrisma`.
 *
 * Implementa: FR-112, FR-114, FR-115, FR-116.
 */
import { construirBusquedaPorTerminos, digitosDelTermino } from './busqueda-por-terminos';
import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type Cotizacion as CotizacionPrisma,
  type DetalleCotizacion as DetalleCotizacionPrisma,
  type EstadoCotizacion as EstadoCotizacionPrisma,
} from '@prisma/client';
import { EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import {
  puedeEditarseCotizacion,
  transicionValidaCotizacion,
  type Cotizacion,
  type DetalleCotizacion,
  type EstadoCotizacion,
} from '../../dominio/entidades/cotizacion';
import { CLAVE_CONTADOR_SALIDA } from '../../dominio/puertos/contadores';
import {
  type CotizacionConDetalles,
  type CriteriosCotizaciones,
  type DatosActualizarCotizacion,
  type DatosNuevaCotizacion,
  type FiltrosListarCotizaciones,
  type LineaNuevaCotizacion,
  type PaginaCotizaciones,
  type RepositorioCotizaciones,
} from '../../dominio/puertos/repositorio-cotizaciones';
import { impuestosDeDocumento, impuestosDeLinea } from '../../dominio/servicios/servicio-impuestos';
import { ContadoresPrisma } from './contadores.prisma';
import { PrismaService } from './prisma.service';
import { UnidadDeTrabajo, type PrismaTransactionClient } from './unidad-de-trabajo';

/** Clave del correlativo de cotizaciones — la fila la siembra la migración `*_cotizaciones`. */
export const CLAVE_CONTADOR_COTIZACION = 'cotizacion';

/** Cliente y proyecto viajan RESUELTOS en la entidad, así que toda lectura los incluye — mismo
 *  criterio que `INCLUIR_PROVEEDOR` en ingresos y órdenes. */
const INCLUIR_PARTES = {
  cliente: { select: { id: true, nombre: true } },
  proyecto: { select: { id: true, nombre: true } },
  salidas: { select: { id: true }, take: 1 },
} as const;

type CotizacionPrismaCompleta = CotizacionPrisma & {
  cliente: { id: bigint; nombre: string };
  proyecto: { id: bigint; nombre: string };
  salidas: { id: bigint }[];
};

/**
 * Orden del listado, compartido por la vista paginada y su exportación completa.
 *
 * El desempate por `id` no es estético: `fecha` es `DATE` y se repite, así que ordenar solo por
 * ella deja un orden INESTABLE y `skip`/`take` duplicaría unas filas y escondería otras al
 * pasar de página (mismo defecto ya corregido en ingresos, salidas y órdenes).
 */
const ORDEN_LISTADO: Prisma.CotizacionOrderByWithRelationInput[] = [{ fecha: 'desc' }, { id: 'desc' }];

@Injectable()
export class RepositorioCotizacionesPrisma implements RepositorioCotizaciones {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unidadDeTrabajo: UnidadDeTrabajo,
    private readonly contadores: ContadoresPrisma,
  ) {}

  async buscarPorId(id: number): Promise<CotizacionConDetalles | null> {
    const registro = await this.prisma.cotizacion.findUnique({
      where: { id: BigInt(id) },
      include: { detalles: true, ...INCLUIR_PARTES },
    });
    return registro
      ? { ...aCotizacionDominio(registro), detalles: registro.detalles.map(aDetalleDominio) }
      : null;
  }

  async listar(filtros: FiltrosListarCotizaciones): Promise<PaginaCotizaciones> {
    const where = construirWhere(filtros);
    const [registros, total] = await this.prisma.$transaction([
      this.prisma.cotizacion.findMany({
        where,
        include: INCLUIR_PARTES,
        orderBy: ORDEN_LISTADO,
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
      }),
      this.prisma.cotizacion.count({ where }),
    ]);
    return { datos: registros.map(aCotizacionDominio), total };
  }

  async listarTodas(criterios: CriteriosCotizaciones): Promise<Cotizacion[]> {
    const registros = await this.prisma.cotizacion.findMany({
      where: construirWhere(criterios),
      include: INCLUIR_PARTES,
      orderBy: ORDEN_LISTADO,
    });
    return registros.map(aCotizacionDominio);
  }

  async crear(datos: DatosNuevaCotizacion): Promise<Cotizacion> {
    return this.unidadDeTrabajo.ejecutar(async (tx) => {
      const numero = await this.contadores.siguienteNumeroEnTransaccion(tx, CLAVE_CONTADOR_COTIZACION);
      const impuestos = impuestosDeDocumento(datos.lineas);

      const registro = await tx.cotizacion.create({
        data: {
          numero: BigInt(numero),
          clienteId: BigInt(datos.clienteId),
          proyectoId: BigInt(datos.proyectoId),
          fecha: datos.fecha,
          fechaValidez: datos.fechaValidez,
          observaciones: datos.observaciones,
          valorTotal: impuestos.base,
          valorIva: impuestos.iva,
          usuarioCreacionId: BigInt(datos.usuarioId),
          detalles: { create: datos.lineas.map(aLineaPrisma) },
        },
        include: INCLUIR_PARTES,
      });
      return aCotizacionDominio(registro);
    });
  }

  async actualizar(id: number, datos: DatosActualizarCotizacion, usuarioId: number): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const cotizacion = await cargarParaMutar(tx, id);
      if (!puedeEditarseCotizacion({ estado: aEstadoDominio(cotizacion.estado) })) {
        throw new EstadoInvalido('Solo una cotización en BORRADOR puede editarse');
      }

      const impuestos = impuestosDeDocumento(datos.lineas);
      await tx.detalleCotizacion.deleteMany({ where: { cotizacionId: BigInt(id) } });
      await tx.cotizacion.update({
        where: { id: BigInt(id) },
        data: {
          clienteId: BigInt(datos.clienteId),
          proyectoId: BigInt(datos.proyectoId),
          fecha: datos.fecha,
          fechaValidez: datos.fechaValidez,
          observaciones: datos.observaciones,
          valorTotal: impuestos.base,
          valorIva: impuestos.iva,
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
          detalles: { create: datos.lineas.map(aLineaPrisma) },
        },
      });
    });
  }

  async enviar(id: number, usuarioId: number): Promise<void> {
    await this.cambiarEstado(id, 'ENVIADA', usuarioId, 'Solo una cotización en BORRADOR puede enviarse');
  }

  async rechazar(id: number, usuarioId: number): Promise<void> {
    await this.cambiarEstado(id, 'RECHAZADA', usuarioId, 'Solo una cotización ENVIADA puede rechazarse');
  }

  async anular(id: number, motivo: string, usuarioId: number): Promise<void> {
    await this.cambiarEstado(
      id,
      'ANULADA',
      usuarioId,
      'Solo una cotización en BORRADOR o ENVIADA puede anularse',
      motivo,
    );
  }

  /** ENVIADA → ACEPTADA + la salida PENDIENTE que la surte, en UNA transacción (FR-115). */
  async aceptar(id: number, usuarioId: number): Promise<{ salidaId: number }> {
    return this.unidadDeTrabajo.ejecutar(async (tx) => {
      const cotizacion = await tx.cotizacion.findUnique({
        where: { id: BigInt(id) },
        include: { detalles: true },
      });
      if (!cotizacion) throw new NoEncontrado('La cotización');
      if (!transicionValidaCotizacion(aEstadoDominio(cotizacion.estado), 'ACEPTADA')) {
        throw new EstadoInvalido('Solo una cotización ENVIADA puede aceptarse');
      }

      const numeroSalida = await this.contadores.siguienteNumeroEnTransaccion(tx, CLAVE_CONTADOR_SALIDA);
      const salida = await tx.salida.create({
        data: {
          numero: BigInt(numeroSalida),
          // La salida se fecha HOY, no con la fecha de la cotización: la oferta pudo hacerse
          // semanas antes y lo que se está registrando ahora es la decisión de despacharla.
          fechaSalida: new Date(),
          // US28 (FR-124): la salida generada hereda los DOS destinos de la cotización — una
          // cotización siempre tiene proyecto, así que esta salida también lo lleva.
          clienteId: cotizacion.clienteId,
          proyectoId: cotizacion.proyectoId,
          cotizacionId: cotizacion.id,
          observaciones: `Generada al aceptar la cotización N.º ${cotizacion.numero}.`,
          valorTotal: cotizacion.valorTotal,
          valorIva: cotizacion.valorIva,
          usuarioCreacionId: BigInt(usuarioId),
          detalles: {
            create: cotizacion.detalles.map((detalle) => ({
              productoId: detalle.productoId,
              cantidad: detalle.cantidad,
              // El precio y el impuesto viajan TAL CUAL: se le factura al cliente lo mismo que
              // se le cotizó, que es la razón de que exista este enlace.
              precioUnitario: detalle.precioUnitario,
              valorTotal: detalle.valorTotal,
              tasaIva: detalle.tasaIva,
              valorIva: detalle.valorIva,
            })),
          },
        },
        select: { id: true },
      });

      await tx.cotizacion.update({
        where: { id: BigInt(id) },
        data: {
          estado: 'ACEPTADA',
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
        },
      });

      return { salidaId: Number(salida.id) };
    });
  }

  /** Relee la cotización y valida la transición DENTRO de la transacción — ver el TSDoc de
   *  cabecera sobre por qué no basta con comprobarlo antes. */
  private async cambiarEstado(
    id: number,
    siguiente: EstadoCotizacion,
    usuarioId: number,
    mensajeSiInvalida: string,
    motivo?: string,
  ): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const cotizacion = await cargarParaMutar(tx, id);
      if (!transicionValidaCotizacion(aEstadoDominio(cotizacion.estado), siguiente)) {
        throw new EstadoInvalido(mensajeSiInvalida);
      }

      await tx.cotizacion.update({
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

async function cargarParaMutar(tx: PrismaTransactionClient, id: number): Promise<CotizacionPrisma> {
  const cotizacion = await tx.cotizacion.findUnique({ where: { id: BigInt(id) } });
  if (!cotizacion) throw new NoEncontrado('La cotización');
  return cotizacion;
}

function aLineaPrisma(linea: LineaNuevaCotizacion) {
  const impuestos = impuestosDeLinea(linea);
  return {
    productoId: BigInt(linea.productoId),
    cantidad: linea.cantidad,
    precioUnitario: linea.precioUnitario,
    valorTotal: impuestos.base,
    tasaIva: linea.tasaIva ?? 0,
    valorIva: impuestos.iva,
  };
}

/** `buscar` cruza el NÚMERO de la cotización y el nombre del cliente; el resto son igualdades y
 *  rangos, combinados con Y lógico (mismo criterio que el resto de listados, FR-075). */
function construirWhere(filtros: CriteriosCotizaciones): Prisma.CotizacionWhereInput {
  const condiciones: Prisma.CotizacionWhereInput[] = [];

  // US22 (FR-118) — mismo criterio que las órdenes de compra, mirando al cliente: "cot 42",
  // "jumbo torre" o "000042" llegan al mismo documento. También se busca por el nombre del
  // PROYECTO, que es como se identifica una oferta cuando el cliente tiene varias obras.
  const busqueda = construirBusquedaPorTerminos<Prisma.CotizacionWhereInput>(filtros.buscar, [
    (termino) => ({ cliente: { nombre: { contains: termino, mode: 'insensitive' } } }),
    (termino) => ({ proyecto: { nombre: { contains: termino, mode: 'insensitive' } } }),
    (termino) => ({ observaciones: { contains: termino, mode: 'insensitive' } }),
    (termino) => ({ numero: digitosDelTermino(termino) ?? BigInt(-1) }),
  ]);
  if (busqueda) condiciones.push(busqueda);

  if (filtros.clienteId) condiciones.push({ clienteId: BigInt(filtros.clienteId) });
  if (filtros.estado) condiciones.push({ estado: filtros.estado });
  if (filtros.desde) condiciones.push({ fecha: { gte: filtros.desde } });
  if (filtros.hasta) condiciones.push({ fecha: { lte: filtros.hasta } });

  return condiciones.length > 0 ? { AND: condiciones } : {};
}

function aCotizacionDominio(registro: CotizacionPrismaCompleta): Cotizacion {
  return {
    id: Number(registro.id),
    numero: Number(registro.numero),
    cliente: { id: Number(registro.cliente.id), nombre: registro.cliente.nombre },
    proyecto: { id: Number(registro.proyecto.id), nombre: registro.proyecto.nombre },
    fecha: registro.fecha,
    fechaValidez: registro.fechaValidez,
    observaciones: registro.observaciones,
    estado: aEstadoDominio(registro.estado),
    valorTotal: registro.valorTotal.toNumber(),
    valorIva: registro.valorIva.toNumber(),
    motivoAnulacion: registro.motivoAnulacion,
    salidaId: registro.salidas[0] ? Number(registro.salidas[0].id) : null,
  };
}

function aDetalleDominio(registro: DetalleCotizacionPrisma): DetalleCotizacion {
  return {
    id: Number(registro.id),
    cotizacionId: Number(registro.cotizacionId),
    productoId: Number(registro.productoId),
    cantidad: registro.cantidad.toNumber(),
    precioUnitario: registro.precioUnitario.toNumber(),
    valorTotal: registro.valorTotal.toNumber(),
    tasaIva: registro.tasaIva.toNumber(),
    valorIva: registro.valorIva.toNumber(),
  };
}

/** El enum de Prisma y el del dominio tienen los mismos miembros, pero son tipos DISTINTOS
 *  (docs/arquitectura.md §2: el dominio no importa nada generado). */
function aEstadoDominio(estado: EstadoCotizacionPrisma): EstadoCotizacion {
  return estado;
}
