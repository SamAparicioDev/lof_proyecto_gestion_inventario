/**
 * Caso de uso `ReporteMovimientosCasoUso` — reporte general de movimientos de inventario:
 * TODOS los movimientos (entradas y salidas) que matchean los filtros, sin paginar
 * (`GET /api/reportes/movimientos`, FR-042), con fecha, tipo, documento asociado, producto,
 * cantidad, usuario y cliente/proyecto cuando aplica. Filtrable por fecha (`desde`/`hasta`),
 * tipo, usuario y cliente/proyecto.
 *
 * Composición de SEIS puertos: `RepositorioMovimientos` (`listar`, US7/T080 — la fuente de las
 * filas, YA filtrada por fecha/tipo/usuario/cliente/proyecto en el adaptador, ver TSDoc de
 * `FiltrosListarMovimientosGeneral`) + cinco puertos de resolución de nombres para que cada
 * fila sea legible sin que el frontend tenga que resolver ids por su cuenta:
 * `RepositorioProductos` (sku/descripción), `RepositorioUsuarios` (nombre de quien registró el
 * movimiento), `RepositorioIngresos`/`RepositorioSalidas` (número del documento de origen,
 * según `documentoTipo`) y `RepositorioProyectos`/`RepositorioClientes` (nombre de
 * proyecto/cliente cuando el movimiento tiene `proyectoId` — solo las SALIDAS, nunca las
 * ENTRADAS, ver TSDoc de `MovimientoInventario.proyectoId`).
 *
 * Evitando N+1: cada resolución se hace en LOTE sobre el conjunto de ids ÚNICOS de los
 * movimientos devueltos, nunca una consulta por movimiento. `RepositorioProductos.buscarPorIds`
 * ya expone lectura en lote real (mismo método que reutilizan los reportes de consumo de US4).
 * `RepositorioUsuarios`/`RepositorioIngresos`/`RepositorioSalidas`/`RepositorioProyectos`/
 * `RepositorioClientes` NO exponen un método de lote (solo `buscarPorId`) — se piden en
 * paralelo con `Promise.all` UNA vez por id ÚNICO (no por movimiento), que es el máximo que
 * permiten hoy esos puertos sin reabrirlos (fuera del alcance de esta tarea). El documento de
 * origen se resuelve con una clave compuesta `documentoTipo:documentoId` porque los ids de
 * `Ingreso` y `Salida` son secuencias independientes — un `INGRESO` id=5 y una `SALIDA` id=5
 * son documentos distintos.
 *
 * Cualquier id referenciado que no se logre resolver (no debería ocurrir, dada la integridad
 * referencial de `data-model.md`) cae a un texto de respaldo (`"Producto N.º 5"`, etc.) —
 * mismo criterio defensivo que `ReporteConsumoClienteCasoUso`/`ReporteConsumoProyectoCasoUso`
 * (US4) usan para `productoId`, nunca lanza `NoEncontrado` por una fila individual.
 *
 * Solo lectura: no muta nada, no necesita `UnidadDeTrabajo` ni bloqueo de filas.
 *
 * Implementa: FR-042 (reporte de movimientos: fecha, tipo, documento, producto, cantidad,
 * usuario y cliente/proyecto cuando aplica, filtrable por fecha/tipo/usuario/cliente/proyecto).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import {
  claveDocumentoMovimiento,
  idsDeDocumento,
  textoDocumentoMovimiento,
} from '../comunes/documento-de-movimiento';
import type { Cliente } from '../../dominio/entidades/cliente';
import type {
  DocumentoTipoMovimiento,
  MovimientoInventario,
  TipoMovimientoInventario,
} from '../../dominio/entidades/movimiento-inventario';
import type { Producto } from '../../dominio/entidades/producto';
import type { Proyecto } from '../../dominio/entidades/proyecto';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';
import { REPOSITORIO_INGRESOS, type RepositorioIngresos } from '../../dominio/puertos/repositorio-ingresos';
import { REPOSITORIO_MOVIMIENTOS, type RepositorioMovimientos } from '../../dominio/puertos/repositorio-movimientos';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import { REPOSITORIO_PROYECTOS, type RepositorioProyectos } from '../../dominio/puertos/repositorio-proyectos';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';
import { identificadorIngreso } from '../ingresos/identificador-ingreso';

/** `desde`/`hasta` llegan como `Date` — el controlador convierte el texto ISO ya validado por
 *  `esquemaFiltroReporteMovimientos` ANTES de invocar el caso de uso, mismo patrón que
 *  `ReporteConsumoClienteCasoUso`. */
export interface ReporteMovimientosEntrada {
  readonly desde?: Date;
  readonly hasta?: Date;
  readonly tipo?: TipoMovimientoInventario;
  readonly usuarioId?: number;
  readonly clienteId?: number;
  readonly proyectoId?: number;
}

