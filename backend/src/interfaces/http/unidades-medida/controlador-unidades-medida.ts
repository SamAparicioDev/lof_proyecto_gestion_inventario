/**
 * `ControladorUnidadesMedida` — `/api/unidades-medida` (US17, T180).
 *
 * Controlador delgado: valida con `PipeValidacionZod`, exige permiso y delega. Sin `try/catch` —
 * el filtro global traduce los errores de dominio al formato del contrato.
 *
 * El permiso va por MÉTODO, igual que en los otros dos catálogos y por la misma razón, que aquí
 * es todavía más directa: LEER el catálogo (`unidades_medida.ver`) lo tienen los tres roles
 * porque desde US17 no se puede dar de alta un producto sin elegir su unidad, y los tres roles
 * pueden crear productos. ADMINISTRARLO (`unidades_medida.gestionar`) queda restringido.
 *
 * Implementa: FR-101…FR-105.
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
  esquemaCrearUnidadMedida,
  esquemaEstadoUnidadMedida,
  esquemaListarUnidadesMedida,
  type DatosCrearUnidadMedida,
  type DatosEstadoUnidadMedida,
  type FiltroListarUnidadesMedida,
} from '@trazo/compartido';
import {
  ActualizarUnidadMedidaCasoUso,
  CambiarEstadoUnidadMedidaCasoUso,
  CrearUnidadMedidaCasoUso,
  EliminarUnidadMedidaCasoUso,
  ListarUnidadesMedidaCasoUso,
} from '../../../aplicacion/unidades-medida/gestionar-unidades-medida.caso-uso';
import type { UnidadMedidaConUso } from '../../../dominio/entidades/unidad-medida';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';

@Controller('unidades-medida')
export class ControladorUnidadesMedida {
  constructor(
    private readonly listarUnidades: ListarUnidadesMedidaCasoUso,
    private readonly crearUnidad: CrearUnidadMedidaCasoUso,
    private readonly actualizarUnidad: ActualizarUnidadMedidaCasoUso,
    private readonly cambiarEstadoUnidad: CambiarEstadoUnidadMedidaCasoUso,
    private readonly eliminarUnidad: EliminarUnidadMedidaCasoUso,
  ) {}

  @Get()
  @RequierePermiso('unidades_medida.ver')
  async listar(
    @Query(new PipeValidacionZod(esquemaListarUnidadesMedida)) filtros: FiltroListarUnidadesMedida,
  ): Promise<UnidadMedidaConUso[]> {
    return this.listarUnidades.ejecutar(filtros);
  }

  @Post()
  @RequierePermiso('unidades_medida.gestionar')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body(new PipeValidacionZod(esquemaCrearUnidadMedida)) datos: DatosCrearUnidadMedida,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<{ id: number }> {
    const id = await this.crearUnidad.ejecutar({ ...datos, usuarioId: usuarioActual.id });
    return { id };
  }

  @Put(':id')
  @RequierePermiso('unidades_medida.gestionar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaCrearUnidadMedida)) datos: DatosCrearUnidadMedida,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<void> {
    await this.actualizarUnidad.ejecutar({ id, ...datos, usuarioId: usuarioActual.id });
  }

  @Put(':id/estado')
  @RequierePermiso('unidades_medida.gestionar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaEstadoUnidadMedida)) datos: DatosEstadoUnidadMedida,
    @UsuarioActual() usuarioActual: Usuario,
  ): Promise<void> {
    await this.cambiarEstadoUnidad.ejecutar({ id, estado: datos.estado, usuarioId: usuarioActual.id });
  }

  @Delete(':id')
  @RequierePermiso('unidades_medida.gestionar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.eliminarUnidad.ejecutar(id);
  }
}
