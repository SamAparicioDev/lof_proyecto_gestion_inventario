/**
 * Caso de uso `CrearRolCasoUso` — alta de un rol propio con su conjunto inicial de permisos
 * (`POST /api/roles`, FR-055). Es lo que hace posible el ejemplo de US9: crear un rol
 * "Bodeguero" que registra ingresos pero no despacha salidas, sin tocar código ni desplegar.
 *
 * Nace SIEMPRE `esSistema=false` y `estado=ACTIVO` — el caso de uso no recibe esos campos:
 * los tres roles del sistema los siembra la migración (FR-059) y no se crean desde la API.
 *
 * Delegación directa de los dos errores del contrato (mismo criterio que `CrearClienteCasoUso`
 * con el NIT duplicado): el adaptador Prisma traduce el `UNIQUE` de `roles.nombre` a
 * `Duplicado('nombre', ...)` y un `permisoId` que no existe en el catálogo a
 * `ErrorValidacionDominio` — ambos `400`, y ninguno deja el rol creado a medias (la matriz se
 * escribe en la misma sentencia anidada que el rol).
 *
 * Ningún invariante de FR-057 de "no dejar al sistema sin administrador" aplica al alta: crear
 * un rol nunca puede quitar quién administra — solo puede AGREGAR quién. Esos tres invariantes
 * viven en actualizar, cambiar estado y eliminar.
 *
 * Sí aplica, en cambio, la regla anti-escalada (`exigirQueNoConcedaPermisosQueNoTiene`): crear
 * un rol con permisos que el actor no tiene y asignárselo después es el mismo camino de
 * escalada que la edición, solo que en dos pasos — ver `comunes/proteccion-escalada-permisos.ts`.
 *
 * Implementa: FR-054 (los permisos son datos), FR-055 (crear roles y asignarles permisos) y
 * FR-056 (se marcan permisos del catálogo sembrado; no se crean permisos nuevos).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { exigirQueNoConcedaPermisosQueNoTiene } from '../comunes/proteccion-escalada-permisos';
import type { ClavePermiso } from '../../dominio/entidades/permiso';
import { REPOSITORIO_PERMISOS, type RepositorioPermisos } from '../../dominio/puertos/repositorio-permisos';
import { REPOSITORIO_ROLES, type RepositorioRoles } from '../../dominio/puertos/repositorio-roles';

/** Entrada: datos validados por `esquemaCrearRol` (FR-055). `permisosDelActor` NO viene del
 *  cuerpo: son los permisos efectivos del usuario autenticado, resueltos por el guard en esta
 *  misma petición (FR-058) — ver `proteccion-escalada-permisos.ts`. */
export interface CrearRolEntrada {
  readonly nombre: string;
  readonly descripcion?: string;
  readonly permisoIds: readonly number[];
  readonly permisosDelActor: readonly ClavePermiso[];
}

export interface CrearRolSalida {
  readonly id: number;
}

@Injectable()
export class CrearRolCasoUso implements CasoDeUso<CrearRolEntrada, CrearRolSalida> {
  constructor(
    @Inject(REPOSITORIO_ROLES) private readonly repositorioRoles: RepositorioRoles,
    @Inject(REPOSITORIO_PERMISOS) private readonly repositorioPermisos: RepositorioPermisos,
  ) {}

  async ejecutar(entrada: CrearRolEntrada): Promise<CrearRolSalida> {
    exigirQueNoConcedaPermisosQueNoTiene(
      entrada.permisoIds,
      await this.repositorioPermisos.listar(),
      entrada.permisosDelActor,
    );

    const rol = await this.repositorioRoles.crear({
      nombre: entrada.nombre,
      // La columna es NULLable (data-model.md § roles): "sin descripción" se guarda como NULL,
      // no como cadena vacía, para que la pantalla distinga un rol sin describir.
      descripcion: entrada.descripcion ?? null,
      permisoIds: entrada.permisoIds,
    });
    return { id: rol.id };
  }
}
