/**
 * Caso de uso `EliminarRolCasoUso` — borra un rol propio (`DELETE /api/roles/:id`, FR-055).
 * Es la ÚNICA eliminación física de la aplicación, y solo es admisible porque un rol sin
 * usuarios no forma parte de ninguna historia auditable: no hay movimientos ni documentos que
 * apunten a él (Principio II). Todo lo demás del sistema se da de baja lógicamente.
 *
 * Los tres invariantes de FR-057 se verifican AQUÍ, antes de tocar la base, y en este orden —
 * cada uno responde `409` con un mensaje que dice qué hacer en su lugar:
 *
 * 1. **Un rol del sistema no se elimina**: Administrador, Gerente y Operario son la definición
 *    de fábrica (FR-059); el seed los volvería a crear en la siguiente corrida.
 * 2. **Un rol con usuarios asignados no se elimina**, y el mensaje dice CUÁNTOS lo tienen
 *    (US9-AS5): eliminarlo dejaría usuarios sin rol —imposible, `usuarios.rol_id` es NOT NULL
 *    con FK `ON DELETE RESTRICT`— así que la alternativa correcta es desactivarlo.
 * 3. **No se puede eliminar el último rol activo con un permiso CRÍTICO**: eliminar al último
 *    que concede el permiso es la forma más definitiva de "quitárselo al último rol que lo
 *    tiene" (FR-057), y la única irreversible. Ver la anotación de T105 en
 *    contracts/api-rest.md § Roles y permisos: el contrato enumeraba solo los dos primeros
 *    casos, y se amplió antes de escribir este código en vez de improvisarlo aquí. Desde la
 *    revisión adversarial de la Tanda 13 se verifican los DOS permisos críticos
 *    (`roles.gestionar` y `usuarios.gestionar`), no solo el primero.
 *
 * El punto 2 se verifica con `contarUsuarios` para poder decir cuántos son; la FK
 * `ON DELETE RESTRICT` queda como última línea de defensa si alguien asigna ese rol entre la
 * verificación y el borrado (el adaptador traduce esa carrera al mismo `409`). Ese mismo punto
 * 2 es la razón por la que aquí no hace falta contar USUARIOS con el permiso (como sí hace la
 * edición de la matriz): un rol que llega hasta el punto 3 tiene CERO usuarios, así que
 * eliminarlo no puede dejar a nadie sin permisos.
 *
 * Implementa: FR-055 (eliminar roles propios) y FR-057 (los tres invariantes anti-bloqueo).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import {
  capacidadQueConcede,
  exigirQueSigaHabiendoUnRolActivoQueConceda,
} from '../comunes/proteccion-capacidad-administrativa';
import { EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import { PERMISOS_CRITICOS_DE_ADMINISTRACION } from '../../dominio/entidades/permiso';
import { REPOSITORIO_ROLES, type RepositorioRoles } from '../../dominio/puertos/repositorio-roles';

/** Entrada: solo el id del rol — `DELETE` no lleva cuerpo (contracts/api-rest.md). */
export interface EliminarRolEntrada {
  readonly rolId: number;
}

@Injectable()
export class EliminarRolCasoUso implements CasoDeUso<EliminarRolEntrada, void> {
  constructor(@Inject(REPOSITORIO_ROLES) private readonly repositorioRoles: RepositorioRoles) {}

  async ejecutar(entrada: EliminarRolEntrada): Promise<void> {
    const rol = await this.repositorioRoles.buscarPorId(entrada.rolId);
    if (!rol) {
      throw new NoEncontrado('El rol');
    }

    if (rol.esSistema) {
      throw new EstadoInvalido(
        `"${rol.nombre}" es un rol del sistema y no se puede eliminar. Si ya no quieres asignarlo, ` +
          'quítale sus permisos o asigna otro rol a sus usuarios.',
      );
    }

    const cantidadUsuarios = await this.repositorioRoles.contarUsuarios(entrada.rolId);
    if (cantidadUsuarios > 0) {
      throw new EstadoInvalido(
        `No se puede eliminar el rol "${rol.nombre}": ${cantidadUsuarios} ${
          cantidadUsuarios === 1 ? 'usuario lo tiene asignado' : 'usuarios lo tienen asignado'
        }. Asígnales otro rol o desactiva este rol en vez de eliminarlo.`,
      );
    }

    for (const permiso of PERMISOS_CRITICOS_DE_ADMINISTRACION) {
      await exigirQueSigaHabiendoUnRolActivoQueConceda(
        this.repositorioRoles,
        rol,
        permiso,
        `No puedes eliminar el rol "${rol.nombre}": es el último rol activo con el permiso de ` +
          `${capacidadQueConcede(permiso)} y el sistema quedaría sin ningún rol que lo conceda.`,
      );
    }

    await this.repositorioRoles.eliminar(entrada.rolId);
  }
}
