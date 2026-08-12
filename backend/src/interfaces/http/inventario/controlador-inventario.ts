/**
 * Controlador `ControladorInventario` — endpoints de `/api/inventario`
 * (contracts/api-rest.md § Inventario). Lectura pura: traduce HTTP ↔ casos de uso de
 * consulta (`ListarInventarioCasoUso`, `FichaProductoCasoUso`, `HistorialProductoCasoUso`);
 * cero reglas de negocio (docs/arquitectura.md — controladores delgados).
 *
 * A diferencia de `ControladorSalidas`/`ControladorIngresos`/`ControladorClientes` (que
 * inyectan el repositorio DIRECTAMENTE para lecturas simples de un solo puerto), aquí
 * SIEMPRE se pasa por un caso de uso: calcular `disponible`/`stockBajo` y enriquecer el
 * historial son composiciones que necesitan varios puertos (ver TSDoc de cada caso de uso
 * en `aplicacion/inventario/`), no lecturas triviales de un repositorio único.
 *
 * Autorización (T103): las tres rutas de consulta del estado del inventario —listado, ficha e
 * historial de movimientos— comparten `inventario.ver`. Un permiso por OPERACIÓN, no por ruta:
 * son la misma capacidad, y separarlas crearía casillas que nadie sabría marcar por separado
 * (research R16, criterio de T100).
 *
 * `historial-costos` (US12/T127) es la EXCEPCIÓN, y no por ser otra ruta sino por ser otra
 * capacidad: el contrato la reserva a Administrador y Gerente, mientras que `inventario.ver`
 * la tienen los tres roles del sistema (Operario incluido). La evolución del costo es
 * información de valorización —mismo alcance que `reportes.ver`—, así que exige su propio
 * permiso `inventario.ver_costos`. Colgarla de `inventario.ver` habría abierto silenciosamente
 * el historial de precios a todo Operario.
 *
 * Implementa: FR-020…FR-024 (visibilidad operativa del inventario: cifras, búsqueda, alerta
 * de stock bajo e historial por producto), FR-072 (historial de costos consultable desde la
 * ficha del producto) y FR-058 (la autorización se resuelve contra el permiso efectivo del
 * rol, nunca contra un nombre de rol fijo en el código).
 */
import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  esquemaFiltroHistorialCostos,
  esquemaFiltroInventario,
  esquemaFiltroMovimientos,
  type FiltroHistorialCostos,
  type FiltroInventario,
  type FiltroMovimientos,
  type OpcionesFiltroInventario,
  type Paginado,
} from '@trazo/compartido';
import { FichaProductoCasoUso } from '../../../aplicacion/inventario/ficha-producto.caso-uso';
import type { FilaInventario } from '../../../aplicacion/inventario/fila-inventario';
import {
  HistorialCostosProductoCasoUso,
  type CambioCostoHistorialProducto,
} from '../../../aplicacion/inventario/historial-costos-producto.caso-uso';
import {
  HistorialProductoCasoUso,
  type MovimientoHistorialProducto,
} from '../../../aplicacion/inventario/historial-producto.caso-uso';
import { ListarInventarioCasoUso } from '../../../aplicacion/inventario/listar-inventario.caso-uso';
import { OpcionesFiltroInventarioCasoUso } from '../../../aplicacion/inventario/opciones-filtro-inventario.caso-uso';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';

@Controller('inventario')
export class ControladorInventario {
  constructor(
    private readonly listarInventario: ListarInventarioCasoUso,
    private readonly opcionesFiltroInventario: OpcionesFiltroInventarioCasoUso,
    private readonly fichaProducto: FichaProductoCasoUso,
    private readonly historialProducto: HistorialProductoCasoUso,
    private readonly historialCostosProducto: HistorialCostosProductoCasoUso,
  ) {}

