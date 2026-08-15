/**
 * Mapeadores puros `reporte rico → DocumentoReporte` (aplanado tabular genérico, ver TSDoc
 * de `aplicacion/reportes/puertos/exportador-reporte.ts`). Viven junto al controlador (no en
 * `aplicacion/`) porque son un detalle de LA CAPA HTTP de exportación: el caso de uso ya
 * terminó su trabajo y devolvió la forma rica que también consume la pantalla; estas
 * funciones solo la reacomodan en filas/columnas/totales, SIN volver a calcular nada — la
 * única fuente de los números es el objeto que ya devolvió el caso de uso (garantiza SC-007:
 * "exportar = lo que se ve en pantalla, siempre, sin excepción").
 *
 * `reporte-consumo-cliente` está agrupado por proyecto→producto en la forma rica; aquí se
 * aplana a una fila por (proyecto, producto) y el desglose por proyecto se conserva como
 * filas de `totales` (`Total <nombre proyecto>`) — así un proyecto SIN consumo en el período
 * (US4-AS4, `productos: []`) no aporta filas de detalle pero SÍ aparece en `totales` con
 * $0, sin inventar una fila de datos falsa.
 *
 * `reporte-consumo-proyecto` ya es una lista plana (`lineas`) en la forma rica; el margen y
 * el presupuesto — visibles en pantalla (US4-AS2) — se llevan al export como filas de
 * `totales` adicionales para que la exportación no pierda información que el usuario sí ve.
 *
 * `reporte-inventario-actual` (Tanda 9/US7/T081) y `reporte-movimientos` siguen el MISMO
 * criterio: ya son listas planas (`productos`/`movimientos`) en la forma rica, se aplanan a
 * una fila por elemento y sus cifras de cierre (`valorTotalInventario`/`cantidadBajoUmbral`,
 * visibles en pantalla) se llevan al export como filas de `totales`, sin recalcular nada.
 *
 * Los formateadores de moneda/fecha/porcentaje viven en `../comunes/formato-documento.ts` desde
 * US11/T120: los mapeadores de documentos de ingreso y de salida necesitan EXACTAMENTE los
 * mismos, y tener tres copias de `Intl.NumberFormat` sería tres maneras de que el mismo valor
 * se viera distinto según qué archivo lo exportara.
 *
 * Implementa: FR-039/FR-040/FR-041/FR-042 (contenido de cada reporte), FR-043 (exportación =
 * mismos datos y filtros que la pantalla).
 */
import type {
  DocumentoReporte,
  ColumnaDocumentoReporte,
} from '../../../aplicacion/reportes/puertos/exportador-reporte';
import type { ReporteConsumoCliente } from '../../../aplicacion/reportes/reporte-consumo-cliente.caso-uso';
import type { ReporteConsumoProyecto } from '../../../aplicacion/reportes/reporte-consumo-proyecto.caso-uso';
import type { ReporteInventarioActual } from '../../../aplicacion/reportes/reporte-inventario-actual.caso-uso';
import type { ReporteMovimientos } from '../../../aplicacion/reportes/reporte-movimientos.caso-uso';
import {
  formatoFechaSoloDia,
  formatoMonedaCop,
  formatoPorcentaje,
  textoFechaFiltro,
  soloFiltrosAplicados,
} from '../comunes/formato-documento';

const COLUMNAS_CONSUMO_CLIENTE: ColumnaDocumentoReporte[] = [
  { clave: 'proyecto', etiqueta: 'Proyecto' },
  { clave: 'producto', etiqueta: 'Producto' },
  { clave: 'cantidad', etiqueta: 'Cantidad', alineacion: 'derecha' },
  { clave: 'valorTotal', etiqueta: 'Valor total', alineacion: 'derecha' },
];

/** Aplana `ReporteConsumoCliente` (FR-039) a `DocumentoReporte` para exportar (FR-043). El
 *  reporte corresponde a UN ÚNICO cliente. Como todo exportable, el archivo sale con el
 *  logotipo de LOF (FR-067) — lo pone `ExportadorConLogo`, no este mapeador, que
 *  devuelve `undefined` si no hay ninguno, y en ese caso el archivo sale igual sin él (FR-068). */
