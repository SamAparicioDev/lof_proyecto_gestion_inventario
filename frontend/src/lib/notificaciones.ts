/**
 * Cómo se PRESENTA un aviso (US35, FR-140) — la mitad de navegador de las notificaciones.
 *
 * ## La ruta se deriva aquí, no viene de la base
 *
 * El backend manda `{ tipo, id }` y este archivo lo convierte en `/salidas/231`. Es a propósito
 * (ver el TSDoc del puerto): las rutas de la interfaz las fija contracts/rutas-frontend.md y
 * cambian cuando cambia la interfaz, mientras que un aviso vive en la base durante meses.
 * Guardar la ruta congelaría el mapa de hoy dentro de datos de siempre — el día que
 * `/salidas/[id]` se llame de otra forma, los avisos viejos llevarían a un 404.
 *
 * ## El tono lo pone el tipo
 *
 * Cada tipo trae su icono y su color. No es decoración: en una lista de doce avisos, "anulada"
 * y "recibido" tienen que distinguirse antes de leerse, o la lista se lee entera cada vez.
 */
import type { Icon } from '@phosphor-icons/react';
import {
  ArrowSquareIn,
  ArrowSquareOut,
  CheckCircle,
  Package,
  PencilSimple,
  Prohibit,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr';
import type { EntidadNotificadaApi, NotificacionApi, TipoNotificacionApi } from '@trazo/compartido';

/** A dónde lleva cada clase de entidad. Es el ÚNICO sitio que traduce entidad → ruta. */
const RUTA_POR_ENTIDAD: Record<EntidadNotificadaApi, (id: number) => string> = {
  INGRESO: (id) => `/ingresos/${id}`,
  SALIDA: (id) => `/salidas/${id}`,
  PRODUCTO: (id) => `/inventario/${id}`,
};

/** Icono y color de cada tipo. `acento` usa las variables del tema (Nocturne), nunca un hex. */
const PRESENTACION: Record<TipoNotificacionApi, { icono: Icon; acento: string }> = {
  INGRESO_REGISTRADO: { icono: ArrowSquareIn, acento: 'var(--color-text)' },
  INGRESO_RECIBIDO: { icono: CheckCircle, acento: 'var(--color-ok, var(--color-accent-300))' },
  INGRESO_ANULADO: { icono: Prohibit, acento: 'var(--color-accent-300)' },
  SALIDA_POR_APROBAR: { icono: ArrowSquareOut, acento: 'var(--color-accent-300)' },
  SALIDA_CONFIRMADA: { icono: CheckCircle, acento: 'var(--color-ok, var(--color-accent-300))' },
  SALIDA_ANULADA: { icono: Prohibit, acento: 'var(--color-accent-300)' },
  STOCK_BAJO: { icono: WarningCircle, acento: 'var(--color-accent-300)' },
  CANTIDAD_CORREGIDA: { icono: PencilSimple, acento: 'var(--color-text)' },
};

/** Respaldo para un tipo que el servidor conozca y esta versión del frontend todavía no: la
 *  bandeja muestra el aviso igual, con un icono neutro, en vez de romperse por uno nuevo. */
const PRESENTACION_POR_DEFECTO = { icono: Package, acento: 'var(--color-text)' };

/** A dónde navega este aviso al abrirlo (FR-140). */
export function rutaDeLaNotificacion(notificacion: NotificacionApi): string {
  const construir = RUTA_POR_ENTIDAD[notificacion.entidad.tipo];
  return construir ? construir(notificacion.entidad.id) : '/notificaciones';
}

/** Icono y color con los que se pinta. */
export function presentacionDe(tipo: TipoNotificacionApi): { icono: Icon; acento: string } {
  return PRESENTACION[tipo] ?? PRESENTACION_POR_DEFECTO;
}

/**
 * "hace 5 minutos", "ayer", "hace 3 días" — el tiempo como se dice en voz alta.
 *
 * Una bandeja de avisos se lee de un vistazo, y una marca de tiempo absoluta obliga a hacer la
 * resta mentalmente. Pasada una semana se pasa a la fecha: "hace 23 días" ya no ubica a nadie.
 */
export function haceCuanto(iso: string, ahora: Date = new Date()): string {
  const fecha = new Date(iso);
  const segundos = Math.max(0, Math.round((ahora.getTime() - fecha.getTime()) / 1000));

  if (segundos < 60) return 'hace un momento';
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return minutos === 1 ? 'hace 1 minuto' : `hace ${minutos} minutos`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return horas === 1 ? 'hace 1 hora' : `hace ${horas} horas`;
  const dias = Math.round(horas / 24);
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;
  return fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}
