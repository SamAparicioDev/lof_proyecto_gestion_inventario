/**
 * Módulo del buzón de solicitudes (US36/T280) — cablea los seis endpoints de `/api/solicitudes`.
 *
 * `RepositorioSolicitudes` llega del `PersistenciaModule`, que es `@Global`. `ModeloConversacional`
 * llega de `IaModule`, el único sitio donde se elige el proveedor. Este módulo no importa nada del
 * asistente: comparten el puerto —hablar con un modelo— y ninguna otra cosa. Aquí no hay
 * herramientas que ofrecer ni permisos que comprobar por consulta; hay un texto que entra y un
 * prompt que sale.
 */
import { Module } from '@nestjs/common';
import { RefinarSolicitudCasoUso } from '../../../aplicacion/solicitudes/refinar-solicitud.caso-uso';
import {
  ActualizarSolicitudCasoUso,
  CambiarEstadoSolicitudCasoUso,
  CrearSolicitudCasoUso,
  ListarSolicitudesCasoUso,
  VerSolicitudCasoUso,
} from '../../../aplicacion/solicitudes/solicitudes.caso-uso';
import { IaModule } from '../../../infraestructura/ia/ia.module';
import { ControladorSolicitudes } from './controlador-solicitudes';

@Module({
  imports: [IaModule],
  controllers: [ControladorSolicitudes],
  providers: [
    CrearSolicitudCasoUso,
    ListarSolicitudesCasoUso,
    VerSolicitudCasoUso,
    ActualizarSolicitudCasoUso,
    CambiarEstadoSolicitudCasoUso,
    RefinarSolicitudCasoUso,
  ],
})
export class SolicitudesModule {}
