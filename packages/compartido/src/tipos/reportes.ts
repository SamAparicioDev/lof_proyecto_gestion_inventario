/**
 * Formas de la API de solo lectura de los reportes de consumo (contracts/api-rest.md §
 * Reportes, FR-039/FR-040/FR-044), consumidas por el frontend (T071/T072), y de los reportes
 * de inventario actual y movimientos (FR-041/FR-042, Tanda 9/US7/T082). Reflejan las
 * interfaces de la capa de aplicación del backend
 * (`aplicacion/reportes/reporte-consumo-cliente.caso-uso.ts`,
 * `aplicacion/reportes/reporte-consumo-proyecto.caso-uso.ts`,
 * `aplicacion/reportes/reporte-inventario-actual.caso-uso.ts`,
 * `aplicacion/reportes/reporte-movimientos.caso-uso.ts`) SERIALIZADAS a JSON — mismo criterio
 * que `tipos/inventario.ts`/`tipos/salidas.ts`: el frontend nunca importa esos tipos de
 * `backend/` directamente (docs/arquitectura.md §2), y las fechas llegan como texto ISO
 * (`string`), no como `Date` (`LineaConsumoReporte.fecha`; `filtros.desde`/`filtros.hasta` ya
 * eran `string | null` en el propio caso de uso).
 *
 * `FilaReporteInventario` EXTIENDE `FilaInventario` (`tipos/inventario.ts`) tal como su
 * espejo del backend (`ReporteInventarioActualCasoUso#FilaReporteInventario extends
 * FilaInventario`) — misma fila que ya usa el listado de US5, sin duplicar
 * stock/comprometido/disponible/stockBajo, solo agrega `valorLinea` (FR-041).
 *
 * Implementa: FR-039 (reporte de consumo por cliente), FR-040 (reporte de consumo por
 * proyecto, con margen vs presupuesto y serie para gráfico), FR-041 (reporte de inventario
 * actual: stock/comprometido/disponible/ubicación, valor total, productos bajo umbral),
 * FR-042 (reporte de movimientos: fecha/tipo/documento/producto/cantidad/usuario/
 * cliente/proyecto), FR-044 (el consumo ya viene calculado solo sobre salidas
 * CONFIRMADA/COMPLETADA — el frontend no filtra nada, solo pinta lo que el backend devuelve).
 */
import type { EstadoProyecto } from './clientes';
import type { DocumentoTipoMovimiento, FilaInventario, TipoMovimientoInventario } from './inventario';

/** Consumo de un producto dentro de un proyecto — nombre ya resuelto (FR-039). */
export interface ProductoConsumoReporte {
  productoId: number;
  nombre: string;
  cantidad: number;
  valorTotal: number;
}

/**
 * Consumo de un proyecto: sus productos consumidos (orden descendente por valor) y el total.
 *
 * US28 (FR-125): `id` y `estado` son `null` en el grupo "Sin proyecto" — lo entregado al cliente
 * sin obra concreta. No es un proyecto del catálogo, pero es consumo suyo y suma en su total.
 */
export interface ProyectoConsumoReporte {
  proyecto: {
    id: number | null;
    nombre: string;
    estado: EstadoProyecto | null;
  };
  productos: ProductoConsumoReporte[];
  totalProyecto: number;
}

/** `GET /api/reportes/consumo-cliente` (FR-039). */
export interface ReporteConsumoCliente {
  cliente: {
    id: number;
    nombre: string;
    nit: string;
  };
  filtros: {
    desde: string | null;
    hasta: string | null;
  };
  proyectos: ProyectoConsumoReporte[];
  totalCliente: number;
}

/** Una fila del detalle aplanado: una línea de una salida de consumo, con el nombre de
 *  producto ya resuelto (FR-040). */
export interface LineaConsumoReporte {
  fecha: string;
  numeroSalida: number;
  producto: string;
  cantidad: number;
  valorUnitario: number;
  valorTotal: number;
}

/** Un punto de la serie del gráfico "consumo por producto" (orden descendente por valor). */
export interface PuntoSerieConsumo {
  producto: string;
  valor: number;
}

/** `GET /api/reportes/consumo-proyecto` (FR-040). */
export interface ReporteConsumoProyecto {
  proyecto: {
    id: number;
    nombre: string;
    estado: EstadoProyecto;
  };
  cliente: {
    id: number;
    nombre: string;
  };
  filtros: {
    desde: string | null;
    hasta: string | null;
  };
  lineas: LineaConsumoReporte[];
  totalConsumo: number;
  presupuestoEstimado: number | null;
  /** `totalConsumo / presupuestoEstimado`, o `null` si el proyecto no tiene presupuesto
   *  asignado (nunca `0` ni una división por cero — el frontend muestra "Sin presupuesto
   *  asignado", jamás "0%"). */
  margen: number | null;
  serie: PuntoSerieConsumo[];
}

/** Una fila del reporte de inventario: la MISMA `FilaInventario` de US5 + su valor monetario
 *  (`stockActual × ultimoCosto`) — espejo de `FilaReporteInventario` del caso de uso (FR-041). */
export interface FilaReporteInventario extends FilaInventario {
  valorLinea: number;
}

/** `GET /api/reportes/inventario` (FR-041). */
export interface ReporteInventarioActual {
  productos: FilaReporteInventario[];
  valorTotalInventario: number;
  cantidadBajoUmbral: number;
  filtros: {
    buscar: string | null;
    cantidadMin: number | null;
    cantidadMax: number | null;
  };
}

/** Una fila del reporte de movimientos: un movimiento con TODOS sus ids ya resueltos a texto
 *  legible por el backend (sku/descripción, nombre de usuario, número de documento,
 *  cliente/proyecto) — espejo de `FilaReporteMovimiento` del caso de uso (FR-042). */
export interface FilaReporteMovimiento {
  id: number;
  fecha: string;
  tipo: TipoMovimientoInventario;
  cantidad: number;
  documento: {
    tipo: DocumentoTipoMovimiento;
    numero: string;
  };
  producto: {
    sku: string;
    descripcion: string;
  };
  usuario: string;
  /** `null` salvo en movimientos de SALIDA (los únicos con proyecto asociado). */
  cliente: string | null;
  proyecto: string | null;
}

/** `GET /api/reportes/movimientos` (FR-042). */
export interface ReporteMovimientos {
  movimientos: FilaReporteMovimiento[];
  filtros: {
    desde: string | null;
    hasta: string | null;
    tipo: TipoMovimientoInventario | null;
    usuarioId: number | null;
    clienteId: number | null;
    proyectoId: number | null;
  };
}