export function mapearConsumoClienteADocumento(
  reporte: ReporteConsumoCliente,
): DocumentoReporte {
  const filas = reporte.proyectos.flatMap((proyecto) =>
    proyecto.productos.map((producto) => ({
      proyecto: proyecto.proyecto.nombre,
      producto: producto.nombre,
      cantidad: producto.cantidad,
      valorTotal: producto.valorTotal,
    })),
  );

  const totales = [
    ...reporte.proyectos.map((proyecto) => ({
      etiqueta: `Total ${proyecto.proyecto.nombre} (${proyecto.proyecto.estado})`,
      valor: formatoMonedaCop(proyecto.totalProyecto),
    })),
    { etiqueta: 'Total cliente', valor: formatoMonedaCop(reporte.totalCliente) },
  ];

  return {
    titulo: `Consumo por cliente — ${reporte.cliente.nombre}`,
    generadoEn: new Date(),
    filtrosAplicados: soloFiltrosAplicados({
      Cliente: reporte.cliente.nombre,
      NIT: reporte.cliente.nit,
      Desde: textoFechaFiltro(reporte.filtros.desde),
      Hasta: textoFechaFiltro(reporte.filtros.hasta),
    }),
    columnas: COLUMNAS_CONSUMO_CLIENTE,
    filas,
    totales,
  };
}

const COLUMNAS_CONSUMO_PROYECTO: ColumnaDocumentoReporte[] = [
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'numeroSalida', etiqueta: 'N.º salida' },
  { clave: 'producto', etiqueta: 'Producto' },
  { clave: 'cantidad', etiqueta: 'Cantidad', alineacion: 'derecha' },
  { clave: 'valorUnitario', etiqueta: 'Valor unitario', alineacion: 'derecha' },
  { clave: 'valorTotal', etiqueta: 'Valor total', alineacion: 'derecha' },
];

/** Aplana `ReporteConsumoProyecto` (FR-040) a `DocumentoReporte` para exportar (FR-043). Un
 *  el archivo sale con el logotipo de LOF como cualquier otro exportable (FR-067), que
 *  resuelve a partir del `proyectoId` con `ResolverLogoDocumentoCasoUso`. */
export function mapearConsumoProyectoADocumento(
  reporte: ReporteConsumoProyecto,
): DocumentoReporte {
  const filas = reporte.lineas.map((linea) => ({
    fecha: formatoFechaSoloDia(linea.fecha),
    numeroSalida: linea.numeroSalida,
    producto: linea.producto,
    cantidad: linea.cantidad,
    valorUnitario: linea.valorUnitario,
    valorTotal: linea.valorTotal,
  }));

  return {
    titulo: `Consumo por proyecto — ${reporte.proyecto.nombre}`,
    generadoEn: new Date(),
    filtrosAplicados: soloFiltrosAplicados({
      Cliente: reporte.cliente.nombre,
      Proyecto: reporte.proyecto.nombre,
      Desde: textoFechaFiltro(reporte.filtros.desde),
      Hasta: textoFechaFiltro(reporte.filtros.hasta),
    }),
    columnas: COLUMNAS_CONSUMO_PROYECTO,
    filas,
    totales: [
      { etiqueta: 'Total consumo', valor: formatoMonedaCop(reporte.totalConsumo) },
      {
        etiqueta: 'Presupuesto estimado',
        valor: reporte.presupuestoEstimado === null ? 'Sin presupuesto asignado' : formatoMonedaCop(reporte.presupuestoEstimado),
      },
      {
        etiqueta: 'Margen consumo/presupuesto',
        valor: reporte.margen === null ? 'Sin presupuesto asignado' : formatoPorcentaje(reporte.margen),
      },
    ],
  };
}

const COLUMNAS_REPORTE_INVENTARIO: ColumnaDocumentoReporte[] = [
  { clave: 'sku', etiqueta: 'SKU' },
  { clave: 'descripcion', etiqueta: 'Descripción' },
  { clave: 'categoria', etiqueta: 'Categoría' },
  { clave: 'ubicacion', etiqueta: 'Ubicación' },
  { clave: 'stock', etiqueta: 'Stock', alineacion: 'derecha' },
  { clave: 'comprometido', etiqueta: 'Comprometido', alineacion: 'derecha' },
  { clave: 'disponible', etiqueta: 'Disponible', alineacion: 'derecha' },
  { clave: 'stockBajo', etiqueta: 'Bajo umbral' },
  { clave: 'valorLinea', etiqueta: 'Valor', alineacion: 'derecha' },
];

