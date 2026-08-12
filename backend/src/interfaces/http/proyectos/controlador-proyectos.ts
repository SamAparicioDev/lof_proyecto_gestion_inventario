/**
 * Controlador `ControladorProyectos` — endpoints de `/api/proyectos` NO anidados bajo
 * cliente (contracts/api-rest.md § Clientes y proyectos): edición y cambio de estado de un
 * proyecto ya existente. El alta (`POST /api/clientes/:id/proyectos`) vive en
 * `ControladorClientes` porque esa ruta SÍ es anidada y necesita el `clienteId` de la URL —
 * un proyecto no cambia de cliente tras el alta, así que estas dos rutas no lo requieren.
 *
 * Autorización (T103): `proyectos.editar` y `proyectos.cambiar_estado` son permisos DISTINTOS
 * aunque hoy los mismos roles tengan ambos — cambiar el estado de un proyecto decide si puede
 * recibir salidas (FR-038), mientras editar solo corrige sus datos; separarlos es lo que
 * permite un rol que corrija datos sin poder cerrar un proyecto (research R16).
 *
 * Implementa: FR-036 (edición de proyecto), FR-038 (efecto del estado en el destino de
 * salidas — US2-AS4), FR-045 (auditoría: `usuarioId` siempre del token, nunca del body) y
 * FR-058 (autorización por permiso efectivo, resuelto en el servidor en cada petición).
 */
import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Put } from '@nestjs/common';
import {
  esquemaActualizarProyecto,
  esquemaCambiarEstadoProyecto,
  type DatosActualizarProyecto,
  type DatosCambiarEstadoProyecto,
} from '@trazo/compartido';
import { ActualizarProyectoCasoUso } from '../../../aplicacion/clientes/actualizar-proyecto.caso-uso';
import { CambiarEstadoProyectoCasoUso } from '../../../aplicacion/clientes/cambiar-estado-proyecto.caso-uso';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';

@Controller('proyectos')
export class ControladorProyectos {
  constructor(
    private readonly actualizarProyecto: ActualizarProyectoCasoUso,
    private readonly cambiarEstadoProyecto: CambiarEstadoProyectoCasoUso,
  ) {}

  /** `PUT /api/proyectos/:id` — edición de proyecto (FR-036). */
  @Put(':id')
  @RequierePermiso('proyectos.editar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaActualizarProyecto)) datos: DatosActualizarProyecto,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.actualizarProyecto.ejecutar({ proyectoId: id, ...datos, usuarioId: usuario.id });
  }

  /** `PUT /api/proyectos/:id/estado` — transición de estado ACTIVO/COMPLETADO/SUSPENDIDO (US2-AS4). */
  @Put(':id/estado')
  @RequierePermiso('proyectos.cambiar_estado')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaCambiarEstadoProyecto)) datos: DatosCambiarEstadoProyecto,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.cambiarEstadoProyecto.ejecutar({ proyectoId: id, estado: datos.estado, usuarioId: usuario.id });
  }
}
