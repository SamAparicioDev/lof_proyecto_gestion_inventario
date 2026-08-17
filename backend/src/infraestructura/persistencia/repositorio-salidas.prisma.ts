/**
 * Adaptador `RepositorioSalidasPrisma` — implementa el puerto `RepositorioSalidas` del
 * dominio con Prisma (patrón Repository/Adapter, docs/arquitectura.md §3). Traduce entre el
 * modelo `salidas`/`detalles_salidas` de Prisma y las entidades `Salida`/`DetalleSalida` del
 * dominio (`BigInt`→`number`, `Decimal`→`number`, enum de Prisma→tipo del dominio).
 *
 * La pieza crítica es `confirmar` (research R4, FR-028/FR-029/FR-030): transacción atómica
 * que bloquea `productos` con `FOR UPDATE` ORDENADO POR ID (evita deadlocks bajo
 * concurrencia — mismo patrón que `RepositorioIngresosPrisma.recibir`) y aplica
 * `ServicioStock.aplicarSalida` (puro, dominio) contra el `stockActual` REAL así bloqueado.
 * Si `DisponibilidadInsuficiente` se lanza, NO se captura aquí: Prisma revierte
 * automáticamente todo lo escrito en `tx` (Principio I).
 *
 * CORRECCIÓN DE DISEÑO (T056 — bug real encontrado por la prueba de carrera SC-002, ver
 * `backend/test/integracion/salidas-stock.spec.ts` y el TSDoc de cabecera de
 * `dominio/servicios/servicio-stock.ts`): `confirmar` YA NO calcula un "disponible" neto
 * restándole el `comprometido` de las OTRAS salidas `PENDIENTE` antes de validar — esa
 * fórmula hacía que dos confirmaciones concurrentes sobre el mismo producto se rechazaran
 * MUTUAMENTE (cada una veía a la otra todavía `PENDIENTE`, sin commitear, y le restaba su
 * compromiso), así que NINGUNA ganaba nunca, en vez de exactamente una. La validación ahora
 * es directamente contra el `stockActual` bloqueado con `FOR UPDATE`: ese candado YA es el
 * mecanismo de serialización correcto (la segunda transacción, al adquirirlo, lee el stock
 * YA actualizado por la primera). `comprometidoPorProducto` sigue existiendo y sigue siendo
 * necesario para la UX de creación/edición (`comprometidoPorProducto` sin excluir nada, o
 * excluyendo la propia salida al editar) — simplemente ya no participa en `confirmar`.
 *
 * `anular` (FR-032) reutiliza `ServicioStock.aplicarEntrada` (YA EXISTE, US1) para la
 * reversa — sumar sin restricción es exactamente lo que se necesita para devolver el stock
 * que `confirmar` había descontado; el único cambio es que el movimiento insertado es tipo
 * `AJUSTE_ENTRADA` en vez de `ENTRADA`.
 *
 * `cancelar`/`anular` guardan su estado de origen con IGUALDAD DIRECTA (`salida.estado !==
 * 'PENDIENTE'`/`'CONFIRMADA'`), NO con `transicionValidaSalida`: ambas transiciones
 * terminan en `ANULADA`, así que el chequeo genérico ("¿ANULADA es alcanzable desde el
 * estado actual?") aceptaría erróneamente `cancelar` sobre una `CONFIRMADA` (dejando el
 * stock ya descontado sin reversa) o `anular` sobre una `PENDIENTE` (aplicando una reversa
 * que nunca correspondió). `confirmar`/`completar` sí usan `transicionValidaSalida` porque
 * cada una tiene EXACTAMENTE un estado de origen válido en toda la máquina.
 *
 * Implementa: FR-025…FR-033 (registro, edición y las cuatro transiciones de estado de la
 * máquina de `entidades/salida.ts`).
 */
