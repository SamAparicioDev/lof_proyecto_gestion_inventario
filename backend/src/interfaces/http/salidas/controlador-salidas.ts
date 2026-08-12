/**
 * Controlador `ControladorSalidas` — endpoints de `/api/salidas`
 * (contracts/api-rest.md § Salidas). Traduce HTTP ↔ casos de uso / lectura de
 * `RepositorioSalidas`; cero reglas de negocio.
 *
 * Lectura (`listar`/`obtener`) inyecta el puerto `RepositorioSalidas` DIRECTAMENTE — sin
 * caso de uso intermedio — porque no hay regla de negocio que aplicar antes de leer (mismo
 * patrón que `ControladorIngresos`/`ControladorClientes`). `obtener` traduce el `null` del
 * repositorio a `NoEncontrado` (el filtro global lo convierte en `404`) porque el puerto
 * expresa "no existe" como valor, no como excepción.
 *
 * `cancelar`/`anular` reciben `{motivo}` validado con el `esquemaMotivo` compartido (solo
 * garantiza que, si llega, sea texto — T088: un `motivo` no-string sin pipe producía un
 * `500` en vez de un `400`); el requisito de que NO esté vacío sigue viviendo en los casos
 * de uso, que ya lo validan con `ErrorValidacionDominio` (400) — mismo criterio que
 * `ControladorIngresos.anular`.
 *
 * Autorización (T103): CADA transición de la máquina de estados tiene su propio permiso
 * (`salidas.confirmar`, `completar`, `cancelar`, `anular`) en vez de un `salidas.operar`
 * único, porque la distinción de negocio es justamente esa: `anular` revierte stock YA
 * descontado y por eso los tres roles del sistema no lo comparten, mientras `cancelar` cierra
 * una salida `PENDIENTE` que nunca tocó stock. Antes esa diferencia estaba fija en el código
 * (`@Roles('ADMINISTRADOR','GERENTE')` frente a `(...,'OPERARIO')`); ahora es una casilla que
 * el Administrador mueve por rol sin tocar código (FR-055, research R16).
 *
 * ## Exportación (US11/T120/T121, FR-064/FR-065/FR-067/FR-069)
 *
 * `GET /export` (listado) y `GET /:id/export` (documento individual), con el mismo criterio
 * SC-007 que reportes e ingresos: MISMO esquema de filtros que la ruta de datos, MISMA lectura
 * del repositorio, más un mapeo puro y la estrategia de exportación. Tres precisiones propias
 * de las salidas:
 *
 * - El listado exportado usa `listarTodas`: TODAS las filas del filtro, no la página visible
 *   (FR-064). `pagina`/`porPagina` se validan con el mismo esquema y se IGNORAN.
 * - Se resuelven los NOMBRES de cliente y proyecto en el servidor, porque la tabla de `/salidas`
 *   también los muestra (los resuelve en el navegador); exportar `Proyecto N.º 3` enseñaría
 *   menos que la pantalla.
 * - El LOGO (FR-067/FR-069): el documento de una salida siempre corresponde a un único cliente
 *   —el dueño de su proyecto— y lo lleva; el listado solo lo lleva si el usuario filtró por
 *   `clienteId`. Sin ese filtro abarca varios clientes y no habría un logo correcto que mostrar
 *   (US11-AS4).
 *
 * Ambas rutas exigen `salidas.ver`, el mismo permiso del listado y el detalle que exportan
 * (contrato: A,G,O) — mismo razonamiento que en `ControladorIngresos`. Y `@Get('export')` va
 * ANTES de `@Get(':id')` por el orden de resolución de Express.
 *
 * Implementa: FR-025…FR-033 (registro, edición y las cuatro transiciones de estado de la
 * máquina de `entidades/salida.ts`), FR-064/FR-065/FR-067/FR-069 (exportación con la identidad
 * del cliente), FR-045 (auditoría: `usuarioId` siempre del token, nunca del body) y FR-058
 * (autorización contra el permiso efectivo del rol, resuelto en el servidor en cada petición).
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
  esquemaActualizarSalida,
  esquemaCrearSalida,
  esquemaFiltroSalidas,
  esquemaFormatoExport,
  esquemaMotivo,
  type DatosActualizarSalida,
  type DatosCrearSalida,
  type DatosMotivo,
  type FiltroSalidas,
  type FormatoExport,
  type Paginado,
} from '@trazo/compartido';
import type { Response } from 'express';
import { ActualizarSalidaCasoUso } from '../../../aplicacion/salidas/actualizar-salida.caso-uso';
import { AnularSalidaCasoUso } from '../../../aplicacion/salidas/anular-salida.caso-uso';
import { CancelarSalidaCasoUso } from '../../../aplicacion/salidas/cancelar-salida.caso-uso';
import { CompletarSalidaCasoUso } from '../../../aplicacion/salidas/completar-salida.caso-uso';
import { ConfirmarSalidaCasoUso } from '../../../aplicacion/salidas/confirmar-salida.caso-uso';
import { CrearSalidaCasoUso } from '../../../aplicacion/salidas/crear-salida.caso-uso';
import { ResolverLogoDocumentoCasoUso } from '../../../aplicacion/exportacion/resolver-logo-documento.caso-uso';
import type { ExportadorReporte } from '../../../aplicacion/reportes/puertos/exportador-reporte';
import { NoEncontrado } from '../../../dominio/comunes/errores';
import type { Salida } from '../../../dominio/entidades/salida';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../../dominio/puertos/repositorio-clientes';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../../dominio/puertos/repositorio-productos';
import { REPOSITORIO_PROYECTOS, type RepositorioProyectos } from '../../../dominio/puertos/repositorio-proyectos';
import {
  REPOSITORIO_SALIDAS,
  type RepositorioSalidas,
  type SalidaConDetalles,
} from '../../../dominio/puertos/repositorio-salidas';
import { EXPORTADOR_EXCEL, EXPORTADOR_PDF } from '../../../infraestructura/exportacion/exportacion.module';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { fechaHoyIso, responderConArchivoExportado } from '../comunes/respuesta-export';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';
import {
  mapearListadoSalidasADocumento,
  mapearSalidaADocumento,
  type DestinoSalida,
} from './mapeadores-documento-salida';

@Controller('salidas')
export class ControladorSalidas {
  constructor(
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
    private readonly crearSalida: CrearSalidaCasoUso,
    private readonly actualizarSalida: ActualizarSalidaCasoUso,
    private readonly confirmarSalida: ConfirmarSalidaCasoUso,
    private readonly completarSalida: CompletarSalidaCasoUso,
    private readonly cancelarSalida: CancelarSalidaCasoUso,
    private readonly anularSalida: AnularSalidaCasoUso,
    /** Los tres siguientes puertos SOLO alimentan la exportación (US11): nombres de
     *  cliente/proyecto y `SKU — descripción` de cada línea, exactamente los mismos datos que la
     *  pantalla resuelve por su cuenta desde el navegador. */
    @Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos,
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    private readonly resolverLogo: ResolverLogoDocumentoCasoUso,
    @Inject(EXPORTADOR_EXCEL) private readonly exportadorExcel: ExportadorReporte,
    @Inject(EXPORTADOR_PDF) private readonly exportadorPdf: ExportadorReporte,
  ) {}

  /** `GET /api/salidas?clienteId=&proyectoId=&estado=&desde=&hasta=&numero=&usuarioAutorizaId=`
   *  — página de cabeceras (FR-033; los dos últimos filtros desde US13/FR-075). */
  @Get()
  @RequierePermiso('salidas.ver')
  async listar(@Query(new PipeValidacionZod(esquemaFiltroSalidas)) filtros: FiltroSalidas): Promise<Paginado<Salida>> {
    const pagina = await this.repositorioSalidas.listar({
      clienteId: filtros.clienteId,
      proyectoId: filtros.proyectoId,
      estado: filtros.estado,
      numero: filtros.numero,
      usuarioAutorizaId: filtros.usuarioAutorizaId,
      desde: filtros.desde ? new Date(filtros.desde) : undefined,
      hasta: filtros.hasta ? new Date(filtros.hasta) : undefined,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    });
    return { datos: pagina.datos, total: pagina.total, pagina: filtros.pagina, porPagina: filtros.porPagina };
  }

  /**
   * `GET /api/salidas/export?formato=pdf|xlsx&…` — el listado COMPLETO que cumple los filtros,
   * sin paginar (FR-064). Lleva el logo del cliente SOLO si se filtró por `clienteId`
   * (FR-067/US11-AS4). Va ANTES de `@Get(':id')` por el orden de resolución de Express.
   */
  @Get('export')
  @RequierePermiso('salidas.ver')
  async exportarListado(
    @Query(new PipeValidacionZod(esquemaFiltroSalidas.merge(esquemaFormatoExport)))
    filtros: FiltroSalidas & FormatoExport,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const salidas = await this.repositorioSalidas.listarTodas({
      clienteId: filtros.clienteId,
      proyectoId: filtros.proyectoId,
      estado: filtros.estado,
      numero: filtros.numero,
      usuarioAutorizaId: filtros.usuarioAutorizaId,
      desde: filtros.desde ? new Date(filtros.desde) : undefined,
      hasta: filtros.hasta ? new Date(filtros.hasta) : undefined,
    });

    const destinos = await this.resolverDestinos(salidas.map((salida) => salida.proyectoId));
    const logo = await this.resolverLogo.ejecutar({ clienteId: filtros.clienteId });
    const documento = mapearListadoSalidasADocumento(
      salidas,
      filtros,
      destinos,
      await this.nombresDeFiltro(filtros),
      logo,
    );
    return this.exportar(documento, filtros.formato, `salidas-${fechaHoyIso()}`, respuesta);
  }

  /** `GET /api/salidas/:id` — salida con sus líneas y auditoría. `404` si no existe. */
  @Get(':id')
  @RequierePermiso('salidas.ver')
  async obtener(@Param('id', ParseIntPipe) id: number): Promise<SalidaConDetalles> {
    const salida = await this.repositorioSalidas.buscarPorId(id);
    if (!salida) {
      throw new NoEncontrado('La salida');
    }
    return salida;
  }

  /**
   * `GET /api/salidas/:id/export?formato=pdf|xlsx` — el documento COMPLETO de la salida
   * (cabecera con su destino, líneas, total y auditoría — FR-065) CON el logo del cliente dueño
   * del proyecto (FR-067/FR-069). Es el archivo que se le envía al cliente como soporte de
   * entrega. `404` si no existe, igual que `obtener`.
   *
   * Nombre del archivo: `salida-<numero>.<ext>` (contrato).
   */
  @Get(':id/export')
  @RequierePermiso('salidas.ver')
  async exportarDocumento(
    @Param('id', ParseIntPipe) id: number,
    @Query(new PipeValidacionZod(esquemaFormatoExport)) filtros: FormatoExport,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const salida = await this.repositorioSalidas.buscarPorId(id);
    if (!salida) {
      throw new NoEncontrado('La salida');
    }

    const destinos = await this.resolverDestinos([salida.proyectoId]);
    const productos = await this.repositorioProductos.buscarPorIds(
      salida.detalles.map((detalle) => detalle.productoId),
    );
    const logo = await this.resolverLogo.ejecutar({ proyectoId: salida.proyectoId });

    const documento = mapearSalidaADocumento(
      salida,
      destinos.get(salida.proyectoId) ?? { cliente: '—', proyecto: `Proyecto N.º ${salida.proyectoId}` },
      new Map(productos.map((producto) => [producto.id, producto])),
      logo,
    );
    return this.exportar(documento, filtros.formato, `salida-${salida.numero}`, respuesta);
  }

  /** `POST /api/salidas` — registra la salida en PENDIENTE (FR-025/FR-026/FR-027). */
  @Post()
  @RequierePermiso('salidas.crear')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body(new PipeValidacionZod(esquemaCrearSalida)) datos: DatosCrearSalida,
    @UsuarioActual() usuario: Usuario,
  ): Promise<{ id: number; numero: number }> {
    return this.crearSalida.ejecutar({
      ...datos,
      observaciones: datos.observaciones ?? null,
      usuarioId: usuario.id,
    });
  }

  /** `PUT /api/salidas/:id` — reemplaza cabecera y líneas; solo PENDIENTE (revalida disponibilidad). */
  @Put(':id')
  @RequierePermiso('salidas.editar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaActualizarSalida)) datos: DatosActualizarSalida,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.actualizarSalida.ejecutar({
      salidaId: id,
      ...datos,
      observaciones: datos.observaciones ?? null,
      usuarioId: usuario.id,
    });
  }

  /** `POST /api/salidas/:id/confirmar` — PENDIENTE→CONFIRMADA, descuenta stock atómicamente (FR-028/029/030). */
  @Post(':id/confirmar')
  @RequierePermiso('salidas.confirmar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: Usuario): Promise<void> {
    await this.confirmarSalida.ejecutar({ salidaId: id, usuarioId: usuario.id });
  }

  /** `POST /api/salidas/:id/completar` — CONFIRMADA→COMPLETADA, cierre administrativo de entrega. */
  @Post(':id/completar')
  @RequierePermiso('salidas.completar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async completar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: Usuario): Promise<void> {
    await this.completarSalida.ejecutar({ salidaId: id, usuarioId: usuario.id });
  }

  /** `POST /api/salidas/:id/cancelar` — PENDIENTE→ANULADA con motivo, libera el compromiso. */
  @Post(':id/cancelar')
  @RequierePermiso('salidas.cancelar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancelar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaMotivo)) datos: DatosMotivo,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.cancelarSalida.ejecutar({ salidaId: id, usuarioId: usuario.id, motivo: datos.motivo ?? '' });
  }

  /** `POST /api/salidas/:id/anular` — CONFIRMADA→ANULADA con reversa de stock (FR-032). Exige `salidas.anular`. */
  @Post(':id/anular')
  @RequierePermiso('salidas.anular')
  @HttpCode(HttpStatus.NO_CONTENT)
  async anular(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaMotivo)) datos: DatosMotivo,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.anularSalida.ejecutar({ salidaId: id, usuarioId: usuario.id, motivo: datos.motivo ?? '' });
  }

  /**
   * Nombre de cliente y de proyecto de cada `proyectoId` que aparece en el export (US11) — los
   * MISMOS textos que la pantalla resuelve con `cargarClientesYProyectos`.
   *
   * Se resuelve en DOS lecturas fijas (proyectos únicos, luego sus clientes únicos), no una por
   * salida: un export sin filtrar puede traer miles de filas y casi todas comparten proyecto.
   * Un proyecto o un cliente que no se pueda resolver simplemente no entra en el mapa, y el
   * mapeador cae en el texto de respaldo que ya usa la pantalla.
   */
  private async resolverDestinos(proyectoIds: readonly number[]): Promise<Map<number, DestinoSalida>> {
    const idsUnicos = [...new Set(proyectoIds)];
    if (idsUnicos.length === 0) return new Map();

    const proyectos = (await Promise.all(idsUnicos.map((id) => this.repositorioProyectos.buscarPorId(id)))).filter(
      (proyecto): proyecto is NonNullable<typeof proyecto> => proyecto !== null,
    );
    const clientesUnicos = [...new Set(proyectos.map((proyecto) => proyecto.clienteId))];
    const clientes = (await Promise.all(clientesUnicos.map((id) => this.repositorioClientes.buscarPorId(id)))).filter(
      (cliente): cliente is NonNullable<typeof cliente> => cliente !== null,
    );
    const nombrePorClienteId = new Map(clientes.map((cliente) => [cliente.id, cliente.nombre]));

    return new Map(
      proyectos.map((proyecto) => [
        proyecto.id,
        { cliente: nombrePorClienteId.get(proyecto.clienteId) ?? '—', proyecto: proyecto.nombre },
      ]),
    );
  }

  /** Nombres de los filtros de cliente/proyecto para el encabezado del archivo — sin ellos, la
   *  línea de filtros del PDF diría "Cliente: 3", que no le dice nada a quien lo recibe. */
  private async nombresDeFiltro(filtros: FiltroSalidas): Promise<{ cliente?: string; proyecto?: string }> {
    const [cliente, proyecto] = await Promise.all([
      filtros.clienteId === undefined ? null : this.repositorioClientes.buscarPorId(filtros.clienteId),
      filtros.proyectoId === undefined ? null : this.repositorioProyectos.buscarPorId(filtros.proyectoId),
    ]);
    return { cliente: cliente?.nombre, proyecto: proyecto?.nombre };
  }

  /** Elige la estrategia por `formato` y fija los headers de descarga — plomería compartida con
   *  los controladores de reportes e ingresos (`comunes/respuesta-export.ts`). */
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
