/**
 * Caso de uso `ResumenPanelCasoUso` — el panel de control de la ruta de inicio
 * (`GET /api/panel`, US10/FR-060…FR-063): cifras de inventario, documentos pendientes de
 * atender, consumo del mes en curso y actividad reciente, recortado por los permisos del
 * usuario autenticado.
 *
 * ## Composición, NUNCA recálculo (FR-063 — la razón de ser de este archivo)
 *
 * Este caso de uso no escribe ni una sola consulta agregada propia: cada cifra sale del MISMO
 * camino de lectura que ya alimenta su pantalla de detalle, de modo que panel y detalle no
 * puedan discrepar jamás (un panel que miente es peor que no tenerlo). El mapeo cifra ↔ origen
 * es literal, y es también el que verifica `backend/test/integracion/panel.spec.ts` (T117):
 *
 * | Cifra del panel | De dónde sale | Pantalla que muestra lo mismo |
 * |---|---|---|
 * | `inventario.productosActivos` | `ListarInventarioCasoUso` (`total`, sin filtro) | `GET /api/inventario` |
 * | `inventario.bajoUmbral` | `ListarInventarioCasoUso` (`total`, `soloStockBajo`) | `GET /api/inventario?soloStockBajo=true` |
 * | `inventario.valorTotal` | `ReporteInventarioActualCasoUso.valorTotalInventario` | `GET /api/reportes/inventario` |
 * | `pendientes.salidasPendientes` | `RepositorioSalidas.listar` (`total`, estado PENDIENTE) | `GET /api/salidas?estado=PENDIENTE` |
 * | `pendientes.ingresosPendientes` | `RepositorioIngresos.listar` (`total`, estado PENDIENTE) | `GET /api/ingresos?estado=PENDIENTE` |
 * | `consumoMes.total` | `RepositorioSalidas.listarParaConsumo` (FR-044) | `GET /api/reportes/consumo-cliente` (mismas salidas) |
 * | `movimientosRecientes` | `RepositorioMovimientos.listar` | `GET /api/reportes/movimientos` |
 *
 * Notas de composición que merecen justificación explícita:
 *
 * - **Los dos conteos de inventario** piden página 1 con `porPagina: 1` y usan SOLO el `total`:
 *   es exactamente el número que el listado imprime en su pie ("… N productos"), sin traerse
 *   filas que el panel no va a pintar. `bajoUmbral` se toma del LISTADO y no del
 *   `cantidadBajoUmbral` del reporte de inventario porque la tarjeta enlaza a
 *   `/inventario?soloStockBajo=true` (FR-061): la cifra y su destino salen del mismo cálculo.
 *   Por la misma razón `productosActivos` cuenta el catálogo TAL COMO lo lista `/inventario`
 *   —que desde T111 incluye los productos dados de baja, con su etiqueta de estado— y no solo
 *   los `ACTIVO`: una cifra que no cuadre con el listado al que lleva sería justo la
 *   discrepancia que FR-063 prohíbe (el panel la rotula "Productos en inventario").
 * - **Pendientes**: los listados de salidas/ingresos no tienen caso de uso intermedio — sus
 *   controladores inyectan el puerto directamente (ver TSDoc de `ControladorSalidas`), así que
 *   componer con el mismo puerto y los mismos filtros ES reutilizar su camino de lectura.
 * - **Consumo del mes**: no existe un caso de uso "consumo total" (los reportes de US4 son por
 *   cliente y por proyecto, y ambos EXIGEN su id), así que se suman las líneas de las mismas
 *   salidas que devuelve `listarParaConsumo` — el método del puerto que fija internamente
 *   `CONFIRMADA`/`COMPLETADA` (FR-044). El total se acumula sobre `detalle.valorTotal`, igual
 *   que `ReporteConsumoClienteCasoUso` acumula `totalProyecto`/`totalCliente`: mismo dato,
 *   misma fórmula, mismo universo de salidas.
 * - **Actividad reciente**: el contrato (api-rest.md § Panel de control) nombra
 *   `RepositorioMovimientos.listar` como su origen. Se toman los 10 primeros del orden que ya
 *   devuelve el puerto (`fecha_hora` DESC) y solo para ESOS se resuelven producto y usuario;
 *   reutilizar `ReporteMovimientosCasoUso` habría resuelto los nombres de TODO el historial en
 *   cada carga de la portada, y esta pantalla la abre todo el mundo en cada inicio de sesión.
 *   Los textos de respaldo (`Producto N.º 5`, `Usuario N.º 3`) son los MISMOS de ese reporte, a
 *   propósito: las dos pantallas deben leerse igual.
 *
 * **Costo asumido a conciencia**: componer sale más caro que una consulta agregada a medida
 * (`soloStockBajo` materializa los candidatos en memoria y el reporte de inventario recorre el
 * catálogo — exactamente lo que ya hacen sus dos pantallas, research R9, escala de un solo
 * almacén). Se paga a propósito: la alternativa barata es un `SELECT count(*)` propio que
 * mañana devuelva un número distinto al de la pantalla de detalle, que es justo lo que FR-063
 * prohíbe. Si algún día el volumen lo exige, se optimiza el camino COMPARTIDO (el caso de uso o
 * el puerto), nunca duplicándolo aquí.
 *
 * ## Recorte por permisos en el SERVIDOR (FR-062)
 *
 * La entrada es el usuario autenticado COMPLETO (`Usuario`, con `rolAsignado.permisos`
 * resueltos en esta misma petición por `EstrategiaJwt`), y cada sección se calcula solo si su
 * permiso está concedido; las demás se OMITEN del resultado (`undefined` → la clave no existe
 * en el JSON), nunca viajan con valor `null` ni ocultas para que el cliente decida. Se compara
 * contra las MISMAS claves que declaran los endpoints de detalle con `@RequierePermiso`, así
 * que el panel nunca puede mostrar algo que su pantalla de detalle negaría con un `403`.
 *
 * Solo lectura: no muta nada, no necesita `UnidadDeTrabajo` ni bloqueo de filas.
 *
 * Implementa: FR-060 (panel con las cifras operativas del negocio en la ruta de inicio),
 * FR-062 (el servidor incluye únicamente las cifras que el usuario puede consultar) y FR-063
 * (las cifras provienen de los mismos casos de uso que las pantallas de detalle).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import type { ClavePermiso } from '../../dominio/entidades/permiso';
import type { MovimientoInventario, TipoMovimientoInventario } from '../../dominio/entidades/movimiento-inventario';
import type { Usuario } from '../../dominio/entidades/usuario';
import { REPOSITORIO_INGRESOS, type RepositorioIngresos } from '../../dominio/puertos/repositorio-ingresos';
import { REPOSITORIO_MOVIMIENTOS, type RepositorioMovimientos } from '../../dominio/puertos/repositorio-movimientos';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';
import { ListarInventarioCasoUso } from '../inventario/listar-inventario.caso-uso';
import { ReporteInventarioActualCasoUso } from '../reportes/reporte-inventario-actual.caso-uso';

/**
 * Permisos que gobiernan cada sección del panel (FR-062). Son las MISMAS claves que declaran
 * con `@RequierePermiso` los endpoints de detalle equivalentes — si alguna cambiara ahí, el
 * panel debe cambiar con ella o volvería a mostrar algo que el detalle niega.
 */