import {
  impuestosDeDocumento,
  impuestosDeLinea,
} from '../../dominio/servicios/servicio-impuestos';
import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type DetalleSalida as DetalleSalidaPrisma,
  type EstadoSalida as EstadoSalidaPrisma,
  type Salida as SalidaPrisma,
} from '@prisma/client';
import { CLAVE_CONTADOR_SALIDA } from '../../dominio/puertos/contadores';
import { EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import {
  calcularValorTotalLinea,
  calcularValorTotalSalida,
  transicionValidaSalida,
  type DetalleSalida,
  type EstadoSalida,
  type Salida,
} from '../../dominio/entidades/salida';
import type {
  CriteriosSalidas,
  DatosActualizarSalida,
  DatosNuevaSalida,
  FiltrosConsumoSalidas,
  FiltrosListarSalidas,
  PaginaSalidas,
  RepositorioSalidas,
  SalidaConDetalles,
} from '../../dominio/puertos/repositorio-salidas';
import { ServicioStock, type InfoProductoStock } from '../../dominio/servicios/servicio-stock';
import { ContadoresPrisma } from './contadores.prisma';
import { PrismaService } from './prisma.service';
import { UnidadDeTrabajo, type PrismaTransactionClient } from './unidad-de-trabajo';

/** Fila cruda de `SELECT id, stock_actual FROM productos ... FOR UPDATE` (research R4). */
interface FilaProductoBloqueado {
  id: bigint;
  stock_actual: Prisma.Decimal;
}

/** Fila cruda del agregado de comprometido (ver `sumarComprometidoPorProducto`). */
interface FilaComprometido {
  producto_id: bigint;
  comprometido: Prisma.Decimal;
}

/** Cliente Prisma capaz de ejecutar `$queryRaw` — satisfecho tanto por `PrismaService` (fuera
 *  de transacción, uso standalone del puerto) como por `PrismaTransactionClient` (dentro de
 *  la transacción de `confirmar`, research R4). Mismo criterio que `contadores.prisma.ts`. */
type ClientePrismaConQueryRaw = Pick<PrismaService, '$queryRaw'> | PrismaTransactionClient;

@Injectable()
export class RepositorioSalidasPrisma implements RepositorioSalidas {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unidadDeTrabajo: UnidadDeTrabajo,
    /** Adaptador CONCRETO (no el puerto `Contadores`): se necesita
     *  `siguienteNumeroEnTransaccion`, que es un detalle de integración entre dos
     *  adaptadores de infraestructura y a propósito NO forma parte del puerto del dominio
     *  (ver TSDoc de `contadores.prisma.ts`). */
    private readonly contadores: ContadoresPrisma,
  ) {}

  async buscarPorId(id: number): Promise<SalidaConDetalles | null> {
    const registro = await this.prisma.salida.findUnique({
      where: { id: BigInt(id) },
      include: { detalles: true },
    });
    return registro ? aSalidaConDetallesDominio(registro) : null;
  }

  async listar(filtros: FiltrosListarSalidas): Promise<PaginaSalidas> {
    const where = construirWhereListarSalidas(filtros);
    const [registros, total] = await this.prisma.$transaction([
      this.prisma.salida.findMany({
        where,
        orderBy: ORDEN_LISTADO_SALIDAS,
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
      }),
      this.prisma.salida.count({ where }),
    ]);
    return { datos: registros.map(aSalidaDominio), total };
  }

  /**
   * TODAS las cabeceras que cumplen los criterios, SIN paginar (US11, FR-064) — fuente del
   * listado exportado. Es LITERALMENTE `listar` sin `skip`/`take`: mismo
   * `construirWhereListarSalidas` (con su JOIN cliente→proyecto) y mismo `ORDEN_LISTADO_SALIDAS`.
   * A diferencia de `listarParaConsumo`, NO fija estados: exporta lo mismo que muestra la
   * pantalla con esos filtros (SC-007), no el subconjunto que cuenta como consumo.
   */
  async listarTodas(criterios: CriteriosSalidas): Promise<Salida[]> {
    const registros = await this.prisma.salida.findMany({
      where: construirWhereListarSalidas(criterios),
      orderBy: ORDEN_LISTADO_SALIDAS,
    });
    return registros.map(aSalidaDominio);
  }

  /**
   * Crea la salida y asigna su correlativo DENTRO de la misma transacción (FR-026,
   * research R5): si el `INSERT` de la salida falla después de incrementar el contador, el
   * `UPDATE ... RETURNING` de `contadores` se revierte junto con él (Prisma
   * `$transaction`) — el número no queda "quemado" de forma visible.
   */
  async crear(datos: DatosNuevaSalida, usuarioId: number): Promise<Salida> {
    return this.unidadDeTrabajo.ejecutar(async (tx) => {
      const numero = await this.contadores.siguienteNumeroEnTransaccion(tx, CLAVE_CONTADOR_SALIDA);

      const detallesCrear = datos.lineas.map((linea) => ({
        productoId: BigInt(linea.productoId),
        cantidad: linea.cantidad,
        precioUnitario: linea.precioUnitario,
        valorTotal: calcularValorTotalLinea(linea),
        // US20 (FR-109/FR-110) — ver el mismo bloque en `repositorio-ingresos.prisma.ts`.
        tasaIva: linea.tasaIva ?? 0,
        valorIva: impuestosDeLinea(linea).iva,
      }));
      const valorTotal = calcularValorTotalSalida(datos.lineas);

      const registro = await tx.salida.create({
        data: {
          numero: BigInt(numero),
          fechaSalida: datos.fechaSalida,
          proyectoId: BigInt(datos.proyectoId),
          observaciones: datos.observaciones,
          valorTotal,
          valorIva: impuestosDeDocumento(datos.lineas).iva,
          usuarioCreacionId: BigInt(usuarioId),
          detalles: { create: detallesCrear },
        },
      });
      return aSalidaDominio(registro);
    });
  }

  /**
   * Reemplaza cabecera y líneas de una salida `PENDIENTE`. Envuelto en `UnidadDeTrabajo`
   * porque valida estado y reescribe las líneas de forma atómica (mismo motivo que
   * `RepositorioIngresosPrisma.actualizar`): sin transacción, una lectura de "PENDIENTE"
   * seguida de un `confirmar` concurrente podría dejar la edición aplicada sobre una salida
   * que ya descontó stock.
   */
  async actualizar(id: number, datos: DatosActualizarSalida, usuarioId: number): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const salida = await tx.salida.findUnique({ where: { id: BigInt(id) } });
      if (!salida) throw new NoEncontrado('La salida');
      if (salida.estado !== 'PENDIENTE') {
        throw new EstadoInvalido('Solo una salida PENDIENTE puede editarse');
      }

      const detallesNuevos = datos.lineas.map((linea) => ({
        productoId: BigInt(linea.productoId),
        cantidad: linea.cantidad,
        precioUnitario: linea.precioUnitario,
        valorTotal: calcularValorTotalLinea(linea),
        // US20 (FR-109/FR-110) — ver el mismo bloque en `repositorio-ingresos.prisma.ts`.
        tasaIva: linea.tasaIva ?? 0,
        valorIva: impuestosDeLinea(linea).iva,
      }));
      const valorTotal = calcularValorTotalSalida(datos.lineas);

      await tx.detalleSalida.deleteMany({ where: { salidaId: BigInt(id) } });
      await tx.salida.update({
        where: { id: BigInt(id) },
        data: {
          fechaSalida: datos.fechaSalida,
          proyectoId: BigInt(datos.proyectoId),
          observaciones: datos.observaciones,
          valorTotal,
          valorIva: impuestosDeDocumento(datos.lineas).iva,
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
          detalles: { create: detallesNuevos },
        },
      });
    });
  }

  /**
   * Salidas de "consumo" (FR-044, US4, ver TSDoc del puerto): SIN paginar, CON líneas.
   * `construirWhereConsumoSalidas` reutiliza `condicionesClienteProyectoFecha` — el MISMO
   * JOIN cliente→proyecto y filtro de fechas que `listar` — y fija el estado a
   * `CONFIRMADA`/`COMPLETADA` (nunca `PENDIENTE`/`ANULADA`).
   */
  async listarParaConsumo(filtros: FiltrosConsumoSalidas): Promise<SalidaConDetalles[]> {
    const where = construirWhereConsumoSalidas(filtros);
    const registros = await this.prisma.salida.findMany({
      where,
      include: { detalles: true },
      orderBy: { fechaSalida: 'desc' },
    });
    return registros.map(aSalidaConDetallesDominio);
  }

  /** Implementación del puerto: agregado standalone (fuera de transacción) — usado para
   *  calcular `disponible` al LISTAR productos (caso de uso (a) del TSDoc del puerto). */
  async comprometidoPorProducto(
    productoIds?: readonly number[],
    excluirSalidaId?: number,
  ): Promise<Map<number, number>> {
    return sumarComprometidoPorProducto(this.prisma, productoIds, excluirSalidaId);
  }

  /**
   * `PENDIENTE → CONFIRMADA` (FR-028/FR-029/FR-030, research R4). Procedimiento fijo:
   * bloquear los productos de las líneas en orden por id, aplicar `ServicioStock.aplicarSalida`
   * (puro) contra ese `stockActual` REAL y persistir stock/movimientos/estado — todo en una
   * sola transacción. NO calcula `comprometido` de otras salidas `PENDIENTE` (ver TSDoc de
   * cabecera — corrección T056: esa fórmula rompía SC-002 bajo concurrencia real).
   */
  async confirmar(id: number, usuarioId: number): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const salida = await tx.salida.findUnique({ where: { id: BigInt(id) }, include: { detalles: true } });
      if (!salida) throw new NoEncontrado('La salida');
      if (!transicionValidaSalida(mapearEstadoSalidaDeDominio(salida.estado), 'CONFIRMADA')) {
        throw new EstadoInvalido('Solo una salida PENDIENTE puede confirmarse');
      }

      const idsProductos = idsProductoOrdenados(salida.detalles);
      const productosBloqueados = await tx.$queryRaw<FilaProductoBloqueado[]>`
        SELECT id, stock_actual FROM productos WHERE id = ANY(${idsProductos}) ORDER BY id FOR UPDATE
      `;
      const mapaProductos = new Map<number, InfoProductoStock>(
        productosBloqueados.map((fila) => [
          Number(fila.id),
          { id: Number(fila.id), stockActual: fila.stock_actual.toNumber() },
        ]),
      );
      const lineas = salida.detalles.map((detalle) => ({
        productoId: Number(detalle.productoId),
        cantidad: detalle.cantidad.toNumber(),
      }));

      const resultado = new ServicioStock().aplicarSalida(mapaProductos, lineas);

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
            tipo: 'SALIDA',
            productoId: BigInt(movimiento.productoId),
            cantidad: movimiento.cantidad,
            stockResultante: movimiento.stockResultante,
            documentoTipo: 'SALIDA',
            documentoId: BigInt(id),
            // A diferencia de los movimientos de ingreso, los de salida SÍ llevan
            // `proyectoId` (FR-042) — se deriva de la propia salida, no del body.
            proyectoId: salida.proyectoId,
            usuarioId: BigInt(usuarioId),
          },
        });
      }

      await tx.salida.update({
        where: { id: BigInt(id) },
        data: {
          estado: 'CONFIRMADA',
          usuarioAutorizaId: BigInt(usuarioId),
          fechaConfirmacion: new Date(),
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
        },
      });
    });
  }

  /** `CONFIRMADA → COMPLETADA`: cierre administrativo, sin efecto en stock (terminal e
   *  inmutable). Único estado de origen en toda la máquina — `transicionValidaSalida` es
   *  equivalente a una igualdad directa aquí, se usa por consistencia con `confirmar`. */
  async completar(id: number, usuarioId: number): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const salida = await tx.salida.findUnique({ where: { id: BigInt(id) } });
      if (!salida) throw new NoEncontrado('La salida');
      if (!transicionValidaSalida(mapearEstadoSalidaDeDominio(salida.estado), 'COMPLETADA')) {
        throw new EstadoInvalido('Solo una salida CONFIRMADA puede completarse');
      }
      await tx.salida.update({
        where: { id: BigInt(id) },
        data: { estado: 'COMPLETADA', usuarioModificacionId: BigInt(usuarioId), fechaModificacion: new Date() },
      });
    });
  }

  /** `PENDIENTE → ANULADA` ("cancelar"): sin efecto en stock — libera el compromiso
   *  simplemente al dejar de estar `PENDIENTE` (agregado derivado, research R4). Guardia
   *  DIRECTA sobre `PENDIENTE` (ver TSDoc de cabecera: NO `transicionValidaSalida`). `motivo`
   *  se persiste en `motivo_anulacion` — mismo campo que usa `anular` (ver TSDoc del puerto). */
  async cancelar(id: number, usuarioId: number, motivo: string): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const salida = await tx.salida.findUnique({ where: { id: BigInt(id) } });
      if (!salida) throw new NoEncontrado('La salida');
      if (salida.estado !== 'PENDIENTE') {
        throw new EstadoInvalido('Solo una salida PENDIENTE puede cancelarse');
      }
      await tx.salida.update({
        where: { id: BigInt(id) },
        data: {
          estado: 'ANULADA',
          motivoAnulacion: motivo,
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
        },
      });
    });
  }

  /**
   * `CONFIRMADA → ANULADA` (FR-032): reversa atómica con `ServicioStock.aplicarEntrada`
   * (mismo bloqueo ordenado que `confirmar`) ANTES de marcar `ANULADA`. Guardia DIRECTA
   * sobre `CONFIRMADA` (ver TSDoc de cabecera: NO `transicionValidaSalida`).
   */
  async anular(id: number, usuarioId: number, motivo: string): Promise<void> {
    await this.unidadDeTrabajo.ejecutar(async (tx) => {
      const salida = await tx.salida.findUnique({ where: { id: BigInt(id) }, include: { detalles: true } });
      if (!salida) throw new NoEncontrado('La salida');
      if (salida.estado !== 'CONFIRMADA') {
        throw new EstadoInvalido('Solo una salida CONFIRMADA puede anularse');
      }

      const idsProductos = idsProductoOrdenados(salida.detalles);
      const productosBloqueados = await tx.$queryRaw<FilaProductoBloqueado[]>`
        SELECT id, stock_actual FROM productos WHERE id = ANY(${idsProductos}) ORDER BY id FOR UPDATE
      `;
      const mapaProductos = new Map<number, InfoProductoStock>(
        productosBloqueados.map((fila) => [
          Number(fila.id),
          { id: Number(fila.id), stockActual: fila.stock_actual.toNumber() },
        ]),
      );
      const lineas = salida.detalles.map((detalle) => ({
        productoId: Number(detalle.productoId),
        cantidad: detalle.cantidad.toNumber(),
      }));

      const resultado = new ServicioStock().aplicarEntrada(mapaProductos, lineas);

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
            tipo: 'AJUSTE_ENTRADA',
            productoId: BigInt(movimiento.productoId),
            cantidad: movimiento.cantidad,
            stockResultante: movimiento.stockResultante,
            documentoTipo: 'SALIDA',
            documentoId: BigInt(id),
            proyectoId: salida.proyectoId,
            usuarioId: BigInt(usuarioId),
            motivo,
          },
        });
      }

      await tx.salida.update({
        where: { id: BigInt(id) },
        data: {
          estado: 'ANULADA',
          motivoAnulacion: motivo,
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
        },
      });
    });
  }
}

