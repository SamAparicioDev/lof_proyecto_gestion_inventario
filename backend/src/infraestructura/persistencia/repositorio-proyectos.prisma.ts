/**
 * Adaptador `RepositorioProyectosPrisma` — implementa el puerto `RepositorioProyectos` del
 * dominio con Prisma (patrón Repository/Adapter, docs/arquitectura.md §3). Único punto del
 * backend donde el modelo `proyectos` de Prisma se traduce a la entidad `Proyecto` del
 * dominio: convierte `BigInt` a `number` y `Prisma.Decimal` a `number` (el dominio no
 * conoce el tipo de columna de la BD — docs/arquitectura.md §2).
 *
 * CRUD estándar SIN transacción (Principio V, YAGNI — no hay mutación de stock aquí, a
 * diferencia de `repositorio-ingresos.prisma.ts`, así que no se usa `UnidadDeTrabajo`).
 *
 * `proyectosDestino` es la traducción a SQL de `esDestinoValido` (`dominio/entidades/
 * proyecto.ts`, FR-038): filtra por `proyecto.estado = 'ACTIVO' AND cliente.estado =
 * 'ACTIVO'`, la MISMA regla que esa función pura evalúa en memoria — si la regla de dominio
 * cambia, este filtro debe cambiar junto con ella, nunca inventar una condición distinta.
 *
 * Traduce violaciones técnicas de Postgres a errores de dominio tipados: `P2002`
 * (`UNIQUE(cliente_id, nombre)`, constraint COMPUESTA) → `Duplicado('nombre', ...)` — el
 * campo que el usuario ve en el formulario es siempre "nombre" (el `clienteId` es implícito
 * en la ruta anidada, no un campo visible), sin importar el detalle exacto de `target` que
 * reporte Prisma para esa constraint (FR-036). `P2025` (registro inexistente) →
 * `NoEncontrado` (contrato: `PUT /api/proyectos/:id` → 404).
 *
 * Implementa: FR-036 (alta/edición de proyecto de un cliente), FR-038 (proyectos destino).
 */
import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type EstadoProyecto as EstadoProyectoPrisma,
  type Proyecto as ProyectoPrisma,
} from '@prisma/client';
import { Duplicado, NoEncontrado } from '../../dominio/comunes/errores';
import type { EstadoProyecto, Proyecto } from '../../dominio/entidades/proyecto';
import type {
  DatosActualizarProyecto,
  DatosNuevoProyecto,
  RepositorioProyectos,
} from '../../dominio/puertos/repositorio-proyectos';
import { PrismaService } from './prisma.service';

@Injectable()
export class RepositorioProyectosPrisma implements RepositorioProyectos {
  constructor(private readonly prisma: PrismaService) {}

  async buscarPorId(id: number): Promise<Proyecto | null> {
    const registro = await this.prisma.proyecto.findUnique({ where: { id: BigInt(id) } });
    return registro ? aProyectoDominio(registro) : null;
  }

  async listarPorCliente(clienteId: number): Promise<Proyecto[]> {
    const registros = await this.prisma.proyecto.findMany({
      where: { clienteId: BigInt(clienteId) },
      orderBy: { nombre: 'asc' },
    });
    return registros.map(aProyectoDominio);
  }

  /**
   * Consulta simple, sin transacción (no hay mutación de stock aquí). Ver TSDoc de cabecera:
   * este `where` ES la traducción SQL de `esDestinoValido` (FR-038) — cualquier cambio a esa
   * función pura debe reflejarse aquí también.
   */
  async proyectosDestino(clienteId: number): Promise<Proyecto[]> {
    const registros = await this.prisma.proyecto.findMany({
      where: { clienteId: BigInt(clienteId), estado: 'ACTIVO', cliente: { estado: 'ACTIVO' } },
      orderBy: { nombre: 'asc' },
    });
    return registros.map(aProyectoDominio);
  }

