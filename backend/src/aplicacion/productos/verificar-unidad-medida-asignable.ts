/**
 * Comprobación compartida por `CrearProductoCasoUso`, `ActualizarProductoCasoUso` e
 * `ImportarProductosCasoUso` (US17, FR-102): la unidad de medida que se va a asignar existe y
 * está ACTIVA.
 *
 * Vive aparte porque las tres operaciones la necesitan idéntica, y duplicarla haría que relajar
 * una relajara las otras sin que nadie lo decidiera. No es un caso de uso: no responde a ninguna
 * petición por sí sola, es una regla que tres casos de uso comparten.
 *
 * Por qué no basta con la base de datos: la FK ya impide una unidad INEXISTENTE, pero lo haría
 * con un error técnico de clave foránea en vez de un mensaje que señale el campo; y el estado
 * INACTIVA no lo cubre ninguna restricción — una unidad retirada del catálogo no debe poder
 * elegirse en un producto nuevo, que es el equivalente para unidades de lo que FR-086 pide para
 * categorías.
 *
 * Al EDITAR se llama SIEMPRE, no solo si el campo viene informado: a diferencia del proveedor de
 * un ingreso, aquí el caso que importa es el contrario — un producto anterior a US17 llega SIN
 * unidad y hay que exigirle una para poder guardarlo (FR-103, US17-AS3). Es la ocasión en la que
 * alguien decide la unidad de ese producto.
 *
 * Con UNA excepción, `unidadActualId`: si la unidad que se envía es la que el producto YA tiene,
 * se acepta aunque esté inactiva. Es el mismo principio que FR-086 para categorías —desactivar
 * una unidad impide ASIGNARLA, no despoja al producto que la referencia—, y sin la excepción
 * bastaría con que un administrador retirara "Bulto" del catálogo para que ningún producto medido
 * en bultos pudiera volver a editarse: corregir su descripción exigiría cambiarle la unidad, que
 * es un dato distinto y que nadie pidió tocar.
 */
import { ErrorValidacionDominio } from '../../dominio/comunes/errores';
import { puedeMedirProductos } from '../../dominio/entidades/unidad-medida';
import type { RepositorioUnidadesMedida } from '../../dominio/puertos/repositorio-unidades-medida';

/** Campo del formulario al que se anclan los errores, para que la ficha del producto los pinte
 *  junto al selector (contrato de error: `{ error: { mensaje, campos } }`). */
const CAMPO = 'unidadMedidaId';

export async function verificarUnidadMedidaAsignable(
  repositorio: RepositorioUnidadesMedida,
  unidadMedidaId: number,
  unidadActualId?: number | null,
): Promise<void> {
  if (unidadActualId !== undefined && unidadActualId !== null && unidadMedidaId === unidadActualId) {
    return;
  }

  const unidad = await repositorio.buscarPorId(unidadMedidaId);
  if (!unidad) {
    throw new ErrorValidacionDominio('La unidad de medida seleccionada no existe', {
      [CAMPO]: 'La unidad de medida seleccionada no existe',
    });
  }
  if (!puedeMedirProductos(unidad)) {
    throw new ErrorValidacionDominio(`La unidad de medida "${unidad.nombre}" está inactiva`, {
      [CAMPO]: `La unidad de medida "${unidad.nombre}" está inactiva. Actívala o elige otra.`,
    });
  }
}
