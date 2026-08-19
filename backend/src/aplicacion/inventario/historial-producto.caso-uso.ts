/**
 * Caso de uso `HistorialProductoCasoUso` — historial de movimientos de un producto,
 * enriquecido con datos legibles (`GET /api/inventario/:productoId/movimientos`,
 * FR-024/FR-045).
 *
 * `RepositorioMovimientos.listarPorProducto` (solo lectura — ver TSDoc del puerto) devuelve
 * movimientos "crudos" (ids de documento/usuario/proyecto, sin nombres). Enriquecerlos con
 * el número de factura/salida, el nombre de quien ejecutó el movimiento y el nombre del
 * proyecto es COMPOSICIÓN de lectura, no una regla de negocio — apropiado en el caso de uso,
 * mismo criterio que `ListarResumenProductosCasoUso` compone `RepositorioProductos` +
 * `RepositorioSalidas` (T052).
 *
 * Rendimiento (evita N+1, Principio V): los puertos existentes (`RepositorioIngresos`,
 * `RepositorioSalidas`, `RepositorioUsuarios`, `RepositorioProyectos`) solo exponen
 * `buscarPorId` singular — ninguno tiene un método de lote. Este caso de uso deduplica los
 * ids ANTES de consultar (varios movimientos del MISMO ingreso/salida/usuario/proyecto es el
 * caso común de una página de historial) y dispara una consulta por id ÚNICO en paralelo
 * (`Promise.all`), agrupadas por tipo de documento — nunca una consulta por movimiento
 * individual. Agregar métodos de lote a esos puertos es una extensión posible si el volumen
 * real lo exige (T086); no se anticipa aquí sin evidencia medida (Principio V, YAGNI).
 *
 * Si el documento/usuario/proyecto referenciado ya no existe, se usa el id crudo como
 * fallback — la consulta completa nunca falla por un dato faltante de enriquecimiento.
 *
 * Implementa: FR-024 (historial de movimientos por producto, más reciente primero), FR-045
 * (auditoría legible: quién, cuándo, qué documento y, si aplica, qué cliente/proyecto).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import type {
  DocumentoTipoMovimiento,
  MovimientoInventario,
  TipoMovimientoInventario,
} from '../../dominio/entidades/movimiento-inventario';
import { REPOSITORIO_INGRESOS, type RepositorioIngresos } from '../../dominio/puertos/repositorio-ingresos';
import { REPOSITORIO_MOVIMIENTOS, type RepositorioMovimientos } from '../../dominio/puertos/repositorio-movimientos';
import { REPOSITORIO_PROYECTOS, type RepositorioProyectos } from '../../dominio/puertos/repositorio-proyectos';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';
import { identificadorIngreso } from '../ingresos/identificador-ingreso';

export interface HistorialProductoEntrada {
  readonly productoId: number;
  readonly desde?: Date;
  readonly hasta?: Date;
  readonly pagina: number;
  readonly porPagina: number;
}

/** Movimiento enriquecido con datos legibles — lo que consume la ficha de producto del
 *  frontend (fecha, tipo, documento, cantidad, usuario, cliente/proyecto). */
export interface MovimientoHistorialProducto {
  readonly id: number;
  readonly fechaHora: Date;
  readonly tipo: TipoMovimientoInventario;
  readonly cantidad: number;
  readonly stockResultante: number;
  readonly documentoTipo: DocumentoTipoMovimiento;
  readonly documentoId: number;
  /** Número de factura (INGRESO) o número de salida (SALIDA); el id crudo si el documento
   *  original ya no se encuentra. */
  readonly numeroDocumento: string;
  readonly usuarioId: number;
  /** `nombreCompleto` de quien ejecutó el movimiento; `"Usuario N.º {id}"` si no se encuentra. */
  readonly usuarioNombre: string;
  readonly proyectoId: number | null;
  /** `nombre` del proyecto cuando `proyectoId` no es `null`; el id crudo si no se encuentra. */
  readonly proyectoNombre: string | null;
  readonly motivo: string | null;
}

export interface PaginaHistorialProducto {
  readonly datos: MovimientoHistorialProducto[];
  readonly total: number;
}

@Injectable()
export class HistorialProductoCasoUso implements CasoDeUso<HistorialProductoEntrada, PaginaHistorialProducto> {
  constructor(
    @Inject(REPOSITORIO_MOVIMIENTOS) private readonly repositorioMovimientos: RepositorioMovimientos,
    @Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos,
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
    @Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos,
  ) {}

