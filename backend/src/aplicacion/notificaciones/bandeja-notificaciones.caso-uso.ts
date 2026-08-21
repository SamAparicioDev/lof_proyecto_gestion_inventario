/**
 * Casos de uso de LECTURA de la bandeja de avisos (US35, FR-141…FR-144, FR-147).
 *
 * Los cuatro viven en un archivo porque comparten la misma —y única— decisión de negocio: QUÉ
 * puede ver esta sesión. Separarlos en cuatro clases repartiría esa decisión en cuatro sitios,
 * que es exactamente cómo terminan divergiendo el listado y su contador.
 *
 * ## La autorización se calcula aquí, nunca llega en la petición
 *
 * `tiposVisiblesPara(permisos)` cruza la SUSCRIPCIÓN (`notificaciones.*`) con el permiso de
 * LECTURA del módulo (FR-141/FR-142). El resultado baja al repositorio como un filtro más, pero
 * no es un filtro del usuario: nada de lo que llegue por HTTP puede ampliarlo. Y si sale vacío,
 * la respuesta es una bandeja vacía —nunca un `403`— porque no tener suscripciones no es un
 * error de acceso: es no haberse suscrito.
 *
 * Implementa: FR-141/FR-142 (entrega por permiso de suscripción Y de lectura), FR-143 (el autor
 * se excluye, en el repositorio), FR-144 (leído por usuario, contador y marcado) y FR-147
 * (ventana acotada al alta del usuario y a los últimos 30 días).
 */
import { Inject, Injectable } from '@nestjs/common';
import { tiposVisiblesPara } from '../../dominio/entidades/notificacion';
import type { Usuario } from '../../dominio/entidades/usuario';
import {
  REPOSITORIO_NOTIFICACIONES,
  type CriteriosNoLeidas,
  type PaginaNotificaciones,
  type RepositorioNotificaciones,
} from '../../dominio/puertos/repositorio-notificaciones';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { inicioDeLaBandeja } from './ventana-bandeja';

/** Entrada de la bandeja: el usuario COMPLETO, no su id — hacen falta sus permisos y su alta. */
export interface BandejaEntrada {
  readonly usuario: Usuario;
  readonly soloNoLeidas: boolean;
  readonly pagina: number;
  readonly porPagina: number;
}

/** Lo que puede ver una sesión: los tres criterios que el repositorio necesita, en un objeto. */
function criteriosDe(usuario: Usuario): CriteriosNoLeidas {
  return {
    usuarioId: usuario.id,
    tipos: tiposVisiblesPara(usuario.rolAsignado.permisos),
    desde: inicioDeLaBandeja(usuario.fechaCreacion),
  };
}

/** `GET /api/notificaciones` — la bandeja paginada, con su contador de no leídas. */
@Injectable()
export class BandejaNotificacionesCasoUso implements CasoDeUso<BandejaEntrada, PaginaNotificaciones> {
  constructor(
    @Inject(REPOSITORIO_NOTIFICACIONES) private readonly repositorio: RepositorioNotificaciones,
  ) {}

  async ejecutar(entrada: BandejaEntrada): Promise<PaginaNotificaciones> {
    return this.repositorio.listar({
      ...criteriosDe(entrada.usuario),
      soloNoLeidas: entrada.soloNoLeidas,
      pagina: entrada.pagina,
      porPagina: entrada.porPagina,
    });
  }
}

/** `GET /api/notificaciones/resumen` — solo el número del indicador. Es la consulta que la
 *  campana repite cada tanto, así que se resuelve con un `count` y nada más. */
@Injectable()
export class ResumenNotificacionesCasoUso implements CasoDeUso<{ usuario: Usuario }, { noLeidas: number }> {
  constructor(
    @Inject(REPOSITORIO_NOTIFICACIONES) private readonly repositorio: RepositorioNotificaciones,
  ) {}

  async ejecutar(entrada: { usuario: Usuario }): Promise<{ noLeidas: number }> {
    return { noLeidas: await this.repositorio.contarNoLeidas(criteriosDe(entrada.usuario)) };
  }
}

/**
 * `POST /api/notificaciones/:id/leer` — marca UNA como leída.
 *
 * Devuelve `false` cuando el aviso no existe o no es visible para esta sesión, y el controlador
 * lo convierte en `404`. Los dos casos responden igual a propósito: distinguirlos diría "existe,
 * pero no es tuyo", que ya es información sobre lo que pasa en el sistema.
 */
@Injectable()
export class MarcarNotificacionLeidaCasoUso
  implements CasoDeUso<{ usuario: Usuario; notificacionId: number }, boolean>
{
  constructor(
    @Inject(REPOSITORIO_NOTIFICACIONES) private readonly repositorio: RepositorioNotificaciones,
  ) {}

  async ejecutar(entrada: { usuario: Usuario; notificacionId: number }): Promise<boolean> {
    return this.repositorio.marcarLeida(entrada.notificacionId, criteriosDe(entrada.usuario));
  }
}

/** `POST /api/notificaciones/leer-todas` — marca lo visible y no leído; devuelve cuántas. */
@Injectable()
export class MarcarTodasLeidasCasoUso implements CasoDeUso<{ usuario: Usuario }, { marcadas: number }> {
  constructor(
    @Inject(REPOSITORIO_NOTIFICACIONES) private readonly repositorio: RepositorioNotificaciones,
  ) {}

  async ejecutar(entrada: { usuario: Usuario }): Promise<{ marcadas: number }> {
    return { marcadas: await this.repositorio.marcarTodasLeidas(criteriosDe(entrada.usuario)) };
  }
}
