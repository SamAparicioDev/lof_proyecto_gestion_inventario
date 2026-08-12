/**
 * Módulo de exportación — todo lo que un controlador necesita para producir un archivo:
 *
 * 1. Las dos estrategias del puerto `ExportadorReporte` (patrón Strategy, research R8,
 *    docs/arquitectura.md §3) bajo tokens de inyección propios, uno por formato, para que el
 *    controlador elija según el query param `formato` sin conocer las clases concretas de
 *    infraestructura (DIP).
 * 2. `ResolverLogoDocumentoCasoUso` (US11/T119): la ÚNICA respuesta a "¿qué logo lleva este
 *    archivo?" (FR-067/FR-069). Es un caso de uso de APLICACIÓN, no un adaptador; vive aquí
 *    porque los módulos de NestJS solo cablean, y quien importa este módulo lo hace justamente
 *    para exportar — pedirle además importar un segundo módulo para el logo sería ruido.
 *
 * A diferencia de `PersistenciaModule`, NO es `@Global()`: lo importan solo los TRES módulos
 * que exportan archivos (reportes desde US4/T070 y US7/T081; ingresos y salidas desde
 * US11/T120), en vez de registrar en todo el árbol proveedores que el resto no usa.
 */
import { Module } from '@nestjs/common';
import { ResolverLogoDocumentoCasoUso } from '../../aplicacion/exportacion/resolver-logo-documento.caso-uso';
import { ExportadorExcel } from './exportador-excel';
import { ExportadorPdf } from './exportador-pdf';

/** Token de inyección del `ExportadorReporte` en formato Excel (.xlsx). */
export const EXPORTADOR_EXCEL = 'ExportadorExcel';
/** Token de inyección del `ExportadorReporte` en formato PDF. */
export const EXPORTADOR_PDF = 'ExportadorPdf';

@Module({
  providers: [
    { provide: EXPORTADOR_EXCEL, useClass: ExportadorExcel },
    { provide: EXPORTADOR_PDF, useClass: ExportadorPdf },
    ResolverLogoDocumentoCasoUso,
  ],
  exports: [EXPORTADOR_EXCEL, EXPORTADOR_PDF, ResolverLogoDocumentoCasoUso],
})
export class ExportacionModule {}
