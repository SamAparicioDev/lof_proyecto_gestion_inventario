/**
 * Controlador `ControladorProductos` — endpoints de `/api/productos`
 * (contracts/api-rest.md § Productos). Traduce HTTP ↔ casos de uso; cero reglas de negocio.
 *
 * `listar` se agregó en T035 (frontend de ingresos) como catálogo simple {id, sku,
 * descripcion} sin paginar, para poblar el `<select>` de líneas de un formulario. T052 lo
 * extendió con `ultimoCosto`/`disponible` (formulario de salidas, FR-020/FR-028): ese
 * cálculo YA es una regla de negocio (agrega `RepositorioSalidas.comprometidoPorProducto`),
 * así que vive en `ListarResumenProductosCasoUso` — este controlador solo delega, no orquesta
 * los dos repositorios directamente (docs/arquitectura.md, controladores delgados).
 *
 * `PUT /:id` y `PUT /:id/estado` se agregan en esta tanda (US5 — T060), ahora que existe la
 * ficha de producto que los consume (FR-010/FR-012). Ambos delegan en métodos del
 * repositorio que YA EXISTEN desde US1 (`actualizar`/`cambiarEstado`) — los casos de uso
 * nuevos (`ActualizarProductoCasoUso`/`CambiarEstadoProductoCasoUso`) solo traducen la
 * entrada, sin regla de negocio adicional.
 *
 * `plantillaImportacion`/`importar` se agregan en T095 (US8, carga masiva de inventario):
 * - `plantillaImportacion` llama DIRECTO a `generarPlantillaProductos` (infraestructura) sin
 *   pasar por un caso de uso ni un puerto — es una función PURA sin estado ni reglas de
 *   negocio (solo arma un `.xlsx` fijo), así que un puerto sería complejidad especulativa
 *   (Principio V, YAGNI). Esto es válido porque `interfaces/http` SÍ puede importar
 *   `infraestructura` (a diferencia de `aplicacion` — ver `backend/eslint.config.mjs`); mismo
 *   criterio que este controlador usando `EXPORTADOR_EXCEL`/`EXPORTADOR_PDF` en
 *   `controlador-reportes.ts`.
 * - `importar` sí delega en `ImportarProductosCasoUso` (aplicación) porque procesar el
 *   archivo SÍ es una regla de negocio (decide crear/actualizar, agrupa el `Ingreso`
 *   sintético). El límite de tamaño (5 MB) es una restricción de TRANSPORTE HTTP (multipart),
 *   no de negocio, así que se aplica ANTES de invocar el caso de uso — y ANTES incluso de que
 *   el archivo termine de subirse: vive en `limits.fileSize` de `FileInterceptor` (Multer
 *   corta el stream al superar el límite, no bufferiza el archivo completo primero) con
 *   `FiltroArchivoDemasiadoGrande` normalizando el `PayloadTooLargeException` resultante al
 *   `400` del contrato (ver TSDoc de `importar`). El límite de 2.000 filas de datos se valida
 *   dentro del caso de uso, que ya tiene el archivo parseado sin necesitar un segundo parseo
 *   aquí.
 *
 * `catalogoImportacion` se agrega en T112 (Phase 13, FR-053): mismo criterio que
 * `plantillaImportacion` para el `.xlsx` (llamada directa a `infraestructura/importacion`, sin
 * puerto), y mismo criterio que `ControladorClientes`/`ControladorIngresos` para los datos —
 * inyecta `REPOSITORIO_PRODUCTOS` DIRECTAMENTE, sin caso de uso intermedio, porque no hay
 * ninguna regla de negocio que aplicar antes de leer: es `listarTodos()` tal cual (el método
 * que US7 ya creó para el reporte de inventario), volcado a filas de Excel. Un caso de uso que
 * solo reenviara la llamada sería una capa vacía (Principio V, YAGNI).
 *
 * Autorización (T103): `productos.ver`/`crear`/`editar`/`cambiar_estado` van una por
 * operación, pero los TRES endpoints de carga masiva comparten `productos.importar` — la
 * plantilla vacía y el catálogo descargable existen únicamente para alimentar el `POST`, así
 * que conceder uno sin los otros no describe ninguna capacidad real que alguien quisiera
 * otorgar (criterio de granularidad de T100: un permiso por OPERACIÓN de negocio, no por ruta).
 *
 * Implementa: FR-010 (alta/edición de producto), FR-011 (alta rápida — mismo endpoint de
 * creación sirve al dialog de "alta rápida" desde el formulario de ingresos), FR-012 (baja
 * lógica vía `PUT /:id/estado`, nunca `DELETE`), FR-048…FR-051 (carga masiva de inventario),
 * FR-053 (descarga del catálogo actual en formato de plantilla) y FR-058 (autorización contra
 * el permiso efectivo del rol, resuelto en el servidor en cada petición).
 */
