/**
 * Módulo de productos — cablea `POST /api/productos` (alta rápida, FR-011),
 * `GET /api/productos` (catálogo con disponible, T052), `PUT /api/productos/:id` y
 * `PUT /api/productos/:id/estado` (edición/baja lógica, T060) con sus casos de uso. Los
 * puertos `RepositorioProductos`/`RepositorioSalidas`/`RepositorioIngresos` ya los provee
 * `PersistenciaModule` (`@Global`, T030/T049): este módulo NO los vuelve a registrar, solo
 * declara los casos de uso y el controlador que los consumen (docs/arquitectura.md — los
 * módulos de NestJS solo cablean).
 *
 * `ImportacionModule` (T094, US8) SÍ se importa explícitamente aquí — igual que
 * `ReportesModule` importa `ExportacionModule` — porque `LectorImportacionProductos` no es
 * `@Global()`: solo lo necesita `ImportarProductosCasoUso`.
 */
import { Module } from '@nestjs/common';
import { ActualizarProductoCasoUso } from '../../../aplicacion/productos/actualizar-producto.caso-uso';
import { CambiarEstadoProductoCasoUso } from '../../../aplicacion/productos/cambiar-estado-producto.caso-uso';
import { CrearProductoCasoUso } from '../../../aplicacion/productos/crear-producto.caso-uso';
import { ImportarProductosCasoUso } from '../../../aplicacion/productos/importar-productos.caso-uso';
import { ListarResumenProductosCasoUso } from '../../../aplicacion/productos/listar-resumen-productos.caso-uso';
import { ImportacionModule } from '../../../infraestructura/importacion/importacion.module';
import { ControladorProductos } from './controlador-productos';

@Module({
  imports: [ImportacionModule],
  controllers: [ControladorProductos],
  providers: [
    CrearProductoCasoUso,
    ListarResumenProductosCasoUso,
    ActualizarProductoCasoUso,
    CambiarEstadoProductoCasoUso,
    ImportarProductosCasoUso,
  ],
})
export class ProductosModule {}
