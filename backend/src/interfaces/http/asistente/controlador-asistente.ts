/**
 * `ControladorAsistente` — la única ruta del asistente de consultas (US33, FR-133).
 *
 * Delgado como todos: valida con Zod, exige el permiso, delega. La decisión interesante es cuál
 * permiso — `asistente.consultar` propio y no reutilizar `inventario.ver`: quién puede preguntar
 * por chat y quién puede abrir el inventario son dos decisiones distintas, y una organización
 * puede querer el asistente apagado para algunos roles sin quitarles ninguna pantalla. Lo que ese
 * permiso NO hace es conceder acceso a datos: cada consulta interna vuelve a comprobar el permiso
 * que le toca (FR-134), así que tenerlo sin tener `reportes.ver` sirve para preguntar por stock y
 * no por consumo.
 *
 * Responde `200` incluso cuando el servicio no está disponible: el cuerpo lo dice con
 * `disponible: false` (FR-136). Un `503` obligaría a la pantalla a distinguir errores de red de
 * indisponibilidad del asistente, y las dos se ven igual desde el navegador.
 *
 * Implementa: FR-133, FR-134, FR-136.
 */
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  esquemaConsultaAsistente,
  type DatosConsultaAsistente,
  type RespuestaAsistente,
} from '@trazo/compartido';
import { ConsultarAsistenteCasoUso } from '../../../aplicacion/asistente/consultar-asistente.caso-uso';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';

@Controller('asistente')
export class ControladorAsistente {
  constructor(private readonly consultarAsistente: ConsultarAsistenteCasoUso) {}

  /** `POST /api/asistente/consulta` — una pregunta, una respuesta con sus fuentes. */
  @Post('consulta')
  @RequierePermiso('asistente.consultar')
  @HttpCode(HttpStatus.OK)
  async consultar(
    @Body(new PipeValidacionZod(esquemaConsultaAsistente)) datos: DatosConsultaAsistente,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<RespuestaAsistente> {
    return this.consultarAsistente.ejecutar({
      pregunta: datos.pregunta,
      historial: datos.historial,
      // El usuario sale del token, NUNCA del cuerpo: es lo que decide qué puede consultar el
      // asistente por dentro (FR-134).
      usuario: usuarioActual,
    });
  }
}
