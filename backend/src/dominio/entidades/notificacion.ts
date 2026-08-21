/**
 * Entidad de dominio `Notificacion` — TypeScript puro (Principio VI, NO NEGOCIABLE).
 *
 * Un aviso es un HECHO ya ocurrido del que alguien más necesita enterarse para hacer su trabajo:
 * llegó mercancía por recibir, hay una salida esperando aprobación, se anuló un documento, un
 * producto cruzó su umbral. El sistema lo sabe en el instante exacto; US35 es hacer que llegue.
 *
 * ## La decisión que gobierna este archivo: el catálogo manda
 *
 * Cada tipo de aviso declara AQUÍ los dos permisos que exige y a qué clase de entidad lleva. No
 * hay una sola condición de entrega escrita en un `if` de la aplicación ni en un `WHERE` del
 * adaptador: quien quiera saber quién recibe qué, lee `CATALOGO_NOTIFICACIONES` y ya. Un tipo
 * nuevo se agrega en esta tabla y el resto del sistema lo respeta sin tocarse.
 *
 * ## Por qué DOS permisos y no uno
 *
 * - `permisoSuscripcion` (`notificaciones.*`) es la casilla que el Administrador mueve en
 *   `/roles`: decide QUIÉN QUIERE enterarse (FR-141).
 * - `permisoLectura` (`ingresos.ver`, `salidas.ver`, `inventario.ver`) es la puerta del módulo:
 *   decide QUIÉN PUEDE (FR-142).
 *
 * Hacen falta las DOS. El título de un aviso ya es información del módulo —"Salida SAL-000231 ·
 * Constructora Jumbo · 4 líneas"—, así que si la suscripción bastara, marcar una casilla de avisos
 * sería una forma de repartir datos sin repartir permisos: la pantalla seguiría cerrada y el
 * contenido saldría igual por la campana. La suscripción SUSCRIBE; nunca amplía.
 *
 * Implementa: FR-139 (qué hechos se avisan), FR-140 (a dónde lleva cada uno), FR-141 (la
 * suscripción es un permiso parametrizable) y FR-142 (nunca amplía el acceso).
 */
import type { ClavePermiso } from './permiso';

/** Los hechos que el sistema avisa (FR-139). El orden es el de su módulo, no el de importancia. */
export type TipoNotificacion =
  | 'INGRESO_REGISTRADO'
  | 'INGRESO_RECIBIDO'
  | 'INGRESO_ANULADO'
  | 'SALIDA_POR_APROBAR'
  | 'SALIDA_CONFIRMADA'
  | 'SALIDA_ANULADA'
  | 'STOCK_BAJO'
  | 'CANTIDAD_CORREGIDA';

/** A qué clase de cosa lleva un aviso. La RUTA concreta la arma el frontend a partir de esto:
 *  guardar `/salidas/231` en la base congelaría el mapa de rutas de hoy dentro de los datos de
 *  siempre (contracts/rutas-frontend.md es quien manda sobre las rutas). */
export type EntidadNotificada = 'INGRESO' | 'SALIDA' | 'PRODUCTO';

/** Permiso de suscripción a los avisos de entradas de mercancía (FR-141). */
export const PERMISO_AVISOS_INGRESOS: ClavePermiso = 'notificaciones.ingresos';
/** Permiso de suscripción a los avisos de salidas (FR-141). */
export const PERMISO_AVISOS_SALIDAS: ClavePermiso = 'notificaciones.salidas';
/** Permiso de suscripción a los avisos de inventario: umbral cruzado y cantidad corregida. */
export const PERMISO_AVISOS_INVENTARIO: ClavePermiso = 'notificaciones.inventario';

/** Lo que cada tipo de aviso exige y a dónde lleva. */
export interface DefinicionNotificacion {
  /** Casilla de `/roles` que suscribe a este aviso (FR-141). */
  readonly permisoSuscripcion: ClavePermiso;
  /** Permiso de lectura del módulo del que habla; sin él no se entrega (FR-142). */
  readonly permisoLectura: ClavePermiso;
  /** Clase de entidad a la que navega al abrirlo (FR-140). */
  readonly entidad: EntidadNotificada;
}

/**
 * El catálogo completo. Es la ÚNICA fuente de verdad de la entrega: la aplicación calcula con
 * él los tipos visibles de una sesión y el adaptador solo obedece esa lista.
 */
