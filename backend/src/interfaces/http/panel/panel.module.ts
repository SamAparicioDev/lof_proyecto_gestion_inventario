/**
 * Módulo del panel de control — cablea `GET /api/panel` (US10/T115) con `ResumenPanelCasoUso`
 * y con los DOS casos de uso que este compone (`ListarInventarioCasoUso`,
 * `ReporteInventarioActualCasoUso`).
 *
 * Por qué se vuelven a declarar esos dos casos de uso aquí, si `InventarioModule`/
 * `ReportesModule` ya los declaran: en NestJS un provider pertenece al módulo que lo declara y
 * no se comparte salvo que se exporte, así que declararlos en este módulo es lo que permite
 * INYECTARLOS sin tocar los módulos existentes (no son estado compartido: son objetos sin
 * estado propio cuyos puertos —`RepositorioProductos`/`RepositorioSalidas`— vienen igualmente
 * del `PersistenciaModule` global). Alternativa descartada: exportarlos desde sus módulos y
 * hacer `imports: [InventarioModule, ReportesModule]` — arrastraría también sus controladores
 * y sus estrategias de exportación, que este módulo no necesita.
 *
 * `AuthModule` sí se importa explícitamente: `RepositorioUsuarios` vive ahí (no es `@Global`) y
 * el caso de uso lo necesita para poner el nombre de quien ejecutó cada movimiento reciente —
 * mismo criterio ya establecido por `InventarioModule` y `ReportesModule`.
 */
import { Module } from '@nestjs/common';
import { ListarInventarioCasoUso } from '../../../aplicacion/inventario/listar-inventario.caso-uso';
import { ResumenPanelCasoUso } from '../../../aplicacion/panel/resumen-panel.caso-uso';
import { ReporteInventarioActualCasoUso } from '../../../aplicacion/reportes/reporte-inventario-actual.caso-uso';
import { AuthModule } from '../auth/auth.module';
import { ControladorPanel } from './controlador-panel';

@Module({
  imports: [AuthModule],
  controllers: [ControladorPanel],
  providers: [ResumenPanelCasoUso, ListarInventarioCasoUso, ReporteInventarioActualCasoUso],
})
export class PanelModule {}
