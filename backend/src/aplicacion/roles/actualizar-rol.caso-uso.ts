/**
 * Caso de uso `ActualizarRolCasoUso` — edita el nombre, la descripción y la MATRIZ DE
 * PERMISOS de un rol (`PUT /api/roles/:id`, FR-055). `permisoIds` reemplaza el conjunto
 * completo: desmarcar una casilla quita el permiso, y el cambio rige en la petición siguiente
 * de cada usuario con ese rol, sin re-login (US9-AS3).
 *
 * Dos reglas de negocio antes de escribir, ambas de FR-057 y ambas verificadas AQUÍ y no solo
 * en la pantalla (una petición directa a la API las esquivaría):
 *
 * 1. **Un rol del sistema no se renombra** (`409`, data-model.md § roles): Administrador,
 *    Gerente y Operario son la definición de fábrica del sistema (FR-059) y el seed los
 *    reconoce POR NOMBRE — renombrarlos crearía un duplicado en la siguiente corrida. Sus
 *    PERMISOS sí se pueden editar: es justamente lo que US9 le concede al dueño del negocio
 *    (el seed los restaura a su definición de fábrica; ver TSDoc de `prisma/seed.ts`).
 * 2. **Quitar un permiso CRÍTICO no puede dejar al sistema sin administración** (`409`) — el
 *    invariante anti-bloqueo compartido, ver
 *    `aplicacion/comunes/proteccion-capacidad-administrativa.ts`. La revisión adversarial de la
 *    Tanda 13 encontró dos agujeros aquí, y ambos se cierran en este método:
 *    - se verificaba SOLO `roles.gestionar`, cuando FR-057 dice "administrar roles **o
 *      usuarios**": una sola petición podía dejar al sistema sin nadie que administrara
 *      usuarios quitándole `usuarios.gestionar` al único rol que lo tenía, sin ningún `409`.
 *      Ahora se recorren los dos permisos críticos.
 *    - se contaban ROLES activos con el permiso, no USUARIOS que pudieran ejercerlo: bastaba
 *      crear antes un rol huérfano con `roles.gestionar` y CERO usuarios para que el conteo
 *      diera 2 y la edición pasara, dejando el sistema irrecuperable por HTTP. Ahora las dos
 *      verificaciones corren, y la segunda es la que cuenta gente.
 *
 * Implementa: FR-055 (editar un rol y su matriz de permisos), FR-057 (invariantes que impiden
 * dejar a la organización sin quién la administre) y FR-058 (los permisos que la autorización
 * consulta son estos datos, no una lista fija en el código).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import {
  capacidadQueConcede,
  exigirQueSigaHabiendoQuienPuedaEjercerlo,
  exigirQueSigaHabiendoUnRolActivoQueConceda,
} from '../comunes/proteccion-capacidad-administrativa';
import { exigirQueNoConcedaPermisosQueNoTiene } from '../comunes/proteccion-escalada-permisos';
import { EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import { PERMISOS_CRITICOS_DE_ADMINISTRACION, type ClavePermiso } from '../../dominio/entidades/permiso';
import { REPOSITORIO_PERMISOS, type RepositorioPermisos } from '../../dominio/puertos/repositorio-permisos';
import { REPOSITORIO_ROLES, type RepositorioRoles } from '../../dominio/puertos/repositorio-roles';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';

/** Entrada: datos validados por `esquemaActualizarRol` (FR-055). */
export interface ActualizarRolEntrada {
  readonly rolId: number;
  readonly nombre: string;
  readonly descripcion?: string;
  readonly permisoIds: readonly number[];
  /** Permisos efectivos del usuario autenticado, resueltos por el guard en esta misma petición
   *  (FR-058) — nunca un dato del cuerpo. Alimentan la regla anti-escalada
   *  (`comunes/proteccion-escalada-permisos.ts`). */
  readonly permisosDelActor: readonly ClavePermiso[];
}

