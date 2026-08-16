/**
 * Formas de la API de solo lectura de inventario (contracts/api-rest.md § Inventario,
 * FR-020…FR-024), consumidas por el frontend (T061/T062). Reflejan las interfaces de la capa
 * de aplicación del backend (`aplicacion/inventario/fila-inventario.ts#FilaInventario`,
 * `aplicacion/inventario/historial-producto.caso-uso.ts#MovimientoHistorialProducto`)
 * SERIALIZADAS a JSON — mismo criterio que `tipos/salidas.ts`/`tipos/clientes.ts`: el frontend
 * nunca importa esos tipos de `backend/` directamente (docs/arquitectura.md §2, los workspaces
 * no se importan entre sí), y las fechas llegan como texto ISO (`string`), no como `Date`.
 *
 * `FilaInventario.producto.umbralStockBajo`/`.estado` (contracts/api-rest.md, anotación T062):
 * la ficha de producto del frontend los necesita para precargar el formulario de edición
 * (`PUT /api/productos/:id`) y para el botón activar/desactivar (`PUT /api/productos/:id/estado`).
 * `.categoria` se agrega en US8 (T091, FR-052) — mismo motivo: sin él, `PanelProducto` no puede
 * precargar el valor actual en `ProductoForm`.
 *
 * Implementa: FR-020 (cifras de stock/comprometido/disponible), FR-022 (marcado de stock bajo),
 * FR-023 (búsqueda), FR-024/FR-045 (historial de movimientos enriquecido), FR-052 (categoría).
 */
import type { EstadoProducto } from './productos';

/** Fila de inventario: producto + sus cifras derivadas de stock — misma forma para el listado
 *  paginado (`GET /api/inventario`) y la ficha individual (`GET /api/inventario/:productoId`). */
export interface FilaInventario {
  producto: {
    id: number;
    sku: string;
    descripcion: string;
    /** US15: referencia al catálogo, con el nombre resuelto para poder pintarlo sin otra
     *  petición. Era una cadena de texto libre hasta US14. */
    categoria: { id: number; nombre: string } | null;
    /** US17 (FR-105): en qué se mide. Viaja con la ABREVIATURA porque es lo que se pinta junto
     *  a la cantidad en la tabla; `null` solo en los productos anteriores a esa historia. */
    unidadMedida: { id: number; nombre: string; abreviatura: string } | null;
    ubicacion: string | null;
    umbralStockBajo: number;
    /**
     * Costo de referencia vigente del producto (US12, FR-071). Se agrega por el mismo motivo
     * que `umbralStockBajo`/`categoria`: la ficha de producto precarga con él el campo de
     * costo, ahora editable, de `ProductoForm` — sin este dato una edición lo enviaría vacío
     * y el guardado registraría un cambio de costo que nadie pidió. No es información nueva
     * para nadie: `GET /api/productos` ya expone `ultimoCosto` con el mismo alcance de roles.
     */
    ultimoCosto: number;
    estado: EstadoProducto;
    fechaUltimoMovimiento: string | null;
  };
  stock: number;
  comprometido: number;
  disponible: number;
  stockBajo: boolean;
}

/**
 * De dónde vino un cambio de costo (US12, FR-072) — espejo de `OrigenCambioCosto` en
 * `backend/src/dominio/entidades/cambio-costo-producto.ts` y del enum `origen_cambio_costo`
 * de `historial_costos_producto` (data-model.md).
 */
export type OrigenCambioCosto = 'IMPORTACION' | 'EDICION_MANUAL' | 'RECEPCION_INGRESO';

/**
 * Fila de `GET /api/inventario/:productoId/historial-costos` (contracts/api-rest.md §
 * Historial de costos del producto) — un cambio de costo ya enriquecido con el nombre de
 * quien lo hizo, más reciente primero.
 *
 * NO es un movimiento de inventario y nunca aparecerá en el historial de movimientos
 * (FR-073): un cambio de costo no altera cantidades, y registrarlo como movimiento rompería
 * la correspondencia `stock = Σ movimientos`. Son dos historiales distintos porque responden
 * dos preguntas distintas: *cuánto hay y por qué* vs. *cuánto vale y desde cuándo*.
 */
export interface CambioCostoProducto {
  id: number;
  fechaHora: string;
  costoAnterior: number;
  costoNuevo: number;
  origen: OrigenCambioCosto;
  /** Id del ingreso que originó el cambio cuando `origen === 'RECEPCION_INGRESO'`; si no, `null`. */
  documentoId: number | null;
  usuarioId: number;
  /** `nombreCompleto` de quien hizo el cambio; `"Usuario N.º {id}"` si ya no se encuentra. */
  usuarioNombre: string;
}

/** Máquina simple de un movimiento de inventario (data-model.md `movimientos_inventario`). */
export type TipoMovimientoInventario = 'ENTRADA' | 'SALIDA' | 'AJUSTE_ENTRADA' | 'AJUSTE_SALIDA';

/** Documento de origen de un movimiento — determina cómo se resuelve `numeroDocumento`. */
export type DocumentoTipoMovimiento = 'INGRESO' | 'SALIDA';

/** Fila de `GET /api/inventario/:productoId/movimientos` — movimiento ya enriquecido con
 *  nombres legibles (no ids crudos) por `HistorialProductoCasoUso` (FR-024/FR-045). */
export interface MovimientoHistorialProducto {
  id: number;
  fechaHora: string;
  tipo: TipoMovimientoInventario;
  cantidad: number;
  stockResultante: number;
  documentoTipo: DocumentoTipoMovimiento;
  documentoId: number;
  /** Número de factura (INGRESO) o número de salida (SALIDA); el id crudo si el documento ya no existe. */
  numeroDocumento: string;
  usuarioId: number;
  /** `nombreCompleto` de quien ejecutó el movimiento; `"Usuario N.º {id}"` si no se encuentra. */
  usuarioNombre: string;
  proyectoId: number | null;
  /** `nombre` del proyecto cuando `proyectoId` no es `null`; el id crudo si no se encuentra. */
  proyectoNombre: string | null;
  motivo: string | null;
}

/**
 * Respuesta de `GET /api/inventario/opciones-filtro` (US13, FR-076): los valores que EXISTEN
 * hoy en el catálogo para los dos campos de clasificación de texto libre, sin repetir y
 * ordenados alfabéticamente.
 *
 * Por qué el servidor los publica en vez de que la pantalla ofrezca una caja de texto:
 * `categoria` y `ubicacion` son texto libre sin catálogo propio (FR-052), así que nadie puede
 * adivinar cómo se escribieron —"Ferretería" vs "ferreteria", "Bodega 1" vs "Bodega1"— y un
 * filtro que exige adivinar no se usa. Los productos SIN valor no aportan una opción vacía.
 */
export interface OpcionesFiltroInventario {
  /** US15 (FR-088): salen del CATÁLOGO de categorías, no de los valores presentes en los
   *  productos. `ubicaciones` sigue siendo texto libre deduplicado. */
  categorias: { id: number; nombre: string }[];
  ubicaciones: string[];
}
