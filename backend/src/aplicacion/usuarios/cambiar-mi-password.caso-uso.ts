/**
 * Caso de uso `CambiarMiPasswordCasoUso` — permite a cualquier usuario autenticado cambiar
 * su propia contraseña (`PUT /api/auth/password`), limpiando el flag
 * `debeCambiarPassword` que fuerza el cambio inicial tras el alta o un restablecimiento.
 *
 * Implementa: FR-004 (todo usuario puede cambiar su propia contraseña verificando la
 * actual). La verificación usa el puerto `Hasheador` (nunca compara texto plano); si la
 * contraseña actual no coincide, rechaza con `EstadoInvalido` — el `FiltroErroresDominio`
 * ya lo traduce a `409` automáticamente (contracts/api-rest.md § Autenticación).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import { HASHEADOR, type Hasheador } from '../../dominio/puertos/hasheador';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';

/** Entrada: `usuarioId` llega del token de sesión, nunca del body (FR-045). */
export interface CambiarMiPasswordEntrada {
  usuarioId: number;
  passwordActual: string;
  passwordNueva: string;
}

@Injectable()
export class CambiarMiPasswordCasoUso implements CasoDeUso<CambiarMiPasswordEntrada, void> {
  constructor(
    @Inject(HASHEADOR) private readonly hasheador: Hasheador,
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
  ) {}

  async ejecutar(entrada: CambiarMiPasswordEntrada): Promise<void> {
    const usuario = await this.repositorioUsuarios.buscarConCredencialesPorId(entrada.usuarioId);
    if (!usuario) {
      // Defensivo: JwtAuthGuard ya revalidó el usuario contra BD antes de llegar aquí.
      throw new NoEncontrado('Usuario');
    }

    const coincide = await this.hasheador.comparar(entrada.passwordActual, usuario.passwordHash);
    if (!coincide) {
      throw new EstadoInvalido('La contraseña actual no es correcta.');
    }

    const nuevoHash = await this.hasheador.hash(entrada.passwordNueva);
    await this.repositorioUsuarios.actualizarPassword(usuario.id, nuevoHash, false);
  }
}
