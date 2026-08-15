/**
 * Controlador `ControladorClientes` — endpoints de `/api/clientes`
 * (contracts/api-rest.md § Clientes y proyectos). Traduce HTTP ↔ casos de uso / lectura de
 * `RepositorioClientes`/`RepositorioProyectos`; cero reglas de negocio.
 *
 * Lectura (`listar`/`obtener`/`proyectosDestino`) inyecta los puertos DIRECTAMENTE — sin
 * caso de uso intermedio — porque no hay regla de negocio que aplicar antes de leer (mismo
 * patrón que `ControladorIngresos` con `RepositorioIngresos`). `obtener` y
 * `proyectosDestino` traducen el `null` del repositorio a `NoEncontrado` (el filtro global
 * lo convierte en `404`) porque el puerto expresa "no existe" como valor, no como excepción.
 *
 * El alta de proyecto (`POST /:id/proyectos`) vive aquí, NO en `ControladorProyectos`,
 * porque la ruta es anidada bajo cliente (contracts/api-rest.md); la edición y el cambio de
 * estado de un proyecto ya existente sí son rutas planas y viven en
 * `interfaces/http/proyectos/controlador-proyectos.ts`.
 *
 * Autorización (T103): el permiso sigue al OBJETO DE NEGOCIO, no al controlador que aloja la
 * ruta. Por eso `POST /:id/proyectos` exige `proyectos.crear` —no `clientes.crear`— pese a
 * vivir en este archivo: quien concede "crear proyectos" en la pantalla de roles espera que
 * cubra el alta de proyectos, esté donde esté su ruta. Las tres lecturas comparten
 * `clientes.ver` (listado, ficha y proyectos-destino son la misma capacidad de consulta).
 *
 * Implementa: FR-034…FR-038 (catálogo comercial de clientes/proyectos, destino obligatorio
 * de salidas), FR-045 (auditoría:
 * `usuarioId` siempre del token, nunca del body) y FR-058 (autorización contra el permiso
 * efectivo del rol, resuelto en el servidor en cada petición).
 */
import {
  Body,
  Controller,
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
  esquemaActualizarCliente,
  esquemaCambiarEstadoCliente,
  esquemaCrearCliente,
  esquemaCrearProyecto,
  esquemaFiltroClientes,
  type DatosActualizarCliente,
  type DatosCambiarEstadoCliente,
  type DatosCrearCliente,
  type DatosCrearProyecto,
  type FiltroClientes,
  type OpcionesFiltroClientes,
  type Paginado,
} from '@trazo/compartido';
import { ActualizarClienteCasoUso } from '../../../aplicacion/clientes/actualizar-cliente.caso-uso';
import { CambiarEstadoClienteCasoUso } from '../../../aplicacion/clientes/cambiar-estado-cliente.caso-uso';
import { CrearClienteCasoUso } from '../../../aplicacion/clientes/crear-cliente.caso-uso';
import { CrearProyectoCasoUso } from '../../../aplicacion/clientes/crear-proyecto.caso-uso';
import { NoEncontrado } from '../../../dominio/comunes/errores';
import type { Cliente } from '../../../dominio/entidades/cliente';
import type { Proyecto } from '../../../dominio/entidades/proyecto';
import type { Usuario } from '../../../dominio/entidades/usuario';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../../dominio/puertos/repositorio-clientes';
import { REPOSITORIO_PROYECTOS, type RepositorioProyectos } from '../../../dominio/puertos/repositorio-proyectos';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { UsuarioActual } from '../comunes/usuario-actual.decorator';



/**
 * Respuesta de `GET /api/clientes/:id` — el cliente con sus proyectos ANIDADOS al nivel
 * superior (mismo criterio que `IngresoConDetalles`, `dominio/puertos/repositorio-ingresos.ts`:
 * "extiende" la entidad en vez de anidarla bajo una clave `cliente`). `resumenSalidas` es el
 * agregado de consumo por proyecto que pide FR-037; US3 (salidas) todavía no existe en el
 * backend, así que viaja como arreglo vacío — lo completará el módulo de salidas sin romper
 * este contrato.
 */
export interface ClienteConProyectos extends Cliente {
  readonly proyectos: Proyecto[];
  readonly resumenSalidas: unknown[];
}

@Controller('clientes')
export class ControladorClientes {
  constructor(
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
    @Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos,
    private readonly crearCliente: CrearClienteCasoUso,
    private readonly actualizarCliente: ActualizarClienteCasoUso,
    private readonly cambiarEstadoCliente: CambiarEstadoClienteCasoUso,
    private readonly crearProyecto: CrearProyectoCasoUso,
  ) {}

