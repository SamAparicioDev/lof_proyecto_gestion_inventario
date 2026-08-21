/**
 * Cliente de la BANDEJA DE AVISOS (US35, FR-139…FR-147) — contracts/api-rest.md
 * § Notificaciones.
 *
 * No hay función para CREAR un aviso, y no es un olvido: los emite el sistema al ocurrir el
 * hecho. El backend tampoco expone la ruta.
 */
import type {
  BandejaNotificaciones,
  ResultadoLecturaMasiva,
  ResumenNotificaciones,
} from '@trazo/compartido';
import { api } from './cliente';

/** `GET /api/notificaciones` — la bandeja de esta sesión, ya recortada por el servidor. */
export function listarNotificaciones(opciones: {
  pagina?: number;
  porPagina?: number;
  soloNoLeidas?: boolean;
}): Promise<BandejaNotificaciones> {
  const parametros = new URLSearchParams();
  if (opciones.pagina) parametros.set('pagina', String(opciones.pagina));
  if (opciones.porPagina) parametros.set('porPagina', String(opciones.porPagina));
  if (opciones.soloNoLeidas) parametros.set('soloNoLeidas', 'true');
  const query = parametros.toString();
  return api<BandejaNotificaciones>(`/api/notificaciones${query ? `?${query}` : ''}`);
}

/** `GET /api/notificaciones/resumen` — solo el número del indicador. Es lo que la campana
 *  vuelve a pedir cada tanto, así que es deliberadamente lo más barato de la API. */
export function resumenNotificaciones(): Promise<ResumenNotificaciones> {
  return api<ResumenNotificaciones>('/api/notificaciones/resumen');
}

/** `POST /api/notificaciones/:id/leer`. Idempotente. */
export function marcarNotificacionLeida(id: number): Promise<void> {
  return api<void>(`/api/notificaciones/${id}/leer`, { method: 'POST' });
}

/** `POST /api/notificaciones/leer-todas` — devuelve cuántas marcó. */
export function marcarTodasLeidas(): Promise<ResultadoLecturaMasiva> {
  return api<ResultadoLecturaMasiva>('/api/notificaciones/leer-todas', { method: 'POST' });
}