  async ejecutar(entrada: HistorialProductoEntrada): Promise<PaginaHistorialProducto> {
    const pagina = await this.repositorioMovimientos.listarPorProducto(entrada.productoId, {
      desde: entrada.desde,
      hasta: entrada.hasta,
      pagina: entrada.pagina,
      porPagina: entrada.porPagina,
    });

    const [numerosDocumento, nombresUsuario, nombresProyecto] = await Promise.all([
      this.resolverNumerosDocumento(pagina.datos),
      this.resolverNombresUsuario(pagina.datos),
      this.resolverNombresProyecto(pagina.datos),
    ]);

    const datos = pagina.datos.map(
      (movimiento): MovimientoHistorialProducto => ({
        id: movimiento.id,
        fechaHora: movimiento.fechaHora,
        tipo: movimiento.tipo,
        cantidad: movimiento.cantidad,
        stockResultante: movimiento.stockResultante,
        documentoTipo: movimiento.documentoTipo,
        documentoId: movimiento.documentoId,
        numeroDocumento: numerosDocumento.get(claveDocumento(movimiento)) ?? String(movimiento.documentoId),
        usuarioId: movimiento.usuarioId,
        usuarioNombre: nombresUsuario.get(movimiento.usuarioId) ?? `Usuario N.º ${movimiento.usuarioId}`,
        proyectoId: movimiento.proyectoId,
        proyectoNombre:
          movimiento.proyectoId === null
            ? null
            : (nombresProyecto.get(movimiento.proyectoId) ?? String(movimiento.proyectoId)),
        motivo: movimiento.motivo,
      }),
    );

    return { datos, total: pagina.total };
  }

  /** Números de factura/salida en lote: un `buscarPorId` por id ÚNICO de cada tipo de
   *  documento, en paralelo — nunca uno por movimiento individual. */
  private async resolverNumerosDocumento(movimientos: readonly MovimientoInventario[]): Promise<Map<string, string>> {
    const idsIngreso = idsUnicos(movimientos.filter((m) => m.documentoTipo === 'INGRESO').map((m) => m.documentoId));
    const idsSalida = idsUnicos(movimientos.filter((m) => m.documentoTipo === 'SALIDA').map((m) => m.documentoId));

    const [ingresos, salidas] = await Promise.all([
      Promise.all(idsIngreso.map((id) => this.repositorioIngresos.buscarPorId(id))),
      Promise.all(idsSalida.map((id) => this.repositorioSalidas.buscarPorId(id))),
    ]);

    const mapa = new Map<string, string>();
    idsIngreso.forEach((id, indice) => {
      const ingreso = ingresos[indice];
      // US29 (FR-126): un ajuste se identifica por su correlativo, no por una factura
      // que no tiene.
      mapa.set(`INGRESO:${id}`, ingreso ? identificadorIngreso(ingreso) : String(id));
    });
    idsSalida.forEach((id, indice) => {
      const salida = salidas[indice];
      mapa.set(`SALIDA:${id}`, salida ? String(salida.numero) : String(id));
    });
    return mapa;
  }

  /** Nombres de usuario en lote — mismo criterio que `resolverNumerosDocumento`. */
  private async resolverNombresUsuario(movimientos: readonly MovimientoInventario[]): Promise<Map<number, string>> {
    const ids = idsUnicos(movimientos.map((m) => m.usuarioId));
    const usuarios = await Promise.all(ids.map((id) => this.repositorioUsuarios.buscarPorId(id)));
    const mapa = new Map<number, string>();
    ids.forEach((id, indice) => {
      const usuario = usuarios[indice];
      if (usuario) mapa.set(id, usuario.nombreCompleto);
    });
    return mapa;
  }

  /** Nombres de proyecto en lote (solo movimientos de tipo SALIDA traen `proyectoId`). */
  private async resolverNombresProyecto(movimientos: readonly MovimientoInventario[]): Promise<Map<number, string>> {
    const ids = idsUnicos(
      movimientos.map((m) => m.proyectoId).filter((id): id is number => id !== null),
    );
    const proyectos = await Promise.all(ids.map((id) => this.repositorioProyectos.buscarPorId(id)));
    const mapa = new Map<number, string>();
    ids.forEach((id, indice) => {
      const proyecto = proyectos[indice];
      if (proyecto) mapa.set(id, proyecto.nombre);
    });
    return mapa;
  }
}

/** Deduplica una lista de ids preservando el primer orden de aparición. */
function idsUnicos(ids: readonly number[]): number[] {
  return [...new Set(ids)];
}

/** Clave compuesta `documentoTipo:documentoId` — dos tipos de documento pueden compartir el
 *  mismo `documentoId` numérico (un `Ingreso.id=5` y una `Salida.id=5` son documentos
 *  distintos), así que el mapa de números de documento no puede indexar solo por id. */
function claveDocumento(movimiento: Pick<MovimientoInventario, 'documentoTipo' | 'documentoId'>): string {
  return `${movimiento.documentoTipo}:${movimiento.documentoId}`;
}
