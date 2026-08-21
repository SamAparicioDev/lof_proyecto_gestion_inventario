/**
 * Módulo de ingresos — cablea los endpoints de `/api/ingresos` con sus casos de uso
 * (US1). El puerto `RepositorioIngresos` ya lo provee `PersistenciaModule` (`@Global`,
 * T030): este módulo NO lo vuelve a registrar, solo declara los casos de uso y el
 * controlador que los consumen (docs/arquitectura.md — los módulos de NestJS solo cablean).
 *
 * Importa `ExportacionModule` desde US11/T120: las dos rutas `/export` (listado y documento)
 * necesitan las estrategias Excel/PDF, exactamente las mismas que ya usan los reportes.
 */
import { Module } from '@nestjs/common';
import { ExportacionModule } from '../../../infraestructura/exportacion/exportacion.module';
import { ActualizarIngresoCasoUso } from '../../../aplicacion/ingresos/actualizar-ingreso.caso-uso';
import { AnularIngresoCasoUso } from '../../../aplicacion/ingresos/anular-ingreso.caso-uso';
import { CrearIngresoCasoUso } from '../../../aplicacion/ingresos/crear-ingreso.caso-uso';
import { RecibirIngresoCasoUso } from '../../../aplicacion/ingresos/recibir-ingreso.caso-uso';
import { VerificarIngresoCasoUso } from '../../../aplicacion/ingresos/verificar-ingreso.caso-uso';
import { AvisadorDeNotificaciones } from '../../../aplicacion/notificaciones/avisador-notificaciones';
import { ControladorIngresos } from './controlador-ingresos';

@Module({
  imports: [ExportacionModule],
  controllers: [ControladorIngresos],
  providers: [
    CrearIngresoCasoUso,
    ActualizarIngresoCasoUso,
    RecibirIngresoCasoUso,
    VerificarIngresoCasoUso,
    AnularIngresoCasoUso,
  // US35: el AVISADOR se declara en cada módulo que EMITE, no en el de la campana. Al revés
  // —colgarlo del módulo de notificaciones y hacer que este lo importe— obligaría a que
  // registrar un ingreso dependiera de la bandeja, que es la dependencia justo al revés.
    AvisadorDeNotificaciones,
  ],
})
export class IngresosModule {}
