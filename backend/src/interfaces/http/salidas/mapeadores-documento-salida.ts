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
 * resuelve los nombres en el servidor y los pasa aquí. Cuando un id no se puede resolver, se cae
 * en el MISMO texto de respaldo que ya usa la pantalla, nunca en un hueco vacío.
 *
 * Desde US28 (FR-124) los nombres llegan en un `DirectorioDestinos` —dos mapas, clientes y
 * proyectos— en vez de un único mapa indexado por proyecto: una salida puede no tener proyecto,
 * y su cliente hay que poder nombrarlo igual.
 *
 * ## El logotipo (FR-067)
 *
 * El documento de UNA salida y el listado FILTRADO por `clienteId` corresponden a un único
 * cliente. Desde el 2026-08-15 el logotipo NO se decide aquí: TODO exportable lleva el de LOF
 * y lo pone `ExportadorConLogo` (un único punto para las doce rutas `/export`); estos
 * mapeadores solo lo adjuntan, y `undefined` es un valor perfectamente normal (FR-068).
 *
 * Implementa: FR-064 (listado exportado con todas las filas del filtro), FR-065 (documento
 * individual completo con auditoría), FR-067 (logotipo institucional, que aplica el
 * proyecto), FR-043/SC-007.
 */
import type { FiltroSalidas } from '@trazo/compartido';
import type {
  BloqueFirma,
  ColumnaDocumentoReporte,
  DatoEncabezadoDocumento,
  DocumentoReporte,
} from '../../../aplicacion/reportes/puertos/exportador-reporte';
import type { Producto } from '../../../dominio/entidades/producto';
import type { EstadoSalida, Salida } from '../../../dominio/entidades/salida';
import type { SalidaConDetalles } from '../../../dominio/puertos/repositorio-salidas';
import { totalesConIva } from '../comunes/totales-con-iva';
import {
  formatoFechaHoraBogota,
  formatoFechaSoloDia,
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

/** Cliente y proyecto de una salida, ya resueltos a texto (ver TSDoc de cabecera). */
export interface DestinoSalida {
  readonly cliente: string;
  readonly proyecto: string;
}

/**
 * Nombres de los clientes y proyectos que aparecen en un export, resueltos por el controlador
 * en dos lecturas en lote.
 *
 * Sustituye al mapa único `proyectoId → { cliente, proyecto }` de US11: aquel deducía el
 * cliente a través del proyecto, y desde US28 (FR-124) hay salidas sin proyecto — que con
 * aquel mapa habrían salido en el archivo sin cliente, justo las que más necesitan mostrarlo.
 */
export interface DirectorioDestinos {
  readonly clientes: ReadonlyMap<number, string>;
  readonly proyectos: ReadonlyMap<number, string>;
}

/** Texto que ocupa la columna "Proyecto" cuando la entrega no es de una obra (US28, FR-124).
 *  Es el MISMO que muestra la pantalla, para que el archivo no diga otra cosa (SC-007). */
export const TEXTO_SIN_PROYECTO = 'Sin proyecto';

/**
 * Destino de UNA salida, con los mismos respaldos que usa la pantalla cuando un id no se puede
 * resolver: nunca un hueco vacío, siempre algo legible.
 */
export function destinoDeSalida(
  salida: Pick<Salida, 'clienteId' | 'proyectoId'>,
  directorio: DirectorioDestinos,
): DestinoSalida {
  const cliente = directorio.clientes.get(salida.clienteId) ?? `Cliente N.º ${salida.clienteId}`;
  if (salida.proyectoId === null) return { cliente, proyecto: TEXTO_SIN_PROYECTO };
  return {
    cliente,
    proyecto: directorio.proyectos.get(salida.proyectoId) ?? `Proyecto N.º ${salida.proyectoId}`,
  };
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
 * `directorio` trae los nombres de los clientes y proyectos que aparecen; el logotipo lo aplica
 * el decorador común a las doce rutas `/export`.
 */
export function mapearListadoSalidasADocumento(
  salidas: readonly Salida[],
  filtros: FiltroSalidas,
  directorio: DirectorioDestinos,
  nombresDeFiltro: { cliente?: string; proyecto?: string },
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
      const destino = destinoDeSalida(salida, directorio);
      return {
        numero: `N.º ${salida.numero}`,
        fecha: formatoFechaSoloDia(salida.fechaSalida),
        cliente: destino.cliente,
        proyecto: destino.proyecto,
        estado: ETIQUETA_ESTADO_SALIDA[salida.estado],
        valorTotal: salida.valorTotal,
        autoriza: salida.usuarioAutorizaId ? `Usuario N.º ${salida.usuarioAutorizaId}` : '—',
      };
    }),
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
 * Variante SIN valores (US27, FR-123): las columnas de dinero se QUITAN, no se vacían.
 *
 * Dejarlas en blanco o en cero produciría un comprobante con una columna titulada "Precio
 * unitario" esperando que alguien escriba a mano justo lo que se quería ocultar — y con el
 * total del documento en cero, que es una cifra falsa, no una cifra ausente.
 */
const COLUMNAS_LINEAS_SALIDA_SIN_VALORES: ColumnaDocumentoReporte[] = [
  { clave: 'producto', etiqueta: 'Producto' },
  { clave: 'cantidad', etiqueta: 'Cantidad', alineacion: 'derecha' },
];

/** Etiqueta bajo la línea de firma — dice en calidad de qué firma quien firma (US27). */
const ETIQUETA_FIRMA_RECIBE = 'Recibe la mercancía — firma y documento de identidad';

/** Cómo se pide el documento de una salida (US27, FR-123): con o sin valores, y a nombre de
 *  quién se imprime la firma. Ambos llegan de la query, ya validados por
 *  `esquemaExportDocumentoSalida`. */
export interface OpcionesDocumentoSalida {
  readonly conValores: boolean;
  readonly recibe: string;
}

/**
 * Documento individual de una salida (FR-065): cabecera con su destino, líneas, total y
 * auditoría (quién autorizó y cuándo se confirmó). El logotipo lo aplica el decorador del
 * proyecto cuando lo tiene cargado (FR-067/FR-069) — es el archivo que se le envía al cliente
 * como soporte de entrega, y por eso es el caso que más justifica toda esta historia.
 *
 * ## US27 (FR-123): dos variantes, una sola firma
 *
 * `opciones.conValores` decide si el archivo lleva las columnas de dinero y el bloque de
 * totales. La firma NO es opcional: va en las dos variantes, porque el motivo de existir del
 * documento es que alguien acuse recibo de la mercancía, no que se vea cuánto cuesta.
 */
export function mapearSalidaADocumento(
  salida: SalidaConDetalles,
  destino: DestinoSalida,
  productosPorId: ReadonlyMap<number, Producto>,
  opciones: OpcionesDocumentoSalida,
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

  const firmas: BloqueFirma[] = [{ etiqueta: ETIQUETA_FIRMA_RECIBE, nombre: opciones.recibe }];

  return {
    titulo: `Salida N.º ${salida.numero}`,
    generadoEn: new Date(),
    // Ver el mismo comentario en `mapearIngresoADocumento`: un documento no responde a filtros.
    filtrosAplicados: {},
    encabezado,
    columnas: opciones.conValores ? COLUMNAS_LINEAS_SALIDA : COLUMNAS_LINEAS_SALIDA_SIN_VALORES,
    filas: salida.detalles.map((detalle) => {
      const linea: Record<string, string | number> = {
        producto: textoProducto(productosPorId.get(detalle.productoId), detalle.productoId),
        cantidad: detalle.cantidad,
      };
      // Las claves de dinero ni siquiera se construyen en la variante sin valores: una fila que
      // las trajera dependiendo de que `columnas` no las nombre dejaría el importe dentro del
      // archivo (invisible en la tabla, pero presente en el XML del xlsx y en el flujo del PDF).
      if (opciones.conValores) {
        linea.precioUnitario = detalle.precioUnitario;
        linea.valorLinea = detalle.valorTotal;
      }
      return linea;
    }),
    // La variante sin valores omite el bloque de totales entero (base, IVA y total): es la
    // misma razón por la que se quitan las columnas, aplicada al pie del documento.
    totales: opciones.conValores ? totalesConIva(salida) : undefined,
    firmas,
  };
}