  /** `GET /api/clientes?buscar=&estado=&ciudad=` — página de clientes (FR-034; `ciudad` desde
   *  US13/FR-075). */
  @Get()
  @RequierePermiso('clientes.ver')
  async listar(@Query(new PipeValidacionZod(esquemaFiltroClientes)) filtros: FiltroClientes): Promise<Paginado<Cliente>> {
    const pagina = await this.repositorioClientes.listar({
      buscar: filtros.buscar,
      estado: filtros.estado,
      ciudad: filtros.ciudad,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    });
    return { datos: pagina.datos, total: pagina.total, pagina: filtros.pagina, porPagina: filtros.porPagina };
  }

  /**
   * `GET /api/clientes/opciones-filtro` — ciudades que EXISTEN hoy entre los clientes, para
   * alimentar el selector de filtro de la pantalla (US13, FR-076): `ciudad` es texto libre
   * capturado a mano, así que el usuario elige de lo que hay en vez de adivinar la ortografía.
   *
   * Va declarada ANTES de `@Get(':id')` — Express resuelve por orden de declaración y detrás de
   * la ruta paramétrica llegaría como un id de cliente (mismo cuidado que `@Get('export')`,
   * T120). Lectura directa del repositorio, sin caso de uso, porque es el criterio de ESTE
   * controlador para las lecturas de un solo puerto sin composición (ver `listar`/`obtener`).
   */
  @Get('opciones-filtro')
  @RequierePermiso('clientes.ver')
  async opcionesFiltro(): Promise<OpcionesFiltroClientes> {
    return { ciudades: await this.repositorioClientes.ciudades() };
  }

  /** `GET /api/clientes/:id` — cliente con sus proyectos y resumen de salidas (FR-037). `404` si no existe. */
  @Get(':id')
  @RequierePermiso('clientes.ver')
  async obtener(@Param('id', ParseIntPipe) id: number): Promise<ClienteConProyectos> {
    const cliente = await this.repositorioClientes.buscarPorId(id);
    if (!cliente) {
      throw new NoEncontrado('El cliente');
    }
    const proyectos = await this.repositorioProyectos.listarPorCliente(id);
    // Resumen de consumo por proyecto (FR-037): depende de las salidas — US3 lo completará.
    return { ...cliente, proyectos, resumenSalidas: [] };
  }

  /** `GET /api/clientes/:id/proyectos-destino` — proyectos ACTIVOS de un cliente ACTIVO,
   *  para el combobox de salidas (FR-038). `404` si el cliente no existe. */
  @Get(':id/proyectos-destino')
  @RequierePermiso('clientes.ver')
  async proyectosDestino(@Param('id', ParseIntPipe) id: number): Promise<Proyecto[]> {
    const cliente = await this.repositorioClientes.buscarPorId(id);
    if (!cliente) {
      throw new NoEncontrado('El cliente');
    }
    return this.repositorioProyectos.proyectosDestino(id);
  }

  /** `POST /api/clientes` — alta de cliente (FR-034/FR-035). */
  @Post()
  @RequierePermiso('clientes.crear')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body(new PipeValidacionZod(esquemaCrearCliente)) datos: DatosCrearCliente,
    @UsuarioActual() usuario: Usuario,
  ): Promise<{ id: number }> {
    return this.crearCliente.ejecutar({ ...datos, usuarioId: usuario.id });
  }

  /** `PUT /api/clientes/:id` — edición de cliente (FR-034/FR-035). */
  @Put(':id')
  @RequierePermiso('clientes.editar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaActualizarCliente)) datos: DatosActualizarCliente,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.actualizarCliente.ejecutar({ clienteId: id, ...datos, usuarioId: usuario.id });
  }

  /** `PUT /api/clientes/:id/estado` — activa/desactiva un cliente (baja lógica, FR-038). */
  @Put(':id/estado')
  @RequierePermiso('clientes.cambiar_estado')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaCambiarEstadoCliente)) datos: DatosCambiarEstadoCliente,
    @UsuarioActual() usuario: Usuario,
  ): Promise<void> {
    await this.cambiarEstadoCliente.ejecutar({ clienteId: id, estado: datos.estado, usuarioId: usuario.id });
  }


  /** `POST /api/clientes/:id/proyectos` — alta de proyecto para el cliente de la ruta (FR-036). */
  @Post(':id/proyectos')
  @RequierePermiso('proyectos.crear')
  @HttpCode(HttpStatus.CREATED)
  async crearProyectoDeCliente(
    @Param('id', ParseIntPipe) id: number,
    @Body(new PipeValidacionZod(esquemaCrearProyecto)) datos: DatosCrearProyecto,
    @UsuarioActual() usuario: Usuario,
  ): Promise<{ id: number }> {
    return this.crearProyecto.ejecutar({ clienteId: id, ...datos, usuarioId: usuario.id });
  }
}
