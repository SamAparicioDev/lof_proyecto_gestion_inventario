/**
 * Mapeadores puros `orden(es) de compra → DocumentoReporte` (US16, FR-097). Viven junto al
 * controlador —no en `aplicacion/`— por el mismo motivo que los de ingresos: son un detalle de
 * la capa HTTP de exportación. El repositorio ya devolvió los datos; estas funciones solo los
 * reacomodan en filas y columnas, SIN volver a consultar ni recalcular nada.
 *
 * ## Por qué este documento importa más que los otros
 *
 * El PDF de un ingreso o de una salida es un respaldo interno: quien lo abre ya tiene el
 * sistema delante. El de una orden de compra ES EL PEDIDO — sale del sistema y llega a un
 * tercero que no tiene ningún otro contexto. Por eso su encabezado lleva los datos de contacto
 * del proveedor y la fecha de entrega esperada, que en pantalla podrían darse por sabidos, y por
 * eso el número va formateado como `OC-000042`: es la referencia con la que el proveedor va a
 * responder.
 *
 * Implementa: FR-097 (documento completo exportable) y FR-064/SC-007 (el listado exportado es
 * exactamente lo filtrado en pantalla).
 */
import { totalesConIva } from '../comunes/totales-con-iva';
import { formatoNumeroOrdenCompra, type FiltroOrdenesCompra } from '@trazo/compartido';
import type {
  ColumnaDocumentoReporte,
  DatoEncabezadoDocumento,
  DocumentoReporte,
} from '../../../aplicacion/reportes/puertos/exportador-reporte';
import type { EstadoOrdenCompra, OrdenCompra } from '../../../dominio/entidades/orden-compra';
import type { OrdenCompraConDetalles } from '../../../dominio/puertos/repositorio-ordenes-compra';
import type { Producto } from '../../../dominio/entidades/producto';
import type { Proveedor } from '../../../dominio/entidades/proveedor';
import {
  formatoFechaSoloDia,
  textoFechaFiltro,
  textoFiltroOpcional,
  soloFiltrosAplicados,
} from '../comunes/formato-documento';
import { textoProducto } from '../ingresos/mapeadores-documento-ingreso';

/**
 * Etiquetas de estado IDÉNTICAS a las del frontend (`estado-orden-compra-tag.tsx`). El backend
 * no importa código del frontend (docs/arquitectura.md §2), así que la traducción se replica
 * aquí — mismo criterio que `ETIQUETA_ESTADO_INGRESO`.
 */
const ETIQUETA_ESTADO: Record<EstadoOrdenCompra, string> = {
  BORRADOR: 'Borrador',
  ENVIADA: 'Enviada',
  RECIBIDA: 'Recibida',
  ANULADA: 'Anulada',
};

/** Las MISMAS columnas que la tabla de `/ordenes-compra`, en el mismo orden. */
const COLUMNAS_LISTADO: ColumnaDocumentoReporte[] = [
  { clave: 'numero', etiqueta: 'Orden' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'fechaOrden', etiqueta: 'Fecha' },
  { clave: 'entregaEsperada', etiqueta: 'Entrega esperada' },
  { clave: 'estado', etiqueta: 'Estado' },
  { clave: 'valorTotal', etiqueta: 'Valor total', alineacion: 'derecha' },
];

/** Listado → documento tabular (FR-064). `ordenes` llega SIN paginar: son TODAS las filas que
 *  cumplen el filtro, no la página que el usuario tuviera abierta. */