export const CATALOGO_NOTIFICACIONES: Readonly<Record<TipoNotificacion, DefinicionNotificacion>> = {
  INGRESO_REGISTRADO: {
    permisoSuscripcion: PERMISO_AVISOS_INGRESOS,
    permisoLectura: 'ingresos.ver',
    entidad: 'INGRESO',
  },
  INGRESO_RECIBIDO: {
    permisoSuscripcion: PERMISO_AVISOS_INGRESOS,
    permisoLectura: 'ingresos.ver',
    entidad: 'INGRESO',
  },
  INGRESO_ANULADO: {
    permisoSuscripcion: PERMISO_AVISOS_INGRESOS,
    permisoLectura: 'ingresos.ver',
    entidad: 'INGRESO',
  },
  SALIDA_POR_APROBAR: {
    permisoSuscripcion: PERMISO_AVISOS_SALIDAS,
    permisoLectura: 'salidas.ver',
    entidad: 'SALIDA',
  },
  SALIDA_CONFIRMADA: {
    permisoSuscripcion: PERMISO_AVISOS_SALIDAS,
    permisoLectura: 'salidas.ver',
    entidad: 'SALIDA',
  },
  SALIDA_ANULADA: {
    permisoSuscripcion: PERMISO_AVISOS_SALIDAS,
    permisoLectura: 'salidas.ver',
    entidad: 'SALIDA',
  },
  STOCK_BAJO: {
    permisoSuscripcion: PERMISO_AVISOS_INVENTARIO,
    permisoLectura: 'inventario.ver',
    entidad: 'PRODUCTO',
  },
  CANTIDAD_CORREGIDA: {
    permisoSuscripcion: PERMISO_AVISOS_INVENTARIO,
    permisoLectura: 'inventario.ver',
    entidad: 'PRODUCTO',
  },
};

/** Los tres permisos de suscripción, para las pruebas y para la pantalla de roles. */
export const PERMISOS_DE_AVISOS: readonly ClavePermiso[] = [
  PERMISO_AVISOS_INGRESOS,
  PERMISO_AVISOS_SALIDAS,
  PERMISO_AVISOS_INVENTARIO,
];

/**
 * Los tipos de aviso que una sesión con ESTOS permisos puede recibir (FR-141 + FR-142).
 *
 * Función pura y una sola línea de regla, a propósito: es la frase "hace falta la suscripción Y el
 * permiso de lectura" escrita UNA vez. Si el conjunto sale vacío, quien llama no debería consultar
 * nada — no hay avisos que filtrar, no hay consulta que hacer.
 */
export function tiposVisiblesPara(permisos: readonly ClavePermiso[]): TipoNotificacion[] {
  const tiene = new Set(permisos);
  return (Object.keys(CATALOGO_NOTIFICACIONES) as TipoNotificacion[]).filter((tipo) => {
    const definicion = CATALOGO_NOTIFICACIONES[tipo];
    return tiene.has(definicion.permisoSuscripcion) && tiene.has(definicion.permisoLectura);
  });
}

/** Un aviso ya ocurrido, tal como lo lee la bandeja. */
export interface Notificacion {
  readonly id: number;
  readonly tipo: TipoNotificacion;
  /** Redactado en el momento del hecho: un aviso no se reescribe (ver data-model.md). */
  readonly titulo: string;
  readonly detalle: string | null;
  readonly entidadTipo: EntidadNotificada;
  readonly entidadId: number;
  /** Quien provocó el hecho. Se EXCLUYE de los destinatarios (FR-143); `null` si fue el sistema. */
  readonly usuarioOrigenId: number | null;
  readonly creadaEn: Date;
  /** Leída POR EL USUARIO QUE CONSULTA (FR-144) — el mismo aviso está leído para unos y no para
   *  otros, así que este campo depende de quién pregunta, no del aviso. */
  readonly leida: boolean;
}

/** Lo que hace falta para EMITIR un aviso; el id y la fecha los pone la base. */
export interface NuevaNotificacion {
  readonly tipo: TipoNotificacion;
  readonly titulo: string;
  readonly detalle: string | null;
  readonly entidadId: number;
  readonly usuarioOrigenId: number | null;
}
