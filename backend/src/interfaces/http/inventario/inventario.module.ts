/**
 * Módulo de inventario — cablea los endpoints de lectura de `/api/inventario` (US5) con sus
 * casos de uso de consulta. Los puertos que consumen (`RepositorioProductos`,
 * `RepositorioSalidas`, `RepositorioMovimientos`, `RepositorioIngresos`,
 * `RepositorioProyectos`) ya los provee `PersistenciaModule` (`@Global`, T030/T049/T059-prep):
 * este módulo no los vuelve a registrar. `RepositorioUsuarios` es la única excepción: vive en
 * `AuthModule` (no es `@Global`, ver TSDoc de ese módulo), así que `HistorialProductoCasoUso`
 * (necesita el nombre de quien ejecutó cada movimiento, FR-045) exige importarlo aquí
 * explícitamente — este módulo solo cablea, no vuelve a decidir la implementación concreta
 * de ningún puerto (docs/arquitectura.md).
 *
 * `HistorialCostosProductoCasoUso` (US12/T127) se cablea igual: consume
 * `REPOSITORIO_HISTORIAL_COSTOS` (que provee `PersistenciaModule`) y el mismo
 * `RepositorioUsuarios` de `AuthModule`, por el mismo motivo (poner nombre a quien cambió cada
 * precio, FR-072).
 */
import { Module } from '@nestjs/common';
import { FichaProductoCasoUso } from '../../../aplicacion/inventario/ficha-producto.caso-uso';
import { HistorialCostosProductoCasoUso } from '../../../aplicacion/inventario/historial-costos-producto.caso-uso';
import { HistorialProductoCasoUso } from '../../../aplicacion/inventario/historial-producto.caso-uso';
import { ListarInventarioCasoUso } from '../../../aplicacion/inventario/listar-inventario.caso-uso';
import { OpcionesFiltroInventarioCasoUso } from '../../../aplicacion/inventario/opciones-filtro-inventario.caso-uso';
import { AuthModule } from '../auth/auth.module';
import { ControladorInventario } from './controlador-inventario';

@Module({
  imports: [AuthModule],
  controllers: [ControladorInventario],
  providers: [
    ListarInventarioCasoUso,
    OpcionesFiltroInventarioCasoUso,
    FichaProductoCasoUso,
    HistorialProductoCasoUso,
    HistorialCostosProductoCasoUso,
  ],
})
export class InventarioModule {}
