/**
 * Módulo de importación — registra `LectorImportacionProductosExcel` como implementación del
 * puerto `LectorImportacionProductos` (US8, T094) bajo su token de inyección, mismo criterio
 * que `infraestructura/exportacion/exportacion.module.ts` con `ExportadorReporte`
 * (docs/arquitectura.md §3, patrón Strategy/Adapter).
 *
 * NO es `@Global()`: solo lo necesita `ProductosModule` (el único que usa
 * `ImportarProductosCasoUso`), que lo importa explícitamente — mismo criterio que
 * `ReportesModule` con `ExportacionModule`.
 */
import { Module } from '@nestjs/common';
import { LECTOR_IMPORTACION_PRODUCTOS } from '../../aplicacion/productos/puertos/lector-importacion-productos';
import { LectorImportacionProductosExcel } from './leer-filas-importacion-productos';

@Module({
  providers: [{ provide: LECTOR_IMPORTACION_PRODUCTOS, useClass: LectorImportacionProductosExcel }],
  exports: [LECTOR_IMPORTACION_PRODUCTOS],
})
export class ImportacionModule {}
