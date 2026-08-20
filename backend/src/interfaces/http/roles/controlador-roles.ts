/**
 * Controlador `ControladorRoles` — endpoints de `/api/roles`
 * (contracts/api-rest.md § Roles y permisos, FR-054…FR-059). Traduce HTTP ↔ casos de uso /
 * lectura de `RepositorioRoles`; cero reglas de negocio.
 *
 * Autorización: UN permiso a nivel de CLASE, `roles.gestionar`, que cubre las seis rutas —
 * mismo criterio de granularidad que `ControladorUsuarios` (T100): administrar roles es una
 * sola capacidad de negocio, y conceder "crear roles" sin "editar sus permisos" no describe
 * ningún rol real. Es además uno de los dos permisos CRÍTICOS que los invariantes de FR-057
 * protegen para que nunca se queden sin dueño —el otro es `usuarios.gestionar`— (ver
 * `aplicacion/comunes/proteccion-capacidad-administrativa.ts`).
 *
 * `listar`/`obtener` inyectan el puerto `RepositorioRoles` DIRECTAMENTE, sin caso de uso
 * intermedio, porque no hay regla de negocio que aplicar antes de leer (mismo patrón que
 * `ControladorClientes.listar`); `obtener` traduce el `null` del repositorio a `NoEncontrado`
 * (el filtro global lo convierte en `404`) porque el puerto expresa "no existe" como valor.
 *
 * Las respuestas se construyen con proyecciones explícitas (`aRolDetalleApi`/`aRolListadoApi`)
 * en vez de serializar la entidad de dominio: el shape lo decide el contrato, no lo que la
 * entidad acumule (mismo criterio que `aUsuarioApi`).
 *
 * Implementa: FR-054 (permisos como datos), FR-055 (CRUD de roles y edición de su matriz de
 * permisos por el Administrador), FR-057 (los invariantes anti-bloqueo, verificados en los
 * casos de uso — aquí solo se traduce su `EstadoInvalido` a `409` vía el filtro global) y
 * FR-058 (la autorización de esta misma sección se resuelve contra un permiso efectivo).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  esquemaActualizarRol,
  esquemaCambiarEstadoRol,
  esquemaCrearRol,
  esquemaFiltroRoles,
  type DatosActualizarRol,
  type DatosCambiarEstadoRol,
  type DatosCrearRol,
  type FiltroRoles,
  type Paginado,
  type RolDetalle,
  type RolListado,
} from '@trazo/compartido';
import { ActualizarRolCasoUso } from '../../../aplicacion/roles/actualizar-rol.caso-uso';
import { CambiarEstadoRolCasoUso } from '../../../aplicacion/roles/cambiar-estado-rol.caso-uso';
import { CrearRolCasoUso } from '../../../aplicacion/roles/crear-rol.caso-uso';
import { EliminarRolCasoUso } from '../../../aplicacion/roles/eliminar-rol.caso-uso';
import { NoEncontrado } from '../../../dominio/comunes/errores';
import type { Rol } from '../../../dominio/entidades/rol';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';
import { REPOSITORIO_ROLES, type RepositorioRoles, type RolConUsuarios } from '../../../dominio/puertos/repositorio-roles';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';

@Controller('roles')
@RequierePermiso('roles.gestionar')
export class ControladorRoles {
  constructor(
    @Inject(REPOSITORIO_ROLES) private readonly repositorioRoles: RepositorioRoles,
    private readonly crearRol: CrearRolCasoUso,
    private readonly actualizarRol: ActualizarRolCasoUso,
    private readonly cambiarEstadoRol: CambiarEstadoRolCasoUso,
    private readonly eliminarRol: EliminarRolCasoUso,
  ) {}

  /** `GET /api/roles?estado=&pagina=&porPagina=` — página de roles con sus permisos y su
   *  conteo de usuarios (FR-055/FR-057). */
  @Get()
  async listar(@Query(new PipeValidacionZod(esquemaFiltroRoles)) filtros: FiltroRoles): Promise<Paginado<RolListado>> {
    const pagina = await this.repositorioRoles.listar({
      estado: filtros.estado,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    });
    return {
      datos: pagina.datos.map(aRolListadoApi),
      total: pagina.total,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    };
  }

  /** `GET /api/roles/:id` — rol con el detalle de sus permisos asignados. `404` si no existe. */
  @Get(':id')
  async obtener(@Param('id', ParseIntPipe) id: number): Promise<RolDetalle> {
    const rol = await this.repositorioRoles.buscarPorId(id);
    if (!rol) {
      throw new NoEncontrado('El rol');
    }
    return aRolDetalleApi(rol);
  }

  /** `POST /api/roles` — alta de un rol propio (`esSistema=false`, `estado=ACTIVO` — FR-055). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body(new PipeValidacionZod(esquemaCrearRol)) datos: DatosCrearRol,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<{ id: number }> {
    return this.crearRol.ejecutar({
      ...datos,
      permisosDelActor: usuarioActual.rolAsignado.permisos,
      actorEsSuperAdmin: usuarioActual.rolAsignado.esSuperAdmin,
    });
  }

  /** `PUT /api/roles/:id` — nombre, descripción y matriz COMPLETA de permisos (FR-055/FR-057). */
  @Put(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaActualizarRol)) datos: DatosActualizarRol,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<void> {
    await this.actualizarRol.ejecutar({
      rolId: id,
      ...datos,
      permisosDelActor: usuarioActual.rolAsignado.permisos,
      actorEsSuperAdmin: usuarioActual.rolAsignado.esSuperAdmin,
    });
  }

  /** `PUT /api/roles/:id/estado` — baja lógica de un rol, nunca DELETE (FR-055/FR-057). */
  @Put(':id/estado')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaCambiarEstadoRol)) datos: DatosCambiarEstadoRol,
  ): Promise<void> {
    await this.cambiarEstadoRol.ejecutar({ rolId: id, estado: datos.estado });
  }

  /** `DELETE /api/roles/:id` — solo roles propios sin usuarios asignados (FR-057). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.eliminarRol.ejecutar({ rolId: id });
  }
}

/**
 * Proyecta la entidad de dominio a la forma del contrato (`@trazo/compartido`, § Roles y
 * permisos). Los permisos viajan como CLAVES (`modulo.accion`), que es lo que la pantalla
 * marca y lo que compara el guard — el id de un permiso depende del orden de siembra de cada
 * instalación. La copia del arreglo es deliberada: la entidad lo declara `readonly` y la
 * respuesta no debe compartir referencia con ella.
 */
function aRolDetalleApi(rol: Rol): RolDetalle {
  return {
    id: rol.id,
    nombre: rol.nombre,
    descripcion: rol.descripcion,
    esSistema: rol.esSistema,
    // US30 (FR-127): la pantalla lo necesita para pintarlo como protegido y para saber si quien
    // mira puede mover una casilla reservada (FR-131).
    esSuperAdmin: rol.esSuperAdmin,
    estado: rol.estado,
    permisos: [...rol.permisos],
  };
}

/** Igual que `aRolDetalleApi`, más el conteo de usuarios que muestra el listado (FR-057). */
function aRolListadoApi(rol: RolConUsuarios): RolListado {
  return { ...aRolDetalleApi(rol), cantidadUsuarios: rol.cantidadUsuarios };
}