const PERMISOS_DEL_PANEL: Readonly<Record<'inventario' | 'salidas' | 'ingresos' | 'reportes', ClavePermiso>> = {
  /** `GET /api/inventario` — conteos de stock y actividad reciente (la descripción de este
   *  permiso en el catálogo ya incluye "su historial de movimientos"). */
  inventario: 'inventario.ver',
  /** `GET /api/salidas` — salidas pendientes de confirmar. */
  salidas: 'salidas.ver',
  /** `GET /api/ingresos` — ingresos pendientes de recibir. */
  ingresos: 'ingresos.ver',
  /** `GET /api/reportes/*` — valorización del inventario y consumo del mes. */
  reportes: 'reportes.ver',
};

/** Página mínima: de los listados que alimentan un conteo solo se usa `total`, nunca sus filas. */
const PAGINA_SOLO_PARA_CONTAR = { pagina: 1, porPagina: 1 } as const;

/** Cuántos movimientos muestra "actividad reciente" (contracts/api-rest.md § Panel de control:
 *  "se limita a los 10 más recientes"; el detalle completo vive en `/api/reportes/movimientos`). */
const MOVIMIENTOS_RECIENTES = 10;

/** Desfase fijo de `America/Bogota` (UTC−5, sin horario de verano — spec.md § Moneda y
 *  localización), en milisegundos. Mismo criterio que `finDeDiaBogota`
 *  (`interfaces/http/reportes/controlador-reportes.ts`): la zona se resuelve con el offset
 *  literal en vez de depender de la zona horaria del proceso que ejecuta el backend. */
const DESFASE_BOGOTA_MS = 5 * 60 * 60 * 1000;

/** Entrada: el usuario autenticado COMPLETO — sus `rolAsignado.permisos` deciden qué secciones
 *  se calculan y cuáles se omiten (FR-062). */
export interface ResumenPanelEntrada {
  readonly usuario: Usuario;
}

/** Cifras de stock (FR-060). `valorTotal` solo con `reportes.ver` (FR-062). */
export interface PanelInventario {
  readonly productosActivos: number;
  readonly bajoUmbral: number;
  readonly valorTotal?: number;
}

