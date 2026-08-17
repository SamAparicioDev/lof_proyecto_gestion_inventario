/**
 * `ControladorCotizaciones` — `/api/cotizaciones` (US21, T201/T203).
 *
 * Controlador delgado: valida con `PipeValidacionZod`, exige permiso y delega. Sin `try/catch` —
 * el filtro global traduce los errores de dominio al formato `{ error: { mensaje, campos } }`.
 *
 * El permiso va POR MÉTODO y ese reparto ES la regla de FR-117: consultar, crear y editar
 * borradores lo pueden los tres roles —quien atiende al cliente es quien prepara la oferta—,
 * mientras que ENVIAR, CERRAR (aceptar/rechazar) y ANULAR quedan en Administrador y Gerente,
 * porque comprometen un precio frente a un tercero o generan una salida.
 *
 * Implementa: FR-112…FR-117.
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
  esquemaActualizarCotizacion,
  esquemaAnularCotizacion,
  esquemaCrearCotizacion,
  esquemaFormatoExport,
  esquemaListarCotizaciones,
  formatoNumeroCotizacion,
  type DatosAnularCotizacion,
  type DatosCrearCotizacion,
  type FiltroListarCotizaciones,
  type FormatoExport,
  type Paginado,
} from '@trazo/compartido';
import type { Response } from 'express';
import {
  AceptarCotizacionCasoUso,
  ActualizarCotizacionCasoUso,
  AnularCotizacionCasoUso,
  CrearCotizacionCasoUso,
  EnviarCotizacionCasoUso,
  ListarCotizacionesCasoUso,
  ObtenerCotizacionCasoUso,
  RechazarCotizacionCasoUso,
  type CotizacionConVigencia,
} from '../../../aplicacion/cotizaciones/gestionar-cotizaciones.caso-uso';
import type { ExportadorReporte } from '../../../aplicacion/reportes/puertos/exportador-reporte';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../../dominio/puertos/repositorio-clientes';
import {
  REPOSITORIO_COTIZACIONES,
  type CotizacionConDetalles,
  type RepositorioCotizaciones,
} from '../../../dominio/puertos/repositorio-cotizaciones';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../../dominio/puertos/repositorio-productos';
import { EXPORTADOR_EXCEL, EXPORTADOR_PDF } from '../../../infraestructura/exportacion/exportacion.module';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { fechaHoyIso, responderConArchivoExportado } from '../comunes/respuesta-export';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';
import {
  mapearCotizacionADocumento,
  mapearListadoCotizacionesADocumento,
} from './mapeadores-documento-cotizacion';

@Controller('cotizaciones')
export class ControladorCotizaciones {
  constructor(
    private readonly listarCotizaciones: ListarCotizacionesCasoUso,
    private readonly obtenerCotizacion: ObtenerCotizacionCasoUso,
    private readonly crearCotizacion: CrearCotizacionCasoUso,
    private readonly actualizarCotizacion: ActualizarCotizacionCasoUso,
    private readonly enviarCotizacion: EnviarCotizacionCasoUso,
    private readonly aceptarCotizacion: AceptarCotizacionCasoUso,
    private readonly rechazarCotizacion: RechazarCotizacionCasoUso,
    private readonly anularCotizacion: AnularCotizacionCasoUso,
    /** Solo para el listado EXPORTADO, que es `listar` sin paginar (FR-064) — mismo criterio
     *  que `ControladorOrdenesCompra`. */
    @Inject(REPOSITORIO_COTIZACIONES) private readonly repositorioCotizaciones: RepositorioCotizaciones,
    /** Solo para resolver `SKU — descripción` de las líneas y el contacto del cliente en el
     *  encabezado del documento exportado. */
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
    @Inject(EXPORTADOR_EXCEL) private readonly exportadorExcel: ExportadorReporte,
    @Inject(EXPORTADOR_PDF) private readonly exportadorPdf: ExportadorReporte,
  ) {}

  /** `GET /api/cotizaciones` — página de cabeceras con los filtros del contrato. */
  @Get()
  @RequierePermiso('cotizaciones.ver')
  async listar(
    @Query(new PipeValidacionZod(esquemaListarCotizaciones)) filtros: FiltroListarCotizaciones,
  ): Promise<Paginado<CotizacionConVigencia>> {
    const pagina = await this.listarCotizaciones.ejecutar({
      buscar: filtros.buscar,
      clienteId: filtros.clienteId,
      estado: filtros.estado,
      desde: filtros.desde ? new Date(filtros.desde) : undefined,
      hasta: filtros.hasta ? new Date(filtros.hasta) : undefined,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    });
    return { datos: pagina.datos, total: pagina.total, pagina: filtros.pagina, porPagina: filtros.porPagina };
  }

  /** `GET /api/cotizaciones/export` — el listado COMPLETO que cumple los filtros, sin paginar
   *  (FR-064). Va ANTES de `@Get(':id')`: con `:id` primero, Express haría entrar `/export` por
   *  esa ruta. */
  @Get('export')
  @RequierePermiso('cotizaciones.ver')
  async exportarListado(
    @Query(new PipeValidacionZod(esquemaListarCotizaciones.merge(esquemaFormatoExport)))
    filtros: FiltroListarCotizaciones & FormatoExport,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const cotizaciones = await this.repositorioCotizaciones.listarTodas({
      buscar: filtros.buscar,
      clienteId: filtros.clienteId,
      estado: filtros.estado,
      desde: filtros.desde ? new Date(filtros.desde) : undefined,
      hasta: filtros.hasta ? new Date(filtros.hasta) : undefined,
    });
    const clienteFiltrado = filtros.clienteId
      ? await this.repositorioClientes.buscarPorId(filtros.clienteId)
      : null;
    const documento = mapearListadoCotizacionesADocumento(cotizaciones, filtros, clienteFiltrado?.nombre);
    return this.exportar(documento, filtros.formato, `cotizaciones-${fechaHoyIso()}`, respuesta);
  }

  /** `GET /api/cotizaciones/:id` — cotización con sus líneas. `404` si no existe. */
  @Get(':id')
  @RequierePermiso('cotizaciones.ver')
  async obtener(@Param('id', ParseIntPipe) id: number): Promise<CotizacionConDetalles & { vencida: boolean }> {
    return this.obtenerCotizacion.ejecutar(id);
  }

  /** `GET /api/cotizaciones/:id/export` — LA OFERTA: el documento que se le envía al cliente
   *  (FR-116), con el logo institucional que pone el decorador de exportación. */
  @Get(':id/export')
  @RequierePermiso('cotizaciones.ver')
  async exportarDocumento(
    @Param('id', ParseIntPipe) id: number,
    @Query(new PipeValidacionZod(esquemaFormatoExport)) filtros: FormatoExport,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const cotizacion = await this.obtenerCotizacion.ejecutar(id);
    const productos = await this.repositorioProductos.buscarPorIds(
      cotizacion.detalles.map((detalle) => detalle.productoId),
    );
    const cliente = await this.repositorioClientes.buscarPorId(cotizacion.cliente.id);
    const documento = mapearCotizacionADocumento(
      cotizacion,
      new Map(productos.map((producto) => [producto.id, producto])),
      cliente,
    );
    return this.exportar(
      documento,
      filtros.formato,
      `cotizacion-${formatoNumeroCotizacion(cotizacion.numero)}`,
      respuesta,
    );
  }

  /** `POST /api/cotizaciones` — crea la cotización en BORRADOR con su correlativo (FR-112). */
  @Post()
  @RequierePermiso('cotizaciones.crear')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body(new PipeValidacionZod(esquemaCrearCotizacion)) datos: DatosCrearCotizacion,
    @UsuarioActual() usuario: Usuario,
  ): Promise<{ id: number; numero: number }> {
    const cotizacion = await this.crearCotizacion.ejecutar({ ...datos, usuarioId: usuario.id });
    return { id: cotizacion.id, numero: cotizacion.numero };
  }

  /** `PUT /api/cotizaciones/:id` — reemplaza cabecera y líneas; solo en BORRADOR (FR-114). */
  @Put(':id')
  @RequierePermiso('cotizaciones.editar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaActualizarCotizacion)) datos: DatosCrearCotizacion,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.actualizarCotizacion.ejecutar({ id, ...datos, usuarioId: usuario.id });
  }

  /** `POST /api/cotizaciones/:id/enviar` — BORRADOR→ENVIADA. */
  @Post(':id/enviar')
  @RequierePermiso('cotizaciones.enviar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async enviar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: Usuario): Promise<void> {
    await this.enviarCotizacion.ejecutar({ id, usuarioId: usuario.id });
  }

  /**
   * `POST /api/cotizaciones/:id/aceptar` — ENVIADA→ACEPTADA y genera la salida (FR-115).
   *
   * Devuelve `200` con el id de la salida, no `204`: es la única acción del módulo que crea algo
   * fuera de él, y la interfaz necesita ese id para llevar al usuario al pedido que acaba de
   * nacer.
   */
  @Post(':id/aceptar')
  @RequierePermiso('cotizaciones.cerrar')
  @HttpCode(HttpStatus.OK)
  async aceptar(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: Usuario,
  ): Promise<{ salidaId: number }> {
    return this.aceptarCotizacion.ejecutar({ id, usuarioId: usuario.id });
  }

  /** `POST /api/cotizaciones/:id/rechazar` — ENVIADA→RECHAZADA. No genera nada. */
  @Post(':id/rechazar')
  @RequierePermiso('cotizaciones.cerrar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async rechazar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: Usuario): Promise<void> {
    await this.rechazarCotizacion.ejecutar({ id, usuarioId: usuario.id });
  }

  /** `POST /api/cotizaciones/:id/anular` — con motivo obligatorio. */
  @Post(':id/anular')
  @RequierePermiso('cotizaciones.anular')
  @HttpCode(HttpStatus.NO_CONTENT)
  async anular(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaAnularCotizacion)) datos: DatosAnularCotizacion,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.anularCotizacion.ejecutar({ id, usuarioId: usuario.id, motivo: datos.motivo });
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
