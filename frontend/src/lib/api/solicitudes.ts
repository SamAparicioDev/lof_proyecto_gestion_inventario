/**
 * Cliente del BUZÓN DE SOLICITUDES del super administrador (US36, FR-148…FR-157).
 *
 * Seis operaciones y ninguna que borre: lo que se abandona pasa a DESCARTADA (FR-154). No hay
 * aquí una función de borrado porque el backend tampoco expone la ruta — un pedido borrado
 * perdería la única traza de que alguna vez se pidió.
 *
 * `refinarSolicitud` es la única que puede "fallar" respondiendo `200`: cuando el modelo no está,
 * el cuerpo trae `disponible: false` con su aviso ya redactado en español (FR-155). La pantalla lo
 * pinta como aviso, nunca como prompt, y el resto del buzón sigue funcionando.
 */
import type {
  DatosActualizarSolicitud,
  DatosCrearSolicitud,
  EstadoSolicitud,
  PaginaSolicitudes,
  ResultadoRefinado,
  Solicitud,
} from '@trazo/compartido';
import { api } from './cliente';

/** `GET /api/solicitudes` — filtrable por estado (FR-157). */
export function listarSolicitudes(filtros?: {
  estado?: EstadoSolicitud;
  pagina?: number;
  porPagina?: number;
}): Promise<PaginaSolicitudes> {
  const parametros = new URLSearchParams();
  if (filtros?.estado) parametros.set('estado', filtros.estado);
  if (filtros?.pagina) parametros.set('pagina', String(filtros.pagina));
  if (filtros?.porPagina) parametros.set('porPagina', String(filtros.porPagina));
  const consulta = parametros.toString();
  return api<PaginaSolicitudes>(`/api/solicitudes${consulta ? `?${consulta}` : ''}`);
}

/** `POST /api/solicitudes` — nace PENDIENTE (FR-150). */
export function crearSolicitud(datos: DatosCrearSolicitud): Promise<Solicitud> {
  return api<Solicitud>('/api/solicitudes', { method: 'POST', body: JSON.stringify(datos) });
}

/** `PATCH /api/solicitudes/:id` — título y descripción. No toca el prompt (FR-152). */
export function actualizarSolicitud(id: string, datos: DatosActualizarSolicitud): Promise<Solicitud> {
  return api<Solicitud>(`/api/solicitudes/${id}`, { method: 'PATCH', body: JSON.stringify(datos) });
}

/** `PATCH /api/solicitudes/:id/estado` (FR-154). */
export function cambiarEstadoSolicitud(id: string, estado: EstadoSolicitud): Promise<Solicitud> {
  return api<Solicitud>(`/api/solicitudes/${id}/estado`, {
    method: 'PATCH',
    body: JSON.stringify({ estado }),
  });
}

/**
 * `POST /api/solicitudes/:id/refinar` (FR-151).
 *
 * Puede tardar bastante más que el resto de la API: el modelo redacta un texto largo. La pantalla
 * muestra estado de espera en vez de fingir instantáneo.
 */
export function refinarSolicitud(id: string): Promise<ResultadoRefinado> {
  return api<ResultadoRefinado>(`/api/solicitudes/${id}/refinar`, { method: 'POST' });
}
