/**
 * Mapeadores puros `salida(s) → DocumentoReporte` (US11/T120/T121) — mismo criterio y misma
 * ubicación que `ingresos/mapeadores-documento-ingreso.ts`: detalle de la capa HTTP de
 * exportación, sin consultas ni cálculos propios.
 *
 * ## Cliente y proyecto por NOMBRE, no por id (SC-007)
 *
 * A diferencia de "Registró"/"Autoriza" —que la pantalla muestra como `Usuario N.º 7` porque el
 * endpoint de listado no expone el nombre—, la tabla de `/salidas` SÍ muestra el nombre del
 * cliente y del proyecto: los resuelve en el navegador con `cargarClientesYProyectos`. Exportar
 * `Proyecto N.º 3` sería enseñar MENOS de lo que se ve en pantalla, así que el controlador
 * resuelve los nombres en el servidor y los pasa aquí. Cuando un proyecto no se puede resolver,
 * se cae en el MISMO texto de respaldo que ya usa la pantalla, nunca en un hueco vacío.
 *
 * ## El logo (FR-067/FR-069)
 *
 * El documento de UNA salida y el listado FILTRADO por `clienteId` corresponden a un único
 * cliente: llevan su logo. Un listado de salidas SIN filtrar abarca varios clientes y va sin
 * logo (US11-AS4). El logo lo resuelve `ResolverLogoDocumentoCasoUso` y llega ya listo; estos
 * mapeadores solo lo adjuntan, y `undefined` es un valor perfectamente normal (FR-068).
 *
 * Implementa: FR-064 (listado exportado con todas las filas del filtro), FR-065 (documento
 * individual completo con auditoría), FR-067/FR-069 (logo del cliente, heredado por el
 * proyecto), FR-043/SC-007.
 */
import type { FiltroSalidas } from '@trazo/compartido';
import type {
  ColumnaDocumentoReporte,
  DatoEncabezadoDocumento,
  DocumentoReporte,
  LogoDocumento,
} from '../../../aplicacion/reportes/puertos/exportador-reporte';
import type { Producto } from '../../../dominio/entidades/producto';
import type { EstadoSalida, Salida } from '../../../dominio/entidades/salida';
import type { SalidaConDetalles } from '../../../dominio/puertos/repositorio-salidas';
import {
  formatoFechaHoraBogota,
  formatoFechaSoloDia,
  formatoMonedaCop,
  textoFechaFiltro,
  soloFiltrosAplicados,
} from '../comunes/formato-documento';
import { textoProducto } from '../ingresos/mapeadores-documento-ingreso';

/**
 * Etiquetas de estado IDÉNTICAS a las de `frontend/src/componentes/salidas/estado-salida-tag.tsx`
 * (ver el mismo criterio en el mapeador de ingresos).
 */
const ETIQUETA_ESTADO_SALIDA: Record<EstadoSalida, string> = {
  PENDIENTE: 'Pendiente',
  CONFIRMADA: 'Confirmada',
  COMPLETADA: 'Completada',
  ANULADA: 'Anulada',
};

/** Cliente y proyecto de una salida, ya resueltos por el controlador (ver TSDoc de cabecera). */
export interface DestinoSalida {
  readonly cliente: string;
  readonly proyecto: string;
}

/** Las MISMAS siete columnas que la tabla de `/salidas`, en el mismo orden. */
const COLUMNAS_LISTADO_SALIDAS: ColumnaDocumentoReporte[] = [
  { clave: 'numero', etiqueta: 'N.º salida' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'cliente', etiqueta: 'Cliente' },
  { clave: 'proyecto', etiqueta: 'Proyecto' },
  { clave: 'estado', etiqueta: 'Estado' },
  { clave: 'valorTotal', etiqueta: 'Valor total', alineacion: 'derecha' },
  { clave: 'autoriza', etiqueta: 'Autoriza' },
];

/**
 * Listado de salidas → documento tabular (FR-064). `salidas` llega SIN paginar
 * (`RepositorioSalidas.listarTodas`): TODAS las filas del filtro, no la página visible.
 *
 * `destinoPorProyectoId` trae el nombre de cliente y de proyecto de cada salida; `logo` solo
 * viene cuando el filtro acotó a un único cliente.
 */
