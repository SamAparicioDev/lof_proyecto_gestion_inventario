/**
 * Adaptador `RepositorioIngresosPrisma` — implementa el puerto `RepositorioIngresos` del
 * dominio con Prisma (patrón Repository/Adapter, docs/arquitectura.md §3). Traduce entre el
 * modelo `ingresos`/`detalles_ingresos` de Prisma y las entidades `Ingreso`/`DetalleIngreso`
 * del dominio (`BigInt`→`number`, `Decimal`→`number`, enum de Prisma→tipo del dominio).
 *
 * La pieza crítica es `recibir` (y, por el mismo patrón, `anular` cuando el ingreso está
 * `RECIBIDO`): ambas mutan `stock_actual` dentro de la `UnidadDeTrabajo`
 * (`prisma.$transaction`) con bloqueo pesimista `SELECT ... FOR UPDATE` ORDENADO POR ID
 * (research R4 — evita deadlocks bajo concurrencia) antes de aplicar `ServicioStock` (puro,
 * dominio) y escribir `productos`/`movimientos_inventario`/`ingresos` en la MISMA
 * transacción. Si `ServicioStock` lanza `DisponibilidadInsuficiente`, NO se captura aquí:
 * Prisma revierte automáticamente todo lo escrito en `tx` (Principio I) y el error de
 * dominio llega intacto al `FiltroErroresDominio` (→ 409).
 *
 * Traduce `P2002` (UNIQUE de `numero_factura`) a `Duplicado('numeroFactura', ...)` (FR-015).
 *
 * Implementa: FR-013…FR-019 (registro, edición, y las tres transiciones de estado de la
 * máquina de `entidades/ingreso.ts`) y FR-072/FR-074 (US12: recibir mercancía a un precio
 * distinto del vigente deja su registro en `historial_costos_producto` con
 * `origen: RECEPCION_INGRESO`, dentro de la misma transacción — ver TSDoc de `recibir`).
 */
