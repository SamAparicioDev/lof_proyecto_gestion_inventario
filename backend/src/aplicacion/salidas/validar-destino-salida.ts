/**
 * Validación compartida de "destino válido de salida" (FR-027/FR-038) — usada por
 * `CrearSalidaCasoUso` y `ActualizarSalidaCasoUso`, que deben aplicar EXACTAMENTE la misma
 * regla antes de escribir (crear una salida nueva o reemplazar el `proyectoId` de una
 * existente). Vive como función independiente, no como método privado duplicado en cada
 * clase (docs/arquitectura.md §5, DRY) — ninguna de las dos casos de uso es "dueña" de la
 * regla, ambas la consultan.
 *
 * Reutiliza `esDestinoValido` (dominio/entidades/proyecto.ts, YA EXISTE de US2): un
 * `proyectoId` es destino válido si el proyecto está `ACTIVO` y su cliente también.
 *
 * - `proyectoId` que no existe → `ErrorValidacionDominio` (400): es un dato de FORMA del
 *   body, mismo tratamiento que cualquier FK inválida enviada desde un formulario.
 * - Proyecto existente pero no destino válido (él mismo o su cliente no `ACTIVO`) →
 *   `EstadoInvalido` (409, contracts/api-rest.md § Salidas: "proyecto no activo"): el
 *   proyecto existe, es un conflicto de ESTADO, no de forma.
 *
 * Implementa: FR-027 (destino obligatorio), FR-038 (regla de destino válido).
 */
import { ErrorValidacionDominio, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import { esDestinoValido } from '../../dominio/entidades/proyecto';
import type { RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';
import type { RepositorioProyectos } from '../../dominio/puertos/repositorio-proyectos';

export async function validarDestinoSalida(
  repositorioProyectos: RepositorioProyectos,
  repositorioClientes: RepositorioClientes,
  proyectoId: number,
): Promise<void> {
  const proyecto = await repositorioProyectos.buscarPorId(proyectoId);
  if (!proyecto) {
    throw new ErrorValidacionDominio('El proyecto no existe', { proyectoId: 'El proyecto no existe' });
  }

  const cliente = await repositorioClientes.buscarPorId(proyecto.clienteId);
  if (!cliente) {
    // Invariante de integridad referencial: todo proyecto tiene un cliente (FK NOT NULL,
    // data-model.md). Si esto ocurre es un dato corrupto, no un error de negocio del
    // usuario — se señala igual como NoEncontrado, sin exponer detalle interno.
    throw new NoEncontrado('El cliente del proyecto');
  }

  if (!esDestinoValido(proyecto, cliente.estado)) {
    throw new EstadoInvalido(
      'El proyecto no está activo o su cliente no está activo: no es un destino válido para la salida',
    );
  }
}