/** Aplana `ReporteInventarioActual` (FR-041) a `DocumentoReporte` para exportar (FR-043). */
export function mapearInventarioADocumento(reporte: ReporteInventarioActual): DocumentoReporte {
  const filas = reporte.productos.map((fila) => ({
    sku: fila.producto.sku,
    descripcion: fila.producto.descripcion,
    categoria: fila.producto.categoria?.nombre ?? 'Sin categoría',
    ubicacion: fila.producto.ubicacion ?? 'Sin ubicación',
    stock: fila.stock,
    comprometido: fila.comprometido,
    disponible: fila.disponible,
    stockBajo: fila.stockBajo ? 'Sí' : 'No',
    valorLinea: fila.valorLinea,
  }));

  return {
    titulo: 'Inventario actual',
    generadoEn: new Date(),
    filtrosAplicados: soloFiltrosAplicados({
      Buscar: reporte.filtros.buscar ?? 'Sin filtro',
      'Cantidad mínima': reporte.filtros.cantidadMin === null ? 'Sin filtro' : String(reporte.filtros.cantidadMin),
      'Cantidad máxima': reporte.filtros.cantidadMax === null ? 'Sin filtro' : String(reporte.filtros.cantidadMax),
    }),
    columnas: COLUMNAS_REPORTE_INVENTARIO,
    filas,
    totales: [
      { etiqueta: 'Valor total del inventario', valor: formatoMonedaCop(reporte.valorTotalInventario) },
      { etiqueta: 'Productos bajo umbral', valor: String(reporte.cantidadBajoUmbral) },
    ],
  };
}

/** Mismo criterio de etiquetas que `frontend/src/componentes/inventario/tipo-movimiento-tag.tsx`
 *  (`ETIQUETA`) — el backend no importa código del frontend (docs/arquitectura.md §2), así que
 *  se replica aquí la MISMA traducción para que el texto luzca igual en pantalla y exportado. */
const ETIQUETA_TIPO_MOVIMIENTO: Record<string, string> = {
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  AJUSTE_ENTRADA: 'Ajuste (entrada)',
  AJUSTE_SALIDA: 'Ajuste (salida)',
};

/** Mismo criterio: `documentoTipo` traducido a la etiqueta que ya usa la ficha de producto
 *  (`INGRESO`/`SALIDA` de `dominio/entidades/movimiento-inventario.ts#DocumentoTipoMovimiento`). */
const ETIQUETA_DOCUMENTO_TIPO: Record<string, string> = {
  INGRESO: 'Ingreso',
  SALIDA: 'Salida',
};

const COLUMNAS_REPORTE_MOVIMIENTOS: ColumnaDocumentoReporte[] = [
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'tipo', etiqueta: 'Tipo' },
  { clave: 'documento', etiqueta: 'Documento' },
  { clave: 'sku', etiqueta: 'SKU' },
  { clave: 'producto', etiqueta: 'Producto' },
  { clave: 'cantidad', etiqueta: 'Cantidad', alineacion: 'derecha' },
  { clave: 'usuario', etiqueta: 'Usuario' },
  { clave: 'cliente', etiqueta: 'Cliente' },
  { clave: 'proyecto', etiqueta: 'Proyecto' },
];

/** Aplana `ReporteMovimientos` (FR-042) a `DocumentoReporte` para exportar (FR-043). Fecha con
 *  `formatoFechaSoloDia` — mismo criterio que ya usa el historial de producto en pantalla
 *  (`frontend/src/app/(app)/inventario/[id]/page.tsx`: `formatoFecha(movimiento.fechaHora)`,
 *  día en UTC) para que exportar = lo que se ve en pantalla (SC-007). */
export function mapearMovimientosADocumento(reporte: ReporteMovimientos): DocumentoReporte {
  const filas = reporte.movimientos.map((movimiento) => ({
    fecha: formatoFechaSoloDia(movimiento.fecha),
    tipo: ETIQUETA_TIPO_MOVIMIENTO[movimiento.tipo] ?? movimiento.tipo,
    documento: `${ETIQUETA_DOCUMENTO_TIPO[movimiento.documento.tipo] ?? movimiento.documento.tipo} ${movimiento.documento.numero}`,
    sku: movimiento.producto.sku,
    producto: movimiento.producto.descripcion,
    cantidad: movimiento.cantidad,
    usuario: movimiento.usuario,
    cliente: movimiento.cliente ?? '—',
    proyecto: movimiento.proyecto ?? '—',
  }));

  return {
    titulo: 'Movimientos de inventario',
    generadoEn: new Date(),
    filtrosAplicados: soloFiltrosAplicados({
      Desde: textoFechaFiltro(reporte.filtros.desde),
      Hasta: textoFechaFiltro(reporte.filtros.hasta),
      Tipo: reporte.filtros.tipo ? (ETIQUETA_TIPO_MOVIMIENTO[reporte.filtros.tipo] ?? reporte.filtros.tipo) : 'Sin filtro',
      Usuario: reporte.filtros.usuarioId === null ? 'Sin filtro' : `N.º ${reporte.filtros.usuarioId}`,
      Cliente: reporte.filtros.clienteId === null ? 'Sin filtro' : `N.º ${reporte.filtros.clienteId}`,
      Proyecto: reporte.filtros.proyectoId === null ? 'Sin filtro' : `N.º ${reporte.filtros.proyectoId}`,
    }),
    columnas: COLUMNAS_REPORTE_MOVIMIENTOS,
    filas,
  };
}
