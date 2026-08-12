/**
 * Controlador `ControladorUsuarios` — endpoints de `/api/usuarios`
 * (contracts/api-rest.md § Usuarios), reservados a quien tenga `usuarios.gestionar`
 * (FR-005…FR-009). Traduce HTTP ↔ casos de uso / lectura de `RepositorioUsuarios`; cero
 * reglas de negocio.
 *
 * Autorización (T103): UN solo permiso a nivel de CLASE, que cubre las cinco rutas — no cinco
 * permisos. Administrar usuarios es una sola capacidad de negocio: quien puede darlos de alta
 * puede editarlos, restablecerles la contraseña y desactivarlos; conceder "crear usuarios"
 * sin "cambiar su estado" no describe ningún rol real y solo multiplicaría casillas en la
 * pantalla de roles (criterio de granularidad de T100). `PermisosGuard` resuelve
 * método-sobre-clase (`getAllAndOverride`), exactamente como hacía `@Roles('ADMINISTRADOR')`
 * aquí antes, así que la migración conserva el alcance de clase sin cambiar el mecanismo.
 *
 * `listar` inyecta el puerto `RepositorioUsuarios` DIRECTAMENTE, sin caso de uso intermedio,
 * porque no hay regla de negocio que aplicar antes de leer (mismo patrón que
 * `ControladorClientes.listar`). La respuesta NUNCA incluye el hash de password: el puerto
 * expresa la entidad `Usuario` de dominio sin ese campo (FR-007), así que no hace falta
 * lógica adicional para "ocultarlo".
 *
 * La respuesta se construye con la proyección explícita `aUsuarioApi` (T101) en vez de
 * serializar la entidad de dominio tal cual: desde US9 la entidad lleva el rol completo con
 * sus permisos efectivos (`rolAsignado`), que existe para que `PermisosGuard` autorice, no
 * para viajar fila por fila en un listado. La proyección publica del rol solo `{id, nombre}`
 * (T106), que es lo que el contrato define y lo que la pantalla necesita: el `id` para
 * precargar `rolId` en la edición y el `nombre` para mostrarlo — incluido el de un rol propio
 * como "Bodeguero", que ningún enum del código conoce (FR-054).
 *
 * QUIÉN ejecuta la operación, y no solo QUÉ pide (corrección de la revisión adversarial de la
 * Tanda 13): las cuatro rutas de mutación reciben `@UsuarioActual()` y le pasan al caso de uso
 * los PERMISOS EFECTIVOS del actor (`rolAsignado.permisos`, resueltos por el guard desde la BD
 * en esta misma petición — FR-058, nunca un dato del cuerpo). Los necesitan las reglas de
 * FR-057 que impiden la escalada de privilegios: `usuarios.gestionar` no puede convertirse en
 * "administrador total" asignándose un rol superior ni restableciéndole la contraseña a uno
 * (ver `aplicacion/usuarios/rol-asignado.ts`).
 *
 * Implementa: FR-005 (alta/edición/listado de usuarios), FR-006 (rol asignado en el alta),
 * FR-007 (el hash de password nunca se serializa), FR-008 (baja lógica, nunca DELETE),
 * FR-009 (unicidad de login/email), FR-045 (auditoría: `usuarioId` siempre del token) y
 * FR-057 (nadie reparte ni pierde la capacidad de administrar el sistema).
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import {
  esquemaActualizarUsuario,
  esquemaCambiarEstadoUsuario,
  esquemaCrearUsuario,
  esquemaFiltroUsuarios,
  esquemaRestablecerPasswordUsuario,
  type DatosActualizarUsuario,
  type DatosCambiarEstadoUsuario,
  type DatosCrearUsuario,
  type DatosRestablecerPasswordUsuario,
  type FiltroUsuarios,
  type Paginado,
  type Usuario as UsuarioApi,
} from '@trazo/compartido';
import { ActualizarUsuarioCasoUso } from '../../../aplicacion/usuarios/actualizar-usuario.caso-uso';
import { CambiarEstadoUsuarioCasoUso } from '../../../aplicacion/usuarios/cambiar-estado-usuario.caso-uso';
import { CrearUsuarioCasoUso } from '../../../aplicacion/usuarios/crear-usuario.caso-uso';
import { RestablecerPasswordUsuarioCasoUso } from '../../../aplicacion/usuarios/restablecer-password-usuario.caso-uso';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../../dominio/puertos/repositorio-usuarios';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';

@Controller('usuarios')
@RequierePermiso('usuarios.gestionar')
export class ControladorUsuarios {
  constructor(
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
    private readonly crearUsuario: CrearUsuarioCasoUso,
    private readonly actualizarUsuario: ActualizarUsuarioCasoUso,
    private readonly restablecerPasswordUsuario: RestablecerPasswordUsuarioCasoUso,
    private readonly cambiarEstadoUsuario: CambiarEstadoUsuarioCasoUso,
  ) {}

  /** `GET /api/usuarios?estado=&rolId=&pagina=&porPagina=` — página de usuarios, sin
   *  `password_hash` (FR-005/FR-007); `rolId` responde "¿quiénes tienen este rol?" (US13/FR-075). */
  @Get()
  async listar(
    @Query(new PipeValidacionZod(esquemaFiltroUsuarios)) filtros: FiltroUsuarios,
  ): Promise<Paginado<UsuarioApi>> {
    const pagina = await this.repositorioUsuarios.listar({
      estado: filtros.estado,
      rolId: filtros.rolId,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    });
    return {
      datos: pagina.datos.map(aUsuarioApi),
      total: pagina.total,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    };
  }

  /** `POST /api/usuarios` — alta de usuario (FR-005/FR-006). Nace con `debeCambiarPassword=true`. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body(new PipeValidacionZod(esquemaCrearUsuario)) datos: DatosCrearUsuario,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<{ id: number }> {
    return this.crearUsuario.ejecutar({ ...datos, permisosDelActor: usuarioActual.rolAsignado.permisos });
  }

  /** `PUT /api/usuarios/:id` — edición de usuario (FR-005). */
  @Put(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaActualizarUsuario)) datos: DatosActualizarUsuario,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<void> {
    await this.actualizarUsuario.ejecutar({
      usuarioId: id,
      ...datos,
      permisosDelActor: usuarioActual.rolAsignado.permisos,
    });
  }

  /** `PUT /api/usuarios/:id/restablecer-password` — restablece la contraseña de OTRO usuario, sin pedir la anterior (FR-005). */
  @Put(':id/restablecer-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async restablecerPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaRestablecerPasswordUsuario)) datos: DatosRestablecerPasswordUsuario,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<void> {
    await this.restablecerPasswordUsuario.ejecutar({
      usuarioId: id,
      passwordTemporal: datos.passwordTemporal,
      permisosDelActor: usuarioActual.rolAsignado.permisos,
    });
  }

  /** `PUT /api/usuarios/:id/estado` — activa/desactiva un usuario (baja lógica, FR-008); `409` si intenta auto-desactivarse. */
  @Put(':id/estado')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaCambiarEstadoUsuario)) datos: DatosCambiarEstadoUsuario,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<void> {
    await this.cambiarEstadoUsuario.ejecutar({ usuarioId: id, estado: datos.estado, usuarioActualId: usuarioActual.id });
  }
}

/**
 * Proyecta la entidad de dominio a la forma del contrato (`@trazo/compartido`, § Usuarios).
 * Del rol publica solo su identidad (`{id, nombre}`) y NUNCA sus permisos: existen para que el
 * servidor autorice cada petición (FR-058), no para repetirse en cada fila de un listado. Los
 * permisos del usuario de la SESIÓN sí viajan, pero en su perfil (`GET /api/auth/perfil`) y
 * solo para que la interfaz sepa qué ofrecer.
 */
function aUsuarioApi(usuario: Usuario): UsuarioApi {
  return {
    id: usuario.id,
    nombreCompleto: usuario.nombreCompleto,
    email: usuario.email,
    login: usuario.login,
    rol: { id: usuario.rolAsignado.id, nombre: usuario.rolAsignado.nombre },
    estado: usuario.estado,
    debeCambiarPassword: usuario.debeCambiarPassword,
  };
}
