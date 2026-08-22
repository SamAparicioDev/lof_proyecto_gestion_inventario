/**
 * Formas de RESPUESTA de `/api/solicitudes` (US36, FR-148…FR-157) — lo que el frontend recibe,
 * no lo que valida al enviar (eso vive en `esquemas/solicitudes.ts`).
 *
 * La forma refleja la decisión central del módulo: `descripcion` y `promptRefinado` son dos
 * campos distintos que nunca se fusionan (FR-152). Uno es lo que quiso decir una persona; el otro
 * es cómo lo entendió una máquina. Guardarlos separados es lo único que permite darse cuenta de
 * que el modelo entendió otra cosa.
 */
import type { EstadoSolicitud } from '../esquemas/solicitudes';

/** Quién hizo algo, tal como sale en las respuestas de este módulo. */
export interface AutorSolicitud {
  readonly id: string;
  readonly nombreCompleto: string;
}

/** Una solicitud completa (`GET`/`POST`/`PATCH /api/solicitudes*`). */
export interface Solicitud {
  readonly id: string;
  readonly titulo: string;
  /** El texto del autor, TAL CUAL lo escribió. Refinar no lo toca jamás (FR-152). */
  readonly descripcion: string;
  /** Lo que produjo el modelo; `null` mientras no se haya refinado (FR-153). */
  readonly promptRefinado: string | null;
  readonly refinadoEn: string | null;
  readonly estado: EstadoSolicitud;
  readonly creadaPor: AutorSolicitud;
  readonly creadaEn: string;
  readonly estadoCambiadoPor: AutorSolicitud | null;
  readonly estadoCambiadoEn: string | null;
}

/** Respuesta de `GET /api/solicitudes`. `pendientes` cuenta sobre el CONJUNTO completo, no sobre
 *  la página: es el número que dice cuánto trabajo hay esperando, y uno que cambiara al pasar de
 *  página no diría nada. */
export interface PaginaSolicitudes {
  readonly datos: Solicitud[];
  readonly total: number;
  readonly pagina: number;
  readonly porPagina: number;
  readonly pendientes: number;
}

/**
 * Respuesta de `POST /api/solicitudes/:id/refinar`.
 *
 * `disponible: false` NO es un error de esta API (FR-155, mismo criterio que FR-136 en el
 * asistente): la solicitud existe y se leyó bien; lo que faltó fue el modelo. `aviso` viene ya
 * redactado en español, distingue la causa y la pantalla lo pinta como aviso, nunca como prompt.
 */
export interface ResultadoRefinado {
  readonly prompt: string | null;
  readonly generadoEn: string | null;
  readonly disponible: boolean;
  readonly aviso: string | null;
}
