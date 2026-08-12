/**
 * Módulo de seguridad — cablea el módulo de autenticación completo (T014-T016):
 * estrategia Passport-JWT desde cookie httpOnly, el endpoint `/api/auth` y el caso de uso
 * de cambio de contraseña. Los guards globales (`JwtAuthGuard`/`PermisosGuard`) se registran
 * en `app.module.ts`, pero dependen de piezas que este módulo expone (`JwtModule`).
 *
 * Cableado de puertos → adaptadores (DIP, docs/arquitectura.md §4): dominio y aplicación
 * dependen de las INTERFACES `Hasheador`/`RepositorioUsuarios`; este módulo es el ÚNICO
 * lugar donde se decide qué implementación concreta usan (`AdaptadorHashBcrypt` /
 * `RepositorioUsuariosPrisma`), vía tokens de inyección de NestJS.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { CambiarMiPasswordCasoUso } from '../../../aplicacion/usuarios/cambiar-mi-password.caso-uso';
import { HASHEADOR } from '../../../dominio/puertos/hasheador';
import { REPOSITORIO_USUARIOS } from '../../../dominio/puertos/repositorio-usuarios';
import { RepositorioUsuariosPrisma } from '../../../infraestructura/persistencia/repositorio-usuarios.prisma';
import { AdaptadorHashBcrypt } from '../../../infraestructura/seguridad/adaptador-hash-bcrypt';
import { DURACION_SESION_SEGUNDOS } from '../../../infraestructura/seguridad/cookie-sesion';
import { EstrategiaJwt } from '../../../infraestructura/seguridad/estrategia-jwt';
import { ControladorAuth } from './controlador-auth';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: DURACION_SESION_SEGUNDOS },
      }),
    }),
  ],
  controllers: [ControladorAuth],
  providers: [
    EstrategiaJwt,
    { provide: HASHEADOR, useClass: AdaptadorHashBcrypt },
    { provide: REPOSITORIO_USUARIOS, useClass: RepositorioUsuariosPrisma },
    CambiarMiPasswordCasoUso,
  ],
  // JwtModule se reexporta para que los guards globales de app.module.ts (JwtAuthGuard,
  // que firma la renovación deslizante) puedan inyectar JwtService. REPOSITORIO_USUARIOS se
  // reexporta desde US5 (T060) porque `HistorialProductoCasoUso` (InventarioModule) necesita
  // el nombre del usuario que ejecutó cada movimiento (FR-045) — este módulo sigue siendo el
  // ÚNICO lugar donde se decide la implementación concreta del puerto (DIP, ver TSDoc de
  // cabecera); los demás módulos solo lo consumen por el token. HASHEADOR se reexporta desde
  // US6 (T076) porque `UsuariosModule` necesita hashear la contraseña temporal al crear un
  // usuario o restablecer la de otro (FR-007), mismo criterio que REPOSITORIO_USUARIOS.
  exports: [JwtModule, REPOSITORIO_USUARIOS, HASHEADOR],
})
export class AuthModule {}
