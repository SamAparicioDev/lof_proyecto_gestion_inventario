/**
 * Caso de uso `ActualizarMiPerfilCasoUso` — un usuario corrige SUS PROPIOS datos personales
 * (`PUT /api/auth/perfil`, US14/FR-080).
 *
 * Existe separado de `ActualizarUsuarioCasoUso` (que administra a OTROS y exige el permiso
 * `usuarios.gestionar`) porque son dos capacidades distintas y mezclarlas obligaría a decidir
 * en tiempo de ejecución "¿me estoy editando a mí o a otro?" dentro de un mismo flujo — justo
 * la clase de ambigüedad que el control de acceso no debe tener (Principio III).
 *
 * ## Lo que NO se puede cambiar por aquí, y por qué (FR-082)
 *
 * - **El rol**: sería una escalada de privilegios directa — cualquiera se haría Administrador.
 *   Este caso de uso ni siquiera acepta un rol de entrada: LEE el del usuario en la base y lo
 *   reenvía tal cual, así que el rol que se persiste jamás procede del cliente.
 * - **El estado**: nadie se da de baja a sí mismo (mismo espíritu que el bloqueo de
 *   auto-desactivación de US6).
 * - **El nombre de usuario**: identifica sus registros históricos, igual que el SKU de un
 *   producto (criterio ya establecido en US6).
 * - **La contraseña**: ya la cambia `CambiarMiPasswordCasoUso`, que EXIGE la contraseña actual.
 *   Aceptarla aquí permitiría cambiarla sin conocer la anterior, debilitando esa garantía.
 *
 * La primera barrera es el esquema (`esquemaActualizarMiPerfil` no declara esos campos y Zod
 * descarta lo que no declara); esta es la segunda, en el servidor, porque una sola barrera en
 * el borde no basta para algo que concede privilegios.
 *
 * El `usuarioId` llega SIEMPRE del token de sesión y nunca del cuerpo (FR-081): por eso la ruta
 * no lleva `:id` y no hay forma de dirigir esta operación a otra persona.
 *
 * Implementa: FR-080 (editar los datos propios sin permiso especial), FR-081 (el afectado sale
 * de la sesión), FR-082 (rol/estado/login intocables por esta vía) y FR-083 (correo único).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { guardiaDeCapacidadAdministrativa } from '../comunes/proteccion-capacidad-administrativa';
import { NoEncontrado } from '../../dominio/comunes/errores';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';

/** Entrada: los dos campos editables + el id que resolvió el guard desde la sesión. */
export interface ActualizarMiPerfilEntrada {
  readonly usuarioId: number;
  readonly nombreCompleto: string;
  readonly email: string;
}

@Injectable()
export class ActualizarMiPerfilCasoUso implements CasoDeUso<ActualizarMiPerfilEntrada, void> {
  constructor(@Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios) {}

  async ejecutar(entrada: ActualizarMiPerfilEntrada): Promise<void> {
    const usuario = await this.repositorioUsuarios.buscarPorId(entrada.usuarioId);
    if (!usuario) {
      // Prácticamente inalcanzable: el guard ya revalidó al usuario en BD en esta misma
      // petición. Se comprueba igual porque el rol se lee de aquí, y ante un usuario ausente
      // la alternativa sería inventar uno.
      throw new NoEncontrado('El usuario');
    }

    await this.repositorioUsuarios.actualizar(
      entrada.usuarioId,
      {
        nombreCompleto: entrada.nombreCompleto,
        email: entrada.email,
        // El rol NO cambia: se reenvía el que el usuario YA tiene, leído de la base. Que este
        // valor no provenga nunca del cliente es lo que hace imposible la escalada (FR-082).
        rolId: usuario.rolAsignado.id,
      },
      // El guardia anti-bloqueo (FR-057) protege contra dejar al sistema sin quién lo
      // administre al CAMBIAR un rol. Aquí el rol es idéntico al vigente, así que no puede
      // retirarle capacidades a nadie; se pasa igualmente porque el puerto lo exige y porque
      // una comprobación de más nunca es el problema en una escritura de este tipo.
      guardiaDeCapacidadAdministrativa('editar tus datos personales'),
    );
  }
}
