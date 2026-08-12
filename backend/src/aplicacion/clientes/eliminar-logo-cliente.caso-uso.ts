/**
 * Caso de uso `EliminarLogoClienteCasoUso` — quita el logo de un cliente
 * (`DELETE /api/clientes/:id/logo`, FR-066).
 *
 * Deja `logo` y `logo_tipo_mime` en `NULL` (las dos juntas — CHECK `clientes_logo_consistente`)
 * y puebla la auditoría de modificación del cliente. Es una operación de BAJA DE UN ATRIBUTO,
 * no la eliminación de un registro: el cliente sigue existiendo intacto, y sus exportaciones
 * pasan a generarse sin logo, que es un estado perfectamente válido (FR-067).
 *
 * IDEMPOTENTE por diseño: quitar un logo que ya no estaba no es un error, porque el estado
 * final pedido ya se cumple (semántica estándar de `DELETE`). El único `404` posible es que el
 * CLIENTE no exista, y lo produce el adaptador traduciendo `P2025` (mismo criterio que
 * `ActualizarClienteCasoUso`).
 *
 * Implementa: FR-066 (quitar el logo), FR-045 (auditoría con el usuario del token).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';

/** Entrada: a qué cliente se le quita el logo y quién lo quita (FR-045). */
export interface EliminarLogoClienteEntrada {
  readonly clienteId: number;
  readonly usuarioId: number;
}

@Injectable()
export class EliminarLogoClienteCasoUso implements CasoDeUso<EliminarLogoClienteEntrada, void> {
  constructor(@Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes) {}

  async ejecutar(entrada: EliminarLogoClienteEntrada): Promise<void> {
    await this.repositorioClientes.eliminarLogo(entrada.clienteId, entrada.usuarioId);
  }
}