/** Ids de producto ÚNICOS y ORDENADOS de un conjunto de líneas — orden fijo por id, requisito
 *  de `FOR UPDATE` para evitar deadlocks bajo confirmaciones/anulaciones concurrentes
 *  (research R4, mismo criterio que `bloquearProductosDeLineas` de `repositorio-ingresos.prisma.ts`). */
function idsProductoOrdenados(detalles: { productoId: bigint }[]): bigint[] {
  return [...new Set(detalles.map((detalle) => detalle.productoId))].sort((a, b) => Number(a - b));
}

/**
 * Agregado de "comprometido" por producto (research R4, TSDoc de `repositorio-salidas.ts`):
 * `SUM(detalles_salidas.cantidad)` de salidas en estado `PENDIENTE`, agrupado por
 * `producto_id`. Recibe el CLIENTE Prisma como parámetro (en vez de fijar `this.prisma`)
 * para que `confirmar` pueda invocarlo pasando `tx` y así leer dentro de la MISMA
 * transacción que bloqueó los productos — la razón de ser de esta función independiente en
 * vez de un método de instancia que siempre usara `this.prisma`.
 */
async function sumarComprometidoPorProducto(
  cliente: ClientePrismaConQueryRaw,
  productoIds?: readonly number[],
  excluirSalidaId?: number,
): Promise<Map<number, number>> {
  const condiciones: Prisma.Sql[] = [Prisma.sql`s.estado = 'PENDIENTE'`];
  if (productoIds && productoIds.length > 0) {
    condiciones.push(Prisma.sql`ds.producto_id = ANY(${productoIds.map((id) => BigInt(id))})`);
  }
  if (excluirSalidaId !== undefined) {
    condiciones.push(Prisma.sql`s.id <> ${BigInt(excluirSalidaId)}`);
  }

  const filas = await cliente.$queryRaw<FilaComprometido[]>(Prisma.sql`
    SELECT ds.producto_id, SUM(ds.cantidad) AS comprometido
    FROM detalles_salidas ds
    JOIN salidas s ON s.id = ds.salida_id
    WHERE ${Prisma.join(condiciones, ' AND ')}
    GROUP BY ds.producto_id
  `);
  return new Map(filas.map((fila) => [Number(fila.producto_id), fila.comprometido.toNumber()]));
}