  /** `GET /api/inventario?buscar=&soloStockBajo=&categoria=&ubicacion=&estado=&disponibleMin=&disponibleMax=`
   *  — página de `{producto, stock, comprometido, disponible, stockBajo}`
   *  (FR-020/FR-022/FR-023 y, desde US13, FR-075/FR-077). Todos los filtros son opcionales y se
   *  combinan con Y lógico; el caso de uso decide cuáles resuelve el repositorio en SQL y cuáles
   *  se miden contra `disponible`. */
  @Get()
  @RequierePermiso('inventario.ver')
  async listar(
    @Query(new PipeValidacionZod(esquemaFiltroInventario)) filtros: FiltroInventario,
  ): Promise<Paginado<FilaInventario>> {
    const pagina = await this.listarInventario.ejecutar({
      buscar: filtros.buscar,
      soloStockBajo: filtros.soloStockBajo,
      categoria: filtros.categoria,
      ubicacion: filtros.ubicacion,
      estado: filtros.estado,
      disponibleMin: filtros.disponibleMin,
      disponibleMax: filtros.disponibleMax,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    });
    return { datos: pagina.datos, total: pagina.total, pagina: filtros.pagina, porPagina: filtros.porPagina };
  }

  /**
   * `GET /api/inventario/opciones-filtro` — categorías y ubicaciones que EXISTEN hoy en el
   * catálogo, para alimentar los dos selectores de filtro de la pantalla (US13, FR-076).
   *
   * Va declarada ANTES de `@Get(':productoId')`: Express resuelve por orden de declaración, y
   * detrás de la ruta paramétrica "opciones-filtro" llegaría como un id de producto. Mismo
   * cuidado que `@Get('export')` en los controladores de ingresos y salidas (T120).
   *
   * Mismo permiso que el listado (`inventario.ver`) porque no expone ningún dato que la propia
   * pantalla no muestre ya en sus columnas "Categoría" y "Ubicación".
   */
  @Get('opciones-filtro')
  @RequierePermiso('inventario.ver')
  async opcionesFiltro(): Promise<OpcionesFiltroInventario> {
    return this.opcionesFiltroInventario.ejecutar();
  }

  /** `GET /api/inventario/:productoId` — ficha con las cifras actuales (FR-020). `404` si no existe. */
  @Get(':productoId')
  @RequierePermiso('inventario.ver')
  async obtener(@Param('productoId', ParseIntPipe) productoId: number): Promise<FilaInventario> {
    return this.fichaProducto.ejecutar({ productoId });
  }

  /** `GET /api/inventario/:productoId/movimientos?desde=&hasta=` — historial enriquecido,
   *  paginado, más reciente primero (FR-024). */
  @Get(':productoId/movimientos')
  @RequierePermiso('inventario.ver')
  async movimientos(
    @Param('productoId', ParseIntPipe) productoId: number,
    @Query(new PipeValidacionZod(esquemaFiltroMovimientos)) filtros: FiltroMovimientos,
  ): Promise<Paginado<MovimientoHistorialProducto>> {
    const pagina = await this.historialProducto.ejecutar({
      productoId,
      desde: filtros.desde ? new Date(filtros.desde) : undefined,
      hasta: filtros.hasta ? new Date(filtros.hasta) : undefined,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    });
    return { datos: pagina.datos, total: pagina.total, pagina: filtros.pagina, porPagina: filtros.porPagina };
  }

  /**
   * `GET /api/inventario/:productoId/historial-costos` — cambios de costo del producto, más
   * reciente primero (US12, FR-072). Un historial DISTINTO del de movimientos y a propósito:
   * un cambio de costo no mueve cantidades (FR-073), así que nunca aparecerá en el otro.
   *
   * Permiso propio `inventario.ver_costos` (A,G) — ver TSDoc de la clase.
   */
  @Get(':productoId/historial-costos')
  @RequierePermiso('inventario.ver_costos')
  async historialCostos(
    @Param('productoId', ParseIntPipe) productoId: number,
    @Query(new PipeValidacionZod(esquemaFiltroHistorialCostos)) filtros: FiltroHistorialCostos,
  ): Promise<Paginado<CambioCostoHistorialProducto>> {
    const pagina = await this.historialCostosProducto.ejecutar({
      productoId,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    });
    return { datos: pagina.datos, total: pagina.total, pagina: filtros.pagina, porPagina: filtros.porPagina };
  }
}
