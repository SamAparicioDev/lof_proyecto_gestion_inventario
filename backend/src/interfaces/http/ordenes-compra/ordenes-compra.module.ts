/**
 * Módulo HTTP de las órdenes de compra (US16, T171).
 *
 * `AuthModule` aporta el guard de sesión y el de permisos que `@RequierePermiso` consulta;
 * `ExportacionModule` los dos exportadores (Excel y PDF) del documento que se le envía al
 * proveedor (FR-097). Los adaptadores Prisma de los puertos se registran en
 * `PersistenciaModule`, que es global — aquí solo viven los casos de uso y el controlador.
 */
import { Module } from '@nestjs/common';
import {
  ActualizarOrdenCompraCasoUso,
  AnularOrdenCompraCasoUso,
  CrearOrdenCompraCasoUso,
  EnviarOrdenCompraCasoUso,
  ListarOrdenesCompraCasoUso,
  ObtenerOrdenCompraCasoUso,
  SugerirCompraCasoUso,
} from '../../../aplicacion/ordenes-compra/gestionar-ordenes-compra.caso-uso';
import { ExportacionModule } from '../../../infraestructura/exportacion/exportacion.module';
import { AuthModule } from '../auth/auth.module';
import { ControladorOrdenesCompra } from './controlador-ordenes-compra';

@Module({
  imports: [AuthModule, ExportacionModule],
  controllers: [ControladorOrdenesCompra],
  providers: [
    ListarOrdenesCompraCasoUso,
    ObtenerOrdenCompraCasoUso,
    CrearOrdenCompraCasoUso,
    ActualizarOrdenCompraCasoUso,
    EnviarOrdenCompraCasoUso,
    AnularOrdenCompraCasoUso,
    SugerirCompraCasoUso,
  ],
})
export class OrdenesCompraModule {}