@Injectable()
export class ActualizarRolCasoUso implements CasoDeUso<ActualizarRolEntrada, void> {
  constructor(
    @Inject(REPOSITORIO_ROLES) private readonly repositorioRoles: RepositorioRoles,
    @Inject(REPOSITORIO_PERMISOS) private readonly repositorioPermisos: RepositorioPermisos,
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
  ) {}

  async ejecutar(entrada: ActualizarRolEntrada): Promise<void> {
    const rol = await this.repositorioRoles.buscarPorId(entrada.rolId);
    if (!rol) {
      throw new NoEncontrado('El rol');
    }

    // Anti-escalada ANTES que cualquier otra validación: sin esto, `roles.gestionar` era
    // auto-escalable (un rol con ese único permiso podía concederse los 30 en una petición).
    // Ver `comunes/proteccion-escalada-permisos.ts`.
    exigirQueNoConcedaPermisosQueNoTiene(
      entrada.permisoIds,
      await this.repositorioPermisos.listar(),
      entrada.permisosDelActor,
    );

    if (rol.esSistema && entrada.nombre !== rol.nombre) {
      throw new EstadoInvalido(
        `"${rol.nombre}" es un rol del sistema: su nombre no se puede cambiar. Sí puedes ajustar ` +
          'su descripción y sus permisos.',
      );
    }

    for (const permiso of await this.permisosCriticosQueSeRetiran(rol.permisos, entrada.permisoIds)) {
      await exigirQueSigaHabiendoUnRolActivoQueConceda(
        this.repositorioRoles,
        rol,
        permiso,
        `No puedes quitarle el permiso de ${capacidadQueConcede(permiso)} a "${rol.nombre}": es el ` +
          'último rol activo que lo tiene y el sistema quedaría sin nadie que pueda ' +
          `${capacidadQueConcede(permiso)}.`,
      );
      await exigirQueSigaHabiendoQuienPuedaEjercerlo(
        this.repositorioUsuarios,
        permiso,
        rol.id,
        `No puedes quitarle el permiso de ${capacidadQueConcede(permiso)} a "${rol.nombre}": sus ` +
          'usuarios son los únicos que pueden ejercerlo y el sistema quedaría sin nadie que pueda ' +
          `${capacidadQueConcede(permiso)}.`,
      );
    }

    await this.repositorioRoles.actualizar(entrada.rolId, {
      nombre: entrada.nombre,
      descripcion: entrada.descripcion ?? null,
      permisoIds: entrada.permisoIds,
    });
  }

  /**
   * Permisos críticos que el rol tiene HOY y que la matriz entrante ya no le daría — los
   * únicos que pueden disparar un invariante de FR-057 (si el rol no lo tiene, ninguna matriz
   * nueva puede "quitárselo"; si la matriz nueva lo conserva, tampoco se pierde nada).
   *
   * El cuerpo trae IDs y los invariantes razonan en CLAVES, así que la correspondencia se
   * resuelve contra el catálogo — 30 filas de solo lectura versionadas con el código (FR-056),
   * que por eso no necesitan un método de búsqueda propio en el puerto (ver TSDoc de
   * `RepositorioPermisos`). El catálogo se lee UNA sola vez, y solo si el rol tiene algún
   * permiso crítico que perder.
   */
  private async permisosCriticosQueSeRetiran(
    permisosActuales: readonly ClavePermiso[],
    permisoIdsNuevos: readonly number[],
  ): Promise<ClavePermiso[]> {
    const criticosQueTiene = PERMISOS_CRITICOS_DE_ADMINISTRACION.filter((permiso) =>
      permisosActuales.includes(permiso),
    );
    if (criticosQueTiene.length === 0) {
      return [];
    }

    const catalogo = await this.repositorioPermisos.listar();
    const clavesNuevas = new Set(
      catalogo.filter((permiso) => permisoIdsNuevos.includes(permiso.id)).map((permiso) => permiso.clave),
    );
    return criticosQueTiene.filter((permiso) => !clavesNuevas.has(permiso));
  }
}
