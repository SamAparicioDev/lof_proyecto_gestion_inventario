/**
 * Casos de uso del BUZÓN DE SOLICITUDES del super administrador (US36, FR-148…FR-157).
 *
 * ## Por qué los cuatro viven en un archivo
 *
 * Mismo criterio que `bandeja-notificaciones.caso-uso.ts`: son operaciones triviales sobre UNA
 * entidad que no tiene reglas de negocio propias más allá de sus estados. Repartirlas en cuatro
 * archivos de quince líneas obligaría a abrir cuatro para entender un módulo que se lee de una
 * sentada. El refinado sí vive aparte (`refinar-solicitud.caso-uso.ts`) porque depende de un
 * servicio externo y tiene su propio modo de fallo.
 *
 * ## Quién puede llamarlos NO se comprueba aquí
 *
 * A diferencia del asistente —donde cada herramienta verifica el permiso de quien pregunta
 * (FR-134)—, aquí el control es binario y de ROL: o eres el super administrador o no entras
 * (FR-148). Eso se resuelve una vez en el guard, antes del controlador, y repetirlo en cada caso
 * de uso solo crearía una segunda fuente de verdad sobre quién puede qué.
 *
 * Implementa: FR-149 (alta con texto libre), FR-150 (nace PENDIENTE), FR-152 (el texto del autor
 * no se sobrescribe al editar), FR-154 (los tres estados con su auditoría) y FR-157 (filtrado por
 * estado con el contador de pendientes).
 */
import { Inject, Injectable } from '@nestjs/common';
import { NoEncontrado } from '../../dominio/comunes/errores';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import type {
  EstadoSolicitudFuncionalidad,
  SolicitudFuncionalidad,
} from '../../dominio/entidades/solicitud-funcionalidad';
import {
  REPOSITORIO_SOLICITUDES,
  type PaginaSolicitudesFuncionalidad,
  type RepositorioSolicitudes,
} from '../../dominio/puertos/repositorio-solicitudes';

/** El recurso, tal como lo nombra el error cuando el id no existe. */
const RECURSO = 'La solicitud';

export interface CrearSolicitudEntrada {
  readonly titulo: string;
  readonly descripcion: string;
  /** Del token, nunca del cuerpo (FR-045). */
  readonly usuarioId: number;
}

/** Alta de una solicitud. Nace PENDIENTE siempre (FR-150). */
@Injectable()
export class CrearSolicitudCasoUso implements CasoDeUso<CrearSolicitudEntrada, SolicitudFuncionalidad> {
  constructor(@Inject(REPOSITORIO_SOLICITUDES) private readonly repositorio: RepositorioSolicitudes) {}

  async ejecutar(entrada: CrearSolicitudEntrada): Promise<SolicitudFuncionalidad> {
    return this.repositorio.crear({
      titulo: entrada.titulo,
      descripcion: entrada.descripcion,
      creadaPorId: entrada.usuarioId,
    });
  }
}

export interface ListarSolicitudesEntrada {
  readonly estado?: EstadoSolicitudFuncionalidad;
  readonly pagina: number;
  readonly porPagina: number;
}

/** El buzón, más reciente primero, con el contador de pendientes del conjunto COMPLETO (FR-157). */
@Injectable()
export class ListarSolicitudesCasoUso
  implements CasoDeUso<ListarSolicitudesEntrada, PaginaSolicitudesFuncionalidad>
{
  constructor(@Inject(REPOSITORIO_SOLICITUDES) private readonly repositorio: RepositorioSolicitudes) {}

  async ejecutar(entrada: ListarSolicitudesEntrada): Promise<PaginaSolicitudesFuncionalidad> {
    return this.repositorio.listar(entrada);
  }
}

/** Una solicitud por su id. Existe para que la pantalla de detalle no tenga que listar. */
@Injectable()
export class VerSolicitudCasoUso implements CasoDeUso<number, SolicitudFuncionalidad> {
  constructor(@Inject(REPOSITORIO_SOLICITUDES) private readonly repositorio: RepositorioSolicitudes) {}

  async ejecutar(id: number): Promise<SolicitudFuncionalidad> {
    const solicitud = await this.repositorio.buscarPorId(id);
    if (!solicitud) {
      throw new NoEncontrado(RECURSO);
    }
    return solicitud;
  }
}

export interface ActualizarSolicitudEntrada {
  readonly id: number;
  readonly titulo: string;
  readonly descripcion: string;
}

/**
 * Edición del texto del autor.
 *
 * NO toca `promptRefinado` y no puede hacerlo: el puerto no expone un método capaz de escribir
 * ambas cosas (FR-152). Si tras editar la descripción el prompt guardado queda desfasado, eso es
 * exactamente lo que debe verse — la pantalla muestra ambos, y volver a refinar es un botón.
 * Borrarlo automáticamente sería peor: se perdería el prompt anterior sin que nadie lo pidiera.
 */
@Injectable()
export class ActualizarSolicitudCasoUso
  implements CasoDeUso<ActualizarSolicitudEntrada, SolicitudFuncionalidad>
{
  constructor(@Inject(REPOSITORIO_SOLICITUDES) private readonly repositorio: RepositorioSolicitudes) {}

  async ejecutar(entrada: ActualizarSolicitudEntrada): Promise<SolicitudFuncionalidad> {
    const existe = await this.repositorio.buscarPorId(entrada.id);
    if (!existe) {
      throw new NoEncontrado(RECURSO);
    }
    return this.repositorio.actualizar(entrada.id, {
      titulo: entrada.titulo,
      descripcion: entrada.descripcion,
    });
  }
}

export interface CambiarEstadoSolicitudEntrada {
  readonly id: number;
  readonly estado: EstadoSolicitudFuncionalidad;
  readonly usuarioId: number;
}

/**
 * Cambio de estado (FR-154).
 *
 * No hay tabla de transiciones permitidas, y es deliberado: los tres estados se alcanzan desde
 * cualquier otro, incluida la vuelta de COMPLETADA a PENDIENTE. Aquí no se protege stock ni
 * dinero; prohibir una transición solo lograría que el dueño del sistema cree una fila nueva y
 * pierda la historia de que ya lo había pedido. Lo único que se comprueba es que exista.
 */
@Injectable()
export class CambiarEstadoSolicitudCasoUso
  implements CasoDeUso<CambiarEstadoSolicitudEntrada, SolicitudFuncionalidad>
{
  constructor(@Inject(REPOSITORIO_SOLICITUDES) private readonly repositorio: RepositorioSolicitudes) {}

  async ejecutar(entrada: CambiarEstadoSolicitudEntrada): Promise<SolicitudFuncionalidad> {
    const existe = await this.repositorio.buscarPorId(entrada.id);
    if (!existe) {
      throw new NoEncontrado(RECURSO);
    }
    return this.repositorio.cambiarEstado(entrada.id, entrada.estado, entrada.usuarioId);
  }
}
