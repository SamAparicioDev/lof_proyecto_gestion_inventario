/**
 * Módulo HTTP del catálogo de proveedores (US15, T160).
 *
 * `AuthModule` aporta el guard de sesión y el de permisos que `@RequierePermiso` consulta. El
 * adaptador Prisma del puerto se registra en `PersistenciaModule`, que es global — aquí solo
 * viven los casos de uso y el controlador.
 */
import { Module } from '@nestjs/common';
import {
  ActualizarProveedorCasoUso,
  CambiarEstadoProveedorCasoUso,
  CrearProveedorCasoUso,
  EliminarProveedorCasoUso,
  ListarProveedoresCasoUso,
} from '../../../aplicacion/proveedores/gestionar-proveedores.caso-uso';
import { AuthModule } from '../auth/auth.module';
import { ControladorProveedores } from './controlador-proveedores';

@Module({
  imports: [AuthModule],
  controllers: [ControladorProveedores],
  providers: [
    ListarProveedoresCasoUso,
    CrearProveedorCasoUso,
    ActualizarProveedorCasoUso,
    CambiarEstadoProveedorCasoUso,
    EliminarProveedorCasoUso,
  ],
})
export class ProveedoresModule {}
