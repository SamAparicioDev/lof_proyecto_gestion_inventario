/**
 * Módulo HTTP de las cotizaciones (US21, T201).
 *
 * `AuthModule` aporta el guard de sesión y el de permisos que `@RequierePermiso` consulta;
 * `ExportacionModule` los dos exportadores (Excel y PDF) del documento que se le envía al
 * cliente (FR-116) — y con ellos el decorador que estampa el logo institucional. Los
 * adaptadores Prisma de los puertos se registran en `PersistenciaModule`, que es global: aquí
 * solo viven los casos de uso y el controlador.
 */
import { Module } from '@nestjs/common';
import {
  AceptarCotizacionCasoUso,
  ActualizarCotizacionCasoUso,
  AnularCotizacionCasoUso,
  CrearCotizacionCasoUso,
  EnviarCotizacionCasoUso,
  ListarCotizacionesCasoUso,
  ObtenerCotizacionCasoUso,
  RechazarCotizacionCasoUso,
} from '../../../aplicacion/cotizaciones/gestionar-cotizaciones.caso-uso';
import { ExportacionModule } from '../../../infraestructura/exportacion/exportacion.module';
import { AuthModule } from '../auth/auth.module';
import { ControladorCotizaciones } from './controlador-cotizaciones';

@Module({
  imports: [AuthModule, ExportacionModule],
  controllers: [ControladorCotizaciones],
  providers: [
    ListarCotizacionesCasoUso,
    ObtenerCotizacionCasoUso,
    CrearCotizacionCasoUso,
    ActualizarCotizacionCasoUso,
    EnviarCotizacionCasoUso,
    AceptarCotizacionCasoUso,
    RechazarCotizacionCasoUso,
    AnularCotizacionCasoUso,
  ],
})
export class CotizacionesModule {}
