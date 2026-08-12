/**
 * Caso de uso `GuardarLogoClienteCasoUso` — carga o reemplaza el logo de un cliente
 * (`PUT /api/clientes/:id/logo`, FR-066).
 *
 * Toda la decisión de "¿esto es una imagen admitida?" la toma `detectarTipoDeImagenLogo`
 * (dominio, puro) mirando los BYTES del archivo — nunca su extensión ni el `Content-Type` que
 * declare el navegador, porque los dos los escribe el cliente y puede mentir en ambos
 * (data-model.md § Logo del cliente). El TAMAÑO máximo NO se valida aquí: es una restricción
 * de TRANSPORTE y se corta en `FileInterceptor` antes de bufferizar el archivo completo (ver
 * `controlador-clientes.ts`), mismo criterio y misma corrección que la carga masiva de T095.
 *
 * ORDEN DELIBERADO (US11-AS6): primero se valida el formato, y solo después se escribe. Un
 * archivo rechazado deja el logo anterior del cliente EXACTAMENTE como estaba — la validación
 * ocurre antes de tocar la fila, así que no hay nada que revertir.
 *
 * El pre-chequeo de existencia del cliente lo hace el adaptador (traduce `P2025` a
 * `NoEncontrado`, mismo criterio que `ActualizarClienteCasoUso`): no se repite aquí.
 *
 * Implementa: FR-066 (cargar/reemplazar el logo, solo imágenes válidas), FR-045 (auditoría:
 * `usuarioId` siempre del token, nunca del body).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';
import { detectarTipoDeImagenLogo } from '../../dominio/servicios/servicio-imagen-logo';

/** Entrada: los bytes tal como llegaron y quién los sube (FR-045). */
export interface GuardarLogoClienteEntrada {
  readonly clienteId: number;
  /** Contenido del archivo subido, sin interpretar. Su formato lo decide el dominio. */
  readonly contenido: Uint8Array;
  readonly usuarioId: number;
}

@Injectable()
export class GuardarLogoClienteCasoUso implements CasoDeUso<GuardarLogoClienteEntrada, void> {
  constructor(@Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes) {}

  async ejecutar(entrada: GuardarLogoClienteEntrada): Promise<void> {
    const tipoMime = detectarTipoDeImagenLogo(entrada.contenido);
    await this.repositorioClientes.guardarLogo(
      entrada.clienteId,
      { contenido: entrada.contenido, tipoMime },
      entrada.usuarioId,
    );
  }
}
