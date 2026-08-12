/**
 * Puerto `ExportadorReporte` — patrón Strategy (research R8, docs/arquitectura.md §3): hoy
 * dos formatos de exportación (Excel/PDF), extensible a otros sin tocar el controlador de
 * reportes (OCP). Implementado por `infraestructura/exportacion/exportador-{excel,pdf}.ts`.
 *
 * `DocumentoReporte` es una forma TABULAR GENÉRICA a la que CUALQUIER reporte (consumo-
 * cliente, consumo-proyecto de US4 y los de inventario/movimientos de US7) se aplana antes
 * de exportar. La forma "rica" que devuelve cada caso de uso (agrupada por proyecto, con
 * margen/serie para el gráfico…) es solo para pantalla; el aplanado a `DocumentoReporte`
 * ocurre en un mapeador puro junto al controlador
 * (`interfaces/http/reportes/mapeadores-documento-reporte.ts`), SIEMPRE a partir del MISMO
 * resultado que ya devolvió el caso de uso — nunca recalculando datos por separado. Esa
 * regla es lo que garantiza SC-007 (exportar = exactamente lo que se ve en pantalla).
 *
 * ## US11 (T119/T121): la misma forma sirve para un DOCUMENTO, no solo para un reporte
 *
 * `DocumentoReporte` gana dos campos OPCIONALES —ninguno de los 4 reportes existentes los usa,
 * así que su salida no cambia en un solo byte:
 *
 * - `encabezado`: los datos de CABECERA de un documento individual (proveedor, fechas, estado,
 *   auditoría de un ingreso o de una salida — FR-065). No pueden ir en `filtrosAplicados`
 *   porque `ExportadorExcel` a propósito NO escribe ese campo (ver su TSDoc), y un ingreso
 *   exportado a Excel sin su cabecera no sería el documento completo que FR-065 exige, sino
 *   una lista de líneas huérfana. Tampoco en `totales`: la cabecera de un documento va arriba.
 * - `logo`: la identidad del cliente al que corresponde el archivo (FR-067). Es OPCIONAL
 *   porque solo existe un logo correcto cuando el export corresponde a UN ÚNICO cliente; un
 *   export multi-cliente (inventario, movimientos, ingresos, salidas sin filtrar) lo omite.
 *
 * Regla dura de AMBAS estrategias (FR-068): si el logo falta o falla su lectura/incrustación,
 * el archivo se genera IGUAL sin logo — nunca un error. El contenido de datos manda sobre la
 * decoración; un PDF de entrega sin logotipo sirve, un 500 no.
 *
 * Implementa: FR-043 (exportación PDF/Excel con encabezados, filtros aplicados, fecha de
 * generación y totales; reporte sin filas → archivo válido con cero filas, nunca un error),
 * FR-065 (documento individual completo), FR-067/FR-068 (logo del cliente, opcional y jamás
 * bloqueante).
 */

/** Columna de `DocumentoReporte`. `alineacion: 'derecha'` marca columnas numéricas/monetarias
 *  — los adaptadores las alinean a la derecha y, en Excel, les aplican formato de celda
 *  moneda COP. */
export interface ColumnaDocumentoReporte {
  readonly clave: string;
  readonly etiqueta: string;
  readonly alineacion?: 'derecha';
}

/**
 * Forma tabular genérica a la que se aplana cualquier reporte antes de exportar (ver TSDoc
 * de cabecera). `filtrosAplicados` son pares etiqueta→valor YA formateados para mostrar (ej.
 * `{ Cliente: 'Jumbo', Desde: '01/06/2026' }`) — los adaptadores solo los unen en una línea
 * legible, no interpretan su significado. `totales` es opcional porque no todo reporte
 * tabular tiene fila de cierre.
 */
export interface DocumentoReporte {
  readonly titulo: string;
  readonly generadoEn: Date;
  readonly filtrosAplicados: Record<string, string>;
  /** Cabecera de un DOCUMENTO individual (US11/FR-065) — ver TSDoc de cabecera. Los reportes
   *  tabulares la omiten. */
  readonly encabezado?: DatoEncabezadoDocumento[];
  readonly columnas: ColumnaDocumentoReporte[];
  readonly filas: Record<string, string | number>[];
  readonly totales?: { etiqueta: string; valor: string }[];
  /** Logo del cliente al que corresponde el archivo (US11/FR-067) — presente SOLO cuando el
   *  export corresponde a un único cliente. Su ausencia o su fallo NUNCA impiden generar el
   *  archivo (FR-068). */
  readonly logo?: LogoDocumento;
}

/** Par etiqueta→valor de la cabecera de un documento, YA formateado para mostrar (mismo
 *  criterio que `filtrosAplicados`: los adaptadores no interpretan, solo pintan). */
export interface DatoEncabezadoDocumento {
  readonly etiqueta: string;
  readonly valor: string;
}

/**
 * Imagen a incrustar en el encabezado del archivo exportado (US11/FR-067). `contenido` es
 * `Uint8Array` —no `Buffer`— porque este puerto vive en la capa de APLICACIÓN y describe el
 * dato, no su representación en Node; cada estrategia lo convierte a lo que su librería
 * necesita (`Buffer` para `exceljs`, data URI base64 para `pdfmake`).
 *
 * El `tipoMime` viene ya validado contra los BYTES del archivo al cargarlo
 * (`dominio/servicios/servicio-imagen-logo.ts`), nunca contra lo que declaró un navegador.
 */
export interface LogoDocumento {
  readonly contenido: Uint8Array;
  readonly tipoMime: 'image/png' | 'image/jpeg';
}

/** Estrategia de exportación (research R8) — una implementación por formato de archivo. */
export interface ExportadorReporte {
  /**
   * Genera el archivo del reporte en el formato de la estrategia. Sin `filas` -> IGUAL
   * genera un archivo válido con encabezados y cero filas de datos — nunca lanza por
   * reporte vacío (FR-043, edge case de spec.md).
   */
  generar(documento: DocumentoReporte): Promise<Buffer>;
}