/** Documentos que esperan acción; cada cifra solo si su listado es consultable (FR-062). */
export interface PanelPendientes {
  readonly salidasPendientes?: number;
  readonly ingresosPendientes?: number;
}

/** Consumo del mes en curso — misma definición de consumo que los reportes (FR-044). */
export interface PanelConsumoMes {
  /** Primer día del mes en curso en hora de Bogotá, `AAAA-MM-DD`. */
  readonly desde: string;
  readonly total: number;
}

/** Una fila de actividad reciente, con producto y usuario ya resueltos a texto legible. */
export interface PanelMovimientoReciente {
  readonly id: number;
  readonly fechaHora: Date;
  readonly tipo: TipoMovimientoInventario;
  readonly producto: string;
  readonly cantidad: number;
  readonly usuario: string;
}

/** Resultado del panel — TODA sección ausente significa "esta sesión no puede consultarla". */
export interface ResumenPanel {
  readonly inventario?: PanelInventario;
  readonly pendientes?: PanelPendientes;
  readonly consumoMes?: PanelConsumoMes;
  readonly movimientosRecientes?: PanelMovimientoReciente[];
}

@Injectable()
export class ResumenPanelCasoUso implements CasoDeUso<ResumenPanelEntrada, ResumenPanel> {
  constructor(
    private readonly listarInventario: ListarInventarioCasoUso,
    private readonly reporteInventarioActual: ReporteInventarioActualCasoUso,
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
    @Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos,
    @Inject(REPOSITORIO_MOVIMIENTOS) private readonly repositorioMovimientos: RepositorioMovimientos,
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
  ) {}

  async ejecutar(entrada: ResumenPanelEntrada): Promise<ResumenPanel> {
    const permisos = entrada.usuario.rolAsignado.permisos;
    const puedeInventario = concede(permisos, PERMISOS_DEL_PANEL.inventario);
    const puedeReportes = concede(permisos, PERMISOS_DEL_PANEL.reportes);

    const [inventario, pendientes, consumoMes, movimientosRecientes] = await Promise.all([
      puedeInventario ? this.cifrasInventario(puedeReportes) : undefined,
      this.cifrasPendientes(permisos),
      puedeReportes ? this.consumoDelMes() : undefined,
      puedeInventario ? this.actividadReciente() : undefined,
    ]);

    return { inventario, pendientes, consumoMes, movimientosRecientes };
  }

  /**
   * Conteos del listado de inventario (`total` de la página 1) más, si la sesión puede ver
   * reportes, la valorización que publica `GET /api/reportes/inventario` (FR-062/FR-063).
   */
  private async cifrasInventario(puedeReportes: boolean): Promise<PanelInventario> {
    const [todos, bajos, reporte] = await Promise.all([
      this.listarInventario.ejecutar({ soloStockBajo: false, ...PAGINA_SOLO_PARA_CONTAR }),
      this.listarInventario.ejecutar({ soloStockBajo: true, ...PAGINA_SOLO_PARA_CONTAR }),
      puedeReportes ? this.reporteInventarioActual.ejecutar({}) : undefined,
    ]);

    return {
      productosActivos: todos.total,
      bajoUmbral: bajos.total,
      ...(reporte ? { valorTotal: reporte.valorTotalInventario } : {}),
    };
  }

  /**
   * Documentos en estado `PENDIENTE` — cada cifra solo si su listado es consultable, y la
   * sección completa se omite si no lo es ninguno de los dos (FR-062: nada de claves vacías
   * que insinúen datos que esta sesión no puede ver).
   */
  private async cifrasPendientes(permisos: readonly ClavePermiso[]): Promise<PanelPendientes | undefined> {
    const puedeSalidas = concede(permisos, PERMISOS_DEL_PANEL.salidas);
    const puedeIngresos = concede(permisos, PERMISOS_DEL_PANEL.ingresos);
    if (!puedeSalidas && !puedeIngresos) {
      return undefined;
    }

    const [salidas, ingresos] = await Promise.all([
      puedeSalidas
        ? this.repositorioSalidas.listar({ estado: 'PENDIENTE', ...PAGINA_SOLO_PARA_CONTAR })
        : undefined,
      puedeIngresos
        ? this.repositorioIngresos.listar({ estado: 'PENDIENTE', ...PAGINA_SOLO_PARA_CONTAR })
        : undefined,
    ]);

    return {
      ...(salidas ? { salidasPendientes: salidas.total } : {}),
      ...(ingresos ? { ingresosPendientes: ingresos.total } : {}),
    };
  }

