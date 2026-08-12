/**
 * Adaptador `RepositorioPermisosPrisma` — implementa el puerto `RepositorioPermisos` del
 * dominio con Prisma (patrón Repository/Adapter, docs/arquitectura.md §3).
 *
 * Tiene una sola operación de LECTURA porque el catálogo de permisos no se administra desde
 * la aplicación (FR-056): lo siembran la migración y `prisma/seed.ts`, y su ciclo de vida es
 * el del despliegue. Por eso aquí no hay `crear`/`actualizar`/`eliminar` que traducir, ni
 * errores técnicos que mapear.
 *
 * Implementa: FR-054 (permisos como datos) y FR-056 (catálogo de solo lectura), sirviendo a
 * `GET /api/permisos`.
 */
import { Injectable } from '@nestjs/common';
import type { Permiso as PermisoPrisma } from '@prisma/client';
import type { Permiso } from '../../dominio/entidades/permiso';
import type { RepositorioPermisos } from '../../dominio/puertos/repositorio-permisos';
import { PrismaService } from './prisma.service';

@Injectable()
export class RepositorioPermisosPrisma implements RepositorioPermisos {
  constructor(private readonly prisma: PrismaService) {}

  async listar(): Promise<Permiso[]> {
    // Ordenado por módulo y clave: es el orden en que la pantalla de roles agrupa las
    // casillas, y hace que la agrupación sea un recorrido simple, sin ordenar en memoria.
    const registros = await this.prisma.permiso.findMany({
      orderBy: [{ modulo: 'asc' }, { clave: 'asc' }],
    });
    return registros.map(aPermisoDominio);
  }
}

/** Traduce una fila de `permisos` a la entidad de dominio (ids `BigInt` → `number`). */
function aPermisoDominio(registro: PermisoPrisma): Permiso {
  return {
    id: Number(registro.id),
    clave: registro.clave,
    modulo: registro.modulo,
    descripcion: registro.descripcion,
  };
}
