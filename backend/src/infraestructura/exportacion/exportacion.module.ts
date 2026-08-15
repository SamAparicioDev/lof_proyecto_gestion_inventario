/**
 * Módulo de exportación — todo lo que un controlador necesita para producir un archivo: las dos
 * estrategias del puerto `ExportadorReporte` (patrón Strategy, research R8,
 * docs/arquitectura.md §3) bajo tokens de inyección propios, uno por formato, para que el
 * controlador elija según el query param `formato` sin conocer las clases concretas de
 * infraestructura (DIP).
 *
 * ## Los tokens publican el DECORADOR, no la estrategia desnuda (US11, FR-067)
 *
 * `EXPORTADOR_PDF`/`EXPORTADOR_EXCEL` resuelven a `ExportadorPdfConLogo`/`ExportadorExcelConLogo`,
 * que añaden el logotipo de LOF y delegan. Como los controladores solo conocen esos tokens, todo
 * archivo que salga del sistema lo lleva sin que ningún endpoint tenga que acordarse — la
 * garantía de "TODOS los exportables" es estructural. Ver `exportador-con-logo.ts`.
 *
 * `ResolverLogoDocumentoCasoUso` vivía aquí hasta el 2026-08-15, cuando el logo por cliente se
 * retiró (FR-066): ya no hay nada que "resolver", el logotipo es siempre el mismo.
 *
 * A diferencia de `PersistenciaModule`, NO es `@Global()`: lo importan solo los módulos que
 * exportan archivos (reportes desde US4/T070 y US7/T081; ingresos y salidas desde US11/T120;
 * órdenes de compra desde US16/T171), en vez de registrar en todo el árbol proveedores que el
 * resto no usa.
 */
import { Module } from '@nestjs/common';
import { MarcaModule } from '../../interfaces/http/marca/marca.module';
import { ExportadorExcel } from './exportador-excel';
import { ExportadorExcelConLogo, ExportadorPdfConLogo } from './exportador-con-logo';
import { ExportadorPdf } from './exportador-pdf';

/** Token de inyección del `ExportadorReporte` en formato Excel (.xlsx). */
export const EXPORTADOR_EXCEL = 'ExportadorExcel';
/** Token de inyección del `ExportadorReporte` en formato PDF. */
export const EXPORTADOR_PDF = 'ExportadorPdf';

@Module({
  imports: [MarcaModule],
  providers: [
    // Las estrategias desnudas: solo las consume su decorador, ningún controlador las ve.
    ExportadorExcel,
    ExportadorPdf,
    { provide: EXPORTADOR_EXCEL, useClass: ExportadorExcelConLogo },
    { provide: EXPORTADOR_PDF, useClass: ExportadorPdfConLogo },
  ],
  exports: [EXPORTADOR_EXCEL, EXPORTADOR_PDF],
})
export class ExportacionModule {}
