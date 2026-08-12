/**
 * Forma de la API del PANEL DE CONTROL (`GET /api/panel` — contracts/api-rest.md § Panel de
 * control, US10/FR-060…FR-063), consumida por `frontend/src/app/(app)/page.tsx` (T116).
 * Espejo de las interfaces de `backend/src/aplicacion/panel/resumen-panel.caso-uso.ts`
 * SERIALIZADAS a JSON — mismo criterio que `tipos/reportes.ts`/`tipos/inventario.ts`: el
 * frontend nunca importa tipos de `backend/` (docs/arquitectura.md §2) y las fechas llegan
 * como texto ISO (`string`), no como `Date`.
 *
 * ## Por qué TODAS las secciones son opcionales (FR-062)
 *
 * El recorte por permisos ocurre en el SERVIDOR: el panel devuelve ÚNICAMENTE las secciones
 * que el usuario puede consultar y OMITE las demás del JSON — no viajan con valor `null` ni
 * ocultas para que el navegador decida (ocultar en el cliente no es control de acceso,
 * FR-003). Por eso cada clave de este contrato es `?` y no `| null`: la ausencia significa
 * "esta sesión no puede consultar esto", que es distinto de "no hay datos" (eso se expresa
 * con ceros y listas vacías — US10-AS3). El frontend, en consecuencia, pinta una tarjeta solo
 * si su clave llegó.
 *
 * `inventario.valorTotal` es opcional DENTRO de una sección presente por la misma razón: la
 * valorización es información de reportes (`reportes.ver`), mientras que el conteo de
 * productos y el de bajo umbral es información de inventario (`inventario.ver`) — un Operario
 * recibe la sección con las dos primeras cifras y sin la tercera.
 *
 * Implementa: FR-060 (cifras operativas del inicio), FR-062 (recorte por permisos en el
 * servidor) y FR-063 (las cifras salen de los mismos casos de uso que las pantallas de
 * detalle, nunca de un cálculo paralelo del panel).
 */
import type { TipoMovimientoInventario } from './inventario';

/** Cifras de stock del panel. `productosActivos`/`bajoUmbral` son EXACTAMENTE los `total` de
 *  `GET /api/inventario` y `GET /api/inventario?soloStockBajo=true`; `valorTotal` es el
 *  `valorTotalInventario` de `GET /api/reportes/inventario` (FR-063). */
export interface PanelInventario {
  /** Total del listado de inventario — es decir, el catálogo TAL COMO lo muestra `/inventario`
   *  (que desde T111 incluye también los productos dados de baja, con su etiqueta de estado).
   *  Se cuenta así, y no solo los ACTIVO, para que la cifra coincida exactamente con la del
   *  listado al que la tarjeta enlaza (FR-061/FR-063); por eso el panel la rotula "Productos en
   *  inventario" en vez de prometer un filtro por estado que su destino no aplica. */
  productosActivos: number;
  bajoUmbral: number;
  /** Omitido si la sesión no tiene `reportes.ver` (FR-062). */
  valorTotal?: number;
}

/** Documentos que esperan una acción del usuario — cada cifra es el `total` del listado
 *  correspondiente filtrado por estado `PENDIENTE` (FR-061: la tarjeta enlaza a ese listado). */
export interface PanelPendientes {
  /** Omitido si la sesión no tiene `salidas.ver` (FR-062). */
  salidasPendientes?: number;
  /** Omitido si la sesión no tiene `ingresos.ver` (FR-062). */
  ingresosPendientes?: number;
}

/** Consumo del período en curso (mes calendario) — misma definición de "consumo" que los
 *  reportes: solo salidas `CONFIRMADA`/`COMPLETADA` (FR-044). */
export interface PanelConsumoMes {
  /** Primer día del mes en curso (`AAAA-MM-DD`, hora de Bogotá) desde el que se acumula. */
  desde: string;
  total: number;
}

/** Una fila de "actividad reciente" — los 10 movimientos más recientes, con producto y
 *  usuario ya resueltos a texto legible por el backend (nunca ids crudos). */
export interface PanelMovimientoReciente {
  id: number;
  fechaHora: string;
  tipo: TipoMovimientoInventario;
  /** Descripción del producto; `"Producto N.º {id}"` si la fila ya no se encuentra. */
  producto: string;
  cantidad: number;
  /** `nombreCompleto` de quien ejecutó el movimiento; `"Usuario N.º {id}"` si no se encuentra. */
  usuario: string;
}

/** `GET /api/panel` (FR-060…FR-063) — solo las secciones que la sesión puede consultar. */
export interface ResumenPanel {
  inventario?: PanelInventario;
  pendientes?: PanelPendientes;
  /** Omitido si la sesión no tiene `reportes.ver` (FR-062). */
  consumoMes?: PanelConsumoMes;
  /** Omitido si la sesión no tiene `inventario.ver` (FR-062). Lista vacía = sin movimientos
   *  registrados todavía (US10-AS3), que NO es lo mismo que la clave ausente. */
  movimientosRecientes?: PanelMovimientoReciente[];
}
