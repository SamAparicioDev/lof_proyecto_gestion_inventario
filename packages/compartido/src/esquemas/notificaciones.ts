/**
 * Esquemas y tipos de las NOTIFICACIONES (US35, FR-139…FR-147) — contracts/api-rest.md
 * § Notificaciones.
 *
 * Aquí conviven el esquema de entrada (los filtros de la bandeja) y la forma de la respuesta,
 * en un solo archivo porque el contrato de este módulo es pequeño y se lee mejor junto.
 *
 * Lo que NO hay, a propósito: un esquema para CREAR una notificación. Los avisos los emite el
 * sistema al ocurrir el hecho; un body para fabricarlos a mano permitiría anunciar cosas que
 * nunca pasaron, y un aviso que no corresponde a un hecho es peor que ningún aviso.
 */
import { z } from 'zod';
import { esquemaBooleanoDeQuery, esquemaPaginacion } from './comunes';

/**
 * Los hechos que se avisan (FR-139). Espejo EXACTO del `TipoNotificacion` del dominio y del
 * enum de la base — el frontend lo usa para elegir el icono y el color de cada fila.
 */
export const TIPOS_NOTIFICACION = [
  'INGRESO_REGISTRADO',
  'INGRESO_RECIBIDO',
  'INGRESO_ANULADO',
  'SALIDA_POR_APROBAR',
  'SALIDA_CONFIRMADA',
  'SALIDA_ANULADA',
  'STOCK_BAJO',
  'CANTIDAD_CORREGIDA',
] as const;
export type TipoNotificacionApi = (typeof TIPOS_NOTIFICACION)[number];

/** A qué clase de cosa lleva el aviso (FR-140). La RUTA la arma el frontend con esto: el
 *  contrato transporta identidad, no direcciones — las rutas las fija rutas-frontend.md. */
export const ENTIDADES_NOTIFICADAS = ['INGRESO', 'SALIDA', 'PRODUCTO'] as const;
export type EntidadNotificadaApi = (typeof ENTIDADES_NOTIFICADAS)[number];

/** Query de `GET /api/notificaciones`. */
export const esquemaFiltroNotificaciones = z
  .object({
    /** Llega como texto desde la query (`?soloNoLeidas=true`), igual que el resto de los filtros. */
    soloNoLeidas: esquemaBooleanoDeQuery,
  })
  .merge(esquemaPaginacion);
export type DatosFiltroNotificaciones = z.infer<typeof esquemaFiltroNotificaciones>;

/** Una fila de la bandeja. `leida` es de QUIEN CONSULTA: el mismo aviso está leído para unos
 *  y pendiente para otros (FR-144). */
export interface NotificacionApi {
  id: number;
  tipo: TipoNotificacionApi;
  titulo: string;
  detalle: string | null;
  entidad: { tipo: EntidadNotificadaApi; id: number };
  /** ISO 8601 — como toda fecha del contrato, viaja en texto (ver `tipos/panel.ts`). */
  creadaEn: string;
  leida: boolean;
}

/** Respuesta de `GET /api/notificaciones`. `noLeidas` es del conjunto completo, no de la
 *  página: es el número del indicador, y un contador que cambiara al paginar no sería uno. */
export interface BandejaNotificaciones {
  datos: NotificacionApi[];
  total: number;
  pagina: number;
  porPagina: number;
  noLeidas: number;
}

/** Respuesta de `GET /api/notificaciones/resumen` — lo que pide la campana cada tanto. */
export interface ResumenNotificaciones {
  noLeidas: number;
}

/** Respuesta de `POST /api/notificaciones/leer-todas`. */
export interface ResultadoLecturaMasiva {
  marcadas: number;
}
