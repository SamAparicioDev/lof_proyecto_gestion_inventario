/**
 * Caso de uso `CrearUsuarioCasoUso` — alta de un usuario del sistema por un Administrador
 * (`POST /api/usuarios`, FR-005). Hashea la contraseña temporal con el puerto `Hasheador`
 * ANTES de llamar al repositorio: `RepositorioUsuarios.crear` nunca recibe texto plano
 * (FR-007). `debeCambiarPassword=true` y `estado=ACTIVO` quedan implícitos por los defaults
 * de Prisma en el adaptador — este caso de uso no los fija explícitamente (ver TSDoc de
 * `repositorio-usuarios.prisma.ts`).
 *
 * Delegación directa: `login`/`email` duplicados ya los traduce el adaptador Prisma a
 * `Duplicado('login', ...)`/`Duplicado('email', ...)` (FR-009); este caso de uso no
 * pre-valida unicidad, lo hace el filtro global (mismo criterio que `CrearClienteCasoUso`).
 *
 * Sí pre-valida el ROL (US9/T106): desde que los roles son datos administrables (FR-054) el
 * alta recibe `rolId`, y un id inexistente debe rechazarse con un mensaje de campo en español
 * —no con el `404` genérico que produciría la violación de la FK— para que el formulario lo
 * pinte junto al selector. Y desde la corrección de la revisión adversarial de la Tanda 13,
 * `exigirRolAsignable` verifica además que el rol NO conceda permisos que quien lo asigna no
 * tenga: sin eso, cualquier rol propio con `usuarios.gestionar` podía crear (o convertirse en)
 * un Administrador total (ver TSDoc de `rol-asignado.ts`).
 *
 * No necesita la red de FR-057: dar de alta un usuario nunca puede REDUCIR la capacidad de
 * administrar el sistema, solo ampliarla.
 *
 * Implementa: FR-005 (alta de usuario por el Administrador), FR-006 (rol asignado en el
 * alta), FR-007 (la contraseña nunca viaja en texto plano ni se serializa el hash) y FR-057
 * (nadie reparte permisos que no tiene).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import type { ClavePermiso } from '../../dominio/entidades/permiso';
import { HASHEADOR, type Hasheador } from '../../dominio/puertos/hasheador';
import { REPOSITORIO_ROLES, type RepositorioRoles } from '../../dominio/puertos/repositorio-roles';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';
import { exigirRolAsignable } from './rol-asignado';

/** Entrada: datos validados por `esquemaCrearUsuario` (FR-005) + el contexto del actor. */
export interface CrearUsuarioEntrada {
  readonly nombreCompleto: string;
  readonly email: string;
  readonly login: string;
  readonly passwordTemporal: string;
  readonly rolId: number;
  /** Permisos efectivos de quien ejecuta el alta — del token/BD, NUNCA del cuerpo (FR-058). */
  readonly permisosDelActor: readonly ClavePermiso[];
  /** US30 (FR-127): el respaldo del sistema tiene la lista de permisos VACÍA, así que las
   *  reglas que comparan listas lo tratarían como al usuario con menos poder. Esta bandera es
   *  la misma decisión que toma `PermisosGuard`, y por el mismo motivo. */
  readonly actorEsSuperAdmin: boolean;
}

export interface CrearUsuarioSalida {
  readonly id: number;
}

@Injectable()
export class CrearUsuarioCasoUso implements CasoDeUso<CrearUsuarioEntrada, CrearUsuarioSalida> {
  constructor(
    @Inject(HASHEADOR) private readonly hasheador: Hasheador,
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
    @Inject(REPOSITORIO_ROLES) private readonly repositorioRoles: RepositorioRoles,
  ) {}

  async ejecutar(entrada: CrearUsuarioEntrada): Promise<CrearUsuarioSalida> {
    await exigirRolAsignable(
      this.repositorioRoles,
      entrada.rolId,
      entrada.permisosDelActor,
      entrada.actorEsSuperAdmin,
    );

    const passwordHash = await this.hasheador.hash(entrada.passwordTemporal);
    const usuario = await this.repositorioUsuarios.crear({
      nombreCompleto: entrada.nombreCompleto,
      email: entrada.email,
      login: entrada.login,
      passwordHash,
      rolId: entrada.rolId,
    });
    return { id: usuario.id };
  }
}