/** Estados que cuentan como "consumo" (FR-044, US4) — `PENDIENTE`/`ANULADA` NUNCA, sin
 *  excepción (ver TSDoc de `FiltrosConsumoSalidas`). */
const ESTADOS_CONSUMO: readonly EstadoSalidaPrisma[] = ['CONFIRMADA', 'COMPLETADA'];

/** Condiciones de cliente (JOIN vía relación `proyecto`)/proyecto/rango de `fechaSalida`
 *  compartidas por `listar` (FR-033) y `listarParaConsumo` (FR-044) — factoriza el JOIN
 *  implícito documentado en el TSDoc de `FiltrosListarSalidas` para no duplicarlo. */
function condicionesClienteProyectoFecha(filtros: {
  readonly clienteId?: number;
  readonly proyectoId?: number;
  readonly desde?: Date;
  readonly hasta?: Date;
}): Prisma.SalidaWhereInput[] {
  const condiciones: Prisma.SalidaWhereInput[] = [];
  if (filtros.proyectoId !== undefined) condiciones.push({ proyectoId: BigInt(filtros.proyectoId) });
  if (filtros.clienteId !== undefined) condiciones.push({ proyecto: { clienteId: BigInt(filtros.clienteId) } });
  if (filtros.desde) condiciones.push({ fechaSalida: { gte: filtros.desde } });
  if (filtros.hasta) condiciones.push({ fechaSalida: { lte: filtros.hasta } });
  return condiciones;
}

