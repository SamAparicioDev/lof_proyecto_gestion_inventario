/**
 * Cómo se lee el ORIGEN de un movimiento de inventario — compartido por los dos sitios que lo
 * muestran: el historial de un producto (`HistorialProductoCasoUso`, FR-024) y el reporte de
 * movimientos (`ReporteMovimientosCasoUso`, FR-042).
 *
 * Existe desde US31 (FR-130), cuando apareció el primer movimiento SIN documento detrás: la
 * corrección de cantidad hecha desde el inventario. Hasta entonces cada uno de los dos casos de
 * uso resolvía el documento por su cuenta con código equivalente, y eso era tolerable mientras
 * la regla fuera "el número de la factura o el de la salida". Con un tercer caso que se lee
 * distinto, dos copias significan que un día el historial dirá "Ajuste de inventario" y el
 * reporte dirá "N.º null" — la clase de divergencia que nadie nota hasta que la ve un auditor.
 *
 * No vive en `dominio` porque no decide nada: es presentación de un dato de dominio, y la capa
 * de aplicación es donde ambos casos de uso componen su respuesta.
 *
 * Implementa: FR-045 (todo movimiento nombra su origen), FR-130 (el ajuste no tiene documento y
 * se identifica por lo que es).
 */
import type { DocumentoTipoMovimiento, MovimientoInventario } from '../../dominio/entidades/movimiento-inventario';

/**
 * Lo que se muestra como "documento" de una corrección de cantidad (US31, FR-130).
 *
 * No es un hueco vacío ni un id técnico: la ficha del producto y el reporte de movimientos son
 * justo donde alguien va a preguntarse por qué cambió una cantidad, y "Ajuste de inventario"
 * responde esa pregunta. El detalle —quién y por qué— está en las columnas de usuario y motivo
 * de esa misma fila.
 */
export const TEXTO_DOCUMENTO_AJUSTE = 'Ajuste de inventario';

/** Clave compuesta `tipo:id` — los ids de `Ingreso` y `Salida` son secuencias independientes,
 *  así que el id solo no distingue el documento. */
export function claveDocumentoMovimiento(tipo: DocumentoTipoMovimiento, id: number): string {
  return `${tipo}:${id}`;
}

/**
 * Ids de documento de los movimientos de UN tipo, para resolverlos en lote.
 *
 * Descarta los `AJUSTE` por construcción —no tienen documento que buscar— y con ello devuelve
 * el `number[]` que los repositorios esperan, sin que cada llamador tenga que acordarse de
 * filtrar el `null`.
 */
export function idsDeDocumento(
  movimientos: readonly MovimientoInventario[],
  tipo: 'INGRESO' | 'SALIDA',
): number[] {
  const ids: number[] = [];
  for (const movimiento of movimientos) {
    if (movimiento.documentoTipo === tipo && movimiento.documentoId !== null) {
      ids.push(movimiento.documentoId);
    }
  }
  return ids;
}

/**
 * Texto con el que se identifica el origen de un movimiento: el número de su documento, el
 * nombre de la operación cuando no hay documento (US31), o el id crudo cuando el documento
 * existió y ya no se encuentra — nunca un espacio en blanco.
 */
export function textoDocumentoMovimiento(
  movimiento: Pick<MovimientoInventario, 'documentoTipo' | 'documentoId'>,
  numerosPorClave: ReadonlyMap<string, string>,
): string {
  if (movimiento.documentoTipo === 'AJUSTE' || movimiento.documentoId === null) {
    return TEXTO_DOCUMENTO_AJUSTE;
  }
  return (
    numerosPorClave.get(claveDocumentoMovimiento(movimiento.documentoTipo, movimiento.documentoId)) ??
    String(movimiento.documentoId)
  );
}