import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type DetalleIngreso as DetalleIngresoPrisma,
  type EstadoIngreso as EstadoIngresoPrisma,
  type Ingreso as IngresoPrisma,
} from '@prisma/client';
import { Duplicado, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import {
  calcularValorTotalIngreso,
  calcularValorTotalLinea,
  transicionValidaIngreso,
  type DetalleIngreso,
  type EstadoIngreso,
  type Ingreso,
} from '../../dominio/entidades/ingreso';
import type {
  CriteriosIngresos,
  DatosActualizarIngreso,
  DatosNuevoIngreso,
  FiltrosListarIngresos,
  IngresoConDetalles,
  PaginaIngresos,
  RepositorioIngresos,
} from '../../dominio/puertos/repositorio-ingresos';
import { ServicioStock, type InfoProductoStock } from '../../dominio/servicios/servicio-stock';
import { PrismaService } from './prisma.service';
import { registrarCambioDeCosto } from './registrar-cambio-costo';
import { UnidadDeTrabajo, type PrismaTransactionClient } from './unidad-de-trabajo';

/** Fila cruda de `SELECT id, stock_actual, ultimo_costo FROM productos ... FOR UPDATE`
 *  (research R4). `ultimo_costo` se agrega en US12 (T126): `recibir` necesita el costo VIGENTE
 *  —leído bajo el mismo bloqueo que el stock— para decidir si el precio de la línea es un
 *  cambio de costo (FR-074) sin abrir una segunda lectura fuera del candado. */
interface FilaProductoBloqueado {
  id: bigint;
  stock_actual: Prisma.Decimal;
  ultimo_costo: Prisma.Decimal;
}

/**
 * El proveedor viaja RESUELTO en la entidad de dominio desde US15 (FR-091), así que toda lectura
 * de ingresos lo incluye. Es un `include` fijo —no opcional según quién llame— a propósito:
 * `Ingreso.proveedor` no admite `undefined`, y una consulta que se olvidara de pedirlo no
 * compilaría, que es exactamente la garantía que se busca.
 */
const INCLUIR_PROVEEDOR = { proveedor: { select: { id: true, nombre: true } } } as const;

/** Registro de `ingresos` con el proveedor ya resuelto por `INCLUIR_PROVEEDOR`. */
type IngresoPrismaConProveedor = IngresoPrisma & { proveedor: { id: bigint; nombre: string } };

@Injectable()
export class RepositorioIngresosPrisma implements RepositorioIngresos {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unidadDeTrabajo: UnidadDeTrabajo,
  ) {}

  async buscarPorId(id: number): Promise<IngresoConDetalles | null> {
    const registro = await this.prisma.ingreso.findUnique({
      where: { id: BigInt(id) },
      include: { detalles: true, ...INCLUIR_PROVEEDOR },
    });
    return registro ? aIngresoConDetallesDominio(registro) : null;
  }

  async listar(filtros: FiltrosListarIngresos): Promise<PaginaIngresos> {
    const where = construirWhereListarIngresos(filtros);
    const [registros, total] = await this.prisma.$transaction([
      this.prisma.ingreso.findMany({
        where,
        include: INCLUIR_PROVEEDOR,
        orderBy: ORDEN_LISTADO_INGRESOS,
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
      }),
      this.prisma.ingreso.count({ where }),
    ]);
    return { datos: registros.map(aIngresoDominio), total };
  }

  /**
   * TODAS las cabeceras que cumplen los criterios, SIN paginar (US11, FR-064) — fuente del
   * listado exportado. Es LITERALMENTE `listar` sin `skip`/`take`: mismo
   * `construirWhereListarIngresos` y mismo `ORDEN_LISTADO_INGRESOS`, no una consulta paralela
   * que pudiera derivar (SC-007).
   */
  async listarTodos(criterios: CriteriosIngresos): Promise<Ingreso[]> {
    const registros = await this.prisma.ingreso.findMany({
      where: construirWhereListarIngresos(criterios),
      include: INCLUIR_PROVEEDOR,
      orderBy: ORDEN_LISTADO_INGRESOS,
    });
    return registros.map(aIngresoDominio);
  }

  async crear(datos: DatosNuevoIngreso): Promise<Ingreso> {
    try {
      const detallesCrear = datos.lineas.map((linea) => ({
        productoId: BigInt(linea.productoId),
        cantidad: linea.cantidad,
        precioUnitario: linea.precioUnitario,
        valorTotal: calcularValorTotalLinea(linea),
      }));
      const valorTotal = calcularValorTotalIngreso(datos.lineas);

      const registro = await this.prisma.ingreso.create({
        data: {
          numeroFactura: datos.numeroFactura,
          fechaFactura: datos.fechaFactura,
          proveedorId: BigInt(datos.proveedorId),
          fechaRecepcion: datos.fechaRecepcion,
          observaciones: datos.observaciones,
          valorTotal,
          usuarioRegistraId: BigInt(datos.usuarioId),
          usuarioCreacionId: BigInt(datos.usuarioId),
          detalles: { create: detallesCrear },
        },
        include: INCLUIR_PROVEEDOR,
      });
      return aIngresoDominio(registro);
    } catch (error) {
      throw traducirErrorEscrituraIngreso(error);
    }
  }

  /**
   * Reemplaza cabecera y líneas de un ingreso `PENDIENTE` (US1-AS5). Envuelto en
   * `UnidadDeTrabajo` porque valida estado y reescribe las líneas de forma atómica: sin
   * transacción, una lectura de "PENDIENTE" seguida de un `recibir` concurrente podría dejar
   * la edición aplicada sobre un ingreso que ya subió stock.
   */
  async actualizar(id: number, datos: DatosActualizarIngreso, usuarioId: number): Promise<void> {
    try {
      await this.unidadDeTrabajo.ejecutar(async (tx) => {
        const ingreso = await tx.ingreso.findUnique({ where: { id: BigInt(id) } });
        if (!ingreso) throw new NoEncontrado('El ingreso');
        if (ingreso.estado !== 'PENDIENTE') {
          throw new EstadoInvalido('Solo un ingreso PENDIENTE puede editarse');
        }

        const detallesNuevos = datos.lineas.map((linea) => ({
          productoId: BigInt(linea.productoId),
          cantidad: linea.cantidad,
          precioUnitario: linea.precioUnitario,
          valorTotal: calcularValorTotalLinea(linea),
        }));
        const valorTotal = calcularValorTotalIngreso(datos.lineas);

        await tx.detalleIngreso.deleteMany({ where: { ingresoId: BigInt(id) } });
        await tx.ingreso.update({
          where: { id: BigInt(id) },
          data: {
            numeroFactura: datos.numeroFactura,
            fechaFactura: datos.fechaFactura,
            proveedorId: BigInt(datos.proveedorId),
            fechaRecepcion: datos.fechaRecepcion,
            observaciones: datos.observaciones,
            valorTotal,
            usuarioModificacionId: BigInt(usuarioId),
            fechaModificacion: new Date(),
            detalles: { create: detallesNuevos },
          },
        });
      });
    } catch (error) {
      throw traducirErrorEscrituraIngreso(error);
    }
  }

  /**
   * `PENDIENTE → RECIBIDO` (FR-017/FR-021, research R4). Procedimiento fijo: bloquear los
   * productos de las líneas en orden por id, aplicar `ServicioStock.aplicarEntrada` (puro),
   * persistir stock/costo/movimientos y el nuevo estado — todo en una sola transacción.
   *
   * US12 (T126) cierra aquí un hueco PREEXISTENTE: recibir mercancía ya reescribía
   * `productos.ultimo_costo` con el precio de la línea desde US1, pero no dejaba rastro de ese
   * cambio de precio — la valorización del inventario podía moverse sin que nadie pudiera
   * decir de dónde venía. Ahora cada producto pasa por `registrarCambioDeCosto`, que consulta
   * al dominio si el precio de la línea difiere del costo vigente (FR-074) y, solo entonces,
   * inserta la fila de `historial_costos_producto` con `origen: RECEPCION_INGRESO` y el id del
   * ingreso — en ESTA misma transacción (FR-072). Recibir dos veces al mismo precio no genera
   * ruido: la segunda no es un cambio.
   *
   * El costo persistido sale de ese registro cuando hubo cambio, y se conserva el vigente
   * cuando no lo hubo — nunca dos números distintos entre la ficha y su historial.
   */
  async recibir(id: number, usuarioId: number): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const ingreso = await tx.ingreso.findUnique({ where: { id: BigInt(id) }, include: { detalles: true } });
      if (!ingreso) throw new NoEncontrado('El ingreso');
      if (ingreso.estado !== 'PENDIENTE') {
        throw new EstadoInvalido('Solo un ingreso PENDIENTE puede recibirse');
      }

      const { mapaProductos, costosPorProducto, lineas } = await bloquearProductosDeLineas(tx, ingreso.detalles);
      const resultado = new ServicioStock().aplicarEntrada(mapaProductos, lineas);

      const precioPorProducto = new Map<number, number>(
        ingreso.detalles.map((detalle) => [Number(detalle.productoId), detalle.precioUnitario.toNumber()]),
      );

      for (const productoActualizado of resultado.productosActualizados) {
        // Invariante: todo productoActualizado proviene de una línea de `ingreso.detalles`
        // (mismo id) — el precio de esa línea SIEMPRE existe en el mapa (no es una regla de
        // negocio que pueda fallar por datos del usuario, sino un error de programación si
        // ocurriera; de ahí `Error` genérico y no una clase de `dominio/comunes/errores`).
        const precioLinea = precioPorProducto.get(productoActualizado.id) ?? lanzarInvarianteViolada(productoActualizado.id);
        const costoAnterior = costosPorProducto.get(productoActualizado.id) ?? lanzarInvarianteViolada(productoActualizado.id);
        const costoAplicado = await registrarCambioDeCosto(tx, {
          productoId: productoActualizado.id,
          costoAnterior,
          costoNuevo: precioLinea,
          origen: 'RECEPCION_INGRESO',
          usuarioId,
          documentoId: id,
        });

        await tx.producto.update({
          where: { id: BigInt(productoActualizado.id) },
          data: {
            stockActual: productoActualizado.stockActualNuevo,
            ultimoCosto: costoAplicado ?? costoAnterior,
            fechaUltimoMovimiento: new Date(),
            usuarioModificacionId: BigInt(usuarioId),
            fechaModificacion: new Date(),
          },
        });
      }

      for (const movimiento of resultado.movimientos) {
        await tx.movimientoInventario.create({
          data: {
            tipo: 'ENTRADA',
            productoId: BigInt(movimiento.productoId),
            cantidad: movimiento.cantidad,
            stockResultante: movimiento.stockResultante,
            documentoTipo: 'INGRESO',
            documentoId: BigInt(id),
            usuarioId: BigInt(usuarioId),
          },
        });
      }

      await tx.ingreso.update({
        where: { id: BigInt(id) },
        data: { estado: 'RECIBIDO', usuarioModificacionId: BigInt(usuarioId), fechaModificacion: new Date() },
      });
    });
  }

  /** `RECIBIDO → VERIFICADO`: cierre administrativo, sin efecto en stock (terminal e inmutable). */
  async verificar(id: number, usuarioId: number): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const ingreso = await tx.ingreso.findUnique({ where: { id: BigInt(id) } });
      if (!ingreso) throw new NoEncontrado('El ingreso');
      if (ingreso.estado !== 'RECIBIDO') {
        throw new EstadoInvalido('Solo un ingreso RECIBIDO puede verificarse');
      }
      await tx.ingreso.update({
        where: { id: BigInt(id) },
        data: { estado: 'VERIFICADO', usuarioModificacionId: BigInt(usuarioId), fechaModificacion: new Date() },
      });
    });
  }

  /**
   * `PENDIENTE|RECIBIDO → ANULADO` (FR-019). Reutiliza `transicionValidaIngreso` (dominio)
   * para aceptar ambos orígenes y rechazar `VERIFICADO`/`ANULADO` con `EstadoInvalido`. Si
   * el ingreso estaba `RECIBIDO`, revierte stock con `ServicioStock.aplicarReversaEntrada`
   * (mismo bloqueo ordenado que `recibir`) ANTES de marcar `ANULADO`; si el disponible no
   * alcanza, `DisponibilidadInsuficiente` se propaga sin capturar y Prisma revierte todo.
   */
  async anular(id: number, usuarioId: number, motivo: string): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const ingreso = await tx.ingreso.findUnique({ where: { id: BigInt(id) }, include: { detalles: true } });
      if (!ingreso) throw new NoEncontrado('El ingreso');
      const estadoActual = mapearEstadoIngresoDeDominio(ingreso.estado);
      if (!transicionValidaIngreso(estadoActual, 'ANULADO')) {
        throw new EstadoInvalido(`Un ingreso ${estadoActual} no puede anularse`);
      }

      if (estadoActual === 'RECIBIDO') {
        const { mapaProductos, lineas } = await bloquearProductosDeLineas(tx, ingreso.detalles);
        const resultado = new ServicioStock().aplicarReversaEntrada(mapaProductos, lineas);

        for (const productoActualizado of resultado.productosActualizados) {
          await tx.producto.update({
            where: { id: BigInt(productoActualizado.id) },
            data: {
              stockActual: productoActualizado.stockActualNuevo,
              fechaUltimoMovimiento: new Date(),
              usuarioModificacionId: BigInt(usuarioId),
              fechaModificacion: new Date(),
            },
          });
        }

        for (const movimiento of resultado.movimientos) {
          await tx.movimientoInventario.create({
            data: {
              tipo: 'AJUSTE_SALIDA',
              productoId: BigInt(movimiento.productoId),
              cantidad: movimiento.cantidad,
              stockResultante: movimiento.stockResultante,
              documentoTipo: 'INGRESO',
              documentoId: BigInt(id),
              usuarioId: BigInt(usuarioId),
              motivo,
            },
          });
        }
      }

      await tx.ingreso.update({
        where: { id: BigInt(id) },
        data: {
          estado: 'ANULADO',
          motivoAnulacion: motivo,
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
        },
      });
    });
  }
}

