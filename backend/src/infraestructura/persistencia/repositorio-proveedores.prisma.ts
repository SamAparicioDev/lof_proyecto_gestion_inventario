/**
 * Adaptador Prisma de `RepositorioProveedores` (US15, T160).
 *
 * Espejo de `repositorio-categorias.prisma.ts`: traduce violaciones técnicas de Postgres a
 * errores de dominio tipados —`P2002` en el índice funcional `proveedores_nombre_normalizado_key`
 * → `Duplicado('nombre', …)`, `P2003` (clave foránea desde ingresos) → `EstadoInvalido`,
 * `P2025` → `NoEncontrado`— y cuenta el uso con un `groupBy`, no con un `_count` por fila, que
 * en un listado serían N consultas.
 *
 * Implementa: FR-091…FR-093.
 */
import { construirBusquedaPorTerminos } from './busqueda-por-terminos';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Duplicado, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import type { EstadoProveedor, Proveedor, ProveedorConUso } from '../../dominio/entidades/proveedor';
import type {
  DatosProveedor,
  FiltrosListarProveedores,
  RepositorioProveedores,
} from '../../dominio/puertos/repositorio-proveedores';
import { PrismaService } from './prisma.service';

/** Fila tal como la devuelve Prisma, antes de convertir `BigInt` a `number`. */
type FilaProveedor = {
  id: bigint;
  nombre: string;
  nit: string | null;
  telefono: string | null;
  email: string | null;
  estado: EstadoProveedor;
  esSistema: boolean;
};

@Injectable()
export class RepositorioProveedoresPrisma implements RepositorioProveedores {
  constructor(private readonly prisma: PrismaService) {}

  async listar(filtros: FiltrosListarProveedores): Promise<ProveedorConUso[]> {
    const where: Prisma.ProveedorWhereInput = {};
    if (filtros.estado) where.estado = filtros.estado;
    // US22 (FR-118): un proveedor se busca por su nombre, pero también por su NIT o su
    // contacto cuando es lo único que se tiene a mano.
    const busqueda = construirBusquedaPorTerminos<Prisma.ProveedorWhereInput>(filtros.buscar, [
      (termino) => ({ nombre: { contains: termino, mode: 'insensitive' } }),
      (termino) => ({ nit: { contains: termino, mode: 'insensitive' } }),
      (termino) => ({ email: { contains: termino, mode: 'insensitive' } }),
      (termino) => ({ telefono: { contains: termino, mode: 'insensitive' } }),
    ]);
    if (busqueda) Object.assign(where, busqueda);

    const [proveedores, usos] = await Promise.all([
      this.prisma.proveedor.findMany({ where, orderBy: { nombre: 'asc' } }),
      this.prisma.ingreso.groupBy({ by: ['proveedorId'], _count: { _all: true } }),
    ]);

    const ingresosPorProveedor = new Map<string, number>(
      usos.map((uso) => [String(uso.proveedorId), uso._count._all]),
    );

    return proveedores.map((proveedor) => ({
      ...aProveedor(proveedor),
      cantidadIngresos: ingresosPorProveedor.get(String(proveedor.id)) ?? 0,
    }));
  }

  async buscarPorId(id: number): Promise<Proveedor | null> {
    const proveedor = await this.prisma.proveedor.findUnique({ where: { id: BigInt(id) } });
    return proveedor ? aProveedor(proveedor) : null;
  }

  /**
   * Compara por nombre normalizado con el MISMO criterio que el índice funcional de la BD
   * (`lower(btrim(nombre))`). Se resuelve con SQL crudo parametrizado porque Prisma no sabe
   * consultar por una expresión indexada, y hacerlo trayendo todos los proveedores a memoria
   * dejaría de usar el índice.
   */
  async buscarPorNombreNormalizado(nombreNormalizado: string): Promise<Proveedor | null> {
    // `es_sistema` se aliasea: el SQL crudo devuelve los nombres REALES de las columnas, y sin
    // el alias esta fila no tendría la misma forma que la que entrega el cliente de Prisma.
    const filas = await this.prisma.$queryRaw<FilaProveedor[]>`
      SELECT id, nombre, nit, telefono, email, estado, es_sistema AS "esSistema"
      FROM proveedores
      WHERE lower(btrim(nombre)) = ${nombreNormalizado}
      LIMIT 1
    `;
    const [fila] = filas;
    return fila ? aProveedor(fila) : null;
  }

  async crear(datos: DatosProveedor, usuarioId: number): Promise<number> {
    try {
      const creado = await this.prisma.proveedor.create({
        data: {
          nombre: datos.nombre,
          nit: datos.nit,
          telefono: datos.telefono,
          email: datos.email,
          usuarioCreacionId: BigInt(usuarioId),
        },
        select: { id: true },
      });
      return Number(creado.id);
    } catch (error) {
      throw traducirError(error);
    }
  }

  async actualizar(id: number, datos: DatosProveedor, usuarioId: number): Promise<void> {
    try {
      await this.prisma.proveedor.update({
        where: { id: BigInt(id) },
        data: {
          nombre: datos.nombre,
          nit: datos.nit,
          telefono: datos.telefono,
          email: datos.email,
          fechaModificacion: new Date(),
          usuarioModificacionId: BigInt(usuarioId),
        },
      });
    } catch (error) {
      throw traducirError(error);
    }
  }

  async cambiarEstado(id: number, estado: EstadoProveedor, usuarioId: number): Promise<void> {
    try {
      await this.prisma.proveedor.update({
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

  async contarIngresos(id: number): Promise<number> {
    return this.prisma.ingreso.count({ where: { proveedorId: BigInt(id) } });
  }

  async eliminar(id: number): Promise<void> {
    try {
      await this.prisma.proveedor.delete({ where: { id: BigInt(id) } });
    } catch (error) {
      throw traducirError(error);
    }
  }
}

function aProveedor(fila: FilaProveedor): Proveedor {
  return {
    id: Number(fila.id),
    nombre: fila.nombre,
    nit: fila.nit,
    telefono: fila.telefono,
    email: fila.email,
    estado: fila.estado,
    esSistema: fila.esSistema,
  };
}

/** `P2002` (índice funcional del nombre) → `Duplicado`; `P2003` (FK desde ingresos) →
 *  `EstadoInvalido`; `P2025` → `NoEncontrado`; cualquier otro error se propaga tal cual. */
function traducirError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new Duplicado('nombre', 'Ya existe un proveedor con ese nombre');
    }
    if (error.code === 'P2003') {
      return new EstadoInvalido('No se puede eliminar un proveedor que tiene ingresos asociados');
    }
    if (error.code === 'P2025') {
      return new NoEncontrado('El proveedor no existe');
    }
  }
  return error;
}
