/**
 * Módulo de la bandeja de avisos (US35/T270) — cablea los cuatro endpoints de
 * `/api/notificaciones` con los casos de uso de lectura.
 *
 * Solo LECTURA: la emisión no vive aquí. `AvisadorDeNotificaciones` es un provider de los
 * módulos que emiten (ingresos, salidas, inventario), porque quien avisa es el caso de uso que
 * acaba de cambiar el estado, no este módulo — y colgarlo de aquí obligaría a que los módulos
 * de negocio importaran el módulo de la campana para poder registrar un ingreso, que es
 * exactamente la dependencia al revés.
 *
 * `RepositorioNotificaciones` llega del `PersistenciaModule`, que es `@Global`.
 */
import { Module } from '@nestjs/common';
import {
  BandejaNotificacionesCasoUso,
  MarcarNotificacionLeidaCasoUso,
  MarcarTodasLeidasCasoUso,
  ResumenNotificacionesCasoUso,
} from '../../../aplicacion/notificaciones/bandeja-notificaciones.caso-uso';
import { ControladorNotificaciones } from './controlador-notificaciones';

@Module({
  controllers: [ControladorNotificaciones],
  providers: [
    BandejaNotificacionesCasoUso,
    ResumenNotificacionesCasoUso,
    MarcarNotificacionLeidaCasoUso,
    MarcarTodasLeidasCasoUso,
  ],
})
export class NotificacionesModule {}
