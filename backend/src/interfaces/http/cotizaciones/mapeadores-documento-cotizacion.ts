/**
 * Mapeadores puros `cotización(es) → DocumentoReporte` (US21, FR-116). Viven junto al
 * controlador —no en `aplicacion/`— por el mismo motivo que los de órdenes de compra: son un
 * detalle de la capa HTTP de exportación. El repositorio ya devolvió los datos; estas funciones
 * solo los reacomodan en filas y columnas, SIN volver a consultar ni recalcular nada.
 *
 * ## Es el documento que sale de la empresa
 *
 * Igual que el PDF de una orden de compra —y a diferencia del de un ingreso, que es respaldo
 * interno—, este llega a un tercero que no tiene ningún otro contexto: el cliente. Por eso el
 * encabezado lleva sus datos, el proyecto al que va dirigida y, sobre todo, HASTA CUÁNDO vale
 * el precio: una oferta sin fecha de validez es una oferta que el cliente puede intentar cobrar
 * seis meses después.
 *
 * Y por eso las tres cifras del pie (base, IVA y total) importan aquí más que en ningún otro
 * documento: es la cifra que el cliente va a comparar con la de la competencia.
 *
 * Implementa: FR-116 (documento exportable con logo y las tres cifras) y FR-064/SC-007 (el
 * listado exportado es exactamente lo filtrado en pantalla).
 */
import { formatoNumeroCotizacion, type FiltroListarCotizaciones } from '@trazo/compartido';
import type {
  ColumnaDocumentoReporte,
  DatoEncabezadoDocumento,
  DocumentoReporte,
} from '../../../aplicacion/reportes/puertos/exportador-reporte';
import type { Cliente } from '../../../dominio/entidades/cliente';
import type { Cotizacion, EstadoCotizacion } from '../../../dominio/entidades/cotizacion';
import type { Producto } from '../../../dominio/entidades/producto';
import type { CotizacionConDetalles } from '../../../dominio/puertos/repositorio-cotizaciones';
import {
  formatoFechaSoloDia,
  soloFiltrosAplicados,
  textoFechaFiltro,
  textoFiltroOpcional,
} from '../comunes/formato-documento';
import { totalesConIva } from '../comunes/totales-con-iva';
import { textoProducto } from '../ingresos/mapeadores-documento-ingreso';

/**
 * Etiquetas de estado IDÉNTICAS a las del frontend. El backend no importa código del frontend
 * (docs/arquitectura.md §2), así que la traducción se replica aquí — mismo criterio que
 * `ETIQUETA_ESTADO_INGRESO`.
 */
const ETIQUETA_ESTADO: Record<EstadoCotizacion, string> = {
  BORRADOR: 'Borrador',
  ENVIADA: 'Enviada',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
  ANULADA: 'Anulada',
};

/** Las MISMAS columnas que la tabla de `/cotizaciones`, en el mismo orden. */
const COLUMNAS_LISTADO: ColumnaDocumentoReporte[] = [
  { clave: 'numero', etiqueta: 'Cotización' },
  { clave: 'cliente', etiqueta: 'Cliente' },
  { clave: 'proyecto', etiqueta: 'Proyecto' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'validez', etiqueta: 'Válida hasta' },
  { clave: 'estado', etiqueta: 'Estado' },
  { clave: 'total', etiqueta: 'Total', alineacion: 'derecha' },
];

/**
 * Listado → documento tabular (FR-064). `cotizaciones` llega SIN paginar: son TODAS las filas
 * que cumplen el filtro, no la página que el usuario tuviera abierta.
 *
 * La columna es "Total" y trae base + IVA: en un listado de ofertas, la cifra que se compara es
 * lo que el cliente pagaría, no la base gravable. El desglose está en el documento individual.
 */