/** `Error` técnico (no de negocio) para una rama que solo un bug de programación alcanzaría
 *  — mismo criterio que los `default` de mapeo de enums (ver repositorio-usuarios.prisma.ts). */
function lanzarInvarianteViolada(productoId: number): never {
  throw new Error(`Invariante violada: producto ${productoId} sin línea de origen en el ingreso`);
}

/**
 * Bloquea (`FOR UPDATE`) los productos de un conjunto de líneas de ingreso, EN ORDEN POR ID
 * (evita deadlocks bajo confirmaciones concurrentes — research R4), y arma tanto el
 * `Map` que espera `ServicioStock` como las líneas ya convertidas a `number`.
 *
 * `costosPorProducto` (US12) sale de la MISMA lectura bloqueada: el costo vigente de cada
 * producto, que `recibir` compara con el precio de la línea para decidir si hay cambio de
 * costo que registrar (FR-074). Va en un mapa aparte y no dentro de `InfoProductoStock`
 * porque ese tipo es el contrato de `ServicioStock` (dominio) y el costo no participa en
 * ninguna decisión de stock — mezclarlos insinuaría que sí.
 */
async function bloquearProductosDeLineas(
  tx: PrismaTransactionClient,
  detalles: DetalleIngresoPrisma[],
): Promise<{
  mapaProductos: Map<number, InfoProductoStock>;
  costosPorProducto: Map<number, number>;
  lineas: { productoId: number; cantidad: number }[];
}> {
  const idsProductos = [...new Set(detalles.map((detalle) => detalle.productoId))].sort((a, b) => Number(a - b));
  const productosBloqueados = await tx.$queryRaw<FilaProductoBloqueado[]>`
    SELECT id, stock_actual, ultimo_costo FROM productos WHERE id = ANY(${idsProductos}) ORDER BY id FOR UPDATE
  `;

  const mapaProductos = new Map<number, InfoProductoStock>(
    productosBloqueados.map((fila) => [Number(fila.id), { id: Number(fila.id), stockActual: fila.stock_actual.toNumber() }]),
  );
  const costosPorProducto = new Map<number, number>(
    productosBloqueados.map((fila) => [Number(fila.id), fila.ultimo_costo.toNumber()]),
  );
  const lineas = detalles.map((detalle) => ({
    productoId: Number(detalle.productoId),
    cantidad: detalle.cantidad.toNumber(),
  }));
  return { mapaProductos, costosPorProducto, lineas };
}