import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  type ExceptionFilter,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  esquemaActualizarProducto,
  esquemaCambiarEstadoProducto,
  esquemaCrearProducto,
  esquemaListarProductos,
  type DatosActualizarProducto,
  type DatosCambiarEstadoProducto,
  type DatosCrearProducto,
  type FiltroProductos,
  type ProductoResumen,
} from '@trazo/compartido';
import { ActualizarProductoCasoUso } from '../../../aplicacion/productos/actualizar-producto.caso-uso';
import { CambiarEstadoProductoCasoUso } from '../../../aplicacion/productos/cambiar-estado-producto.caso-uso';
import { CrearProductoCasoUso } from '../../../aplicacion/productos/crear-producto.caso-uso';
import { ImportarProductosCasoUso, type ResumenImportacion } from '../../../aplicacion/productos/importar-productos.caso-uso';
import { ListarResumenProductosCasoUso } from '../../../aplicacion/productos/listar-resumen-productos.caso-uso';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { ErrorValidacionDominio } from '../../../dominio/comunes/errores';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../../dominio/puertos/repositorio-productos';
import {
  generarCatalogoProductos,
  generarPlantillaProductos,
} from '../../../infraestructura/importacion/generar-plantilla-productos';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';

/** Tamaño máximo del archivo de carga masiva (spec.md § Assumptions, US8). */
const TAMANIO_MAXIMO_ARCHIVO_IMPORTACION_BYTES = 5 * 1024 * 1024;

/** `Content-Type` de los dos `.xlsx` descargables de carga masiva (contracts/api-rest.md). */
const CONTENT_TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Traduce el `PayloadTooLargeException` que Multer/Nest generan cuando `FileInterceptor`
 * corta el stream de subida al superar `limits.fileSize` (ver TSDoc de `importar`) al MISMO
 * formato `400 { error: { mensaje, campos } }` que el resto de errores de esta ruta —
 * `PayloadTooLargeException` es una `HttpException` cuyo cuerpo por defecto (`{ statusCode,
 * message, error: 'Payload Too Large' }`) NO coincide con el contrato, así que no puede
 * dejarse caer en `FiltroErroresDominio` global sin normalizar antes. Se registra SOLO en
 * `importar` (`@UseFilters`, ámbito de método) para no tocar el filtro global usado por el
 * resto de la API.
 */
@Catch(PayloadTooLargeException)
class FiltroArchivoDemasiadoGrande implements ExceptionFilter {
  catch(_excepcion: PayloadTooLargeException, host: ArgumentsHost): void {
    const respuesta = host.switchToHttp().getResponse<Response>();
    respuesta.status(HttpStatus.BAD_REQUEST).json({
      error: { mensaje: 'El archivo supera el tamaño máximo permitido de 5 MB.', campos: null },
    });
  }
}

@Controller('productos')
export class ControladorProductos {
  constructor(
    private readonly crearProducto: CrearProductoCasoUso,
    private readonly listarResumenProductos: ListarResumenProductosCasoUso,
    private readonly actualizarProducto: ActualizarProductoCasoUso,
    private readonly cambiarEstadoProducto: CambiarEstadoProductoCasoUso,
    private readonly importarProductos: ImportarProductosCasoUso,
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
  ) {}

  /**
   * `GET /api/productos?buscar=` — catálogo simple {id, sku, descripcion, ultimoCosto,
   * disponible} sin paginar, para poblar selectores (T035/T052). Ver TSDoc de la clase.
   */
  @Get()
  @RequierePermiso('productos.ver')
  async listar(
    @Query(new PipeValidacionZod(esquemaListarProductos)) filtros: FiltroProductos,
  ): Promise<ProductoResumen[]> {
    return this.listarResumenProductos.ejecutar({ buscar: filtros.buscar });
  }

