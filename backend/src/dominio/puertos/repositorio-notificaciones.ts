/**
 * Puerto `RepositorioNotificaciones` — la bandeja de avisos (US35, FR-139…FR-147).
 * Implementado por `infraestructura/persistencia/repositorio-notificaciones.prisma.ts`.
 *
 * ## Una fila por HECHO, no por destinatario
 *
 * Es la decisión que da forma a todo este puerto. Un aviso se escribe UNA vez; quién lo ve se
 * resuelve al LEER, cruzando los tipos que esa sesión puede recibir (`tiposVisiblesPara`) contra
 * lo que la tabla guarda. Tres consecuencias que se buscaron:
 *
 *  1. Cambiar los permisos de un rol surte efecto de inmediato, también sobre los avisos que ya
 *     existían. Con fan-out habría que reescribir el pasado, que es imposible, o vivir con una
 *     bandeja que refleja permisos de ayer.
 *  2. Un usuario dado de alta hoy no arrastra el fan-out de nadie: no hereda avisos anteriores a
 *     su alta (`desde` de `FiltrosNotificaciones`).
 *  3. El número de filas no se multiplica por el tamaño de la plantilla.
 *
 * El costo es que la entrega se calcula en cada lectura. Es barato: dos conjuntos de claves
 * comparados en memoria, y a la base le llega un `IN (tipos)` que el índice cubre.
 *
 * ## Solo INSERT y lectura
 *
 * No hay `actualizar` ni `eliminar`: un aviso es lo que se supo en ese momento. Si el hecho se
 * revierte, lo que corresponde es OTRO aviso —la anulación también se avisa—, no reescribir el
 * anterior. Mismo criterio de inmutabilidad que `movimientos_inventario` (Principio II). Lo único
 * que cambia con el tiempo es quién lo ha leído, y eso vive en otra tabla.
 *
 * Implementa: FR-139 (los avisos existen desde el momento del hecho), FR-141/FR-142 (entrega por
 * permiso de suscripción Y de lectura), FR-143 (nunca al autor), FR-144 (leído por usuario) y
 * FR-147 (ventana acotada, no archivo histórico).
 */
import type { Notificacion, NuevaNotificacion, TipoNotificacion } from '../entidades/notificacion';

/**
 * Qué puede ver ESTA sesión y de qué parte de la bandeja.
 *
 * `tipos` sale de `tiposVisiblesPara` en la capa de aplicación, nunca de la petición: el filtro
 * de autorización no es un parámetro que el cliente pueda proponer. Si llega vacío, el adaptador
 * responde una página vacía sin consultar — no hay nada que filtrar.
 */
export interface FiltrosNotificaciones {
  readonly usuarioId: number;
  readonly tipos: readonly TipoNotificacion[];
  /** Nada anterior a esta fecha: el alta del usuario o la ventana de la bandeja, la más reciente. */
  readonly desde: Date;
  readonly soloNoLeidas: boolean;
  readonly pagina: number;
  readonly porPagina: number;
}

/** Página de la bandeja. `noLeidas` es del CONJUNTO completo, no de la página: es el número del
 *  indicador, y un contador que cambiara al pasar de página no sería un contador. */
export interface PaginaNotificaciones {
  readonly datos: Notificacion[];
  readonly total: number;
  readonly noLeidas: number;
}

/** Lo que hace falta para contar los no leídos sin traerse la bandeja entera. */
export interface CriteriosNoLeidas {
  readonly usuarioId: number;
  readonly tipos: readonly TipoNotificacion[];
  readonly desde: Date;
}

export interface RepositorioNotificaciones {
  /**
   * Emite un aviso. Lo llama SIEMPRE `AvisadorDeNotificaciones`, que ya garantiza que un fallo
   * aquí no puede tumbar la operación de negocio que lo originó (FR-146).
   */
  crear(datos: NuevaNotificacion): Promise<void>;

  /** La bandeja de una sesión, más reciente primero (FR-144). */
  listar(filtros: FiltrosNotificaciones): Promise<PaginaNotificaciones>;

  /** Solo el número del indicador — la consulta que la campana repite cada tanto. */
  contarNoLeidas(criterios: CriteriosNoLeidas): Promise<number>;

  /**
   * Marca UNA como leída. Idempotente: marcarla dos veces no es un error.
   *
   * Devuelve `false` si esa notificación no existe o no es visible para esa sesión, para que el
   * controlador responda `404` en vez de fingir que la marcó. Recibe los mismos `tipos` que la
   * lectura porque la visibilidad es la misma pregunta: nadie puede marcar como leído algo que no
   * podía ver.
   */
  marcarLeida(id: number, criterios: CriteriosNoLeidas): Promise<boolean>;

  /** Marca todo lo visible y no leído. Devuelve cuántas marcó (0 es una respuesta válida). */
  marcarTodasLeidas(criterios: CriteriosNoLeidas): Promise<number>;
}

/** Token de inyección de NestJS para el puerto `RepositorioNotificaciones`. */
export const REPOSITORIO_NOTIFICACIONES = 'RepositorioNotificaciones';
