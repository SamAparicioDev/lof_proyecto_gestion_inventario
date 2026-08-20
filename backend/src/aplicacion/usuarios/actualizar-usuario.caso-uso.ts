/**
 * Caso de uso `ActualizarUsuarioCasoUso` — edición de los datos de un usuario existente por
 * un Administrador (`PUT /api/usuarios/:id`, FR-005). Sin `login` (identificador de negocio
 * inmutable tras el alta) ni contraseña (se gestiona vía `RestablecerPasswordUsuarioCasoUso`).
 *
 * Verifica existencia con `buscarPorId` antes de escribir (a diferencia de
 * `ActualizarClienteCasoUso`, que delega el `404` al adaptador): así lo especifica el diseño
 * de esta tanda. El correo duplicado lo traduce el adaptador Prisma a
 * `Duplicado('email', ...)` (FR-009).
 *
 * Desde US9/T106 la edición también CAMBIA EL ROL, que llega como `rolId` (los roles son datos
 * administrables — FR-054); cambiar el rol de un usuario surte efecto en su siguiente petición,
 * sin re-login, porque los permisos se resuelven en cada una (US9-AS3). Precisamente por eso
 * esta es la operación más peligrosa del módulo, y la revisión adversarial de la Tanda 13
 * encontró que no verificaba NADA más allá de que el rol existiera. Ahora pasa por las dos
 * mitades de FR-057, y por eso el rol se resuelve ANTES de escribir:
 *
 * 1. **Hacia arriba — no se conceden permisos propios que no se tienen** (`exigirRolAsignable`,
 *    hallazgo HIGH): un rol propio con `usuarios.gestionar` se autoasignaba el rol
 *    Administrador en UNA petición y se quedaba con los 30 permisos, `roles.gestionar`
 *    incluido. Ver el TSDoc de `rol-asignado.ts`.
 * 2. **Hacia abajo — no se deja al sistema sin quién lo administre** (`guardia`, hallazgo
 *    CRITICAL): degradar al último usuario que podía administrar roles/usuarios dejaba el
 *    sistema irrecuperable por HTTP (había que restaurar con SQL). La verificación es
 *    TRANSACCIONAL y vive en el adaptador —bloqueo `FOR UPDATE` de los titulares actuales +
 *    revalidación en la misma transacción— porque comprobar aquí y escribir después deja una
 *    ventana entre ambas (ver `GuardiaCapacidadAdministrativa`). Cubre también la
 *    auto-degradación: el actor que se quita a sí mismo el último rol capaz de administrar es
 *    solo un caso particular de "no queda ningún titular activo", sin necesidad de comparar
 *    ids.
 *
 * Implementa: FR-005 (edición de usuario por el Administrador), FR-006 (rol asignado),
 * FR-009 (unicidad de email) y FR-057 (ninguna operación deja a la organización sin capacidad
 * de administrar roles o usuarios, ni reparte esa capacidad sin control).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { guardiaDeCapacidadAdministrativa } from '../comunes/proteccion-capacidad-administrativa';
import { NoEncontrado } from '../../dominio/comunes/errores';
import { exigirQueElObjetivoNoSeaElRespaldo } from '../comunes/respaldo-del-sistema';
import type { ClavePermiso } from '../../dominio/entidades/permiso';
import { REPOSITORIO_ROLES, type RepositorioRoles } from '../../dominio/puertos/repositorio-roles';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';
import { exigirRolAsignable } from './rol-asignado';

/** Entrada: datos validados por `esquemaActualizarUsuario` (FR-005) + el contexto del actor. */
export interface ActualizarUsuarioEntrada {
  readonly usuarioId: number;
  readonly nombreCompleto: string;
  readonly email: string;
  readonly rolId: number;
  /** Permisos efectivos de quien ejecuta la edición — del token/BD, NUNCA del cuerpo (FR-058). */
  readonly permisosDelActor: readonly ClavePermiso[];
  /** US30 (FR-127): el respaldo del sistema tiene la lista de permisos VACÍA, así que las
   *  reglas que comparan listas lo tratarían como al usuario con menos poder. Esta bandera es
   *  la misma decisión que toma `PermisosGuard`, y por el mismo motivo. */
  readonly actorEsSuperAdmin: boolean;
}

@Injectable()
export class ActualizarUsuarioCasoUso implements CasoDeUso<ActualizarUsuarioEntrada, void> {
  constructor(
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
    @Inject(REPOSITORIO_ROLES) private readonly repositorioRoles: RepositorioRoles,
  ) {}

  async ejecutar(entrada: ActualizarUsuarioEntrada): Promise<void> {
    const usuarioExistente = await this.repositorioUsuarios.buscarPorId(entrada.usuarioId);
    if (!usuarioExistente) {
      throw new NoEncontrado('El usuario');
    }
    // US30 (FR-128): editar al respaldo incluye poder cambiarle el rol, que es la forma directa
    // de anularlo. Se comprueba sobre el rol que el usuario TIENE, no sobre el que se le envía.
    exigirQueElObjetivoNoSeaElRespaldo(usuarioExistente.rolAsignado, entrada.actorEsSuperAdmin, 'editar');

    await exigirRolAsignable(
      this.repositorioRoles,
      entrada.rolId,
      entrada.permisosDelActor,
      entrada.actorEsSuperAdmin,
    );

    await this.repositorioUsuarios.actualizar(
      entrada.usuarioId,
      {
        nombreCompleto: entrada.nombreCompleto,
        email: entrada.email,
        rolId: entrada.rolId,
      },
      guardiaDeCapacidadAdministrativa(`cambiarle el rol a "${usuarioExistente.nombreCompleto}"`),
    );
  }
}