  async crear(datos: DatosNuevoProyecto, usuarioId: number): Promise<Proyecto> {
    try {
      const registro = await this.prisma.proyecto.create({
        data: {
          clienteId: BigInt(datos.clienteId),
          nombre: datos.nombre,
          descripcion: datos.descripcion,
          fechaInicio: datos.fechaInicio,
          fechaCierreEstimada: datos.fechaCierreEstimada,
          responsable: datos.responsable,
          presupuestoEstimado: datos.presupuestoEstimado,
          usuarioCreacionId: BigInt(usuarioId),
        },
      });
      return aProyectoDominio(registro);
    } catch (error) {
      throw traducirErrorEscrituraProyecto(error);
    }
  }

  async actualizar(id: number, datos: DatosActualizarProyecto, usuarioId: number): Promise<void> {
    try {
      await this.prisma.proyecto.update({
        where: { id: BigInt(id) },
        data: {
          nombre: datos.nombre,
          descripcion: datos.descripcion,
          fechaInicio: datos.fechaInicio,
          fechaCierreEstimada: datos.fechaCierreEstimada,
          responsable: datos.responsable,
          presupuestoEstimado: datos.presupuestoEstimado,
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
        },
      });
    } catch (error) {
      throw traducirErrorEscrituraProyecto(error);
    }
  }

  async cambiarEstado(id: number, estado: EstadoProyecto, usuarioId: number): Promise<void> {
    try {
      await this.prisma.proyecto.update({
        where: { id: BigInt(id) },
        data: {
          estado: mapearEstadoProyectoAPrisma(estado),
          usuarioModificacionId: BigInt(usuarioId),
          fechaModificacion: new Date(),
        },
      });
    } catch (error) {
      throw traducirErrorEscrituraProyecto(error);
    }
  }
}

/** Traduce un registro Prisma de `proyectos` a la entidad de dominio. */
function aProyectoDominio(registro: ProyectoPrisma): Proyecto {
  return {
    id: Number(registro.id),
    clienteId: Number(registro.clienteId),
    nombre: registro.nombre,
    descripcion: registro.descripcion,
    fechaInicio: registro.fechaInicio,
    fechaCierreEstimada: registro.fechaCierreEstimada,
    responsable: registro.responsable,
    presupuestoEstimado: registro.presupuestoEstimado ? registro.presupuestoEstimado.toNumber() : null,
    estado: mapearEstadoProyectoDeDominio(registro.estado),
  };
}

function mapearEstadoProyectoDeDominio(estado: EstadoProyectoPrisma): EstadoProyecto {
  switch (estado) {
    case 'ACTIVO':
      return 'ACTIVO';
    case 'COMPLETADO':
      return 'COMPLETADO';
    case 'SUSPENDIDO':
      return 'SUSPENDIDO';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de proyecto de Prisma sin mapeo al dominio: ${String(valorInesperado)}`);
    }
  }
}

function mapearEstadoProyectoAPrisma(estado: EstadoProyecto): EstadoProyectoPrisma {
  switch (estado) {
    case 'ACTIVO':
      return 'ACTIVO';
    case 'COMPLETADO':
      return 'COMPLETADO';
    case 'SUSPENDIDO':
      return 'SUSPENDIDO';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de proyecto de dominio sin mapeo a Prisma: ${String(valorInesperado)}`);
    }
  }
}

/** `P2002` (UNIQUE compuesta `cliente_id, nombre`) → `Duplicado('nombre', ...)` SIEMPRE (ver
 *  TSDoc de cabecera); `P2025` (registro inexistente) → `NoEncontrado`; cualquier otro error
 *  técnico se propaga sin traducir (lo maneja el filtro global). */
function traducirErrorEscrituraProyecto(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new Duplicado('nombre', 'Ya existe un proyecto con ese nombre para este cliente');
    }
    if (error.code === 'P2025') return new NoEncontrado('El proyecto');
  }
  return error;
}
