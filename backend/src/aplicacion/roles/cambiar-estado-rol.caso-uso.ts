/**
 * Caso de uso `CambiarEstadoRolCasoUso` — activa o desactiva un rol
 * (`PUT /api/roles/:id/estado`, FR-055). Baja LÓGICA, nunca DELETE: un rol desactivado
 * conserva su historia y sus usuarios (data-model.md § roles).
 *
 * QUÉ SIGNIFICA DESACTIVAR UN ROL (decisión de T105, documentada porque ningún artefacto la
 * fijaba y T102 la dejó abierta a propósito): significa **"ya no se ofrece para asignar"**, no
 * "sus usuarios pierden el acceso". `PermisosGuard` no consulta el estado del rol, y así debe
 * seguir: US9-AS5 presenta desactivar como la ALTERNATIVA a eliminar para un rol con usuarios
 * ("el rol puede desactivarse, pero no eliminarse dejando usuarios sin rol"), de modo que si
 * desactivar dejara a esos usuarios sin permisos sería un despido masivo silencioso, no una
 * alternativa. Quien deba perder el acceso se desactiva como USUARIO (FR-008), que es la baja
 * que la spec sí define. La consecuencia práctica es que la pantalla de usuarios ofrece solo
 * roles ACTIVOS en su selector (`GET /api/roles?estado=ACTIVO`, T108).
 *
 * Dos reglas de negocio antes de escribir, verificadas AQUÍ y no solo en la pantalla:
 *
 * 1. **Un rol del sistema no se activa ni se desactiva** (`409`, contracts/api-rest.md):
 *    Administrador, Gerente y Operario son la definición de fábrica del sistema (FR-059) y
 *    deben poder asignarse siempre.
 * 2. **No se puede desactivar el último rol activo con un permiso CRÍTICO** (`409`) — el mismo
 *    invariante anti-bloqueo de FR-057 que protege a la edición, ver
 *    `aplicacion/comunes/proteccion-capacidad-administrativa.ts`. Es alcanzable pese a la regla
 *    1: basta que el Administrador haya movido ese permiso a un rol propio. Desde la revisión
 *    adversarial de la Tanda 13 se verifican los DOS permisos críticos (`roles.gestionar` y
 *    `usuarios.gestionar`), no solo el primero: FR-057 habla de "administrar roles **o
 *    usuarios**".
 *
 *    Aquí NO se cuenta gente (a diferencia de la edición de la matriz): desactivar un rol no le
 *    retira sus permisos a nadie —ese es el sentido de la baja lógica de un rol, ver arriba—,
 *    así que ningún usuario pierde nada. Lo que se protege es que quede al menos un rol
 *    ASIGNABLE con el permiso: un rol INACTIVO ya no se ofrece en el selector de usuarios.
 *
 * Implementa: FR-055 (activar/desactivar roles) y FR-057 (ninguna operación deja a la
 * organización sin quién administre roles ni usuarios).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import {
  capacidadQueConcede,
  exigirQueSigaHabiendoUnRolActivoQueConceda,
} from '../comunes/proteccion-capacidad-administrativa';
import { EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import { exigirQueNoSeaElRolDeRespaldo } from '../comunes/respaldo-del-sistema';
import { PERMISOS_CRITICOS_DE_ADMINISTRACION } from '../../dominio/entidades/permiso';
import type { EstadoRol } from '../../dominio/entidades/rol';
import { REPOSITORIO_ROLES, type RepositorioRoles } from '../../dominio/puertos/repositorio-roles';

/** Entrada: `estado` validado por `esquemaCambiarEstadoRol` (FR-055). */
export interface CambiarEstadoRolEntrada {
  readonly rolId: number;
  readonly estado: EstadoRol;
}

@Injectable()
export class CambiarEstadoRolCasoUso implements CasoDeUso<CambiarEstadoRolEntrada, void> {
  constructor(@Inject(REPOSITORIO_ROLES) private readonly repositorioRoles: RepositorioRoles) {}

  async ejecutar(entrada: CambiarEstadoRolEntrada): Promise<void> {
    const rol = await this.repositorioRoles.buscarPorId(entrada.rolId);
    if (!rol) {
      throw new NoEncontrado('El rol');
    }

    exigirQueNoSeaElRolDeRespaldo(rol, 'activar ni desactivar');

    if (rol.esSistema) {
      throw new EstadoInvalido(
        `"${rol.nombre}" es un rol del sistema: no se puede desactivar. Los tres roles iniciales ` +
          'deben poder asignarse siempre.',
      );
    }

    if (entrada.estado === 'INACTIVO') {
      for (const permiso of PERMISOS_CRITICOS_DE_ADMINISTRACION) {
        await exigirQueSigaHabiendoUnRolActivoQueConceda(
          this.repositorioRoles,
          rol,
          permiso,
          `No puedes desactivar el rol "${rol.nombre}": es el último rol activo con el permiso de ` +
            `${capacidadQueConcede(permiso)} y el sistema quedaría sin ningún rol asignable que lo ` +
            'conceda.',
        );
      }
    }

    await this.repositorioRoles.cambiarEstado(entrada.rolId, entrada.estado);
  }
}
