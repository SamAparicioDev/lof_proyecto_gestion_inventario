/**
 * Módulo de reportes — cablea `/api/reportes` (US4: consumo-cliente/consumo-proyecto; desde
 * la Tanda 9/US7/T081, también inventario/movimientos) con sus casos de uso y las estrategias
 * de exportación. Los puertos `RepositorioClientes`/`RepositorioProyectos`/`RepositorioSalidas`/
 * `RepositorioProductos`/`RepositorioMovimientos`/`RepositorioIngresos` ya los provee
 * `PersistenciaModule` (`@Global`): este módulo NO los vuelve a registrar, solo declara los
 * casos de uso y el controlador (docs/arquitectura.md — los módulos de NestJS solo cablean).
 * `RepositorioUsuarios` es la única excepción: vive en `AuthModule` (no es `@Global`, ver
 * TSDoc de ese módulo), así que `ReporteMovimientosCasoUso` (necesita el nombre de quien
 * registró cada movimiento, FR-042/FR-045) exige importarlo aquí explícitamente — mismo
 * criterio ya establecido por `InventarioModule` para `HistorialProductoCasoUso`.
 *
 * `ExportacionModule` (T069, no `@Global`) se importa explícitamente aquí: es el único módulo
 * que necesita las estrategias `EXPORTADOR_EXCEL`/`EXPORTADOR_PDF` (research R8, patrón
 * Strategy).
 */
import { Module } from '@nestjs/common';
import { ReporteConsumoClienteCasoUso } from '../../../aplicacion/reportes/reporte-consumo-cliente.caso-uso';
import { ReporteConsumoProyectoCasoUso } from '../../../aplicacion/reportes/reporte-consumo-proyecto.caso-uso';
import { ReporteInventarioActualCasoUso } from '../../../aplicacion/reportes/reporte-inventario-actual.caso-uso';
import { ReporteMovimientosCasoUso } from '../../../aplicacion/reportes/reporte-movimientos.caso-uso';
import { ExportacionModule } from '../../../infraestructura/exportacion/exportacion.module';
import { AuthModule } from '../auth/auth.module';
import { ControladorReportes } from './controlador-reportes';

@Module({
  imports: [ExportacionModule, AuthModule],
  controllers: [ControladorReportes],
  providers: [
    ReporteConsumoClienteCasoUso,
    ReporteConsumoProyectoCasoUso,
    ReporteInventarioActualCasoUso,
    ReporteMovimientosCasoUso,
  ],
})
export class ReportesModule {}
