/**
 * Caso de uso `RestablecerPasswordUsuarioCasoUso` — un Administrador asigna una contraseña
 * temporal a OTRO usuario (`PUT /api/usuarios/:id/restablecer-password`, FR-005), sin
 * necesitar conocer la contraseña anterior (a diferencia de `CambiarMiPasswordCasoUso`, que
 * sí la exige porque ahí el usuario cambia la SUYA). Reutiliza el método
 * `actualizarPassword` YA EXISTENTE del puerto (compartido con `CambiarMiPasswordCasoUso`) en
 * vez de agregar uno nuevo.
 *
 * Marca `debeCambiarPassword=true` para forzar que el usuario la cambie en su próximo login.
 *
 * NO se puede restablecer la contraseña de un usuario cuyo rol concede permisos que el actor
 * no tiene (`exigirQueElObjetivoNoTengaMasPermisos`, corrección de la revisión adversarial de
 * la Tanda 13): es la otra mitad de la protección contra la escalada de privilegios que
 * `rol-asignado.ts` documenta. Impedir que alguien con `usuarios.gestionar` se ASIGNE el rol
 * Administrador no sirve de nada si puede fijarle una contraseña temporal al Administrador y
 * entrar con ella — sería la misma escalada por otra puerta del mismo controlador. Con los
 * tres roles del sistema no cambia nada observable (SC-013): el único que hoy tiene
 * `usuarios.gestionar` es Administrador, que concede los 30 permisos del catálogo.
 *
 * Implementa: FR-005 (restablecimiento de contraseña por el Administrador), FR-007 (la
 * contraseña temporal se hashea con el puerto `Hasheador` antes de persistirla, nunca en
 * texto plano) y FR-057 (la capacidad de administrar el sistema no se toma por asalto).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { NoEncontrado } from '../../dominio/comunes/errores';
import type { ClavePermiso } from '../../dominio/entidades/permiso';
import { HASHEADOR, type Hasheador } from '../../dominio/puertos/hasheador';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';
import { exigirQueElObjetivoNoTengaMasPermisos } from './rol-asignado';

/** Entrada: datos validados por `esquemaRestablecerPasswordUsuario` (FR-005) + el actor. */
export interface RestablecerPasswordUsuarioEntrada {
  readonly usuarioId: number;
  readonly passwordTemporal: string;
  /** Permisos efectivos de quien restablece — del token/BD, NUNCA del cuerpo (FR-058). */
  readonly permisosDelActor: readonly ClavePermiso[];
}

@Injectable()
export class RestablecerPasswordUsuarioCasoUso implements CasoDeUso<RestablecerPasswordUsuarioEntrada, void> {
  constructor(
    @Inject(HASHEADOR) private readonly hasheador: Hasheador,
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
  ) {}

  async ejecutar(entrada: RestablecerPasswordUsuarioEntrada): Promise<void> {
    const usuarioExistente = await this.repositorioUsuarios.buscarPorId(entrada.usuarioId);
    if (!usuarioExistente) {
      throw new NoEncontrado('El usuario');
    }
    exigirQueElObjetivoNoTengaMasPermisos(usuarioExistente.rolAsignado, entrada.permisosDelActor);

    const passwordHash = await this.hasheador.hash(entrada.passwordTemporal);
    await this.repositorioUsuarios.actualizarPassword(entrada.usuarioId, passwordHash, true);
  }
}