/** Una fila del reporte: un movimiento con TODOS sus ids ya resueltos a texto legible (FR-042). */
export interface FilaReporteMovimiento {
  readonly id: number;
  readonly fecha: Date;
  readonly tipo: TipoMovimientoInventario;
  readonly cantidad: number;
  readonly documento: {
    readonly tipo: DocumentoTipoMovimiento;
    readonly numero: string;
  };
  readonly producto: {
    readonly sku: string;
    readonly descripcion: string;
  };
  readonly usuario: string;
  /** `null` salvo en movimientos de SALIDA (los únicos con `proyectoId`, ver TSDoc de
   *  `MovimientoInventario`). */
  readonly cliente: string | null;
  readonly proyecto: string | null;
}

export interface ReporteMovimientos {
  readonly movimientos: FilaReporteMovimiento[];
  readonly filtros: {
    readonly desde: string | null;
    readonly hasta: string | null;
    readonly tipo: TipoMovimientoInventario | null;
    readonly usuarioId: number | null;
    /** US25 (FR-121): nombre de la persona filtrada, ya resuelto, para que el documento
     *  exportado la nombre en vez de mostrar "N.º 7". `null` si no se filtró por persona. */
    readonly usuarioNombre: string | null;
    readonly clienteId: number | null;
    readonly proyectoId: number | null;
  };
}

@Injectable()
export class ReporteMovimientosCasoUso implements CasoDeUso<ReporteMovimientosEntrada, ReporteMovimientos> {
  constructor(
    @Inject(REPOSITORIO_MOVIMIENTOS) private readonly repositorioMovimientos: RepositorioMovimientos,
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
    @Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos,
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
    @Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos,
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
  ) {}

  async ejecutar(entrada: ReporteMovimientosEntrada): Promise<ReporteMovimientos> {
    const movimientos = await this.repositorioMovimientos.listar({
      desde: entrada.desde,
      hasta: entrada.hasta,
      tipo: entrada.tipo,
      usuarioId: entrada.usuarioId,
      clienteId: entrada.clienteId,
      proyectoId: entrada.proyectoId,
    });

    const [productos, usuarios, documentos, proyectosYClientes] = await Promise.all([
      this.resolverProductos(movimientos),
      this.resolverUsuarios(movimientos),
      this.resolverDocumentos(movimientos),
      this.resolverProyectosYClientes(movimientos),
    ]);

    return {
      movimientos: movimientos.map((movimiento) =>
        construirFila(movimiento, productos, usuarios, documentos, proyectosYClientes),
      ),
      filtros: {
        desde: entrada.desde ? entrada.desde.toISOString() : null,
        hasta: entrada.hasta ? entrada.hasta.toISOString() : null,
        tipo: entrada.tipo ?? null,
        usuarioId: entrada.usuarioId ?? null,
        // Se resuelve del mapa que ya se cargó para pintar las filas: si el filtro devolvió
        // movimientos, esa persona está ahí y no hace falta otra consulta. Con cero resultados
        // se pregunta al repositorio, porque el nombre sigue haciendo falta en el encabezado.
        usuarioNombre: entrada.usuarioId
          ? (usuarios.get(entrada.usuarioId) ??
            (await this.repositorioUsuarios.buscarPorId(entrada.usuarioId))?.nombreCompleto ??
            null)
          : null,
        clienteId: entrada.clienteId ?? null,
        proyectoId: entrada.proyectoId ?? null,
      },
    };
  }

  /** Productos en LOTE (`buscarPorIds` real — mismo criterio que los reportes de consumo de US4). */
  private async resolverProductos(movimientos: readonly MovimientoInventario[]): Promise<Map<number, Producto>> {
    const idsUnicos = [...new Set(movimientos.map((movimiento) => movimiento.productoId))];
    const productos = await this.repositorioProductos.buscarPorIds(idsUnicos);
    return new Map(productos.map((producto) => [producto.id, producto]));
  }

  /** Usuarios: `RepositorioUsuarios` no expone lote, se pide UNA vez por id ÚNICO en paralelo
   *  (nunca una vez por movimiento) — el máximo que evita N+1 sin reabrir el puerto. Empareja
   *  `id` con su resultado dentro del propio `map` (nunca indexando un array paralelo por
   *  posición — `noUncheckedIndexedAccess` del `tsconfig.json` marcaría ese acceso como
   *  potencialmente `undefined`, con razón: no hay garantía estática de que las posiciones
   *  sigan alineadas). */
  private async resolverUsuarios(movimientos: readonly MovimientoInventario[]): Promise<Map<number, string>> {
    const idsUnicos = [...new Set(movimientos.map((movimiento) => movimiento.usuarioId))];
    const pares = await Promise.all(
      idsUnicos.map(async (id): Promise<readonly [number, string] | null> => {
        const usuario = await this.repositorioUsuarios.buscarPorId(id);
        return usuario ? ([id, usuario.nombreCompleto] as const) : null;
      }),
    );
    return new Map(soloResueltos(pares));
  }