  /** `POST /api/productos` — alta rápida de producto (FR-010/FR-011). */
  @Post()
  @RequierePermiso('productos.crear')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body(new PipeValidacionZod(esquemaCrearProducto)) datos: DatosCrearProducto,
    @UsuarioActual() usuario: Usuario,
  ): Promise<{ id: number }> {
    return this.crearProducto.ejecutar({
      sku: datos.sku,
      descripcion: datos.descripcion,
      categoriaId: datos.categoriaId ?? null,
      unidadMedidaId: datos.unidadMedidaId,
      ubicacion: datos.ubicacion ?? null,
      umbralStockBajo: datos.umbralStockBajo,
      usuarioId: usuario.id,
    });
  }

  /**
   * `PUT /api/productos/:id` — edición de descripción/categoría/ubicación/umbral de stock bajo
   * (FR-010) y, desde US12, del COSTO (FR-071).
   *
   * `ultimoCosto` viaja OPCIONAL: si el cuerpo no lo trae, el costo queda intacto; si lo trae
   * y difiere del vigente, se actualiza y se registra el cambio con `origen: EDICION_MANUAL`
   * en la misma transacción (FR-072). El controlador no decide nada de eso —lo hace el caso de
   * uso sobre el dominio—; aquí solo se reenvía tal cual, incluido el `undefined`, que es
   * información (significa "no lo toques") y no un valor a normalizar como se hace con
   * `categoria`/`ubicacion` (donde `null` sí es un valor legítimo: "sin categoría").
   */
  @Put(':id')
  @RequierePermiso('productos.editar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaActualizarProducto)) datos: DatosActualizarProducto,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.actualizarProducto.ejecutar({
      productoId: id,
      descripcion: datos.descripcion,
      categoriaId: datos.categoriaId ?? null,
      unidadMedidaId: datos.unidadMedidaId,
      ubicacion: datos.ubicacion ?? null,
      umbralStockBajo: datos.umbralStockBajo,
      ultimoCosto: datos.ultimoCosto,
      usuarioId: usuario.id,
    });
  }

  /** `PUT /api/productos/:id/estado` — baja/alta lógica de un producto, nunca DELETE (FR-012). */
  @Put(':id/estado')
  @RequierePermiso('productos.cambiar_estado')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaCambiarEstadoProducto)) datos: DatosCambiarEstadoProducto,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.cambiarEstadoProducto.ejecutar({ productoId: id, estado: datos.estado, usuarioId: usuario.id });
  }

  /** `GET /api/productos/plantilla-importacion` — plantilla `.xlsx` VACÍA de carga masiva
   *  (FR-048): para dar de alta productos que todavía no existen. */
  @Get('plantilla-importacion')
  @RequierePermiso('productos.importar')
  @Header('Content-Type', CONTENT_TYPE_XLSX)
  @Header('Content-Disposition', 'attachment; filename="plantilla-inventario.xlsx"')
  async plantillaImportacion(): Promise<StreamableFile> {
    const buffer = await generarPlantillaProductos();
    return new StreamableFile(buffer);
  }

  /**
   * `GET /api/productos/catalogo-importacion` — el catálogo ACTUAL en la MISMA estructura de
   * columnas que la plantilla, una fila por producto existente (FR-053): se descarga, se edita
   * en Excel y se vuelve a subir por `POST /api/productos/importar`, que ya actualiza por SKU
   * sin duplicar (FR-049) — el flujo de subida no cambia en nada por esta ruta.
   *
   * CRÍTICO: las columnas "Cantidad inicial" y "Valor unitario" viajan VACÍAS. No es un
   * descuido ni una simplificación: esas columnas son un INGRESO de mercancía, no una foto del
   * stock. Si llevaran el `stockActual` de cada producto, volver a subir el archivo —que es
   * exactamente para lo que se descarga— lo SUMARÍA otra vez al inventario, duplicándolo. La
   * garantía es de tipos, no de disciplina: `generarCatalogoProductos` recibe
   * `FilaCatalogoImportacion`, que no tiene ningún campo de stock ni de costo donde meterlo
   * (ver `infraestructura/importacion/generar-plantilla-productos.ts`).
   *
   * `listarTodos()` sin filtros = TODOS los productos, incluidos los INACTIVOS: siguen siendo
   * parte del catálogo (FR-012 es baja lógica, nunca DELETE) y volver a subirlos actualiza sus
   * datos sin reactivarlos (`ImportarProductosCasoUso` no toca `estado`).
   *
   * Límite conocido (no cubierto por FR-053 ni por el contrato, anotado para quien lo alcance):
   * la descarga no pagina, así que un catálogo de más de 2.000 productos genera un archivo que
   * `ImportarProductosCasoUso` rechazaría entero al volver a subirlo (`LIMITE_FILAS_IMPORTACION`,
   * spec.md § Assumptions). Hoy el catálogo real está en decenas de productos; resolverlo antes
   * de que sea un problema sería especulativo (Principio V), pero exige decisión de producto
   * —¿partir el archivo?, ¿subir el límite?— y no una corrección silenciosa aquí.
   *
   * Los headers se fijan con `@Res({ passthrough: true })` en vez de `@Header(...)` porque el
   * nombre del archivo lleva la fecha de la descarga (patrón `<nombre>-<fecha>.<ext>` del
   * contrato, mismo criterio que `controlador-reportes.ts#exportar`) y `@Header` es estático.
   */
  @Get('catalogo-importacion')
  @RequierePermiso('productos.importar')
  async catalogoImportacion(@Res({ passthrough: true }) respuesta: Response): Promise<StreamableFile> {
    const productos = await this.repositorioProductos.listarTodos();
    const buffer = await generarCatalogoProductos(productos);
    respuesta.set({
      'Content-Type': CONTENT_TYPE_XLSX,
      'Content-Disposition': `attachment; filename="catalogo-inventario-${fechaHoyIso()}.xlsx"`,
    });
    return new StreamableFile(buffer);
  }

  /**
   * `POST /api/productos/importar` — sube un archivo de carga masiva de inventario y devuelve
   * el `ResumenImportacion` (FR-048…FR-051). El tamaño máximo (5 MB) se aplica a nivel de
   * MULTER (`FileInterceptor('archivo', { limits: { fileSize } })`), no como comparación
   * manual posterior: `limits.fileSize` hace que Multer/Busboy corten el stream de subida en
   * cuanto se supera el límite, en vez de bufferizar el archivo completo en memoria antes de
   * rechazarlo (antes de esto, un archivo de cientos de MB se recibía entero en RAM — hallazgo
   * HIGH de la revisión adversarial de esta tanda — porque el chequeo de `archivo.size` corría
   * DESPUÉS de que `@UploadedFile()` ya entregaba el `Buffer` completo). Multer traduce ese
   * corte en un `PayloadTooLargeException` (ver `@nestjs/platform-express` `transformException`),
   * que `FiltroArchivoDemasiadoGrande` normaliza al mismo `400 { error: { mensaje, campos } }`
   * que antes devolvía el chequeo manual — el contrato (`400`, mismo mensaje) no cambia, solo
   * el momento en que se rechaza. Un archivo ausente se sigue rechazando con
   * `ErrorValidacionDominio` (400), sin tocar ningún producto (US8-AS5).
   */
  @Post('importar')
  @RequierePermiso('productos.importar')
  @HttpCode(HttpStatus.OK)
  @UseFilters(FiltroArchivoDemasiadoGrande)
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: TAMANIO_MAXIMO_ARCHIVO_IMPORTACION_BYTES } }))
  async importar(
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @UsuarioActual() usuario: Usuario,
  ): Promise<ResumenImportacion> {
    if (!archivo) {
      throw new ErrorValidacionDominio('Debes adjuntar un archivo Excel (.xlsx) para la carga masiva.');
    }
    return this.importarProductos.ejecutar({ archivo: archivo.buffer, usuarioId: usuario.id });
  }
}

/** Fecha de hoy en texto `AAAA-MM-DD` para el nombre del archivo descargado
 *  (contracts/api-rest.md: patrón `<nombre>-<fecha>.<ext>`). Mismo criterio y mismo cuerpo que
 *  `controlador-reportes.ts#fechaHoyIso`, reproducido aquí en vez de compartido: es un detalle
 *  del nombre de archivo de CADA controlador, no una regla de negocio (`export.spec.ts` ya lo
 *  reproduce con la misma nota). */
function fechaHoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}