/**
 * Orden del listado de salidas, compartido por la vista paginada (`listar`) y por su
 * exportación completa (`listarTodas`, US11/FR-064) — el archivo trae las filas en el MISMO
 * orden en que se leen en pantalla.
 *
 * El desempate por `id` NO es cosmético: `fecha_salida` es una columna `DATE` y se repite
 * muchísimo (varias salidas del mismo día), así que ordenar solo por ella deja un orden
 * INESTABLE — PostgreSQL puede devolver las filas empatadas en distinto orden en cada
 * consulta. Con `skip`/`take` eso hace que al recorrer las páginas una salida aparezca dos
 * veces y otra no aparezca NUNCA (reproducido en verificación: 18 filas leídas, 15 salidas
 * distintas, 3 duplicadas y 3 invisibles). Para un sistema cuyo principio no negociable es la
 * trazabilidad total, una salida confirmada que no se ve en el listado es el peor fallo
 * posible. Un segundo criterio ÚNICO vuelve el orden determinista y la paginación exacta.
 */
const ORDEN_LISTADO_SALIDAS: Prisma.SalidaOrderByWithRelationInput[] = [{ fechaSalida: 'desc' }, { id: 'desc' }];

/** Filtro proyecto/cliente/estado/rango de `fechaSalida` (FR-033) del listado paginado y de su
 *  exportación sin paginar (US11/FR-064) — el MISMO `where` para los dos. */
