/**
 * Controlador `ControladorAuth` — endpoints de `/api/auth` (contracts/api-rest.md §
 * Autenticación). Traduce HTTP ↔ verificación de credenciales/sesión; cero reglas de
 * negocio (delega en `Hasheador`/`RepositorioUsuarios` para el login y en
 * `CambiarMiPasswordCasoUso` para el cambio de contraseña).
 *
 * Implementa: FR-001 (login), FR-002/FR-003 (sesión por cookie httpOnly, revalidada en
 * cada petición por `JwtAuthGuard`/`EstrategiaJwt`), FR-004 (cambio de la propia
 * contraseña) y US6-AS4 (el mensaje de login es genérico: nunca revela si falló el
 * usuario, la contraseña, o si el usuario está INACTIVO).
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Put, Res, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import {
  esquemaActualizarMiPerfil,
  esquemaCambiarPassword,
  esquemaLogin,
  type DatosActualizarMiPerfil,
  type DatosCambiarPassword,
  type DatosLogin,
  type PerfilSesion,
} from '@trazo/compartido';
import { ActualizarMiPerfilCasoUso } from '../../../aplicacion/usuarios/actualizar-mi-perfil.caso-uso';
import { CambiarMiPasswordCasoUso } from '../../../aplicacion/usuarios/cambiar-mi-password.caso-uso';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { HASHEADOR, type Hasheador } from '../../../dominio/puertos/hasheador';
import { REPOSITORIO_PERMISOS, type RepositorioPermisos } from '../../../dominio/puertos/repositorio-permisos';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../../dominio/puertos/repositorio-usuarios';
import { fijarCookieSesion, limpiarCookieSesion } from '../../../infraestructura/seguridad/cookie-sesion';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { Public } from '../comunes/public.decorator';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';

/** Mensaje único de credenciales inválidas — igual para login inexistente, password incorrecta e INACTIVO (US6-AS4). */
const MENSAJE_CREDENCIALES_INVALIDAS = 'Usuario o contraseña incorrectos';

/**
 * Hash bcrypt (costo 12, igual a `AdaptadorHashBcrypt`) de un valor fijo arbitrario sin
 * significado — NO corresponde a ninguna contraseña real. Se usa como señuelo cuando el
 * login no existe, para que `hasheador.comparar` se ejecute SIEMPRE con un costo similar
 * y el tiempo de respuesta no delate (canal lateral de tiempo) si un login existe o no,
 * reforzando el mensaje genérico de US6-AS4.
 */
const HASH_SIMULADO = '$2a$12$1ueJeHaM96apJE7mxwCzVeh7.gsIk/2LaokueOL1qWLXh.xgQ7lhm';

@Controller('auth')
export class ControladorAuth {
  constructor(
    @Inject(HASHEADOR) private readonly hasheador: Hasheador,
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
    private readonly jwtService: JwtService,
    private readonly cambiarMiPassword: CambiarMiPasswordCasoUso,
    private readonly actualizarMiPerfil: ActualizarMiPerfilCasoUso,
    @Inject(REPOSITORIO_PERMISOS) private readonly repositorioPermisos: RepositorioPermisos,
  ) {}

