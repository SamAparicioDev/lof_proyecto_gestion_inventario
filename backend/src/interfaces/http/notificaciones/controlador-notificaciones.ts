/**
 * Controlador `ControladorNotificaciones` — la bandeja de avisos (contracts/api-rest.md
 * § Notificaciones, US35/FR-139…FR-147). Traduce HTTP ↔ casos de uso y nada más: aquí no se
 * decide quién ve qué (eso es `tiposVisiblesPara`, en el dominio) ni se redacta ningún aviso.
 *
 * ## Por qué NINGUNO de estos endpoints declara `@RequierePermiso`
 *
 * Mismo criterio —y mismo motivo— que `GET /api/panel`: exigir un `notificaciones.ver` crearía
 * una casilla capaz de dejar a alguien sin bandeja sin proteger un solo dato, porque el
 * contenido YA está gateado tipo por tipo dentro del caso de uso (suscripción + permiso de
 * lectura del módulo, FR-141/FR-142). Una sesión sin ninguna suscripción recibe `200` con la
 * bandeja vacía y `noLeidas: 0` — no hay nada que filtrar porque no se consultó nada.
 *
 * Es la diferencia entre "no tienes permiso" y "no te has suscrito a nada": la primera es un
 * `403` y la segunda es una bandeja vacía, y confundirlas mandaría a la gente a pedirle a un
 * administrador un permiso que sí tiene.
 *
 * ## No hay endpoint de creación, y es una decisión
 *
 * Los avisos los emite el sistema al ocurrir el hecho (`AvisadorDeNotificaciones`). Un `POST`
 * para fabricarlos permitiría anunciar cosas que nunca pasaron, y un aviso que no corresponde a
 * un hecho es peor que ningún aviso.
 *
 * Implementa: FR-140 (la respuesta lleva a dónde ir), FR-141/FR-142 (recorte por permisos en el
 * servidor), FR-144 (leído por usuario: contador y marcado) y FR-147 (ventana acotada).
 */
import { Controller, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import {
  esquemaFiltroNotificaciones,
  type BandejaNotificaciones,
  type DatosFiltroNotificaciones,
  type NotificacionApi,
  type ResultadoLecturaMasiva,
  type ResumenNotificaciones,
} from '@trazo/compartido';
import {
  BandejaNotificacionesCasoUso,
  MarcarNotificacionLeidaCasoUso,
  MarcarTodasLeidasCasoUso,
  ResumenNotificacionesCasoUso,
} from '../../../aplicacion/notificaciones/bandeja-notificaciones.caso-uso';
import type { Notificacion } from '../../../dominio/entidades/notificacion';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';

@Controller('notificaciones')
export class ControladorNotificaciones {
  constructor(
    private readonly bandeja: BandejaNotificacionesCasoUso,
    private readonly resumen: ResumenNotificacionesCasoUso,
    private readonly marcarLeida: MarcarNotificacionLeidaCasoUso,
    private readonly marcarTodas: MarcarTodasLeidasCasoUso,
  ) {}

  /** `GET /api/notificaciones` — la bandeja paginada de esta sesión. */
  @Get()
  async listar(
    @UsuarioActual() usuario: Usuario,
    @Query(new PipeValidacionZod(esquemaFiltroNotificaciones)) filtros: DatosFiltroNotificaciones,
  ): Promise<BandejaNotificaciones> {
    const pagina = await this.bandeja.ejecutar({
      usuario,
      soloNoLeidas: filtros.soloNoLeidas,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    });
    return {
      datos: pagina.datos.map(aNotificacionApi),
      total: pagina.total,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
      noLeidas: pagina.noLeidas,
    };
  }

  /** `GET /api/notificaciones/resumen` — el número del indicador, y nada más. */
  @Get('resumen')
  async contarNoLeidas(@UsuarioActual() usuario: Usuario): Promise<ResumenNotificaciones> {
    return this.resumen.ejecutar({ usuario });
  }

  /**
   * `POST /api/notificaciones/:id/leer` — marca una como leída. Idempotente.
   *
   * `404` cuando no existe o no es visible para esta sesión: los dos casos responden igual a
   * propósito, porque distinguirlos ya diría "existe, pero no es tuyo".
   */
  @Post(':id/leer')
  @HttpCode(204)
  async leer(@UsuarioActual() usuario: Usuario, @Param('id', ParseIntPipe) id: number): Promise<void> {
    const marcada = await this.marcarLeida.ejecutar({ usuario, notificacionId: id });
    if (!marcada) {
      throw new NotFoundException('La notificación no existe');
    }
  }

  /**
   * `POST /api/notificaciones/leer-todas` — vacía el indicador de un golpe.
   *
   * `200` explícito porque Nest responde `201` a todo `POST` por defecto, y el contrato dice
   * `200`: esto no CREA nada, marca lo que ya existía.
   */
  @Post('leer-todas')
  @HttpCode(200)
  async leerTodas(@UsuarioActual() usuario: Usuario): Promise<ResultadoLecturaMasiva> {
    return this.marcarTodas.ejecutar({ usuario });
  }
}

/**
 * Entidad de dominio → forma del contrato.
 *
 * Dos traducciones que valen la pena señalar: la fecha viaja en ISO (como toda fecha de esta
 * API) y `entidadTipo`/`entidadId` se agrupan en `entidad`, que es como se lee — "a dónde lleva
 * esto" es UNA cosa, no dos campos sueltos que el cliente tenga que volver a juntar.
 */
function aNotificacionApi(notificacion: Notificacion): NotificacionApi {
  return {
    id: notificacion.id,
    tipo: notificacion.tipo,
    titulo: notificacion.titulo,
    detalle: notificacion.detalle,
    entidad: { tipo: notificacion.entidadTipo, id: notificacion.entidadId },
    creadaEn: notificacion.creadaEn.toISOString(),
    leida: notificacion.leida,
  };
}
