/**
 * Adaptador Prisma de `RepositorioCategorias` (US15, T149).
 *
 * Traduce violaciones técnicas de Postgres a errores de dominio tipados: `P2002` en el índice
 * funcional `categorias_nombre_normalizado_key` → `Duplicado('nombre', …)` (FR-085), `P2003`
 * (clave foránea) → `EstadoInvalido`, que es lo que ocurre si alguien intenta borrar una
 * categoría en uso saltándose la comprobación previa del caso de uso (FR-087), y `P2025` →
 * `NoEncontrado`.
 *
 * El conteo de productos NO se hace con un `include: { _count }` por comodidad: se pide
 * explícitamente con `groupBy`, porque la pantalla lo necesita para TODAS las categorías del
 * listado y un `_count` por fila serían N consultas.
 *
 * Implementa: FR-084…FR-088.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Duplicado, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import type { Categoria, CategoriaConUso, EstadoCategoria } from '../../dominio/entidades/categoria';
import type {
  DatosCategoria,
  FiltrosListarCategorias,
  RepositorioCategorias,
} from '../../dominio/puertos/repositorio-categorias';
import { PrismaService } from './prisma.service';

/** Fila tal como la devuelve Prisma, antes de convertir `BigInt` a `number`. */
type FilaCategoria = {
  id: bigint;
  nombre: string;
  descripcion: string | null;
  estado: EstadoCategoria;
};

@Injectable()
export class RepositorioCategoriasPrisma implements RepositorioCategorias {
  constructor(private readonly prisma: PrismaService) {}

  async listar(filtros: FiltrosListarCategorias): Promise<CategoriaConUso[]> {
    const where: Prisma.CategoriaWhereInput = {};
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.buscar) where.nombre = { contains: filtros.buscar, mode: 'insensitive' };

    const [categorias, usos] = await Promise.all([
      this.prisma.categoria.findMany({ where, orderBy: { nombre: 'asc' } }),
      this.prisma.producto.groupBy({ by: ['categoriaId'], _count: { _all: true } }),
    ]);

    const productosPorCategoria = new Map<string, number>(
      usos
        .filter((uso) => uso.categoriaId !== null)
        .map((uso) => [String(uso.categoriaId), uso._count._all]),
    );

    return categorias.map((categoria) => ({
      ...aCategoria(categoria),
      cantidadProductos: productosPorCategoria.get(String(categoria.id)) ?? 0,
    }));
  }

  async buscarPorId(id: number): Promise<Categoria | null> {
    const categoria = await this.prisma.categoria.findUnique({ where: { id: BigInt(id) } });
    return categoria ? aCategoria(categoria) : null;
  }

  /**
   * Compara por nombre normalizado con el MISMO criterio que el índice funcional de la BD
   * (`lower(btrim(nombre))`). Se resuelve con SQL crudo parametrizado porque Prisma no sabe
   * consultar por una expresión indexada, y hacerlo trayendo todas las categorías a memoria
   * dejaría de usar el índice.
   */
  async buscarPorNombreNormalizado(nombreNormalizado: string): Promise<Categoria | null> {
    const filas = await this.prisma.$queryRaw<FilaCategoria[]>`
      SELECT id, nombre, descripcion, estado
      FROM categorias
      WHERE lower(btrim(nombre)) = ${nombreNormalizado}
      LIMIT 1
    `;
    const [fila] = filas;
    return fila ? aCategoria(fila) : null;
  }

  async crear(datos: DatosCategoria, usuarioId: number): Promise<number> {
    try {
      const creada = await this.prisma.categoria.create({
        data: {
          nombre: datos.nombre,
          descripcion: datos.descripcion,
          usuarioCreacionId: BigInt(usuarioId),
        },
        select: { id: true },
      });
      return Number(creada.id);
    } catch (error) {
      throw traducirError(error);
    }
  }

  async actualizar(id: number, datos: DatosCategoria, usuarioId: number): Promise<void> {
    try {
      await this.prisma.categoria.update({
        where: { id: BigInt(id) },
        data: {
          nombre: datos.nombre,
          descripcion: datos.descripcion,
          fechaModificacion: new Date(),
          usuarioModificacionId: BigInt(usuarioId),
        },
      });
    } catch (error) {
      throw traducirError(error);
    }
  }

  async cambiarEstado(id: number, estado: EstadoCategoria, usuarioId: number): Promise<void> {
    try {
      await this.prisma.categoria.update({
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
    return this.prisma.producto.count({ where: { categoriaId: BigInt(id) } });
  }

  async eliminar(id: number): Promise<void> {
    try {
      await this.prisma.categoria.delete({ where: { id: BigInt(id) } });
    } catch (error) {
      throw traducirError(error);
    }
  }
}

function aCategoria(fila: FilaCategoria): Categoria {
  return {
    id: Number(fila.id),
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    estado: fila.estado,
  };
}

/** `P2002` (índice funcional del nombre) → `Duplicado`; `P2003` (FK desde productos) →
 *  `EstadoInvalido`; `P2025` → `NoEncontrado`; cualquier otro error se propaga tal cual. */
function traducirError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new Duplicado('nombre', 'Ya existe una categoría con ese nombre');
    }
    if (error.code === 'P2003') {
      return new EstadoInvalido('No se puede eliminar una categoría que tiene productos asociados');
    }
    if (error.code === 'P2025') {
      return new NoEncontrado('La categoría no existe');
    }
  }
  return error;
}