  /**
   * `POST /api/auth/login` — única ruta pública además de `/api/salud`. Verifica
   * credenciales y estado ACTIVO con el MISMO mensaje de error en todos los casos de
   * fallo (FR-001, US6-AS4); si son válidas, firma el JWT y abre la cookie de sesión.
   */
  @Public()
  @Post('login')
  @HttpCode(204)
  async login(
    @Body(new PipeValidacionZod(esquemaLogin)) datos: DatosLogin,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<void> {
    const usuario = await this.repositorioUsuarios.buscarPorLogin(datos.login);
    // Se compara SIEMPRE (contra el hash real o el señuelo) para que el costo de bcrypt sea
    // parejo exista o no el login — evita un canal lateral de tiempo que permitiría enumerar
    // usuarios aunque el mensaje de error sea idéntico (hallazgo de revisión adversarial).
    const passwordValida = await this.hasheador.comparar(datos.password, usuario?.passwordHash ?? HASH_SIMULADO);

    if (!usuario || !passwordValida || usuario.estado !== 'ACTIVO') {
      throw new UnauthorizedException({
        error: { mensaje: MENSAJE_CREDENCIALES_INVALIDAS, campos: null },
      });
    }

    const token = this.jwtService.sign({ sub: usuario.id });
    fijarCookieSesion(respuesta, token);
  }

  /** `POST /api/auth/logout` — cierra la sesión limpiando la cookie httpOnly. */
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) respuesta: Response): void {
    limpiarCookieSesion(respuesta);
  }

  /**
   * `GET /api/auth/perfil` — perfil de la sesión activa. Se apoya en `@UsuarioActual()`,
   * que ya viene FRESCO de BD gracias a `EstrategiaJwt.validate` (FR-002/FR-003).
   *
   * `rol` viaja IDENTIFICADO (`{id, nombre}`, T106) y no como el texto
   * `ADMINISTRADOR|GERENTE|OPERARIO` que publicaba antes: desde US9 los roles son datos
   * administrables (FR-054), así que un rol propio como "Bodeguero" no tendría representación
   * en ningún enum del código y su nombre, a diferencia de su id, puede cambiar.
   *
   * `permisos` son las claves efectivas de ese rol, tomadas del MISMO `rolAsignado` que
   * `PermisosGuard` acaba de usar para autorizar esta petición (T101): cero consultas
   * adicionales y cero riesgo de que la UI y el guard vean listas distintas. Se resuelven en
   * cada petición, nunca desde el JWT, para que un cambio en la matriz de permisos aplique sin
   * re-login (US9-AS3). Viajan para que el frontend filtre navegación y botones (FR-058); la
   * autoridad sigue siendo el guard, ocultar UI no es control de acceso (FR-003).
   */
  @Get('perfil')
  async perfil(@UsuarioActual() usuario: Usuario): Promise<PerfilSesion> {
    return {
      id: usuario.id,
      nombreCompleto: usuario.nombreCompleto,
      email: usuario.email,
      login: usuario.login,
      rol: { id: usuario.rolAsignado.id, nombre: usuario.rolAsignado.nombre },
      // US30 (FR-127): el respaldo no tiene filas en la matriz, así que su lista está vacía. Si
      // se enviara tal cual, la interfaz le ocultaría TODO justo a quien más puede — y la
      // pantalla en blanco parecería el bloqueo del que esta historia protege. Se resuelve aquí,
      // en el único endpoint que alimenta la UI, y no en el guard: la autorización del respaldo
      // sigue decidiéndose por su columna, nunca por esta lista.
      esSuperAdmin: usuario.rolAsignado.esSuperAdmin,
      permisos: usuario.rolAsignado.esSuperAdmin
        ? (await this.repositorioPermisos.listar()).map((permiso) => permiso.clave)
        : [...usuario.rolAsignado.permisos],
      debeCambiarPassword: usuario.debeCambiarPassword,
    };
  }

  /**
   * `PUT /api/auth/password` — cambia la propia contraseña (FR-004). El `usuarioId` viene
   * del token de sesión, nunca del body (FR-045).
   */
  @Put('password')
  @HttpCode(204)
  async cambiarPassword(
    @Body(new PipeValidacionZod(esquemaCambiarPassword)) datos: DatosCambiarPassword,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.cambiarMiPassword.ejecutar({
      usuarioId: usuario.id,
      passwordActual: datos.passwordActual,
      passwordNueva: datos.passwordNueva,
    });
  }

  /**
   * `PUT /api/auth/perfil` — el usuario edita SUS PROPIOS datos personales (US14, FR-080).
   *
   * Sin `@RequierePermiso` a propósito, igual que `PUT /api/auth/password`: administrar a OTROS
   * exige `usuarios.gestionar` y vive en `/api/usuarios`; esto son los datos de uno mismo, y
   * exigir un permiso para ellos dejaría a un rol propio sin poder corregir su propio correo.
   *
   * La ruta NO lleva `:id`: el usuario afectado sale del token de sesión (FR-081), así que no
   * existe forma de dirigirla a otra persona. Y `esquemaActualizarMiPerfil` solo admite nombre
   * y correo, de modo que un `rolId` o un `estado` enviados en el cuerpo se descartan antes de
   * llegar al caso de uso (FR-082).
   */
  @Put('perfil')
  @HttpCode(204)
  async actualizarPerfil(
    @Body(new PipeValidacionZod(esquemaActualizarMiPerfil)) datos: DatosActualizarMiPerfil,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.actualizarMiPerfil.ejecutar({
      usuarioId: usuario.id,
      nombreCompleto: datos.nombreCompleto,
      email: datos.email,
    });
  }
}