export function mapearListadoOrdenesCompraADocumento(
  ordenes: readonly OrdenCompra[],
  filtros: FiltroOrdenesCompra,
  /** Nombre del proveedor filtrado, ya resuelto por el controlador: el filtro viaja como id y
   *  "Proveedor: 7" no le diría nada a quien abre el archivo. */
  nombreProveedorFiltrado?: string,
): DocumentoReporte {
  return {
    titulo: 'Órdenes de compra',
    generadoEn: new Date(),
    filtrosAplicados: soloFiltrosAplicados({
      Buscar: textoFiltroOpcional(filtros.buscar),
      Proveedor: textoFiltroOpcional(nombreProveedorFiltrado),
      Estado: filtros.estado ? ETIQUETA_ESTADO[filtros.estado] : 'Sin filtro',
      Desde: textoFechaFiltro(filtros.desde),
      Hasta: textoFechaFiltro(filtros.hasta),
    }),
    columnas: COLUMNAS_LISTADO,
    filas: ordenes.map((orden) => ({
      numero: formatoNumeroOrdenCompra(orden.numero),
      proveedor: orden.proveedor.nombre,
      fechaOrden: formatoFechaSoloDia(orden.fechaOrden),
      entregaEsperada: orden.fechaEntregaEsperada ? formatoFechaSoloDia(orden.fechaEntregaEsperada) : 'Sin fecha',
      estado: ETIQUETA_ESTADO[orden.estado],
      valorTotal: orden.valorTotal,
    })),
  };
}

/** Columnas de las LÍNEAS del documento individual — las mismas de la tabla de detalle. */
const COLUMNAS_LINEAS: ColumnaDocumentoReporte[] = [
  { clave: 'producto', etiqueta: 'Producto' },
  { clave: 'cantidad', etiqueta: 'Cantidad', alineacion: 'derecha' },
  { clave: 'precioUnitario', etiqueta: 'Precio estimado', alineacion: 'derecha' },
  { clave: 'valorLinea', etiqueta: 'Valor de línea', alineacion: 'derecha' },
];

/**
 * Documento individual de la orden (FR-097): lo que se le envía al proveedor.
 *
 * `productosPorId` resuelve `SKU — descripción` de cada línea igual que la pantalla; una línea
 * cuyo producto no se pudo resolver cae en el MISMO texto de respaldo (`Producto N.º 7`), nunca
 * en un hueco vacío.
 *
 * "Precio estimado" y no "Precio unitario": el proveedor debe leer que ese número es la
 * expectativa de quien pide, no un precio ya pactado — su factura es la que manda (FR-094).
 */
export function mapearOrdenCompraADocumento(
  orden: OrdenCompraConDetalles,
  productosPorId: ReadonlyMap<number, Producto>,
  /** Datos de contacto del proveedor, para que el documento se baste a sí mismo. */
  proveedor: Proveedor | null,
): DocumentoReporte {
  const encabezado: DatoEncabezadoDocumento[] = [
    { etiqueta: 'Orden de compra', valor: formatoNumeroOrdenCompra(orden.numero) },
    { etiqueta: 'Proveedor', valor: orden.proveedor.nombre },
  ];
  if (proveedor?.nit) encabezado.push({ etiqueta: 'NIT', valor: proveedor.nit });
  if (proveedor?.telefono) encabezado.push({ etiqueta: 'Teléfono', valor: proveedor.telefono });
  if (proveedor?.email) encabezado.push({ etiqueta: 'Correo', valor: proveedor.email });

  encabezado.push({ etiqueta: 'Fecha de la orden', valor: formatoFechaSoloDia(orden.fechaOrden) });
  if (orden.fechaEntregaEsperada) {
    encabezado.push({
      etiqueta: 'Entrega esperada',
      valor: formatoFechaSoloDia(orden.fechaEntregaEsperada),
    });
  }
  encabezado.push({ etiqueta: 'Estado', valor: ETIQUETA_ESTADO[orden.estado] });
  if (orden.observaciones) encabezado.push({ etiqueta: 'Observaciones', valor: orden.observaciones });
  if (orden.motivoAnulacion) encabezado.push({ etiqueta: 'Motivo de anulación', valor: orden.motivoAnulacion });

  return {
    titulo: `Orden de compra ${formatoNumeroOrdenCompra(orden.numero)}`,
    generadoEn: new Date(),
    // Un documento individual no responde a ningún filtro: su contexto entero está en el
    // encabezado. Con el objeto vacío, el PDF omite la línea de filtros.
    filtrosAplicados: {},
    encabezado,
    columnas: COLUMNAS_LINEAS,
    filas: orden.detalles.map((detalle) => ({
      producto: textoProducto(productosPorId.get(detalle.productoId), detalle.productoId),
      cantidad: detalle.cantidad,
      precioUnitario: detalle.precioUnitario,
      valorLinea: detalle.valorTotal,
    })),
    totales: totalesConIva(orden),
  };
}
