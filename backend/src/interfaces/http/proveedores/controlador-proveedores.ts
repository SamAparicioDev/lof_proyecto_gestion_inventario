/**
 * `ControladorProveedores` — `/api/proveedores` (US15, T160).
 *
 * Controlador delgado: valida con `PipeValidacionZod`, exige permiso y delega. Sin `try/catch`
 * — el filtro global traduce los errores de dominio al formato `{ error: { mensaje, campos } }`
 * del contrato.
 *
 * El permiso NO es uniforme para todo el controlador, igual que en `ControladorCategorias` y
 * con más razón aquí: LEER el catálogo (`proveedores.ver`) lo tienen los tres roles porque sin
 * él no se puede registrar un ingreso —el proveedor es OBLIGATORIO (FR-091)— ni usar el filtro
 * del listado, mientras que ADMINISTRARLO (`proveedores.gestionar`) queda restringido.
 *
 * Implementa: FR-091…FR-093.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  esquemaCrearProveedor,
  esquemaEstadoProveedor,
  esquemaListarProveedores,
  type DatosCrearProveedor,
  type DatosEstadoProveedor,
  type FiltroListarProveedores,
} from '@trazo/compartido';
import {
  ActualizarProveedorCasoUso,
  CambiarEstadoProveedorCasoUso,
  CrearProveedorCasoUso,
  EliminarProveedorCasoUso,
  ListarProveedoresCasoUso,
} from '../../../aplicacion/proveedores/gestionar-proveedores.caso-uso';
import type { ProveedorConUso } from '../../../dominio/entidades/proveedor';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';

@Controller('proveedores')
export class ControladorProveedores {
  constructor(
    private readonly listarProveedores: ListarProveedoresCasoUso,
    private readonly crearProveedor: CrearProveedorCasoUso,
    private readonly actualizarProveedor: ActualizarProveedorCasoUso,
    private readonly cambiarEstadoProveedor: CambiarEstadoProveedorCasoUso,
    private readonly eliminarProveedor: EliminarProveedorCasoUso,
  ) {}

  @Get()
  @RequierePermiso('proveedores.ver')
  async listar(
    @Query(new PipeValidacionZod(esquemaListarProveedores)) filtros: FiltroListarProveedores,
  ): Promise<ProveedorConUso[]> {
    return this.listarProveedores.ejecutar(filtros);
  }

  @Post()
  @RequierePermiso('proveedores.gestionar')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body(new PipeValidacionZod(esquemaCrearProveedor)) datos: DatosCrearProveedor,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<{ id: number }> {
    const id = await this.crearProveedor.ejecutar({ ...datos, usuarioId: usuarioActual.id });
    return { id };
  }

  @Put(':id')
  @RequierePermiso('proveedores.gestionar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaCrearProveedor)) datos: DatosCrearProveedor,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<void> {
    await this.actualizarProveedor.ejecutar({ id, ...datos, usuarioId: usuarioActual.id });
  }

  @Put(':id/estado')
  @RequierePermiso('proveedores.gestionar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaEstadoProveedor)) datos: DatosEstadoProveedor,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<void> {
    await this.cambiarEstadoProveedor.ejecutar({ id, estado: datos.estado, usuarioId: usuarioActual.id });
  }

  @Delete(':id')
  @RequierePermiso('proveedores.gestionar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.eliminarProveedor.ejecutar(id);
  }
}
