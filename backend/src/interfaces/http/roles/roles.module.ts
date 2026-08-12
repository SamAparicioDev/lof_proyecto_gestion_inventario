/**
 * Módulo de roles y permisos — cablea `/api/roles` y `GET /api/permisos` (US9, T106) con sus
 * cuatro casos de uso. Los puertos `RepositorioRoles`/`RepositorioPermisos` ya los provee
 * `PersistenciaModule` (`@Global`, T101): este módulo NO los vuelve a registrar, solo declara
 * los casos de uso y los dos controladores que los consumen (docs/arquitectura.md — los
 * módulos de NestJS solo cablean).
 *
 * `ControladorPermisos` vive aquí pese a colgar de otra ruta: sirve a la misma pantalla que
 * `/api/roles` (el catálogo son las casillas del editor de un rol) — mismo criterio por el que
 * `ControladorProyectos` vive en `ClientesModule`.
 *
 * Importa `AuthModule` porque ahí vive `RepositorioUsuarios` (no es `@Global`, ver TSDoc de ese
 * módulo) y `ActualizarRolCasoUso` lo necesita desde la corrección de la revisión adversarial
 * de la Tanda 13: el invariante de FR-057 cuenta USUARIOS que pueden ejercer un permiso
 * crítico, no roles que lo conceden (ver `proteccion-capacidad-administrativa.ts`).
 */
import { Module } from '@nestjs/common';
import { ActualizarRolCasoUso } from '../../../aplicacion/roles/actualizar-rol.caso-uso';
import { CambiarEstadoRolCasoUso } from '../../../aplicacion/roles/cambiar-estado-rol.caso-uso';
import { CrearRolCasoUso } from '../../../aplicacion/roles/crear-rol.caso-uso';
import { EliminarRolCasoUso } from '../../../aplicacion/roles/eliminar-rol.caso-uso';
import { AuthModule } from '../auth/auth.module';
import { ControladorPermisos } from './controlador-permisos';
import { ControladorRoles } from './controlador-roles';

@Module({
  imports: [AuthModule],
  controllers: [ControladorRoles, ControladorPermisos],
  providers: [CrearRolCasoUso, ActualizarRolCasoUso, CambiarEstadoRolCasoUso, EliminarRolCasoUso],
})
export class RolesModule {}
