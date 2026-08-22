/**
 * Adaptador `RepositorioSolicitudesPrisma` — implementa el puerto `RepositorioSolicitudes` con
 * Prisma (docs/arquitectura.md §3). Único punto del backend donde `solicitudes_funcionalidad` se
 * traduce a la entidad del dominio (US36, FR-148…FR-157).
 *
 * ## `pendientes` se cuenta aparte, y no por descuido
 *
 * El contador NO respeta el filtro de la consulta: cuando se está mirando la lista de
 * COMPLETADAS, "pendientes: 4" sigue diciendo 4. Es lo correcto — ese número responde "¿cuánto
 * trabajo hay esperando?", y esa respuesta no cambia porque quien mira haya cambiado de pestaña.
 * Un contador que se moviera con el filtro sería un total de página con nombre engañoso.
 *
 * ## Dos métodos de escritura para el mismo registro
 *
 * `actualizar` toca título y descripción; `guardarRefinado` toca prompt y fecha. Ninguno puede
 * escribir lo del otro, y ahí está la garantía de FR-152: el texto del autor y el de la máquina
 * llegan por caminos distintos, así que ningún llamador puede confundirlos aunque quiera.
 *
 * Implementa: FR-149, FR-150, FR-152, FR-153, FR-154, FR-157.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  EstadoSolicitudFuncionalidad,
  NuevaSolicitudFuncionalidad,
  SolicitudFuncionalidad,
} from '../../dominio/entidades/solicitud-funcionalidad';
import type {
  FiltrosSolicitudesFuncionalidad,
  PaginaSolicitudesFuncionalidad,
  RepositorioSolicitudes,
} from '../../dominio/puertos/repositorio-solicitudes';
import { PrismaService } from './prisma.service';

/** Las dos relaciones de auditoría que toda respuesta de este módulo necesita resueltas. */
const CON_AUTORES = {
  creadaPor: { select: { id: true, nombreCompleto: true } },
  estadoCambiadoPor: { select: { id: true, nombreCompleto: true } },
} satisfies Prisma.SolicitudFuncionalidadInclude;

type FilaConAutores = Prisma.SolicitudFuncionalidadGetPayload<{ include: typeof CON_AUTORES }>;

@Injectable()
export class RepositorioSolicitudesPrisma implements RepositorioSolicitudes {
  constructor(private readonly prisma: PrismaService) {}

  async crear(datos: NuevaSolicitudFuncionalidad): Promise<SolicitudFuncionalidad> {
    const fila = await this.prisma.solicitudFuncionalidad.create({
      data: {
        titulo: datos.titulo,
        descripcion: datos.descripcion,
        creadaPorId: BigInt(datos.creadaPorId),
      },
      include: CON_AUTORES,
    });
    return aDominio(fila);
  }

  async buscarPorId(id: number): Promise<SolicitudFuncionalidad | null> {
    const fila = await this.prisma.solicitudFuncionalidad.findUnique({
      where: { id: BigInt(id) },
      include: CON_AUTORES,
    });
    return fila ? aDominio(fila) : null;
  }

  async listar(filtros: FiltrosSolicitudesFuncionalidad): Promise<PaginaSolicitudesFuncionalidad> {
    const where: Prisma.SolicitudFuncionalidadWhereInput = filtros.estado ? { estado: filtros.estado } : {};

    // `pendientes` va SIN `where` a propósito: es el trabajo que espera, no el de esta vista.
    const [filas, total, pendientes] = await Promise.all([
      this.prisma.solicitudFuncionalidad.findMany({
        where,
        include: CON_AUTORES,
        orderBy: { creadaEn: 'desc' },
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
      }),
      this.prisma.solicitudFuncionalidad.count({ where }),
      this.prisma.solicitudFuncionalidad.count({ where: { estado: 'PENDIENTE' } }),
    ]);

    return { datos: filas.map(aDominio), total, pendientes };
  }

  async actualizar(id: number, datos: { titulo: string; descripcion: string }): Promise<SolicitudFuncionalidad> {
    const fila = await this.prisma.solicitudFuncionalidad.update({
      where: { id: BigInt(id) },
      data: { titulo: datos.titulo, descripcion: datos.descripcion },
      include: CON_AUTORES,
    });
    return aDominio(fila);
  }

  async guardarRefinado(id: number, prompt: string, generadoEn: Date): Promise<SolicitudFuncionalidad> {
    const fila = await this.prisma.solicitudFuncionalidad.update({
      where: { id: BigInt(id) },
      data: { promptRefinado: prompt, refinadoEn: generadoEn },
      include: CON_AUTORES,
    });
    return aDominio(fila);
  }

  async cambiarEstado(
    id: number,
    estado: EstadoSolicitudFuncionalidad,
    cambiadoPorId: number,
  ): Promise<SolicitudFuncionalidad> {
    const fila = await this.prisma.solicitudFuncionalidad.update({
      where: { id: BigInt(id) },
      data: {
        estado,
        estadoCambiadoPorId: BigInt(cambiadoPorId),
        estadoCambiadoEn: new Date(),
      },
      include: CON_AUTORES,
    });
    return aDominio(fila);
  }
}

/** Fila de Prisma → entidad del dominio. Los `BigInt` se bajan a `number` aquí, como en el resto
 *  de adaptadores: el dominio no conoce el tipo de la columna. */
function aDominio(fila: FilaConAutores): SolicitudFuncionalidad {
  return {
    id: Number(fila.id),
    titulo: fila.titulo,
    descripcion: fila.descripcion,
    promptRefinado: fila.promptRefinado,
    refinadoEn: fila.refinadoEn,
    estado: fila.estado,
    creadaPor: { id: Number(fila.creadaPor.id), nombreCompleto: fila.creadaPor.nombreCompleto },
    creadaEn: fila.creadaEn,
    estadoCambiadoPor: fila.estadoCambiadoPor
      ? { id: Number(fila.estadoCambiadoPor.id), nombreCompleto: fila.estadoCambiadoPor.nombreCompleto }
      : null,
    estadoCambiadoEn: fila.estadoCambiadoEn,
  };
}
