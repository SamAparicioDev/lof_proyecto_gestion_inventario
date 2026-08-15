/**
 * Módulo HTTP del catálogo de categorías (US15, T151).
 *
 * `AuthModule` se importa por la misma razón que en el resto de módulos: aporta el guard de
 * sesión y el de permisos que `@RequierePermiso` consulta. El adaptador Prisma del puerto se
 * registra en `PersistenciaModule`, que es global — aquí solo viven los casos de uso y el
 * controlador.
 */
import { Module } from '@nestjs/common';
import {
  ActualizarCategoriaCasoUso,
  CambiarEstadoCategoriaCasoUso,
  CrearCategoriaCasoUso,
  EliminarCategoriaCasoUso,
  ListarCategoriasCasoUso,
} from '../../../aplicacion/categorias/gestionar-categorias.caso-uso';
import { AuthModule } from '../auth/auth.module';
import { ControladorCategorias } from './controlador-categorias';

@Module({
  imports: [AuthModule],
  controllers: [ControladorCategorias],
  providers: [
    ListarCategoriasCasoUso,
    CrearCategoriaCasoUso,
    ActualizarCategoriaCasoUso,
    CambiarEstadoCategoriaCasoUso,
    EliminarCategoriaCasoUso,
  ],
})
export class CategoriasModule {}