  /**
   * Consumo acumulado del mes en curso: suma de las líneas de las salidas que
   * `listarParaConsumo` considera consumo (`CONFIRMADA`/`COMPLETADA`, FR-044) con
   * `fechaSalida >= primer día del mes`. Sin datos devuelve `0`, nunca `NaN` (US10-AS3).
   */
  private async consumoDelMes(): Promise<PanelConsumoMes> {
    const primerDia = primerDiaDelMesEnBogota(new Date());
    const salidas = await this.repositorioSalidas.listarParaConsumo({ desde: primerDia });
    const total = salidas.reduce(
      (acumuladoSalidas, salida) =>
        acumuladoSalidas + salida.detalles.reduce((acumulado, detalle) => acumulado + detalle.valorTotal, 0),
      0,
    );

    return { desde: fechaSoloDiaIso(primerDia), total };
  }

  /**
   * Los `MOVIMIENTOS_RECIENTES` movimientos más recientes (el puerto ya los devuelve por
   * `fecha_hora` DESC), con producto y usuario resueltos en LOTE solo para esas filas — ver
   * TSDoc de cabecera. Sin movimientos devuelve `[]` (estado vacío, nunca un error).
   */
  private async actividadReciente(): Promise<PanelMovimientoReciente[]> {
    const movimientos = (await this.repositorioMovimientos.listar({})).slice(0, MOVIMIENTOS_RECIENTES);
    if (movimientos.length === 0) {
      return [];
    }

    const [productos, usuarios] = await Promise.all([
      this.resolverProductos(movimientos),
      this.resolverUsuarios(movimientos),
    ]);

    return movimientos.map((movimiento) => ({
      id: movimiento.id,
      fechaHora: movimiento.fechaHora,
      tipo: movimiento.tipo,
      producto: productos.get(movimiento.productoId) ?? `Producto N.º ${movimiento.productoId}`,
      cantidad: movimiento.cantidad,
      usuario: usuarios.get(movimiento.usuarioId) ?? `Usuario N.º ${movimiento.usuarioId}`,
    }));
  }

  /** Descripciones de producto en LOTE (`buscarPorIds`, una sola consulta — nunca N+1). */
  private async resolverProductos(movimientos: readonly MovimientoInventario[]): Promise<Map<number, string>> {
    const idsUnicos = [...new Set(movimientos.map((movimiento) => movimiento.productoId))];
    const productos = await this.repositorioProductos.buscarPorIds(idsUnicos);
    return new Map(productos.map((producto) => [producto.id, producto.descripcion]));
  }

  /** Nombres de usuario: `RepositorioUsuarios` no expone lectura en lote, así que se piden en
   *  paralelo UNA vez por id ÚNICO (nunca una por movimiento) — mismo criterio y mismo límite
   *  que `ReporteMovimientosCasoUso#resolverUsuarios`, aquí sobre 10 filas como máximo. */
  private async resolverUsuarios(movimientos: readonly MovimientoInventario[]): Promise<Map<number, string>> {
    const idsUnicos = [...new Set(movimientos.map((movimiento) => movimiento.usuarioId))];
    const pares = await Promise.all(
      idsUnicos.map(async (id): Promise<readonly [number, string] | null> => {
        const usuario = await this.repositorioUsuarios.buscarPorId(id);
        return usuario ? ([id, usuario.nombreCompleto] as const) : null;
      }),
    );
    return new Map(pares.filter((par): par is readonly [number, string] => par !== null));
  }
}

/** ¿La sesión concede este permiso? Comparación exacta contra las claves efectivas del rol,
 *  sin comodines ni jerarquías — mismo criterio que `PermisosGuard` (FR-058). */
function concede(permisos: readonly ClavePermiso[], permiso: ClavePermiso): boolean {
  return permisos.includes(permiso);
}

/**
 * Primer día del mes en curso, decidido en hora de Bogotá y devuelto como MEDIANOCHE UTC.
 *
 * Las dos mitades importan: el mes calendario se decide en Bogotá (a las 21:00 del 31 de julio
 * en Bogotá ya es 1 de agosto en UTC, y el panel debe seguir mostrando julio hasta la
 * medianoche local), pero el instante resultante se ancla a medianoche UTC porque
 * `salidas.fecha_salida` es una columna `DATE` que Postgres serializa así — el mismo criterio
 * que usa `entradaConsumoCliente` (`controlador-reportes.ts`) al convertir `desde` para ese
 * mismo filtro. Anclarlo a `T00:00-05:00` excluiría las salidas del propio día 1.
 */
function primerDiaDelMesEnBogota(ahora: Date): Date {
  const ahoraEnBogota = new Date(ahora.getTime() - DESFASE_BOGOTA_MS);
  return new Date(Date.UTC(ahoraEnBogota.getUTCFullYear(), ahoraEnBogota.getUTCMonth(), 1));
}

/** `AAAA-MM-DD` de una fecha ya anclada a medianoche UTC (contracts/api-rest.md § Panel de
 *  control: `"desde": "2026-08-01"`). */
function fechaSoloDiaIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}
