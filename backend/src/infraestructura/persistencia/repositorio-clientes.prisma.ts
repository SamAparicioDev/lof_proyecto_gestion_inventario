/**
 * Adaptador `RepositorioClientesPrisma` — implementa el puerto `RepositorioClientes` del
 * dominio con Prisma (patrón Repository/Adapter, docs/arquitectura.md §3). Único punto del
 * backend donde el modelo `clientes` de Prisma se traduce a la entidad `Cliente` del
 * dominio: convierte `BigInt` a `number` (el dominio no conoce el tipo de columna de la BD
 * — docs/arquitectura.md §2).
 *
 * CRUD estándar SIN atomicidad de stock ni bloqueo de filas: a diferencia de
 * `repositorio-ingresos.prisma.ts`, esta historia no tiene invariante de stock que proteger
 * (Principio V, YAGNI) — cada método es una única operación de Prisma, sin
 * `UnidadDeTrabajo`.
 *
 * Traduce violaciones técnicas de Postgres a errores de dominio tipados: `P2002` (UNIQUE) en
 * `nit` → `Duplicado('nit', ...)` (FR-035) y `P2025` (registro inexistente) en
 * `actualizar`/`cambiarEstado` → `NoEncontrado` (contrato: `PUT /api/clientes/:id` → 404).
 *
 * Implementa: FR-034 (alta/edición de cliente), FR-035 (unicidad de NIT).
 */
import { construirBusquedaPorTerminos } from './busqueda-por-terminos';
import { Injectable } from '@nestjs/common';
import { Prisma, type EstadoCliente as EstadoClientePrisma } from '@prisma/client';
import { Duplicado, NoEncontrado } from '../../dominio/comunes/errores';
import type { Cliente, EstadoCliente } from '../../dominio/entidades/cliente';
import type {
  DatosCliente,
  FiltrosListarClientes,
  PaginaClientes,
  RepositorioClientes,
} from '../../dominio/puertos/repositorio-clientes';
import { PrismaService } from './prisma.service';

/**
 * Columnas de `clientes` que se leen para construir la entidad `Cliente` del dominio. Es un
 * `select` EXPLÍCITO y no un `findMany` completo: así agregar una columna a la tabla no la
 * cuela en cada fila de cada listado sin que nadie lo decida.
 *
 * (Hasta el 2026-08-15 esa precaución tenía un motivo concreto: `logo` era una columna `BYTEA`
 * de hasta 500 KB. Esa capacidad se retiró — ver FR-066 — y las dos columnas ya no existen.)
 */
const COLUMNAS_CLIENTE = {
  id: true,
  nombre: true,
  nit: true,
  telefono: true,
  email: true,
  direccion: true,
  ciudad: true,
  fechaRegistro: true,
  estado: true,
} satisfies Prisma.ClienteSelect;

/** Fila de `clientes` tal como la devuelve `COLUMNAS_CLIENTE`. */
type FilaCliente = Prisma.ClienteGetPayload<{ select: typeof COLUMNAS_CLIENTE }>;

@Injectable()
export class RepositorioClientesPrisma implements RepositorioClientes {
  constructor(private readonly prisma: PrismaService) {}

  async buscarPorId(id: number): Promise<Cliente | null> {
    const registro = await this.prisma.cliente.findUnique({ where: { id: BigInt(id) }, select: COLUMNAS_CLIENTE });
    return registro ? aClienteDominio(registro) : null;
  }

  async listar(filtros: FiltrosListarClientes): Promise<PaginaClientes> {
    const where = construirWhereListarClientes(filtros);
    const [registros, total] = await this.prisma.$transaction([
      this.prisma.cliente.findMany({
        where,
        select: COLUMNAS_CLIENTE,
        // Desempate por `id`: `nombre` de cliente no es único (el UNIQUE está en el NIT), así
        // que sin un segundo criterio el orden es inestable y la paginación duplicaría unos
        // clientes y escondería otros — mismo defecto corregido en salidas e ingresos.
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
      }),
      this.prisma.cliente.count({ where }),
    ]);
    return { datos: registros.map(aClienteDominio), total };
  }

  async crear(datos: DatosCliente, usuarioId: number): Promise<Cliente> {
    try {
      const registro = await this.prisma.cliente.create({
        data: {
          nombre: datos.nombre,
          nit: datos.nit,
          telefono: datos.telefono,
          email: datos.email,
          direccion: datos.direccion,
          ciudad: datos.ciudad,
          usuarioCreacionId: BigInt(usuarioId),
        },
        select: COLUMNAS_CLIENTE,
      });
      return aClienteDominio(registro);
    } catch (error) {
      throw traducirErrorEscrituraCliente(error);
    }
  }

