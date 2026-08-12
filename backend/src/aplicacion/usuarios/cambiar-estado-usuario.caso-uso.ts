/**
 * Caso de uso `CambiarEstadoUsuarioCasoUso` — activa/desactiva un usuario (baja lógica,
 * `PUT /api/usuarios/:id/estado`, FR-008: nunca DELETE). Bloquea que un Administrador se
 * desactive A SÍ MISMO comparando el id del usuario objetivo contra el id de la sesión
 * activa (`usuarioActualId`, que el controlador toma de `@UsuarioActual()`, nunca del body) —
 * US6-AS, `EstadoInvalido` para que `FiltroErroresDominio` lo traduzca a `409`.
 *
 * Esa regla de US6 NO basta para FR-057, y la revisión adversarial de la Tanda 13 lo demostró:
 * dos administradores que se desactivan MUTUAMENTE ven cada uno un objetivo distinto de sí
 * mismo, ninguna de las dos peticiones se bloquea, y el sistema termina con CERO usuarios que
 * puedan administrarlo — peor que los demás caminos, porque ninguno de los dos puede siquiera
 * iniciar sesión para repararlo. Por eso la baja pasa además por `guardia`: la garantía es
 * TRANSACCIONAL (bloqueo `FOR UPDATE` de los titulares actuales de los permisos críticos +
 * revalidación dentro de la misma transacción, ver `GuardiaCapacidadAdministrativa`), no una
 * comprobación previa que otra petición simultánea pueda dejar obsoleta.
 *
 * Un usuario INACTIVO no puede iniciar sesión (guard de login, sin tocar aquí) pero sus
 * movimientos históricos conservan su nombre: la baja lógica nunca borra la fila del
 * usuario (FR-008).
 *
 * Implementa: FR-008 (baja lógica de usuario), US6-AS (bloqueo de auto-desactivación) y
 * FR-057 (ninguna operación deja a la organización sin capacidad de administrarse).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { guardiaDeCapacidadAdministrativa } from '../comunes/proteccion-capacidad-administrativa';
import { EstadoInvalido } from '../../dominio/comunes/errores';
import type { EstadoUsuario } from '../../dominio/entidades/usuario';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';

/** Entrada: `estado` validado por `esquemaCambiarEstadoUsuario` + auditoría (FR-045). */
export interface CambiarEstadoUsuarioEntrada {
  readonly usuarioId: number;
  readonly estado: EstadoUsuario;
  /** Id del usuario autenticado que ejecuta la mutación — nunca confiar en un valor del body. */
  readonly usuarioActualId: number;
}

@Injectable()
export class CambiarEstadoUsuarioCasoUso implements CasoDeUso<CambiarEstadoUsuarioEntrada, void> {
  constructor(@Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios) {}

  async ejecutar(entrada: CambiarEstadoUsuarioEntrada): Promise<void> {
    if (entrada.estado === 'INACTIVO' && entrada.usuarioId === entrada.usuarioActualId) {
      throw new EstadoInvalido('No puedes desactivar tu propio usuario mientras tienes la sesión activa.');
    }

    await this.repositorioUsuarios.cambiarEstado(
      entrada.usuarioId,
      entrada.estado,
      guardiaDeCapacidadAdministrativa('desactivar este usuario'),
    );
  }
}