/**
 * Orden del listado de ingresos, compartido por la vista paginada (`listar`) y por su
 * exportación completa (`listarTodos`, US11/FR-064) — el archivo trae las filas en el MISMO
 * orden en que se leen en pantalla.
 *
 * El desempate por `id` es obligatorio, no estético: `fecha_recepcion` es `DATE` y se repite
 * constantemente, así que ordenar solo por ella deja un orden INESTABLE y `skip`/`take`
 * duplica unas filas y esconde otras al pasar de página (mismo defecto reproducido en
 * salidas). Ver el TSDoc de `ORDEN_LISTADO_SALIDAS` para el detalle.
 */
const ORDEN_LISTADO_INGRESOS: Prisma.IngresoOrderByWithRelationInput[] = [
  { fechaRecepcion: 'desc' },
  { id: 'desc' },
];

/** Filtro `buscar` (factura/proveedor) + estado + rango de `fechaRecepcion` (FR-018). */
function construirWhereListarIngresos(filtros: CriteriosIngresos): Prisma.IngresoWhereInput {
  const condiciones: Prisma.IngresoWhereInput[] = [];
  const termino = filtros.buscar?.trim();
  if (termino) {
    condiciones.push({
      OR: [
        { numeroFactura: { contains: termino, mode: 'insensitive' } },
        { proveedor: { nombre: { contains: termino, mode: 'insensitive' } } },
      ],
    });
  }
  // US13 (FR-075), reescrito en US15 (FR-091): el filtro nació como subcadena sobre la columna
  // de texto y ahora es una igualdad por id del catálogo — se elige de un selector, así que ya no
  // hay nada que "escribir parecido". Sigue sin ser redundante con el `buscar` de arriba, que
  // cruza número de factura OR NOMBRE del proveedor y por eso no permite preguntar solo por uno.
  if (filtros.proveedorId) condiciones.push({ proveedorId: BigInt(filtros.proveedorId) });
  if (filtros.estado) condiciones.push({ estado: mapearEstadoIngresoAPrisma(filtros.estado) });
  if (filtros.desde) condiciones.push({ fechaRecepcion: { gte: filtros.desde } });
  if (filtros.hasta) condiciones.push({ fechaRecepcion: { lte: filtros.hasta } });
  return condiciones.length > 0 ? { AND: condiciones } : {};
}