  async actualizar(id: number, datos: DatosCliente, usuarioId: number): Promise<void> {
    try {
      await this.prisma.cliente.update({
        where: { id: BigInt(id) },
        data: {
          nombre: datos.nombre,
          nit: datos.nit,
          telefono: datos.telefono,
          email: datos.email,
          direccion: datos.direccion,
          ciudad: datos.ciudad,
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
        },
      });
    } catch (error) {
      throw traducirErrorEscrituraCliente(error);
    }
  }

  async cambiarEstado(id: number, estado: EstadoCliente, usuarioId: number): Promise<void> {
    try {
      await this.prisma.cliente.update({
        where: { id: BigInt(id) },
        data: {
          estado: mapearEstadoClienteAPrisma(estado),
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
        },
      });
    } catch (error) {
      throw traducirErrorEscrituraCliente(error);
    }
  }

  /**
   * Ciudades distintas presentes entre los clientes (US13, FR-076) — ver TSDoc del puerto.
   *
   * `groupBy` (no `findMany` + `distinct`) para que la deduplicación la haga PostgreSQL y solo
   * viajen los valores. Sin índice propio a propósito: `clientes` es una tabla pequeña por diseño
   * del negocio (spec.md § Assumptions proyecta decenas, no miles), donde el planner elige `Seq
   * Scan` de todas formas — el mismo razonamiento medido en rendimiento.md nota 6.
   */
  async ciudades(): Promise<string[]> {
    const filas = await this.prisma.cliente.groupBy({
      by: ['ciudad'],
      where: { ciudad: { not: null } },
      orderBy: { ciudad: 'asc' },
    });
    return filas
      .map((fila) => fila.ciudad)
      .filter((ciudad): ciudad is string => ciudad !== null && ciudad.trim() !== '');
  }

}

/** Filtro `buscar` (nombre/NIT, insensible a mayúsculas) + estado (`GET /api/clientes`). */
function construirWhereListarClientes(filtros: FiltrosListarClientes): Prisma.ClienteWhereInput {
  const condiciones: Prisma.ClienteWhereInput[] = [];
  // US22 (FR-118): por términos y sobre todo lo que identifica a un cliente. La ciudad y el
  // contacto entran como campos buscables porque son la forma natural de dar con uno cuando no
  // se recuerda el nombre exacto ("el de Medellín").
  const busqueda = construirBusquedaPorTerminos<Prisma.ClienteWhereInput>(filtros.buscar, [
    (termino) => ({ nombre: { contains: termino, mode: 'insensitive' } }),
    (termino) => ({ nit: { contains: termino, mode: 'insensitive' } }),
    (termino) => ({ ciudad: { contains: termino, mode: 'insensitive' } }),
    (termino) => ({ email: { contains: termino, mode: 'insensitive' } }),
    (termino) => ({ telefono: { contains: termino, mode: 'insensitive' } }),
  ]);
  if (busqueda) condiciones.push(busqueda);
  if (filtros.estado) condiciones.push({ estado: mapearEstadoClienteAPrisma(filtros.estado) });
  // US13 (FR-075/FR-076): igualdad exacta — el valor sale del selector de `ciudades()`, no de
  // que el usuario acierte la ortografía de un texto libre que capturó otra persona.
  if (filtros.ciudad) condiciones.push({ ciudad: filtros.ciudad });
  return condiciones.length > 0 ? { AND: condiciones } : {};
}

/** Traduce un registro Prisma de `clientes` a la entidad de dominio. */
function aClienteDominio(registro: FilaCliente): Cliente {
  return {
    id: Number(registro.id),
    nombre: registro.nombre,
    nit: registro.nit,
    telefono: registro.telefono,
    email: registro.email,
    direccion: registro.direccion,
    ciudad: registro.ciudad,
    fechaRegistro: registro.fechaRegistro,
    estado: mapearEstadoClienteDeDominio(registro.estado),
  };
}

function mapearEstadoClienteDeDominio(estado: EstadoClientePrisma): EstadoCliente {
  switch (estado) {
    case 'ACTIVO':
      return 'ACTIVO';
    case 'INACTIVO':
      return 'INACTIVO';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de cliente de Prisma sin mapeo al dominio: ${String(valorInesperado)}`);
    }
  }
}

function mapearEstadoClienteAPrisma(estado: EstadoCliente): EstadoClientePrisma {
  switch (estado) {
    case 'ACTIVO':
      return 'ACTIVO';
    case 'INACTIVO':
      return 'INACTIVO';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de cliente de dominio sin mapeo a Prisma: ${String(valorInesperado)}`);
    }
  }
}

/** `P2002` (UNIQUE de `nit`) → `Duplicado`; `P2025` (registro inexistente) → `NoEncontrado`;
 *  cualquier otro error técnico se propaga sin traducir (lo maneja el filtro global). */
function traducirErrorEscrituraCliente(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new Duplicado('nit', 'El NIT ya está registrado para otro cliente');
    if (error.code === 'P2025') return new NoEncontrado('El cliente');
  }
  return error;
}
