/**
 * Controlador de `/api/solicitudes` — el buzón del super administrador (US36, FR-148…FR-157).
 * Contrato en `specs/001-gestion-inventarios/contracts/api-rest.md`.
 *
 * `@SoloSuperAdmin()` va en la CLASE y no endpoint por endpoint: aquí no hay grados —los seis
 * exigen exactamente lo mismo—, y repetirlo seis veces solo crearía la posibilidad de que a un
 * séptimo se le olvide (FR-148).
 *
 * Delgado como todos: valida con Zod en la frontera, traduce a la entrada del caso de uso y mapea
 * la entidad a la forma del contrato. Ninguna regla de negocio vive aquí.
 *
 * Implementa: FR-148 (exclusivo del super administrador), FR-149, FR-150, FR-152, FR-153,
 * FR-154, FR-155 y FR-157.
 */
import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import {
  esquemaActualizarSolicitud,
  esquemaCambiarEstadoSolicitud,
  esquemaCrearSolicitud,
  esquemaFiltrosSolicitudes,
  type DatosActualizarSolicitud,
  type DatosCambiarEstadoSolicitud,
  type DatosCrearSolicitud,
  type FiltrosSolicitudes,
  type PaginaSolicitudes,
  type ResultadoRefinado as ResultadoRefinadoApi,
  type Solicitud as SolicitudApi,
} from '@trazo/compartido';
import { RefinarSolicitudCasoUso } from '../../../aplicacion/solicitudes/refinar-solicitud.caso-uso';
import {
  ActualizarSolicitudCasoUso,
  CambiarEstadoSolicitudCasoUso,
  CrearSolicitudCasoUso,
  ListarSolicitudesCasoUso,
  VerSolicitudCasoUso,
} from '../../../aplicacion/solicitudes/solicitudes.caso-uso';
import type { SolicitudFuncionalidad } from '../../../dominio/entidades/solicitud-funcionalidad';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { SoloSuperAdmin } from '../comunes/solo-super-admin.decorator';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';

@Controller('solicitudes')
@SoloSuperAdmin()
export class ControladorSolicitudes {
  constructor(
    private readonly crear: CrearSolicitudCasoUso,
    private readonly listar: ListarSolicitudesCasoUso,
    private readonly ver: VerSolicitudCasoUso,
    private readonly actualizar: ActualizarSolicitudCasoUso,
    private readonly cambiarEstado: CambiarEstadoSolicitudCasoUso,
    private readonly refinar: RefinarSolicitudCasoUso,
  ) {}

  /** `GET /api/solicitudes` — el buzón paginado, filtrable por estado (FR-157). */
  @Get()
  async listarTodas(
    @Query(new PipeValidacionZod(esquemaFiltrosSolicitudes)) filtros: FiltrosSolicitudes,
  ): Promise<PaginaSolicitudes> {
    const pagina = await this.listar.ejecutar({
      estado: filtros.estado,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    });
    return {
      datos: pagina.datos.map(aSolicitudApi),
      total: pagina.total,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
      pendientes: pagina.pendientes,
    };
  }

  /** `POST /api/solicitudes` — alta con texto libre; nace PENDIENTE (FR-149, FR-150). */
  @Post()
  async crearSolicitud(
    @UsuarioActual() usuario: Usuario,
    @Body(new PipeValidacionZod(esquemaCrearSolicitud)) datos: DatosCrearSolicitud,
  ): Promise<SolicitudApi> {
    const solicitud = await this.crear.ejecutar({
      titulo: datos.titulo,
      descripcion: datos.descripcion,
      usuarioId: usuario.id,
    });
    return aSolicitudApi(solicitud);
  }

  /** `GET /api/solicitudes/:id`. */
  @Get(':id')
  async verSolicitud(@Param('id', ParseIntPipe) id: number): Promise<SolicitudApi> {
    return aSolicitudApi(await this.ver.ejecutar(id));
  }

  /**
   * `PATCH /api/solicitudes/:id` — edita título y descripción.
   *
   * El esquema no admite `promptRefinado`, así que el pipe lo descarta antes de llegar aquí: la
   * garantía de FR-152 es estructural, no una comprobación que alguien deba recordar hacer.
   */
  @Patch(':id')
  async actualizarSolicitud(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaActualizarSolicitud)) datos: DatosActualizarSolicitud,
  ): Promise<SolicitudApi> {
    const solicitud = await this.actualizar.ejecutar({
      id,
      titulo: datos.titulo,
      descripcion: datos.descripcion,
    });
    return aSolicitudApi(solicitud);
  }

  /** `PATCH /api/solicitudes/:id/estado` — con su auditoría (FR-154). */
  @Patch(':id/estado')
  async cambiar(
    @UsuarioActual() usuario: Usuario,
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaCambiarEstadoSolicitud)) datos: DatosCambiarEstadoSolicitud,
  ): Promise<SolicitudApi> {
    const solicitud = await this.cambiarEstado.ejecutar({
      id,
      estado: datos.estado,
      usuarioId: usuario.id,
    });
    return aSolicitudApi(solicitud);
  }

  /**
   * `POST /api/solicitudes/:id/refinar` — genera y GUARDA el prompt (FR-151, FR-153).
   *
   * Responde `200` incluso cuando el modelo no está: `disponible: false` con su aviso en español
   * no es un error de esta API (FR-155). La solicitud existe y se leyó bien; lo que faltó fue un
   * servicio de terceros, y devolver `500` haría que la pantalla dijera "algo salió mal" cuando
   * lo correcto es decir qué pasó y quién puede arreglarlo.
   *
   * `@HttpCode(200)` es obligatorio: NestJS responde 201 por defecto a todo `@Post`, y aquí no se
   * CREA ningún recurso —se actualiza el prompt de una solicitud que ya existía—. El contrato dice
   * 200 y la prueba de integración lo cazó respondiendo 201.
   */
  @Post(':id/refinar')
  @HttpCode(200)
  async refinarSolicitud(@Param('id', ParseIntPipe) id: number): Promise<ResultadoRefinadoApi> {
    const resultado = await this.refinar.ejecutar({ id });
    return {
      prompt: resultado.prompt,
      generadoEn: resultado.generadoEn ? resultado.generadoEn.toISOString() : null,
      disponible: resultado.disponible,
      aviso: resultado.aviso,
    };
  }
}

/**
 * Entidad del dominio → forma del contrato. Los ids salen como texto, igual que en el resto de la
 * API, y las fechas en ISO.
 */
function aSolicitudApi(solicitud: SolicitudFuncionalidad): SolicitudApi {
  return {
    id: String(solicitud.id),
    titulo: solicitud.titulo,
    descripcion: solicitud.descripcion,
    promptRefinado: solicitud.promptRefinado,
    refinadoEn: solicitud.refinadoEn ? solicitud.refinadoEn.toISOString() : null,
    estado: solicitud.estado,
    creadaPor: {
      id: String(solicitud.creadaPor.id),
      nombreCompleto: solicitud.creadaPor.nombreCompleto,
    },
    creadaEn: solicitud.creadaEn.toISOString(),
    estadoCambiadoPor: solicitud.estadoCambiadoPor
      ? {
          id: String(solicitud.estadoCambiadoPor.id),
          nombreCompleto: solicitud.estadoCambiadoPor.nombreCompleto,
        }
      : null,
    estadoCambiadoEn: solicitud.estadoCambiadoEn ? solicitud.estadoCambiadoEn.toISOString() : null,
  };
}
