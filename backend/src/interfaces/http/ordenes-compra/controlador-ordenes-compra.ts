/**
 * `ControladorOrdenesCompra` — `/api/ordenes-compra` (US16, T171).
 *
 * Controlador delgado: valida con `PipeValidacionZod`, exige permiso y delega. Sin `try/catch` —
 * el filtro global traduce los errores de dominio al formato `{ error: { mensaje, campos } }`.
 *
 * El permiso va POR MÉTODO y no en la clase, y ese reparto ES la regla de FR-100: consultar,
 * crear y editar borradores lo pueden los tres roles —quien ve faltar la mercancía es quien
 * arma el pedido—, mientras que ENVIAR y ANULAR quedan en Administrador y Gerente, porque son
 * las dos acciones que comprometen o liberan un gasto frente a un tercero.
 *
 * Implementa: FR-094…FR-098 y FR-100.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  esquemaActualizarOrdenCompra,
  esquemaCrearOrdenCompra,
  esquemaFiltroOrdenesCompra,
  esquemaFormatoExport,
  esquemaMotivo,
  esquemaSugerenciasCompra,
  formatoNumeroOrdenCompra,
  type DatosActualizarOrdenCompra,
  type DatosCrearOrdenCompra,
  type DatosMotivo,
  type FiltroOrdenesCompra,
  type FiltroSugerenciasCompra,
  type FormatoExport,
  type Paginado,
} from '@trazo/compartido';
import type { Response } from 'express';
import {
  ActualizarOrdenCompraCasoUso,
  AnularOrdenCompraCasoUso,
  CrearOrdenCompraCasoUso,
  EnviarOrdenCompraCasoUso,
  ListarOrdenesCompraCasoUso,
  ObtenerOrdenCompraCasoUso,
  SugerirCompraCasoUso,
} from '../../../aplicacion/ordenes-compra/gestionar-ordenes-compra.caso-uso';
import type { ExportadorReporte } from '../../../aplicacion/reportes/puertos/exportador-reporte';
import type { OrdenCompra } from '../../../dominio/entidades/orden-compra';
import type { Usuario } from '../../../dominio/entidades/usuario';
import {
  REPOSITORIO_ORDENES_COMPRA,
  type OrdenCompraConDetalles,
  type RepositorioOrdenesCompra,
} from '../../../dominio/puertos/repositorio-ordenes-compra';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../../dominio/puertos/repositorio-productos';
import {
  REPOSITORIO_PROVEEDORES,
  type RepositorioProveedores,
} from '../../../dominio/puertos/repositorio-proveedores';
import type { SugerenciaCompra } from '../../../dominio/puertos/sugerencias-compra';
import { EXPORTADOR_EXCEL, EXPORTADOR_PDF } from '../../../infraestructura/exportacion/exportacion.module';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { fechaHoyIso, responderConArchivoExportado } from '../comunes/respuesta-export';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';
import {
  mapearListadoOrdenesCompraADocumento,
  mapearOrdenCompraADocumento,
} from './mapeadores-documento-orden-compra';

@Controller('ordenes-compra')
export class ControladorOrdenesCompra {
  constructor(
    private readonly listarOrdenes: ListarOrdenesCompraCasoUso,
    private readonly obtenerOrden: ObtenerOrdenCompraCasoUso,
    private readonly crearOrden: CrearOrdenCompraCasoUso,
    private readonly actualizarOrden: ActualizarOrdenCompraCasoUso,
    private readonly enviarOrden: EnviarOrdenCompraCasoUso,
    private readonly anularOrden: AnularOrdenCompraCasoUso,
    private readonly sugerirCompra: SugerirCompraCasoUso,
    /** Solo para el listado EXPORTADO, que es `listar` sin paginar (FR-064) — mismo criterio
     *  que `ControladorIngresos`, que también inyecta su repositorio para `listarTodos`. */
    @Inject(REPOSITORIO_ORDENES_COMPRA) private readonly repositorioOrdenes: RepositorioOrdenesCompra,
    /** Solo para resolver `SKU — descripción` de las líneas del documento exportado y el
     *  contacto del proveedor en su encabezado — mismo motivo que en `ControladorIngresos`. */
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_PROVEEDORES) private readonly repositorioProveedores: RepositorioProveedores,
    @Inject(EXPORTADOR_EXCEL) private readonly exportadorExcel: ExportadorReporte,
    @Inject(EXPORTADOR_PDF) private readonly exportadorPdf: ExportadorReporte,
  ) {}

  /** `GET /api/ordenes-compra` — página de cabeceras con los filtros del contrato. */
  @Get()
  @RequierePermiso('ordenes_compra.ver')
  async listar(
    @Query(new PipeValidacionZod(esquemaFiltroOrdenesCompra)) filtros: FiltroOrdenesCompra,
  ): Promise<Paginado<OrdenCompra>> {
    const pagina = await this.listarOrdenes.ejecutar({
      buscar: filtros.buscar,
      proveedorId: filtros.proveedorId,
      estado: filtros.estado,
      desde: filtros.desde ? new Date(filtros.desde) : undefined,
      hasta: filtros.hasta ? new Date(filtros.hasta) : undefined,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    });
    return { datos: pagina.datos, total: pagina.total, pagina: filtros.pagina, porPagina: filtros.porPagina };
  }

  /**
   * `GET /api/ordenes-compra/sugerencias?proveedorId=` — qué pedirle hoy a ese proveedor
   * (FR-098). Exige `ordenes_compra.crear` y no `.ver`: es una ayuda para ARMAR un pedido, no
   * información de consulta.
   *
   * Va ANTES de `@Get(':id')`: con `:id` declarado primero, Express haría entrar `/sugerencias`
   * por esa ruta (mismo cuidado que con `/export`).
   */
  @Get('sugerencias')
  @RequierePermiso('ordenes_compra.crear')
  async sugerencias(
    @Query(new PipeValidacionZod(esquemaSugerenciasCompra)) filtros: FiltroSugerenciasCompra,
  ): Promise<SugerenciaCompra[]> {
    return this.sugerirCompra.ejecutar(filtros.proveedorId);
  }

  /** `GET /api/ordenes-compra/export` — el listado COMPLETO que cumple los filtros, sin paginar
   *  (FR-064). Mismos filtros que `listar` (SC-007). */
  @Get('export')
  @RequierePermiso('ordenes_compra.ver')
  async exportarListado(
    @Query(new PipeValidacionZod(esquemaFiltroOrdenesCompra.merge(esquemaFormatoExport)))
    filtros: FiltroOrdenesCompra & FormatoExport,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const ordenes = await this.repositorioOrdenes.listarTodas({
      buscar: filtros.buscar,
      proveedorId: filtros.proveedorId,
      estado: filtros.estado,
      desde: filtros.desde ? new Date(filtros.desde) : undefined,
      hasta: filtros.hasta ? new Date(filtros.hasta) : undefined,
    });
    const proveedorFiltrado = filtros.proveedorId
      ? await this.repositorioProveedores.buscarPorId(filtros.proveedorId)
      : null;
    const documento = mapearListadoOrdenesCompraADocumento(ordenes, filtros, proveedorFiltrado?.nombre);
    return this.exportar(documento, filtros.formato, `ordenes-compra-${fechaHoyIso()}`, respuesta);
  }

  /** `GET /api/ordenes-compra/:id` — orden con sus líneas. `404` si no existe. */
  @Get(':id')
  @RequierePermiso('ordenes_compra.ver')
  async obtener(@Param('id', ParseIntPipe) id: number): Promise<OrdenCompraConDetalles> {
    return this.obtenerOrden.ejecutar(id);
  }

  /** `GET /api/ordenes-compra/:id/export` — EL PEDIDO: el documento que se le envía al
   *  proveedor (FR-097). */
  @Get(':id/export')
  @RequierePermiso('ordenes_compra.ver')
  async exportarDocumento(
    @Param('id', ParseIntPipe) id: number,
    @Query(new PipeValidacionZod(esquemaFormatoExport)) filtros: FormatoExport,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const orden = await this.obtenerOrden.ejecutar(id);
    const productos = await this.repositorioProductos.buscarPorIds(
      orden.detalles.map((detalle) => detalle.productoId),
    );
    const proveedor = await this.repositorioProveedores.buscarPorId(orden.proveedor.id);
    const documento = mapearOrdenCompraADocumento(
      orden,
      new Map(productos.map((producto) => [producto.id, producto])),
      proveedor,
    );
    return this.exportar(
      documento,
      filtros.formato,
      `orden-compra-${formatoNumeroOrdenCompra(orden.numero)}`,
      respuesta,
    );
  }

  /** `POST /api/ordenes-compra` — crea la orden en BORRADOR con su correlativo (FR-094/FR-095). */
  @Post()
  @RequierePermiso('ordenes_compra.crear')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body(new PipeValidacionZod(esquemaCrearOrdenCompra)) datos: DatosCrearOrdenCompra,
    @UsuarioActual() usuario: Usuario,
  ): Promise<{ id: number; numero: number }> {
    const orden = await this.crearOrden.ejecutar({ ...datos, usuarioId: usuario.id });
    return { id: orden.id, numero: orden.numero };
  }

  /** `PUT /api/ordenes-compra/:id` — reemplaza cabecera y líneas; solo en BORRADOR (FR-096). */
  @Put(':id')
  @RequierePermiso('ordenes_compra.editar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaActualizarOrdenCompra)) datos: DatosActualizarOrdenCompra,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.actualizarOrden.ejecutar({ id, ...datos, usuarioId: usuario.id });
  }

  /** `POST /api/ordenes-compra/:id/enviar` — BORRADOR→ENVIADA. Exige `ordenes_compra.enviar`. */
  @Post(':id/enviar')
  @RequierePermiso('ordenes_compra.enviar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async enviar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: Usuario): Promise<void> {
    await this.enviarOrden.ejecutar({ id, usuarioId: usuario.id });
  }

  /** `POST /api/ordenes-compra/:id/anular` — con motivo obligatorio. Exige `ordenes_compra.anular`. */
  @Post(':id/anular')
  @RequierePermiso('ordenes_compra.anular')
  @HttpCode(HttpStatus.NO_CONTENT)
  async anular(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaMotivo)) datos: DatosMotivo,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.anularOrden.ejecutar({ id, usuarioId: usuario.id, motivo: datos.motivo });
  }

  private async exportar(
    documento: Parameters<typeof responderConArchivoExportado>[0],
    formato: FormatoExport['formato'],
    nombreBase: string,
    respuesta: Response,
  ): Promise<StreamableFile> {
    return responderConArchivoExportado(
      documento,
      formato,
      nombreBase,
      { excel: this.exportadorExcel, pdf: this.exportadorPdf },
      respuesta,
    );
  }
}
