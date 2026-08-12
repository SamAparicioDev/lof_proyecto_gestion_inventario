/**
 * Validación compartida de "cantidad ≤ disponible" por línea (FR-028, UX temprana) — usada
 * por `CrearSalidaCasoUso` y `ActualizarSalidaCasoUso`. NO es la garantía dura del
 * Principio I: es una validación de negocio SIN bloqueo de filas, porque una salida
 * `PENDIENTE` todavía no toca `stock_actual` (solo compromete disponibilidad como agregado
 * derivado) — una pequeña carrera aquí no compromete el invariante crítico, que se
 * resuelve de verdad en `RepositorioSalidas.confirmar` (transacción atómica con
 * `FOR UPDATE`, research R4).
 *
 * `disponible` por producto = `stockActual − comprometido` (de TODAS las salidas
 * `PENDIENTE`, o excluyendo la propia salida si `excluirSalidaId` se pasa — caso de la
 * edición, para no restarle su propio compromiso a sí misma). Reutiliza
 * `RepositorioSalidas.comprometidoPorProducto` (el ÚNICO método que calcula ese agregado,
 * research R4) y arma el mismo detalle de `DisponibilidadInsuficiente` que
 * `ServicioStock.aplicarSalida` usa al confirmar, para que el mensaje al usuario sea
 * consistente sin importar en qué paso del flujo se rechace (US3-AS2).
 *
 * Implementa: FR-028 (informar el disponible real cuando una línea excede).
 */
import { DisponibilidadInsuficiente, NoEncontrado } from '../../dominio/comunes/errores';
import type { RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import type { RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';

/** Línea mínima necesaria para validar disponibilidad — declarada aquí (no importada de
 *  `ServicioStock`) para no acoplar esta validación de aplicación a un tipo tan interno del
 *  dominio para algo que, en esencia, solo lee dos números por producto. */
export interface LineaParaValidarDisponibilidad {
  readonly productoId: number;
  readonly cantidad: number;
}

export async function validarDisponibilidadLineas(
  repositorioProductos: RepositorioProductos,
  repositorioSalidas: RepositorioSalidas,
  lineas: readonly LineaParaValidarDisponibilidad[],
  excluirSalidaId?: number,
): Promise<void> {
  const productoIds = lineas.map((linea) => linea.productoId);
  const [productos, comprometido] = await Promise.all([
    Promise.all(productoIds.map((id) => repositorioProductos.buscarPorId(id))),
    repositorioSalidas.comprometidoPorProducto(productoIds, excluirSalidaId),
  ]);

  const insuficientes: { productoId: number; descripcion: string; solicitado: number; disponible: number }[] = [];
  lineas.forEach((linea, indice) => {
    const producto = productos[indice];
    if (!producto) {
      throw new NoEncontrado(`El producto ${linea.productoId}`);
    }
    const disponible = producto.stockActual - (comprometido.get(linea.productoId) ?? 0);
    if (linea.cantidad > disponible) {
      insuficientes.push({
        productoId: producto.id,
        descripcion: producto.descripcion,
        solicitado: linea.cantidad,
        disponible,
      });
    }
  });

  if (insuficientes.length > 0) {
    throw new DisponibilidadInsuficiente(insuficientes);
  }
}
