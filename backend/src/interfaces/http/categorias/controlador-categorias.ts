/**
 * `ControladorCategorias` — `/api/categorias` (US15, T151).
 *
 * Controlador delgado: valida con `PipeValidacionZod`, exige permiso y delega. Sin `try/catch`
 * — el filtro global traduce los errores de dominio al formato `{ error: { mensaje, campos } }`
 * del contrato.
 *
 * El permiso NO es uniforme para todo el controlador, y esa es la decisión de diseño de la
 * clase: LEER el catálogo (`categorias.ver`) lo tienen los tres roles, porque sin él no se
 * puede clasificar un producto ni usar el filtro por categoría del inventario —trabajo diario—,
 * mientras que ADMINISTRARLO (`categorias.gestionar`) queda restringido (FR-088). Por eso el
 * decorador va por método y no en la clase, al revés que `ControladorRoles`.
 *
 * Implementa: FR-084…FR-088.
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
  esquemaCrearCategoria,
  esquemaEstadoCategoria,
  esquemaListarCategorias,
  type DatosCrearCategoria,
  type DatosEstadoCategoria,
  type FiltroListarCategorias,
} from '@trazo/compartido';
import {
  ActualizarCategoriaCasoUso,
  CambiarEstadoCategoriaCasoUso,
  CrearCategoriaCasoUso,
  EliminarCategoriaCasoUso,
  ListarCategoriasCasoUso,
} from '../../../aplicacion/categorias/gestionar-categorias.caso-uso';
import type { CategoriaConUso } from '../../../dominio/entidades/categoria';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';

@Controller('categorias')
export class ControladorCategorias {
  constructor(
    private readonly listarCategorias: ListarCategoriasCasoUso,
    private readonly crearCategoria: CrearCategoriaCasoUso,
    private readonly actualizarCategoria: ActualizarCategoriaCasoUso,
    private readonly cambiarEstadoCategoria: CambiarEstadoCategoriaCasoUso,
    private readonly eliminarCategoria: EliminarCategoriaCasoUso,
  ) {}

  @Get()
  @RequierePermiso('categorias.ver')
  async listar(
    @Query(new PipeValidacionZod(esquemaListarCategorias)) filtros: FiltroListarCategorias,
  ): Promise<CategoriaConUso[]> {
    return this.listarCategorias.ejecutar(filtros);
  }

  @Post()
  @RequierePermiso('categorias.gestionar')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body(new PipeValidacionZod(esquemaCrearCategoria)) datos: DatosCrearCategoria,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<{ id: number }> {
    const id = await this.crearCategoria.ejecutar({ ...datos, usuarioId: usuarioActual.id });
    return { id };
  }

  @Put(':id')
  @RequierePermiso('categorias.gestionar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaCrearCategoria)) datos: DatosCrearCategoria,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<void> {
    await this.actualizarCategoria.ejecutar({ id, ...datos, usuarioId: usuarioActual.id });
  }

  @Put(':id/estado')
  @RequierePermiso('categorias.gestionar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaEstadoCategoria)) datos: DatosEstadoCategoria,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<void> {
    await this.cambiarEstadoCategoria.ejecutar({ id, estado: datos.estado, usuarioId: usuarioActual.id });
  }

  @Delete(':id')
  @RequierePermiso('categorias.gestionar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.eliminarCategoria.ejecutar(id);
  }
}
