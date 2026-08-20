/**
 * Módulo del ARRANQUE — lo que el sistema hace una vez al levantarse, antes de atender tráfico.
 *
 * Hoy una sola pieza: asegurar el usuario de respaldo (US30, FR-129). Vive en su propio módulo y
 * no colgando del de seguridad porque no es autenticación: es una tarea de despliegue que
 * necesita los mismos puertos que un caso de uso, y tenerla aparte deja claro cuándo corre.
 */
import { Module } from '@nestjs/common';
import { PersistenciaModule } from '../persistencia/persistencia.module';
import { AuthModule } from '../../interfaces/http/auth/auth.module';
import { ArranqueSuperAdmin } from './arranque-super-admin';

@Module({
  imports: [PersistenciaModule, AuthModule],
  providers: [ArranqueSuperAdmin],
})
export class ArranqueModule {}
