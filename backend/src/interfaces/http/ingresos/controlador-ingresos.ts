/**
 * Controlador `ControladorIngresos` — endpoints de `/api/ingresos`
 * (contracts/api-rest.md § Ingresos). Traduce HTTP ↔ casos de uso / lectura de
 * `RepositorioIngresos`; cero reglas de negocio.
 *
 * Lectura (`listar`/`obtener`) inyecta el puerto `RepositorioIngresos` DIRECTAMENTE — sin
 * caso de uso intermedio — porque no hay regla de negocio que aplicar antes de leer (mismo
 * patrón que `ControladorAuth` con `RepositorioUsuarios`, docs/arquitectura.md). `obtener`
 * traduce el `null` del repositorio a `NoEncontrado` (el filtro global lo convierte en
 * `404`) porque el puerto expresa "no existe" como valor, no como excepción.
 *
 * `anular` recibe `{motivo}` validado con el `esquemaMotivo` compartido (solo garantiza que,
 * si llega, sea texto — T088: un `motivo` no-string sin pipe producía un `500` en vez de un
 * `400`); el requisito de que NO esté vacío sigue viviendo en `AnularIngresoCasoUso`, que ya
 * lo valida con `ErrorValidacionDominio` (400).
 *
 * Autorización (T103): un permiso por transición (`ingresos.recibir`, `verificar`, `anular`)
 * además de `ver`/`crear`/`editar`, en vez de un `ingresos.operar` único — `verificar` y
 * `anular` son precisamente las dos que los tres roles del sistema NO comparten, y tenerlas
 * separadas es lo que permite un rol de bodega que reciba mercancía sin poder verificarla ni
 * anularla, sin tocar código (FR-055, research R16).
 *
 * ## Exportación (US11/T120/T121, FR-064/FR-065)
 *
 * `GET /export` (listado) y `GET /:id/export` (documento individual) siguen el criterio SC-007
 * ya establecido para reportes: MISMO esquema de filtros que la ruta hermana de datos
 * (`esquemaFiltroIngresos`, mergeado con `esquemaFormatoExport`) y la MISMA lectura del
 * repositorio, más un mapeo puro y la estrategia de exportación. Dos precisiones propias de
 * esta historia:
 *
 * - El listado exportado usa `listarTodos` en vez de `listar`: trae TODAS las filas que cumplen
 *   el filtro, no la página visible (FR-064 — la paginación es una comodidad de lectura, no un
 *   recorte de los datos). Por eso `pagina`/`porPagina` llegan validadas y se IGNORAN: se
 *   conserva el mismo esquema para que los filtros no puedan divergir entre pantalla y archivo.
 * - Ninguno de los dos lleva logo: un ingreso es una compra a un PROVEEDOR, no tiene cliente al
 *   que corresponda (FR-067, US11-AS4).
 *
 * Ambas rutas exigen `ingresos.ver`, el MISMO permiso que el listado y el detalle que exportan
 * (contrato: A,G,O). No se crea un `ingresos.exportar`: a diferencia de los reportes —donde
 * `reportes.ver`/`reportes.exportar` ya existían separados desde T103— aquí el contrato no
 * declara un permiso nuevo y ningún rol distinguiría las dos capacidades, así que sería una
 * casilla más en el catálogo sin nadie que la use (Principio V).
 *
 * `@Get('export')` se declara ANTES que `@Get(':id')` a propósito: Express resuelve por orden
 * de registro, y con `:id` primero la ruta `/api/ingresos/export` entraría por ahí y moriría en
 * `ParseIntPipe` con un `400`.
 *
 * Implementa: FR-013…FR-019 (registro, edición y las tres transiciones de estado de la
 * máquina de `entidades/ingreso.ts`), FR-064/FR-065 (exportación del listado y del documento),
 * FR-045 (auditoría: `usuarioId` siempre del token, nunca del body) y FR-058 (autorización
 * contra el permiso efectivo del rol, resuelto en el servidor en cada petición).
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
  esquemaActualizarIngreso,
  esquemaCrearIngreso,
  esquemaFiltroIngresos,
  esquemaFormatoExport,
  esquemaMotivo,
  type DatosActualizarIngreso,
  type DatosCrearIngreso,
  type DatosMotivo,
  type FiltroIngresos,
  type FormatoExport,
  type Paginado,
} from '@trazo/compartido';
import type { Response } from 'express';
import { ActualizarIngresoCasoUso } from '../../../aplicacion/ingresos/actualizar-ingreso.caso-uso';
import { AnularIngresoCasoUso } from '../../../aplicacion/ingresos/anular-ingreso.caso-uso';
import { CrearIngresoCasoUso } from '../../../aplicacion/ingresos/crear-ingreso.caso-uso';
import { RecibirIngresoCasoUso } from '../../../aplicacion/ingresos/recibir-ingreso.caso-uso';
import { VerificarIngresoCasoUso } from '../../../aplicacion/ingresos/verificar-ingreso.caso-uso';
import type { ExportadorReporte } from '../../../aplicacion/reportes/puertos/exportador-reporte';
import { NoEncontrado } from '../../../dominio/comunes/errores';
import type { Usuario } from '../../../dominio/entidades/usuario';
import type { Ingreso } from '../../../dominio/entidades/ingreso';
import {
  REPOSITORIO_INGRESOS,
  type IngresoConDetalles,
  type RepositorioIngresos,
} from '../../../dominio/puertos/repositorio-ingresos';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../../dominio/puertos/repositorio-productos';
import {
  REPOSITORIO_PROVEEDORES,
  type RepositorioProveedores,
} from '../../../dominio/puertos/repositorio-proveedores';
import { EXPORTADOR_EXCEL, EXPORTADOR_PDF } from '../../../infraestructura/exportacion/exportacion.module';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { fechaHoyIso, responderConArchivoExportado } from '../comunes/respuesta-export';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';
import { mapearIngresoADocumento, mapearListadoIngresosADocumento } from './mapeadores-documento-ingreso';

@Controller('ingresos')
export class ControladorIngresos {
  constructor(
    @Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos,
    private readonly crearIngreso: CrearIngresoCasoUso,
    private readonly actualizarIngreso: ActualizarIngresoCasoUso,
    private readonly recibirIngreso: RecibirIngresoCasoUso,
    private readonly verificarIngreso: VerificarIngresoCasoUso,
    private readonly anularIngreso: AnularIngresoCasoUso,
    /** Solo para resolver `SKU — descripción` de las líneas del documento exportado (US11) —
     *  mismo dato que la pantalla de detalle muestra con `GET /api/productos`. */
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    /** Solo para escribir el NOMBRE del proveedor en la línea de filtros del listado exportado
     *  (US15): el filtro viaja como id desde FR-091, y un encabezado que dijera "Proveedor: 7"
     *  no le serviría a quien abre el archivo. Mismo motivo que `repositorioProductos`. */
    @Inject(REPOSITORIO_PROVEEDORES) private readonly repositorioProveedores: RepositorioProveedores,
    @Inject(EXPORTADOR_EXCEL) private readonly exportadorExcel: ExportadorReporte,
    @Inject(EXPORTADOR_PDF) private readonly exportadorPdf: ExportadorReporte,
  ) {}

  /** `GET /api/ingresos` — página de cabeceras con filtros de búsqueda/estado/fechas y, desde
   *  US13, de proveedor (FR-018/FR-075), que US15 convirtió en una selección del catálogo. */
  @Get()
  @RequierePermiso('ingresos.ver')
  async listar(
    @Query(new PipeValidacionZod(esquemaFiltroIngresos)) filtros: FiltroIngresos,
  ): Promise<Paginado<Ingreso>> {
    const pagina = await this.repositorioIngresos.listar({
      buscar: filtros.buscar,
      proveedorId: filtros.proveedorId,
      tipo: filtros.tipo,
      estado: filtros.estado,
      desde: filtros.desde ? new Date(filtros.desde) : undefined,
      hasta: filtros.hasta ? new Date(filtros.hasta) : undefined,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    });
    return { datos: pagina.datos, total: pagina.total, pagina: filtros.pagina, porPagina: filtros.porPagina };
  }

  /**
   * `GET /api/ingresos/export?formato=pdf|xlsx&…` — el listado COMPLETO que cumple los filtros,
   * sin paginar (FR-064). MISMO esquema de filtros que `listar` (SC-007); `pagina`/`porPagina`
   * se ignoran a propósito (ver TSDoc de la clase).
   *
   * Va ANTES de `@Get(':id')`: con `:id` declarado primero, Express haría entrar `/export` por
   * esa ruta.
   */
  @Get('export')
  @RequierePermiso('ingresos.ver')
  async exportarListado(
    @Query(new PipeValidacionZod(esquemaFiltroIngresos.merge(esquemaFormatoExport)))
    filtros: FiltroIngresos & FormatoExport,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const ingresos = await this.repositorioIngresos.listarTodos({
      buscar: filtros.buscar,
      proveedorId: filtros.proveedorId,
      tipo: filtros.tipo,
      estado: filtros.estado,
      desde: filtros.desde ? new Date(filtros.desde) : undefined,
      hasta: filtros.hasta ? new Date(filtros.hasta) : undefined,
    });
    const proveedorFiltrado = filtros.proveedorId
      ? await this.repositorioProveedores.buscarPorId(filtros.proveedorId)
      : null;
    const documento = mapearListadoIngresosADocumento(ingresos, filtros, proveedorFiltrado?.nombre);
    return this.exportar(documento, filtros.formato, `ingresos-${fechaHoyIso()}`, respuesta);
  }

  /** `GET /api/ingresos/:id` — ingreso con sus líneas. `404` si no existe. */
  @Get(':id')
  @RequierePermiso('ingresos.ver')
  async obtener(@Param('id', ParseIntPipe) id: number): Promise<IngresoConDetalles> {
    const ingreso = await this.repositorioIngresos.buscarPorId(id);
    if (!ingreso) {
      throw new NoEncontrado('El ingreso');
    }
    return ingreso;
  }

  /**
   * `GET /api/ingresos/:id/export?formato=pdf|xlsx` — el documento COMPLETO del ingreso
   * (cabecera, líneas, total y auditoría — FR-065). `404` si no existe, igual que `obtener`.
   *
   * Nombre del archivo: `ingreso-<numeroFactura>.<ext>` (contrato) — el número de factura
   * identifica el documento mejor que la fecha de descarga.
   */
  @Get(':id/export')
  @RequierePermiso('ingresos.ver')
  async exportarDocumento(
    @Param('id', ParseIntPipe) id: number,
    @Query(new PipeValidacionZod(esquemaFormatoExport)) filtros: FormatoExport,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const ingreso = await this.repositorioIngresos.buscarPorId(id);
    if (!ingreso) {
      throw new NoEncontrado('El ingreso');
    }
    const productos = await this.repositorioProductos.buscarPorIds(
      ingreso.detalles.map((detalle) => detalle.productoId),
    );
    const documento = mapearIngresoADocumento(ingreso, new Map(productos.map((p) => [p.id, p])));
    return this.exportar(documento, filtros.formato, `ingreso-${ingreso.numeroFactura}`, respuesta);
  }

  /** `POST /api/ingresos` — registra la factura en PENDIENTE (FR-013/FR-014/FR-015). */
  @Post()
  @RequierePermiso('ingresos.crear')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body(new PipeValidacionZod(esquemaCrearIngreso)) datos: DatosCrearIngreso,
    @UsuarioActual() usuario: Usuario,
  ): Promise<{ id: number }> {
    return this.crearIngreso.ejecutar({
      ...datos,
      observaciones: datos.observaciones ?? null,
      usuarioId: usuario.id,
    });
  }

  /** `PUT /api/ingresos/:id` — reemplaza cabecera y líneas; solo PENDIENTE (US1-AS5). */
  @Put(':id')
  @RequierePermiso('ingresos.editar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaActualizarIngreso)) datos: DatosActualizarIngreso,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.actualizarIngreso.ejecutar({
      ingresoId: id,
      ...datos,
      observaciones: datos.observaciones ?? null,
      usuarioId: usuario.id,
    });
  }

  /** `POST /api/ingresos/:id/recibir` — PENDIENTE→RECIBIDO, sube stock atómicamente (FR-017/FR-021). */
  @Post(':id/recibir')
  @RequierePermiso('ingresos.recibir')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recibir(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: Usuario): Promise<void> {
    await this.recibirIngreso.ejecutar({ ingresoId: id, usuarioId: usuario.id });
  }

  /** `POST /api/ingresos/:id/verificar` — RECIBIDO→VERIFICADO. Exige `ingresos.verificar`. */
  @Post(':id/verificar')
  @RequierePermiso('ingresos.verificar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verificar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: Usuario): Promise<void> {
    await this.verificarIngreso.ejecutar({ ingresoId: id, usuarioId: usuario.id });
  }

  /** `POST /api/ingresos/:id/anular` — PENDIENTE|RECIBIDO→ANULADO con motivo (FR-019). Exige `ingresos.anular`. */
  @Post(':id/anular')
  @RequierePermiso('ingresos.anular')
  @HttpCode(HttpStatus.NO_CONTENT)
  async anular(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaMotivo)) datos: DatosMotivo,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.anularIngreso.ejecutar({ ingresoId: id, usuarioId: usuario.id, motivo: datos.motivo ?? '' });
  }

  /** Elige la estrategia por `formato` y fija los headers de descarga — plomería compartida con
   *  los controladores de reportes y salidas (`comunes/respuesta-export.ts`). */
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