export function mapearListadoSalidasADocumento(
  salidas: readonly Salida[],
  filtros: FiltroSalidas,
  destinoPorProyectoId: ReadonlyMap<number, DestinoSalida>,
  nombresDeFiltro: { cliente?: string; proyecto?: string },
  logo?: LogoDocumento,
): DocumentoReporte {
  return {
    titulo: 'Salidas por proyecto',
    generadoEn: new Date(),
    filtrosAplicados: soloFiltrosAplicados({
      Cliente: nombresDeFiltro.cliente ?? 'Todos',
      Proyecto: nombresDeFiltro.proyecto ?? 'Todos',
      Estado: filtros.estado ? ETIQUETA_ESTADO_SALIDA[filtros.estado] : 'Sin filtro',
      Desde: textoFechaFiltro(filtros.desde),
      Hasta: textoFechaFiltro(filtros.hasta),
      // US13: el encabezado enumera TODOS los filtros del listado, también los nuevos — un
      // archivo que omitiera uno diría "esto es todo lo que hay" sobre un conjunto recortado.
      // `usuarioAutorizaId` viaja como id porque la columna "Autoriza" de esta misma tabla
      // también muestra `Usuario N.º 7`: el archivo enseña exactamente lo que enseña la
      // pantalla, ni más ni menos (SC-007, mismo criterio que la columna "Registró" de ingresos).
      'N.º de salida': filtros.numero !== undefined ? `N.º ${filtros.numero}` : 'Sin filtro',
      Autoriza: filtros.usuarioAutorizaId !== undefined ? `Usuario N.º ${filtros.usuarioAutorizaId}` : 'Sin filtro',
    }),
    columnas: COLUMNAS_LISTADO_SALIDAS,
    filas: salidas.map((salida) => {
      const destino = destinoPorProyectoId.get(salida.proyectoId);
      return {
        numero: `N.º ${salida.numero}`,
        fecha: formatoFechaSoloDia(salida.fechaSalida),
        cliente: destino?.cliente ?? '—',
        proyecto: destino?.proyecto ?? `Proyecto N.º ${salida.proyectoId}`,
        estado: ETIQUETA_ESTADO_SALIDA[salida.estado],
        valorTotal: salida.valorTotal,
        autoriza: salida.usuarioAutorizaId ? `Usuario N.º ${salida.usuarioAutorizaId}` : '—',
      };
    }),
    logo,
  };
}

/** Columnas de las LÍNEAS del documento individual — las mismas cuatro de la tabla de detalle
 *  de `/salidas/[id]`. */
const COLUMNAS_LINEAS_SALIDA: ColumnaDocumentoReporte[] = [
  { clave: 'producto', etiqueta: 'Producto' },
  { clave: 'cantidad', etiqueta: 'Cantidad', alineacion: 'derecha' },
  { clave: 'precioUnitario', etiqueta: 'Precio unitario', alineacion: 'derecha' },
  { clave: 'valorLinea', etiqueta: 'Valor de línea', alineacion: 'derecha' },
];

/**
 * Documento individual de una salida (FR-065): cabecera con su destino, líneas, total y
 * auditoría (quién autorizó y cuándo se confirmó). Lleva el logo del cliente dueño del
 * proyecto cuando lo tiene cargado (FR-067/FR-069) — es el archivo que se le envía al cliente
 * como soporte de entrega, y por eso es el caso que más justifica toda esta historia.
 */
export function mapearSalidaADocumento(
  salida: SalidaConDetalles,
  destino: DestinoSalida,
  productosPorId: ReadonlyMap<number, Producto>,
  logo?: LogoDocumento,
): DocumentoReporte {
  const encabezado: DatoEncabezadoDocumento[] = [
    { etiqueta: 'Salida', valor: `N.º ${salida.numero}` },
    { etiqueta: 'Cliente', valor: destino.cliente },
    { etiqueta: 'Proyecto', valor: destino.proyecto },
    { etiqueta: 'Fecha de salida', valor: formatoFechaSoloDia(salida.fechaSalida) },
    { etiqueta: 'Estado', valor: ETIQUETA_ESTADO_SALIDA[salida.estado] },
    // Auditoría (FR-065): quién autorizó la salida y cuándo quedó confirmada.
    { etiqueta: 'Autoriza', valor: salida.usuarioAutorizaId ? `Usuario N.º ${salida.usuarioAutorizaId}` : '—' },
    {
      etiqueta: 'Fecha de confirmación',
      valor: salida.fechaConfirmacion ? formatoFechaHoraBogota(salida.fechaConfirmacion) : '—',
    },
  ];
  if (salida.observaciones) {
    encabezado.push({ etiqueta: 'Observaciones', valor: salida.observaciones });
  }
  if (salida.motivoAnulacion) {
    encabezado.push({ etiqueta: 'Motivo de anulación', valor: salida.motivoAnulacion });
  }

  return {
    titulo: `Salida N.º ${salida.numero}`,
    generadoEn: new Date(),
    // Ver el mismo comentario en `mapearIngresoADocumento`: un documento no responde a filtros.
    filtrosAplicados: {},
    encabezado,
    columnas: COLUMNAS_LINEAS_SALIDA,
    filas: salida.detalles.map((detalle) => ({
      producto: textoProducto(productosPorId.get(detalle.productoId), detalle.productoId),
      cantidad: detalle.cantidad,
      precioUnitario: detalle.precioUnitario,
      valorLinea: detalle.valorTotal,
    })),
    totales: [{ etiqueta: 'Valor total', valor: formatoMonedaCop(salida.valorTotal) }],
    logo,
  };
}