export function mapearListadoCotizacionesADocumento(
  cotizaciones: readonly Cotizacion[],
  filtros: FiltroListarCotizaciones,
  /** Nombre del cliente filtrado, ya resuelto por el controlador: el filtro viaja como id y
   *  "Cliente: 7" no le diría nada a quien abre el archivo. */
  nombreClienteFiltrado?: string,
): DocumentoReporte {
  return {
    titulo: 'Cotizaciones',
    generadoEn: new Date(),
    filtrosAplicados: soloFiltrosAplicados({
      Buscar: textoFiltroOpcional(filtros.buscar),
      Cliente: textoFiltroOpcional(nombreClienteFiltrado),
      Estado: filtros.estado ? ETIQUETA_ESTADO[filtros.estado] : 'Sin filtro',
      Desde: textoFechaFiltro(filtros.desde),
      Hasta: textoFechaFiltro(filtros.hasta),
    }),
    columnas: COLUMNAS_LISTADO,
    filas: cotizaciones.map((cotizacion) => ({
      numero: formatoNumeroCotizacion(cotizacion.numero),
      cliente: cotizacion.cliente.nombre,
      proyecto: cotizacion.proyecto.nombre,
      fecha: formatoFechaSoloDia(cotizacion.fecha),
      validez: formatoFechaSoloDia(cotizacion.fechaValidez),
      estado: ETIQUETA_ESTADO[cotizacion.estado],
      total: cotizacion.valorTotal + cotizacion.valorIva,
    })),
  };
}

/** Columnas de las LÍNEAS del documento individual. */
const COLUMNAS_LINEAS: ColumnaDocumentoReporte[] = [
  { clave: 'producto', etiqueta: 'Producto' },
  { clave: 'cantidad', etiqueta: 'Cantidad', alineacion: 'derecha' },
  { clave: 'precioUnitario', etiqueta: 'Precio unitario', alineacion: 'derecha' },
  { clave: 'iva', etiqueta: 'IVA', alineacion: 'derecha' },
  { clave: 'valorLinea', etiqueta: 'Valor de línea', alineacion: 'derecha' },
];

/** LA OFERTA: el documento que se le envía al cliente (FR-116). */
export function mapearCotizacionADocumento(
  cotizacion: CotizacionConDetalles,
  productosPorId: ReadonlyMap<number, Producto>,
  /** Datos de contacto del cliente, para que el documento se baste a sí mismo. */
  cliente: Cliente | null,
): DocumentoReporte {
  const encabezado: DatoEncabezadoDocumento[] = [
    { etiqueta: 'Cotización', valor: formatoNumeroCotizacion(cotizacion.numero) },
    { etiqueta: 'Cliente', valor: cotizacion.cliente.nombre },
  ];
  if (cliente?.nit) encabezado.push({ etiqueta: 'NIT', valor: cliente.nit });
  if (cliente?.telefono) encabezado.push({ etiqueta: 'Teléfono', valor: cliente.telefono });
  if (cliente?.email) encabezado.push({ etiqueta: 'Correo', valor: cliente.email });

  encabezado.push({ etiqueta: 'Proyecto', valor: cotizacion.proyecto.nombre });
  encabezado.push({ etiqueta: 'Fecha', valor: formatoFechaSoloDia(cotizacion.fecha) });
  // La validez va SIEMPRE, aunque el resto sea opcional: es lo que impide que la oferta se
  // interprete como un precio sostenido para siempre.
  encabezado.push({ etiqueta: 'Válida hasta', valor: formatoFechaSoloDia(cotizacion.fechaValidez) });
  encabezado.push({ etiqueta: 'Estado', valor: ETIQUETA_ESTADO[cotizacion.estado] });
  if (cotizacion.observaciones) {
    encabezado.push({ etiqueta: 'Observaciones', valor: cotizacion.observaciones });
  }
  if (cotizacion.motivoAnulacion) {
    encabezado.push({ etiqueta: 'Motivo de anulación', valor: cotizacion.motivoAnulacion });
  }

  return {
    titulo: `Cotización ${formatoNumeroCotizacion(cotizacion.numero)}`,
    generadoEn: new Date(),
    // Un documento individual no responde a ningún filtro: su contexto entero está en el
    // encabezado. Con el objeto vacío, el PDF omite la línea de filtros.
    filtrosAplicados: {},
    encabezado,
    columnas: COLUMNAS_LINEAS,
    filas: cotizacion.detalles.map((detalle) => ({
      producto: textoProducto(productosPorId.get(detalle.productoId), detalle.productoId),
      cantidad: detalle.cantidad,
      precioUnitario: detalle.precioUnitario,
      iva: detalle.valorIva,
      valorLinea: detalle.valorTotal,
    })),
    totales: totalesConIva(cotizacion),
  };
}
