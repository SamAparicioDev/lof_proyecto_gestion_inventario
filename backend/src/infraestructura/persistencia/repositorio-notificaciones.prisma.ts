/**
 * Adaptador `RepositorioNotificacionesPrisma` — implementa el puerto
 * `RepositorioNotificaciones` con Prisma (docs/arquitectura.md §3). Único punto del backend
 * donde `notificaciones`/`notificaciones_lecturas` se traducen a la entidad del dominio.
 *
 * ## La condición de entrega no se escribe aquí
 *
 * Este adaptador NO decide quién ve qué: recibe `tipos` ya calculados por la aplicación con
 * `tiposVisiblesPara` y los usa tal cual. Es deliberado — la regla "suscripción Y permiso de
 * lectura" (FR-141/FR-142) es negocio, y escrita en un `where` de Prisma sería invisible para
 * quien lee el dominio y quedaría fuera de las pruebas puras.
 *
 * ## "Leída" es la AUSENCIA de una fila
 *
 * No hay columna booleana: una notificación está leída para alguien si existe su fila en
 * `notificaciones_lecturas`. Por eso el filtro de no leídas es un `none` sobre la relación y no
 * una comparación — y por eso emitir un aviso no escribe nada por cada destinatario posible.
 *
 * ## El autor nunca se cuenta ni se ve
 *
 * `usuarioOrigenId: { not: usuarioId }` va en TODAS las consultas, incluida la del contador
 * (FR-143). Si estuviera solo en el listado, el indicador diría "3" y la bandeja mostraría 2.
 *
 * Implementa: FR-139, FR-141…FR-144 y FR-147 (ventana acotada).
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Notificacion as NotificacionPrisma,
  TipoNotificacion as TipoNotificacionPrisma,
} from '@prisma/client';
import { CATALOGO_NOTIFICACIONES, type Notificacion, type NuevaNotificacion } from '../../dominio/entidades/notificacion';
import type {
  CriteriosNoLeidas,
  FiltrosNotificaciones,
  PaginaNotificaciones,
  RepositorioNotificaciones,
} from '../../dominio/puertos/repositorio-notificaciones';
import { PrismaService } from './prisma.service';

@Injectable()
export class RepositorioNotificacionesPrisma implements RepositorioNotificaciones {
  constructor(private readonly prisma: PrismaService) {}

  async crear(datos: NuevaNotificacion): Promise<void> {
    await this.prisma.notificacion.create({
      data: {
        tipo: datos.tipo as TipoNotificacionPrisma,
        titulo: datos.titulo,
        detalle: datos.detalle,
        // La clase de entidad NO viaja en el evento: es una propiedad del TIPO, y sacarla del
        // catálogo aquí impide que un emisor se equivoque y mande una salida a `/ingresos/7`.
        entidadTipo: CATALOGO_NOTIFICACIONES[datos.tipo].entidad,
        entidadId: BigInt(datos.entidadId),
        usuarioOrigenId: datos.usuarioOrigenId === null ? null : BigInt(datos.usuarioOrigenId),
      },
    });
  }

  async listar(filtros: FiltrosNotificaciones): Promise<PaginaNotificaciones> {
    // Sin tipos visibles no hay consulta que hacer: una sesión sin suscripciones tiene la
    // bandeja vacía por definición, y preguntárselo a la base sería `IN ()`.
    if (filtros.tipos.length === 0) {
      return { datos: [], total: 0, noLeidas: 0 };
    }

    const visibles = this.dondeVisibles(filtros);
    const where: Prisma.NotificacionWhereInput = filtros.soloNoLeidas
      ? { ...visibles, lecturas: { none: { usuarioId: BigInt(filtros.usuarioId) } } }
      : visibles;

    const [registros, total, noLeidas] = await this.prisma.$transaction([
      this.prisma.notificacion.findMany({
        where,
        // `id` desempata las del MISMO instante: varios avisos de una misma operación comparten
        // `now()`, y sin el desempate la paginación podría repetir o saltarse uno.
        orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
        // Solo hace falta saber SI hay lectura de este usuario, no cuál: un `select` de la PK.
        include: {
          lecturas: { where: { usuarioId: BigInt(filtros.usuarioId) }, select: { usuarioId: true } },
        },
      }),
      this.prisma.notificacion.count({ where }),
      this.prisma.notificacion.count({
        where: { ...visibles, lecturas: { none: { usuarioId: BigInt(filtros.usuarioId) } } },
      }),
    ]);

    return {
      datos: registros.map((registro) => aNotificacionDominio(registro, registro.lecturas.length > 0)),
      total,
      noLeidas,
    };
  }

  async contarNoLeidas(criterios: CriteriosNoLeidas): Promise<number> {
    if (criterios.tipos.length === 0) return 0;
    return this.prisma.notificacion.count({
      where: {
        ...this.dondeVisibles(criterios),
        lecturas: { none: { usuarioId: BigInt(criterios.usuarioId) } },
      },
    });
  }

  async marcarLeida(id: number, criterios: CriteriosNoLeidas): Promise<boolean> {
    if (criterios.tipos.length === 0) return false;

    // La visibilidad se comprueba en la MISMA consulta que localiza la fila: sin ese `where`,
    // marcar como leída sería una forma de averiguar qué ids existen.
    const visible = await this.prisma.notificacion.findFirst({
      where: { id: BigInt(id), ...this.dondeVisibles(criterios) },
      select: { id: true },
    });
    if (!visible) return false;

    // Idempotente: marcarla dos veces no es un error ni actualiza la fecha de la primera vez.
    await this.prisma.notificacionLectura.createMany({
      data: [{ notificacionId: BigInt(id), usuarioId: BigInt(criterios.usuarioId) }],
      skipDuplicates: true,
    });
    return true;
  }

  async marcarTodasLeidas(criterios: CriteriosNoLeidas): Promise<number> {
    if (criterios.tipos.length === 0) return 0;

    const pendientes = await this.prisma.notificacion.findMany({
      where: {
        ...this.dondeVisibles(criterios),
        lecturas: { none: { usuarioId: BigInt(criterios.usuarioId) } },
      },
      select: { id: true },
    });
    if (pendientes.length === 0) return 0;

    const { count } = await this.prisma.notificacionLectura.createMany({
      data: pendientes.map((fila) => ({ notificacionId: fila.id, usuarioId: BigInt(criterios.usuarioId) })),
      skipDuplicates: true,
    });
    return count;
  }

  /**
   * Las tres condiciones que definen "esta sesión puede ver este aviso", en un solo sitio:
   * es de un tipo al que está suscrita, no lo provocó ella y está dentro de la ventana.
   *
   * Vive en un helper y no repetido en cada método porque olvidarla en UNO solo —el contador,
   * por ejemplo— produce el defecto más difícil de ver: un número que no cuadra con la lista.
   */
  private dondeVisibles(criterios: CriteriosNoLeidas): Prisma.NotificacionWhereInput {
    return {
      tipo: { in: criterios.tipos as TipoNotificacionPrisma[] },
      // La exclusión del autor se escribe como OR explícito y no como `{ not: id }`: la columna
      // es NULLABLE (un aviso puede no tener autor) y en SQL `usuario_origen_id <> 7` NO incluye
      // las filas NULL — un aviso del sistema desaparecería para todo el mundo sin que nada
      // fallara. Esto dice exactamente lo que quiere decir: "de otro, o de nadie".
      OR: [{ usuarioOrigenId: null }, { usuarioOrigenId: { not: BigInt(criterios.usuarioId) } }],
      creadaEn: { gte: criterios.desde },
    };
  }
}

/** Traduce una fila de `notificaciones` a la entidad del dominio (`BigInt`→`number`). */
function aNotificacionDominio(registro: NotificacionPrisma, leida: boolean): Notificacion {
  return {
    id: Number(registro.id),
    tipo: registro.tipo,
    titulo: registro.titulo,
    detalle: registro.detalle,
    entidadTipo: registro.entidadTipo,
    entidadId: Number(registro.entidadId),
    usuarioOrigenId: registro.usuarioOrigenId === null ? null : Number(registro.usuarioOrigenId),
    creadaEn: registro.creadaEn,
    leida,
  };
}
