/**
 * Composición compartida "producto + cifras de inventario" (FR-020/FR-022) — usada por
 * `ListarInventarioCasoUso` (una fila por producto en el listado paginado) y
 * `FichaProductoCasoUso` ("las mismas cifras que una fila del listado, para una ficha
 * individual" — alcance de la tarea T059). Vive como función independiente, no como método
 * privado duplicado en cada clase (docs/arquitectura.md §5, DRY) — ninguno de los dos casos
 * de uso es "dueño" de qué es una fila de inventario, ambos la componen igual; solo cambia
 * CÓMO obtienen `comprometido` (en lote sobre una página completa, o para un único id), nunca
 * el cálculo en sí (mismo patrón que `validar-disponibilidad-lineas.ts` en `aplicacion/salidas/`).
 *
 * `disponible = stockActual − comprometido` y `stockBajo` reutilizan
 * `dominio/entidades/producto.ts#esStockBajo` — la ÚNICA fuente de verdad de ese criterio
 * (nunca se compara contra `stockActual` crudo, ver TSDoc de esa función).
 *
 * `producto.umbralStockBajo` y `producto.estado` se agregaron en T062 (contracts/api-rest.md
 * § Inventario, anotación T062): la ficha de producto del frontend necesita precargar el
 * umbral en el formulario de edición y conocer el estado actual para el botón
 * activar/desactivar, y el contrato no define un GET adicional a `/api/productos/:id` para
 * obtenerlos por separado — extensión aditiva, sin nuevo cálculo (`Producto` ya traía ambos
 * campos completos desde el repositorio). `producto.categoria` se agrega en US8 (T091,
 * FR-052): sin este campo la ficha de producto del frontend no puede precargar el valor
 * actual en `ProductoForm` y una edición sin re-escribirlo lo borraría silenciosamente.
 * `producto.ultimoCosto` se agrega en US12 (T128, FR-071) por EXACTAMENTE el mismo motivo:
 * el costo pasa a ser editable desde `ProductoForm`, así que la ficha debe poder precargar el
 * vigente — enviarlo vacío registraría un cambio de costo que nadie pidió. No expone
 * información nueva a nadie: `GET /api/productos` ya devuelve `ultimoCosto` con el mismo
 * alcance de roles que este listado.
 *
 * Implementa: FR-020 (cifras de stock/comprometido/disponible), FR-022 (marcado de stock
 * bajo contra el umbral por producto, US5-AS2), FR-010/FR-012 (datos de edición/estado que
 * consume la ficha de producto, T062), FR-052 (campo `categoria`, US8), FR-071 (costo vigente
 * que precarga el campo editable de costo, US12).
 */
import { esStockBajo, type EstadoProducto, type Producto } from '../../dominio/entidades/producto';

/** Fila de inventario: producto + sus cifras derivadas de stock — forma compartida entre el
 *  listado paginado y la ficha individual de un producto. */
export interface FilaInventario {
  readonly producto: {
    readonly id: number;
    readonly sku: string;
    readonly descripcion: string;
    readonly categoria: { readonly id: number; readonly nombre: string } | null;
    readonly ubicacion: string | null;
    readonly umbralStockBajo: number;
    readonly ultimoCosto: number;
    readonly estado: EstadoProducto;
    readonly fechaUltimoMovimiento: Date | null;
  };
  readonly stock: number;
  readonly comprometido: number;
  readonly disponible: number;
  readonly stockBajo: boolean;
}

/**
 * Compone una `FilaInventario` a partir de un producto y su `comprometido` ya calculado — el
 * llamador decide CÓMO obtenerlo (`RepositorioSalidas.comprometidoPorProducto` en lote para
 * el listado, o con un único id para la ficha individual); esta función solo ensambla el
 * resultado, sin volver a consultar nada.
 */
export function construirFilaInventario(producto: Producto, comprometido: number): FilaInventario {
  const disponible = producto.stockActual - comprometido;
  return {
    producto: {
      id: producto.id,
      sku: producto.sku,
      descripcion: producto.descripcion,
      categoria: producto.categoria,
      ubicacion: producto.ubicacion,
      umbralStockBajo: producto.umbralStockBajo,
      ultimoCosto: producto.ultimoCosto,
      estado: producto.estado,
      fechaUltimoMovimiento: producto.fechaUltimoMovimiento,
    },
    stock: producto.stockActual,
    comprometido,
    disponible,
    stockBajo: esStockBajo(disponible, producto.umbralStockBajo),
  };
}

/**
 * `true` si `disponible` cae dentro de `[minimo, maximo]` (ambos opcionales, ambos INCLUSIVE).
 *
 * Vive aquí, junto a `construirFilaInventario`, porque el criterio lo comparten DOS pantallas
 * con nombres de parámetro distintos: el rango `cantidadMin`/`cantidadMax` del reporte de
 * inventario actual (FR-041, US7) y el `disponibleMin`/`disponibleMax` del listado de inventario
 * (FR-077, US13). Que la regla estuviera duplicada en los dos casos de uso permitiría que un día
 * uno pasara a comparar contra `stockActual` crudo y el otro no — exactamente la discrepancia que
 * FR-077 prohíbe: el rango SIEMPRE se mide sobre `disponible` (= stock − comprometido), la misma
 * cifra contra la que se decide `stockBajo`.
 */
export function disponibleEnRango(
  disponible: number,
  minimo: number | undefined,
  maximo: number | undefined,
): boolean {
  if (minimo !== undefined && disponible < minimo) return false;
  if (maximo !== undefined && disponible > maximo) return false;
  return true;
}