function construirWhereListarSalidas(filtros: CriteriosSalidas): Prisma.SalidaWhereInput {
  const condiciones = condicionesClienteProyectoFecha(filtros);
  if (filtros.estado) condiciones.push({ estado: mapearEstadoSalidaAPrisma(filtros.estado) });
  // US13 (FR-075). `numero` es el correlativo de negocio (`UNIQUE`), no el id técnico;
  // `usuarioAutorizaId` solo matchea salidas ya confirmadas — una PENDIENTE no tiene autorizante
  // (FR-030), así que nunca aparece bajo este filtro, que es la semántica correcta.
  if (filtros.numero !== undefined) condiciones.push({ numero: BigInt(filtros.numero) });
  if (filtros.usuarioAutorizaId !== undefined) {
    condiciones.push({ usuarioAutorizaId: BigInt(filtros.usuarioAutorizaId) });
  }
  return condiciones.length > 0 ? { AND: condiciones } : {};
}

/** Filtro proyecto/cliente/rango de `fechaSalida` + estado fijo `CONFIRMADA`/`COMPLETADA`
 *  del reporte de consumo (FR-044) — reutiliza `condicionesClienteProyectoFecha`. */
function construirWhereConsumoSalidas(filtros: FiltrosConsumoSalidas): Prisma.SalidaWhereInput {
  const condiciones = condicionesClienteProyectoFecha(filtros);
  condiciones.push({ estado: { in: [...ESTADOS_CONSUMO] } });
  return { AND: condiciones };
}