/** Traduce un registro Prisma de `ingresos` (sin líneas) a la entidad de dominio. */
function aIngresoDominio(registro: IngresoPrismaConProveedor): Ingreso {
  return {
    id: Number(registro.id),
    numeroFactura: registro.numeroFactura,
    fechaFactura: registro.fechaFactura,
    proveedor: { id: Number(registro.proveedor.id), nombre: registro.proveedor.nombre },
    fechaRecepcion: registro.fechaRecepcion,
    observaciones: registro.observaciones,
    estado: mapearEstadoIngresoDeDominio(registro.estado),
    valorTotal: registro.valorTotal.toNumber(),
    usuarioRegistraId: Number(registro.usuarioRegistraId),
    motivoAnulacion: registro.motivoAnulacion,
  };
}

/** Traduce un registro Prisma de `detalles_ingresos` a la entidad de dominio. */
function aDetalleIngresoDominio(registro: DetalleIngresoPrisma): DetalleIngreso {
  return {
    id: Number(registro.id),
    ingresoId: Number(registro.ingresoId),
    productoId: Number(registro.productoId),
    cantidad: registro.cantidad.toNumber(),
    precioUnitario: registro.precioUnitario.toNumber(),
    valorTotal: registro.valorTotal.toNumber(),
  };
}