  /** Número de documento de origen (factura de ingreso o número de salida), resuelto por
   *  `documentoTipo` con clave compuesta `tipo:id` (ids de `Ingreso`/`Salida` son secuencias
   *  independientes). Mismo criterio de "un id único por llamada, emparejado dentro del `map`"
   *  que `resolverUsuarios`: ninguno de los dos puertos expone lectura en lote. */
  private async resolverDocumentos(movimientos: readonly MovimientoInventario[]): Promise<Map<string, string>> {
    const idsIngreso = [...new Set(idsDeDocumento(movimientos, 'INGRESO'))];
    const idsSalida = [...new Set(idsDeDocumento(movimientos, 'SALIDA'))];

    const [paresIngreso, paresSalida] = await Promise.all([
      Promise.all(
        idsIngreso.map(async (id): Promise<readonly [string, string] | null> => {
          const ingreso = await this.repositorioIngresos.buscarPorId(id);
          // US29 (FR-126): `AJU-000042` cuando el movimiento viene de un ajuste.
          return ingreso ? ([claveDocumentoMovimiento('INGRESO', id), identificadorIngreso(ingreso)] as const) : null;
        }),
      ),
      Promise.all(
        idsSalida.map(async (id): Promise<readonly [string, string] | null> => {
          const salida = await this.repositorioSalidas.buscarPorId(id);
          return salida ? ([claveDocumentoMovimiento('SALIDA', id), String(salida.numero)] as const) : null;
        }),
      ),
    ]);

    return new Map(soloResueltos([...paresIngreso, ...paresSalida]));
  }

  /** Proyecto (nombre) y, a partir de `proyecto.clienteId`, cliente (nombre) — mismo JOIN
   *  implícito vía `proyecto.clienteId` que usa `RepositorioSalidas`/`RepositorioMovimientos`
   *  para el filtro `clienteId` (ver TSDoc de `FiltrosListarMovimientosGeneral`). Solo se
   *  resuelven los `proyectoId` NO nulos — las ENTRADAS nunca tienen proyecto. */
  private async resolverProyectosYClientes(
    movimientos: readonly MovimientoInventario[],
  ): Promise<{ proyectos: Map<number, Proyecto>; clientes: Map<number, Cliente> }> {
    const idsProyecto = [
      ...new Set(
        movimientos.map((movimiento) => movimiento.proyectoId).filter((id): id is number => id !== null),
      ),
    ];
    const paresProyecto = await Promise.all(
      idsProyecto.map(async (id): Promise<readonly [number, Proyecto] | null> => {
        const proyecto = await this.repositorioProyectos.buscarPorId(id);
        return proyecto ? ([id, proyecto] as const) : null;
      }),
    );
    const proyectos = new Map(soloResueltos(paresProyecto));

    const idsCliente = [...new Set(Array.from(proyectos.values()).map((proyecto) => proyecto.clienteId))];
    const paresCliente = await Promise.all(
      idsCliente.map(async (id): Promise<readonly [number, Cliente] | null> => {
        const cliente = await this.repositorioClientes.buscarPorId(id);
        return cliente ? ([id, cliente] as const) : null;
      }),
    );
    const clientes = new Map(soloResueltos(paresCliente));

    return { proyectos, clientes };
  }
}


/** Descarta los pares `[id, valor]` cuyo `buscarPorId` no encontró nada (`null`) — helper
 *  compartido por los cuatro resolvers de lote de esta clase. */
function soloResueltos<Clave, Valor>(pares: readonly (readonly [Clave, Valor] | null)[]): (readonly [Clave, Valor])[] {
  return pares.filter((par): par is readonly [Clave, Valor] => par !== null);
}

/** Ensambla una fila del reporte a partir de un movimiento y los mapas de resolución ya
 *  construidos en lote — sin volver a consultar nada (FR-042). */
function construirFila(
  movimiento: MovimientoInventario,
  productos: ReadonlyMap<number, Producto>,
  usuarios: ReadonlyMap<number, string>,
  documentos: ReadonlyMap<string, string>,
  proyectosYClientes: { proyectos: ReadonlyMap<number, Proyecto>; clientes: ReadonlyMap<number, Cliente> },
): FilaReporteMovimiento {
  const producto = productos.get(movimiento.productoId);
  const proyecto = movimiento.proyectoId !== null ? proyectosYClientes.proyectos.get(movimiento.proyectoId) : undefined;
  const cliente = proyecto ? proyectosYClientes.clientes.get(proyecto.clienteId) : undefined;

  return {
    id: movimiento.id,
    fecha: movimiento.fechaHora,
    tipo: movimiento.tipo,
    cantidad: movimiento.cantidad,
    documento: {
      tipo: movimiento.documentoTipo,
      numero: textoDocumentoMovimiento(movimiento, documentos),
    },
    producto: producto
      ? { sku: producto.sku, descripcion: producto.descripcion }
      : { sku: '—', descripcion: `Producto N.º ${movimiento.productoId}` },
    usuario: usuarios.get(movimiento.usuarioId) ?? `Usuario N.º ${movimiento.usuarioId}`,
    cliente: cliente?.nombre ?? null,
    proyecto: proyecto?.nombre ?? null,
  };
}