/** Traduce un registro Prisma de `salidas` (sin líneas) a la entidad de dominio. */
function aSalidaDominio(registro: SalidaPrisma): Salida {
  return {
    id: Number(registro.id),
    numero: Number(registro.numero),
    fechaSalida: registro.fechaSalida,
    proyectoId: Number(registro.proyectoId),
    observaciones: registro.observaciones,
    estado: mapearEstadoSalidaDeDominio(registro.estado),
    valorTotal: registro.valorTotal.toNumber(),
    valorIva: registro.valorIva.toNumber(),
    usuarioAutorizaId: registro.usuarioAutorizaId ? Number(registro.usuarioAutorizaId) : null,
    fechaConfirmacion: registro.fechaConfirmacion,
    motivoAnulacion: registro.motivoAnulacion,
  };
}

/** Traduce un registro Prisma de `detalles_salidas` a la entidad de dominio. */
function aDetalleSalidaDominio(registro: DetalleSalidaPrisma): DetalleSalida {
  return {
    id: Number(registro.id),
    salidaId: Number(registro.salidaId),
    productoId: Number(registro.productoId),
    cantidad: registro.cantidad.toNumber(),
    precioUnitario: registro.precioUnitario.toNumber(),
    valorTotal: registro.valorTotal.toNumber(),
    tasaIva: registro.tasaIva.toNumber(),
    valorIva: registro.valorIva.toNumber(),
  };
}

function aSalidaConDetallesDominio(
  registro: SalidaPrisma & { detalles: DetalleSalidaPrisma[] },
): SalidaConDetalles {
  return { ...aSalidaDominio(registro), detalles: registro.detalles.map(aDetalleSalidaDominio) };
}

function mapearEstadoSalidaDeDominio(estado: EstadoSalidaPrisma): EstadoSalida {
  switch (estado) {
    case 'PENDIENTE':
      return 'PENDIENTE';
    case 'CONFIRMADA':
      return 'CONFIRMADA';
    case 'COMPLETADA':
      return 'COMPLETADA';
    case 'ANULADA':
      return 'ANULADA';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de salida de Prisma sin mapeo al dominio: ${String(valorInesperado)}`);
    }
  }
}

function mapearEstadoSalidaAPrisma(estado: EstadoSalida): EstadoSalidaPrisma {
  switch (estado) {
    case 'PENDIENTE':
      return 'PENDIENTE';
    case 'CONFIRMADA':
      return 'CONFIRMADA';
    case 'COMPLETADA':
      return 'COMPLETADA';
    case 'ANULADA':
      return 'ANULADA';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de salida de dominio sin mapeo a Prisma: ${String(valorInesperado)}`);
    }
  }
}
