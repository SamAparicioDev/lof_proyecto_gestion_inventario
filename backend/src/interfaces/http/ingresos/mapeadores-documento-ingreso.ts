/**
 * Mapeadores puros `ingreso(s) → DocumentoReporte` (US11/T120/T121). Viven junto al controlador
 * —no en `aplicacion/`— por el MISMO motivo que `reportes/mapeadores-documento-reporte.ts`: son
 * un detalle de la capa HTTP de exportación. El repositorio ya devolvió los datos; estas
 * funciones solo los reacomodan en filas/columnas, SIN volver a consultar ni recalcular nada.
 *
 * ## Por qué las columnas son EXACTAMENTE las de la pantalla (SC-007/SC-015)
 *
 * `mapearListadoIngresosADocumento` produce las MISMAS siete columnas, con los MISMOS textos y
 * el MISMO formato, que la tabla de `/ingresos` (`frontend/src/app/(app)/ingresos/page.tsx`) —
 * incluida la columna "Registró", que dice `Usuario N.º 7`. Eso NO es una limitación heredada
 * que convenga "mejorar" aquí: el nombre del usuario que registró no se muestra en ninguna
 * pantalla del sistema, así que ponerlo solo en el archivo exportado sería enseñar algo que
 * quien exporta no puede contrastar con lo que ve, y eso rompe SC-007 igual que enseñar de
 * menos. (Distinto es el `SKU — descripción` de las líneas del documento individual: la ficha
 * SÍ lo muestra, y `Producto N.º 7` es solo su texto de respaldo cuando el catálogo no está
 * disponible — resolverlo en el servidor es hacer lo mismo de forma más fiable, no mostrar
 * más.)
 *
 * `mapearIngresoADocumento` es el DOCUMENTO individual (FR-065): cabecera + líneas + total +
 * auditoría. La cabecera y la auditoría viajan en `encabezado` (no en `filtrosAplicados`)
 * porque `ExportadorExcel` no escribe ese campo — ver el TSDoc del puerto `ExportadorReporte`.
 *
 * Un ingreso no tiene cliente (es una compra a un PROVEEDOR), así que ninguno de los dos
 * documentos lleva logo: no habría un cliente al que corresponda (FR-067, US11-AS4).
 *
 * Implementa: FR-064 (listado exportado con todas las filas del filtro), FR-065 (documento
 * individual completo con auditoría), FR-043/SC-007 (exportar = lo filtrado en pantalla).
 */
import type { FiltroIngresos } from '@trazo/compartido';
import type {
  ColumnaDocumentoReporte,
  DatoEncabezadoDocumento,
  DocumentoReporte,
} from '../../../aplicacion/reportes/puertos/exportador-reporte';
import type { EstadoIngreso, Ingreso } from '../../../dominio/entidades/ingreso';
import type { IngresoConDetalles } from '../../../dominio/puertos/repositorio-ingresos';
import type { Producto } from '../../../dominio/entidades/producto';
import { totalesConIva } from '../comunes/totales-con-iva';
import {
  formatoFechaSoloDia,
  textoFechaFiltro,
  textoFiltroOpcional,
  soloFiltrosAplicados,
} from '../comunes/formato-documento';
import { identificadorIngreso } from '../../../aplicacion/ingresos/identificador-ingreso';

/**
 * Etiquetas de estado IDÉNTICAS a las de `frontend/src/componentes/ingresos/estado-ingreso-tag.tsx`.
 * El backend no importa código del frontend (docs/arquitectura.md §2), así que la traducción se
 * replica aquí — igual que `ETIQUETA_TIPO_MOVIMIENTO` en los mapeadores de reportes.
 */
const ETIQUETA_ESTADO_INGRESO: Record<EstadoIngreso, string> = {
  PENDIENTE: 'Pendiente',
  RECIBIDO: 'Recibido',
  VERIFICADO: 'Verificado',
  ANULADO: 'Anulado',
};

/** Las MISMAS siete columnas que la tabla de `/ingresos`, en el mismo orden. */
const COLUMNAS_LISTADO_INGRESOS: ColumnaDocumentoReporte[] = [
  { clave: 'numeroFactura', etiqueta: 'Factura' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'fechaFactura', etiqueta: 'Fecha factura' },
  { clave: 'fechaRecepcion', etiqueta: 'Recepción' },
  { clave: 'estado', etiqueta: 'Estado' },
  { clave: 'valorTotal', etiqueta: 'Valor total', alineacion: 'derecha' },
  { clave: 'registro', etiqueta: 'Registró' },
];

/**
 * Listado de ingresos → documento tabular (FR-064). `ingresos` llega SIN paginar
 * (`RepositorioIngresos.listarTodos`): son TODAS las filas que cumplen el filtro, no la página
 * que el usuario tuviera abierta.
 */
