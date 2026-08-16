/**
 * Módulo HTTP del catálogo de unidades de medida (US17, T180).
 *
 * `AuthModule` aporta el guard de sesión y el de permisos que `@RequierePermiso` consulta. El
 * adaptador Prisma del puerto se registra en `PersistenciaModule`, que es global — aquí solo
 * viven los casos de uso y el controlador.
 */
import { Module } from '@nestjs/common';
import {
  ActualizarUnidadMedidaCasoUso,
  CambiarEstadoUnidadMedidaCasoUso,
  CrearUnidadMedidaCasoUso,
  EliminarUnidadMedidaCasoUso,
  ListarUnidadesMedidaCasoUso,
} from '../../../aplicacion/unidades-medida/gestionar-unidades-medida.caso-uso';
import { AuthModule } from '../auth/auth.module';
import { ControladorUnidadesMedida } from './controlador-unidades-medida';

@Module({
  imports: [AuthModule],
  controllers: [ControladorUnidadesMedida],
  providers: [
    ListarUnidadesMedidaCasoUso,
    CrearUnidadMedidaCasoUso,
    ActualizarUnidadMedidaCasoUso,
    CambiarEstadoUnidadMedidaCasoUso,
    EliminarUnidadMedidaCasoUso,
  ],
})
export class UnidadesMedidaModule {}
