/**
 * Módulo de salidas — cablea los endpoints de `/api/salidas` con sus casos de uso (US3). El
 * puerto `RepositorioSalidas` ya lo provee `PersistenciaModule` (`@Global`, T049): este
 * módulo NO lo vuelve a registrar, solo declara los casos de uso y el controlador que los
 * consumen (docs/arquitectura.md — los módulos de NestJS solo cablean).
 *
 * Importa `ExportacionModule` desde US11/T120: las dos rutas `/export` necesitan las estrategias
 * Excel/PDF y `ResolverLogoDocumentoCasoUso`, que es quien decide el logo del cliente (FR-067).
 */
import { Module } from '@nestjs/common';
import { ExportacionModule } from '../../../infraestructura/exportacion/exportacion.module';
import { ActualizarSalidaCasoUso } from '../../../aplicacion/salidas/actualizar-salida.caso-uso';
import { AnularSalidaCasoUso } from '../../../aplicacion/salidas/anular-salida.caso-uso';
import { CancelarSalidaCasoUso } from '../../../aplicacion/salidas/cancelar-salida.caso-uso';
import { CompletarSalidaCasoUso } from '../../../aplicacion/salidas/completar-salida.caso-uso';
import { ConfirmarSalidaCasoUso } from '../../../aplicacion/salidas/confirmar-salida.caso-uso';
import { CrearSalidaCasoUso } from '../../../aplicacion/salidas/crear-salida.caso-uso';
import { ControladorSalidas } from './controlador-salidas';

@Module({
  imports: [ExportacionModule],
  controllers: [ControladorSalidas],
  providers: [
    CrearSalidaCasoUso,
    ActualizarSalidaCasoUso,
    ConfirmarSalidaCasoUso,
    CompletarSalidaCasoUso,
    CancelarSalidaCasoUso,
    AnularSalidaCasoUso,
  ],
})
export class SalidasModule {}
