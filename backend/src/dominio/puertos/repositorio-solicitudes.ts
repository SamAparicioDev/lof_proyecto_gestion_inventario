/**
 * Puerto `RepositorioSolicitudes` — el buzón de solicitudes del super administrador
 * (US36, FR-148…FR-157). Implementado por
 * `infraestructura/persistencia/repositorio-solicitudes.prisma.ts`.
 *
 * ## No hay `eliminar`, y es una decisión
 *
 * Un pedido que se abandona pasa a DESCARTADA (FR-154). Borrarlo perdería la única traza de que
 * alguna vez se pidió, y la próxima vez volvería a pedirse desde cero — que es exactamente el
 * problema que este módulo existe para resolver. La ausencia del método es lo que lo garantiza:
 * una regla que no se puede incumplir porque no hay con qué.
 *
 * ## Dos escrituras separadas para el mismo registro
 *
 * `actualizar` toca título y descripción; `guardarRefinado` toca el prompt. Podrían ser un solo
 * método con campos opcionales, y sería peor: el punto de FR-152 es que el texto del autor y el
 * de la máquina se escriben por caminos distintos, y un método que pudiera hacer ambas cosas
 * dejaría esa garantía en manos de quien lo llame.
 *
 * Implementa: FR-149, FR-150, FR-152, FR-153, FR-154 y FR-157 (filtrado por estado con su
 * contador de pendientes).
 */
import type {
  EstadoSolicitudFuncionalidad,
  NuevaSolicitudFuncionalidad,
  SolicitudFuncionalidad,
} from '../entidades/solicitud-funcionalidad';

/** Qué porción del buzón se pide. `estado` ausente = todas. */
export interface FiltrosSolicitudesFuncionalidad {
  readonly estado?: EstadoSolicitudFuncionalidad;
  readonly pagina: number;
  readonly porPagina: number;
}

/** Página del buzón. `pendientes` cuenta sobre el conjunto COMPLETO —no sobre la página ni sobre
 *  el filtro vigente—: es cuánto trabajo hay esperando, y filtrar por COMPLETADA no cambia eso. */
export interface PaginaSolicitudesFuncionalidad {
  readonly datos: SolicitudFuncionalidad[];
  readonly total: number;
  readonly pendientes: number;
}

export interface RepositorioSolicitudes {
  crear(datos: NuevaSolicitudFuncionalidad): Promise<SolicitudFuncionalidad>;

  /** `null` cuando no existe — el caso de uso decide qué error de negocio es eso. */
  buscarPorId(id: number): Promise<SolicitudFuncionalidad | null>;

  listar(filtros: FiltrosSolicitudesFuncionalidad): Promise<PaginaSolicitudesFuncionalidad>;

  /** Solo título y descripción. NO toca `promptRefinado` (FR-152). */
  actualizar(id: number, datos: { titulo: string; descripcion: string }): Promise<SolicitudFuncionalidad>;

  /** Reemplaza el prompt por completo y sella `refinadoEn` (FR-153). Nunca fusiona con el anterior. */
  guardarRefinado(id: number, prompt: string, generadoEn: Date): Promise<SolicitudFuncionalidad>;

  /** Cambia el estado dejando su auditoría (FR-045, FR-154). */
  cambiarEstado(
    id: number,
    estado: EstadoSolicitudFuncionalidad,
    cambiadoPorId: number,
  ): Promise<SolicitudFuncionalidad>;
}

/** Token de inyección de NestJS para el puerto. */
export const REPOSITORIO_SOLICITUDES = 'RepositorioSolicitudes';
