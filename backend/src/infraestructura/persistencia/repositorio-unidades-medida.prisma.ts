/**
 * Adaptador Prisma de `RepositorioUnidadesMedida` (US17, T180).
 *
 * Espejo de `repositorio-categorias.prisma.ts`, con una diferencia: hay DOS índices únicos
 * funcionales, así que traducir un `P2002` exige saber CUÁL de los dos chocó — el mensaje
 * "ya existe una unidad con ese nombre" sobre un choque de abreviatura mandaría al usuario a
 * corregir el campo equivocado. Prisma expone el índice violado en `error.meta.target`, y de ahí
 * sale el campo al que se ancla el error.
 *
 * Implementa: FR-101 (dos unicidades), FR-104 (búsqueda por nombre o abreviatura).
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Duplicado, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import type {
  EstadoUnidadMedida,
  UnidadMedida,
  UnidadMedidaConUso,
} from '../../dominio/entidades/unidad-medida';
import type {
  CoincidenciaUnidadMedida,
  DatosUnidadMedida,
  FiltrosListarUnidadesMedida,
  RepositorioUnidadesMedida,
} from '../../dominio/puertos/repositorio-unidades-medida';
import { PrismaService } from './prisma.service';

/** Fila tal como la devuelve Prisma, antes de convertir `BigInt` a `number`. */
type FilaUnidadMedida = {
  id: bigint;
  nombre: string;
  abreviatura: string;
  estado: EstadoUnidadMedida;
};

@Injectable()
export class RepositorioUnidadesMedidaPrisma implements RepositorioUnidadesMedida {
  constructor(private readonly prisma: PrismaService) {}

  async listar(filtros: FiltrosListarUnidadesMedida): Promise<UnidadMedidaConUso[]> {
    const where: Prisma.UnidadMedidaWhereInput = {};
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.buscar) {
      // Se busca en los DOS textos: quien escribe "kg" en el buscador espera encontrar
      // "Kilogramo", y quien escribe "kilo" también.
      where.OR = [
        { nombre: { contains: filtros.buscar, mode: 'insensitive' } },
        { abreviatura: { contains: filtros.buscar, mode: 'insensitive' } },
      ];
    }

    const [unidades, usos] = await Promise.all([
      this.prisma.unidadMedida.findMany({ where, orderBy: { nombre: 'asc' } }),
      this.prisma.producto.groupBy({ by: ['unidadMedidaId'], _count: { _all: true } }),
    ]);

    const productosPorUnidad = new Map<string, number>(
      usos
        .filter((uso) => uso.unidadMedidaId !== null)
        .map((uso) => [String(uso.unidadMedidaId), uso._count._all]),
    );

    return unidades.map((unidad) => ({
      ...aUnidadMedida(unidad),
      cantidadProductos: productosPorUnidad.get(String(unidad.id)) ?? 0,
    }));
  }

  async buscarPorId(id: number): Promise<UnidadMedida | null> {
    const unidad = await this.prisma.unidadMedida.findUnique({ where: { id: BigInt(id) } });
    return unidad ? aUnidadMedida(unidad) : null;
  }

  /**
   * Una sola consulta para los dos textos, con el MISMO criterio que los índices funcionales
   * (`lower(btrim(...))`). SQL crudo parametrizado porque Prisma no sabe consultar por una
   * expresión indexada, y traer todo el catálogo a memoria dejaría de usar el índice.
   *
   * El `ORDER BY` da prioridad a la coincidencia por NOMBRE cuando las dos ocurren a la vez:
   * es el campo que el usuario está mirando primero en el formulario.
   */
  async buscarPorTexto(
    nombreNormalizado: string,
    abreviaturaNormalizada: string,
  ): Promise<CoincidenciaUnidadMedida | null> {
    const filas = await this.prisma.$queryRaw<Array<FilaUnidadMedida & { coincide_nombre: boolean }>>`
      SELECT id, nombre, abreviatura, estado,
             lower(btrim(nombre)) = ${nombreNormalizado} AS coincide_nombre
      FROM unidades_medida
      WHERE lower(btrim(nombre)) = ${nombreNormalizado}
         OR lower(btrim(abreviatura)) = ${abreviaturaNormalizada}
      ORDER BY coincide_nombre DESC
      LIMIT 1
    `;
    const [fila] = filas;
    if (!fila) return null;
    return { unidad: aUnidadMedida(fila), campo: fila.coincide_nombre ? 'nombre' : 'abreviatura' };
  }

  async crear(datos: DatosUnidadMedida, usuarioId: number): Promise<number> {
    try {
      const creada = await this.prisma.unidadMedida.create({
        data: {
          nombre: datos.nombre,
          abreviatura: datos.abreviatura,
          usuarioCreacionId: BigInt(usuarioId),
        },
        select: { id: true },
      });
      return Number(creada.id);
    } catch (error) {
      throw traducirError(error);
    }
  }

  async actualizar(id: number, datos: DatosUnidadMedida, usuarioId: number): Promise<void> {
    try {
      await this.prisma.unidadMedida.update({
        where: { id: BigInt(id) },
        data: {
          nombre: datos.nombre,
          abreviatura: datos.abreviatura,
          fechaModificacion: new Date(),
          usuarioModificacionId: BigInt(usuarioId),
        },
      });
    } catch (error) {
      throw traducirError(error);
    }
  }

  async cambiarEstado(id: number, estado: EstadoUnidadMedida, usuarioId: number): Promise<void> {
    try {
      await this.prisma.unidadMedida.update({
        where: { id: BigInt(id) },
        data: {
          estado,
          fechaModificacion: new Date(),
          usuarioModificacionId: BigInt(usuarioId),
        },
      });
    } catch (error) {
      throw traducirError(error);
    }
  }

  async contarProductos(id: number): Promise<number> {
    return this.prisma.producto.count({ where: { unidadMedidaId: BigInt(id) } });
  }

  async eliminar(id: number): Promise<void> {
    try {
      await this.prisma.unidadMedida.delete({ where: { id: BigInt(id) } });
    } catch (error) {
      throw traducirError(error);
    }
  }
}

function aUnidadMedida(fila: FilaUnidadMedida): UnidadMedida {
  return {
    id: Number(fila.id),
    nombre: fila.nombre,
    abreviatura: fila.abreviatura,
    estado: fila.estado,
  };
}

/**
 * `P2002` → `Duplicado` anclado al campo REAL que chocó; `P2003` (FK desde productos) →
 * `EstadoInvalido`; `P2025` → `NoEncontrado`.
 *
 * El campo sale de `error.meta.target`, que trae el nombre del índice violado. Si algún día ese
 * metadato cambiara de forma, el `else` cae en `nombre`: un mensaje que señala un campo posible
 * es mejor que uno que no señala ninguno, y el usuario ve los dos en el mismo formulario.
 */
function traducirError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const indice = String(error.meta?.target ?? '');
      const campo = indice.includes('abreviatura') ? 'abreviatura' : 'nombre';
      return new Duplicado(
        campo,
        campo === 'abreviatura'
          ? 'Ya existe una unidad de medida con esa abreviatura'
          : 'Ya existe una unidad de medida con ese nombre',
      );
    }
    if (error.code === 'P2003') {
      return new EstadoInvalido('No se puede eliminar una unidad de medida que tiene productos asociados');
    }
    if (error.code === 'P2025') {
      return new NoEncontrado('La unidad de medida no existe');
    }
  }
  return error;
}
