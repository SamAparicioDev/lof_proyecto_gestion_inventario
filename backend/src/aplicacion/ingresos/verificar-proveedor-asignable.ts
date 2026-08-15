/**
 * Comprobación compartida por `CrearIngresoCasoUso` y `ActualizarIngresoCasoUso` (US15, FR-091):
 * el proveedor que se va a asignar a una factura existe y está ACTIVO.
 *
 * Vive aparte porque las dos operaciones la necesitan idéntica y duplicarla haría que relajar
 * una relajara la otra sin que nadie lo decidiera. No es un caso de uso: no responde a ninguna
 * petición por sí sola, es una regla de negocio que dos casos de uso comparten.
 *
 * Por qué no basta con la base de datos: la FK `ingresos.proveedor_id` ya impide un proveedor
 * INEXISTENTE, pero lo haría con un error técnico de clave foránea en vez de un mensaje que
 * señale el campo; y el estado INACTIVO no lo cubre ninguna restricción — un proveedor retirado
 * del catálogo no debe poder elegirse en una factura nueva, que es el equivalente para
 * proveedores de lo que FR-086 pide para categorías.
 *
 * Al EDITAR, se llama solo si el proveedor CAMBIA: un ingreso que ya apuntaba a un proveedor
 * luego desactivado lo conserva (se decide qué se ofrece, no qué se conserva), y exigir lo
 * contrario dejaría facturas pendientes imposibles de guardar por un cambio de catálogo ajeno.
 */
import { ErrorValidacionDominio } from '../../dominio/comunes/errores';
import { puedeRecibirIngresos } from '../../dominio/entidades/proveedor';
import type { RepositorioProveedores } from '../../dominio/puertos/repositorio-proveedores';

export async function verificarProveedorAsignable(
  repositorio: RepositorioProveedores,
  proveedorId: number,
): Promise<void> {
  const proveedor = await repositorio.buscarPorId(proveedorId);
  if (!proveedor) {
    throw new ErrorValidacionDominio('El proveedor seleccionado no existe', {
      proveedorId: 'El proveedor seleccionado no existe',
    });
  }
  if (!puedeRecibirIngresos(proveedor)) {
    throw new ErrorValidacionDominio(`El proveedor "${proveedor.nombre}" está inactivo`, {
      proveedorId: `El proveedor "${proveedor.nombre}" está inactivo. Actívalo o elige otro.`,
    });
  }
}
