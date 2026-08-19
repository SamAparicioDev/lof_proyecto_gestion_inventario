/**
 * Validación compartida de "destino válido de salida" (FR-027/FR-038/FR-124) — usada por
 * `CrearSalidaCasoUso` y `ActualizarSalidaCasoUso`, que deben aplicar EXACTAMENTE la misma
 * regla antes de escribir. Vive como función independiente, no como método privado duplicado en
 * cada clase (docs/arquitectura.md §5, DRY) — ninguno de los dos casos de uso es "dueño" de la
 * regla, ambos la consultan.
 *
 * ## Qué cambió en US28 (FR-124)
 *
 * El destino obligatorio es el CLIENTE; el proyecto es opcional. Eso parte la validación en dos
 * mitades independientes:
 *
 * 1. **El cliente**, siempre: debe existir y estar `ACTIVO`. Es la regla que antes se comprobaba
 *    de pasada al validar el proyecto —un proyecto activo de un cliente inactivo no era destino
 *    válido— y que ahora se aplica por sí sola, porque puede no haber proyecto que la arrastre.
 * 2. **El proyecto**, solo si viaja: debe existir, estar `ACTIVO` y **pertenecer a ese cliente**.
 *    Esa última comprobación es nueva y no es un detalle: hasta US28 el cliente se DEDUCÍA del
 *    proyecto, así que era imposible que discreparan. Ahora llegan los dos en el body, y sin esta
 *    verificación nada impediría enviar el proyecto de otro cliente — lo que dejaría una entrega
 *    contando como consumo de una obra ajena, que es precisamente el dato que el sistema existe
 *    para responder bien (FR-039).
 *
 * Reutiliza `esDestinoValido` (dominio/entidades/proyecto.ts, de US2): un proyecto es destino
 * válido si él y su cliente están `ACTIVO`.
 *
 * Criterio de errores, el mismo de siempre:
 * - Referencia que NO EXISTE → `ErrorValidacionDominio` (400): es un dato de FORMA del body,
 *   mismo tratamiento que cualquier FK inválida enviada desde un formulario.
 * - Existe pero no sirve como destino (inactivo, o de otro cliente) → `EstadoInvalido` (409,
 *   contracts/api-rest.md § Salidas): es un conflicto de ESTADO, no de forma.
 *
 * Implementa: FR-027 (destino obligatorio), FR-038 (regla de destino válido), FR-124 (cliente
 * obligatorio y proyecto opcional).
 */
import { ErrorValidacionDominio, EstadoInvalido } from '../../dominio/comunes/errores';
import { esDestinoValido } from '../../dominio/entidades/proyecto';
import type { RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';
import type { RepositorioProyectos } from '../../dominio/puertos/repositorio-proyectos';

export async function validarDestinoSalida(
  repositorioProyectos: RepositorioProyectos,
  repositorioClientes: RepositorioClientes,
  clienteId: number,
  proyectoId: number | null,
): Promise<void> {
  const cliente = await repositorioClientes.buscarPorId(clienteId);
  if (!cliente) {
    throw new ErrorValidacionDominio('El cliente no existe', { clienteId: 'El cliente no existe' });
  }
  if (cliente.estado !== 'ACTIVO') {
    throw new EstadoInvalido('El cliente no está activo: no es un destino válido para la salida');
  }

  // Sin proyecto la validación termina aquí: la entrega es del cliente y de nadie más (FR-124).
  if (proyectoId === null) return;

  const proyecto = await repositorioProyectos.buscarPorId(proyectoId);
  if (!proyecto) {
    throw new ErrorValidacionDominio('El proyecto no existe', { proyectoId: 'El proyecto no existe' });
  }
  if (proyecto.clienteId !== clienteId) {
    // 400 y no 409: es una incoherencia entre dos campos del MISMO body, no un conflicto con el
    // estado del sistema. Anclado a `proyectoId` para que el formulario marque el selector que
    // hay que corregir. Es el error que cotizaciones ya devolvía desde US21 para este caso.
    throw new ErrorValidacionDominio('El proyecto no pertenece al cliente seleccionado', {
      proyectoId: 'El proyecto seleccionado no pertenece a ese cliente',
    });
  }
  if (!esDestinoValido(proyecto, cliente.estado)) {
    throw new EstadoInvalido(
      'El proyecto no está activo o su cliente no está activo: no es un destino válido para la salida',
    );
  }
}