function aIngresoConDetallesDominio(
  registro: IngresoPrismaConProveedor & { detalles: DetalleIngresoPrisma[] },
): IngresoConDetalles {
  return { ...aIngresoDominio(registro), detalles: registro.detalles.map(aDetalleIngresoDominio) };
}

function mapearEstadoIngresoDeDominio(estado: EstadoIngresoPrisma): EstadoIngreso {
  switch (estado) {
    case 'PENDIENTE':
      return 'PENDIENTE';
    case 'RECIBIDO':
      return 'RECIBIDO';
    case 'VERIFICADO':
      return 'VERIFICADO';
    case 'ANULADO':
      return 'ANULADO';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de ingreso de Prisma sin mapeo al dominio: ${String(valorInesperado)}`);
    }
  }
}

function mapearEstadoIngresoAPrisma(estado: EstadoIngreso): EstadoIngresoPrisma {
  switch (estado) {
    case 'PENDIENTE':
      return 'PENDIENTE';
    case 'RECIBIDO':
      return 'RECIBIDO';
    case 'VERIFICADO':
      return 'VERIFICADO';
    case 'ANULADO':
      return 'ANULADO';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de ingreso de dominio sin mapeo a Prisma: ${String(valorInesperado)}`);
    }
  }
}

/** `P2002` (UNIQUE de `numero_factura`) → `Duplicado`; cualquier otro error se propaga tal
 *  cual (incluidos los de dominio ya tipados, p. ej. `EstadoInvalido`/`NoEncontrado`). */
function traducirErrorEscrituraIngreso(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new Duplicado('numeroFactura', 'El número de factura ya existe');
  }
  return error;
}
