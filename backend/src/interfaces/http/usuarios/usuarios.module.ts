/**
 * Módulo de usuarios — cablea `/api/usuarios` (US6, T076) con sus cuatro casos de uso.
 * `RepositorioUsuarios`/`Hasheador` viven en `AuthModule` (no son `@Global`, ver TSDoc de ese
 * módulo): este módulo los importa explícitamente en vez de volver a decidir su
 * implementación concreta (mismo patrón que `InventarioModule`, docs/arquitectura.md).
 */
import { Module } from '@nestjs/common';
import { ActualizarUsuarioCasoUso } from '../../../aplicacion/usuarios/actualizar-usuario.caso-uso';
import { CambiarEstadoUsuarioCasoUso } from '../../../aplicacion/usuarios/cambiar-estado-usuario.caso-uso';
import { CrearUsuarioCasoUso } from '../../../aplicacion/usuarios/crear-usuario.caso-uso';
import { RestablecerPasswordUsuarioCasoUso } from '../../../aplicacion/usuarios/restablecer-password-usuario.caso-uso';
import { AuthModule } from '../auth/auth.module';
import { ControladorUsuarios } from './controlador-usuarios';

@Module({
  imports: [AuthModule],
  controllers: [ControladorUsuarios],
  providers: [CrearUsuarioCasoUso, ActualizarUsuarioCasoUso, RestablecerPasswordUsuarioCasoUso, CambiarEstadoUsuarioCasoUso],
})
export class UsuariosModule {}