export function mapearListadoIngresosADocumento(
  ingresos: readonly Ingreso[],
  filtros: FiltroIngresos,
  /** Nombre del proveedor filtrado, ya resuelto por el controlador (US15): desde FR-091 el
   *  filtro viaja como id, y "Proveedor: 7" no le diría nada a quien abre el archivo. */
  nombreProveedorFiltrado?: string,
): DocumentoReporte {
  return {
    titulo: 'Ingresos de mercancía',
    generadoEn: new Date(),
    filtrosAplicados: soloFiltrosAplicados({
      Buscar: textoFiltroOpcional(filtros.buscar),
      // US13: el encabezado enumera TODOS los filtros del listado, también los nuevos — un
      // archivo que omitiera uno diría "esto es todo lo que hay" sobre un conjunto recortado.
      Proveedor: textoFiltroOpcional(nombreProveedorFiltrado),
      Estado: filtros.estado ? ETIQUETA_ESTADO_INGRESO[filtros.estado] : 'Sin filtro',
      Desde: textoFechaFiltro(filtros.desde),
      Hasta: textoFechaFiltro(filtros.hasta),
    }),
    columnas: COLUMNAS_LISTADO_INGRESOS,
    filas: ingresos.map((ingreso) => ({
      // US29 (FR-126): un ajuste enseña su correlativo donde las facturas enseñan su número, y
      // deja en blanco lo que no tiene. Un guión es la respuesta honesta: no hay proveedor, no
      // un proveedor que no se pudo resolver.
      numeroFactura: identificadorIngreso(ingreso),
      proveedor: ingreso.proveedor?.nombre ?? '—',
      fechaFactura: ingreso.fechaFactura ? formatoFechaSoloDia(ingreso.fechaFactura) : '—',
      fechaRecepcion: formatoFechaSoloDia(ingreso.fechaRecepcion),
      estado: ETIQUETA_ESTADO_INGRESO[ingreso.estado],
      valorTotal: ingreso.valorTotal,
      registro: `Usuario N.º ${ingreso.usuarioRegistraId}`,
    })),
  };
}

/** Columnas de las LÍNEAS del documento individual — las mismas cuatro de la tabla de detalle
 *  de `/ingresos/[id]`. */
const COLUMNAS_LINEAS_INGRESO: ColumnaDocumentoReporte[] = [
  { clave: 'producto', etiqueta: 'Producto' },
  { clave: 'cantidad', etiqueta: 'Cantidad', alineacion: 'derecha' },
  { clave: 'precioUnitario', etiqueta: 'Precio unitario', alineacion: 'derecha' },
  { clave: 'valorLinea', etiqueta: 'Valor de línea', alineacion: 'derecha' },
];

/**
 * Documento individual de un ingreso (FR-065): cabecera, líneas, total y auditoría.
 *
 * `productosPorId` resuelve `SKU — descripción` de cada línea, igual que hace la pantalla de
 * detalle; una línea cuyo producto no se pudo resolver cae en el MISMO texto de respaldo que
 * usa esa pantalla (`Producto N.º 7`), nunca en un hueco vacío.
 */
export function mapearIngresoADocumento(
  ingreso: IngresoConDetalles,
  productosPorId: ReadonlyMap<number, Producto>,
): DocumentoReporte {
  // US29 (FR-126): un ajuste no tiene factura, fecha de factura ni proveedor, y su cabecera no
  // los inventa: se omiten las filas que no existen y el documento se encabeza con su propio
  // correlativo. Escribirlas con un guión daría a entender que faltan datos por completar.
  const esAjuste = ingreso.tipo === 'AJUSTE';
  const encabezado: DatoEncabezadoDocumento[] = [
    { etiqueta: esAjuste ? 'Ajuste de inventario' : 'Factura', valor: identificadorIngreso(ingreso) },
    ...(ingreso.proveedor ? [{ etiqueta: 'Proveedor', valor: ingreso.proveedor.nombre }] : []),
    ...(ingreso.fechaFactura
      ? [{ etiqueta: 'Fecha de la factura', valor: formatoFechaSoloDia(ingreso.fechaFactura) }]
      : []),
    { etiqueta: 'Fecha de recepción', valor: formatoFechaSoloDia(ingreso.fechaRecepcion) },
    { etiqueta: 'Estado', valor: ETIQUETA_ESTADO_INGRESO[ingreso.estado] },
    // Auditoría (FR-065): quién registró el documento. Mismo texto que la pantalla, ver TSDoc.
    { etiqueta: 'Registró', valor: `Usuario N.º ${ingreso.usuarioRegistraId}` },
  ];
  if (ingreso.observaciones) {
    encabezado.push({ etiqueta: 'Observaciones', valor: ingreso.observaciones });
  }
  if (ingreso.motivoAnulacion) {
    encabezado.push({ etiqueta: 'Motivo de anulación', valor: ingreso.motivoAnulacion });
  }

  return {
    titulo: `Ingreso — Factura ${ingreso.numeroFactura}`,
    generadoEn: new Date(),
    // Un documento individual no responde a ningún filtro: su contexto entero está en
    // `encabezado`. Con el objeto vacío, el PDF omite la línea de filtros (ver `ExportadorPdf`).
    filtrosAplicados: {},
    encabezado,
    columnas: COLUMNAS_LINEAS_INGRESO,
    filas: ingreso.detalles.map((detalle) => ({
      producto: textoProducto(productosPorId.get(detalle.productoId), detalle.productoId),
      cantidad: detalle.cantidad,
      precioUnitario: detalle.precioUnitario,
      valorLinea: detalle.valorTotal,
    })),
    totales: totalesConIva(ingreso),
  };
}

/** `SKU — descripción`, o el mismo respaldo que muestra la pantalla si el producto no se pudo
 *  resolver (`Producto N.º 7`). */
export function textoProducto(producto: Producto | undefined, productoId: number): string {
  return producto ? `${producto.sku} — ${producto.descripcion}` : `Producto N.º ${productoId}`;
}
