/**
 * Casos de uso de las cotizaciones (US21, T201/T202).
 *
 * Van juntos en un archivo, como los de órdenes de compra: son las operaciones de UN documento
 * cuyas decisiones no triviales son pocas —validar el destino al crear, exigir motivo al anular,
 * y dejar que la máquina de estados del dominio decida el resto— y se leen mejor seguidas.
 *
 * NINGUNO toca stock (FR-113), ni siquiera `aceptar`: lo que este genera es una salida
 * PENDIENTE, y una salida pendiente nunca movió inventario — el compromiso ocurre al
 * confirmarla, con el flujo atómico que ya existe (FR-025). Pedir no es entregar, y ofrecer
 * todavía menos.
 *
 * El destino se valida con `validarDestinoSalida`, la MISMA función que usan las salidas: una
 * cotización se dirige a un proyecto activo de un cliente activo por la misma razón que una
 * salida, y duplicar la regla haría que relajar una relajara la otra sin que nadie lo decidiera.
 *
 * Implementa: FR-112 (alta con cliente/proyecto y líneas), FR-114 (edición solo en BORRADOR),
 * FR-115 (aceptar genera la salida), FR-117 (los permisos los exige el controlador).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { ErrorValidacionDominio, NoEncontrado } from '../../dominio/comunes/errores';
import { estaVencida, type Cotizacion } from '../../dominio/entidades/cotizacion';
import {
  REPOSITORIO_COTIZACIONES,
  type CotizacionConDetalles,
  type FiltrosListarCotizaciones,
  type PaginaCotizaciones,
  type RepositorioCotizaciones,
} from '../../dominio/puertos/repositorio-cotizaciones';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';
import { REPOSITORIO_PROYECTOS, type RepositorioProyectos } from '../../dominio/puertos/repositorio-proyectos';
import { validarDestinoSalida } from '../salidas/validar-destino-salida';

/**
 * Cotización con `vencida` ya resuelta (FR-112).
 *
 * El cálculo se hace AQUÍ y no en el navegador porque es una comparación contra "hoy": hacerla
 * en el cliente la ataría al reloj de cada equipo, y dos personas verían cosas distintas sobre
 * el mismo documento.
 */
export type CotizacionConVigencia = Cotizacion & { readonly vencida: boolean };

export interface PaginaCotizacionesConVigencia {
  readonly datos: CotizacionConVigencia[];
  readonly total: number;
}

function conVigencia<T extends Cotizacion>(cotizacion: T, hoy: Date): T & { vencida: boolean } {
  return { ...cotizacion, vencida: estaVencida(cotizacion, hoy) };
}

@Injectable()
export class ListarCotizacionesCasoUso
  implements CasoDeUso<FiltrosListarCotizaciones, PaginaCotizacionesConVigencia>
{
  constructor(@Inject(REPOSITORIO_COTIZACIONES) private readonly repositorio: RepositorioCotizaciones) {}

  async ejecutar(filtros: FiltrosListarCotizaciones): Promise<PaginaCotizacionesConVigencia> {
    const pagina: PaginaCotizaciones = await this.repositorio.listar(filtros);
    const hoy = new Date();
    return { datos: pagina.datos.map((cotizacion) => conVigencia(cotizacion, hoy)), total: pagina.total };
  }
}

@Injectable()
export class ObtenerCotizacionCasoUso
  implements CasoDeUso<number, CotizacionConDetalles & { vencida: boolean }>
{
  constructor(@Inject(REPOSITORIO_COTIZACIONES) private readonly repositorio: RepositorioCotizaciones) {}

  async ejecutar(id: number): Promise<CotizacionConDetalles & { vencida: boolean }> {
    const cotizacion = await this.repositorio.buscarPorId(id);
    if (!cotizacion) throw new NoEncontrado('La cotización');
    return conVigencia(cotizacion, new Date());
  }
}

/** Línea ya validada en forma por `esquemaCrearCotizacion`. */
export interface LineaCotizacionEntrada {
  readonly productoId: number;
  readonly cantidad: number;
  readonly precioUnitario: number;
  readonly tasaIva?: number;
}

/** Entrada de alta/edición. Las fechas llegan como texto ISO (`YYYY-MM-DD`) — el esquema Zod las
 *  valida como string para poder distinguir "obligatoria" de "inválida"; aquí se convierten. */
export interface CotizacionEntrada {
  readonly clienteId: number;
  readonly proyectoId: number;
  readonly fecha: string;
  readonly fechaValidez: string;
  readonly observaciones?: string;
  readonly lineas: readonly LineaCotizacionEntrada[];
  /** Quién arma la oferta — nunca se confía en un valor del body (FR-045). */
  readonly usuarioId: number;
}

@Injectable()
export class CrearCotizacionCasoUso implements CasoDeUso<CotizacionEntrada, Cotizacion> {
  constructor(
    @Inject(REPOSITORIO_COTIZACIONES) private readonly repositorio: RepositorioCotizaciones,
    @Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos,
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
  ) {}

  async ejecutar(entrada: CotizacionEntrada): Promise<Cotizacion> {
    await this.verificarDestino(entrada);
    return this.repositorio.crear({ ...aDatosPersistencia(entrada), usuarioId: entrada.usuarioId });
  }

  /**
   * El proyecto tiene que existir, estar activo y pertenecer al cliente indicado.
   *
   * La segunda mitad es propia de este módulo: `Salida` solo guarda el proyecto —el cliente se
   * deduce— mientras que una cotización guarda los dos para poder listarse por cliente. Guardar
   * dos referencias obliga a comprobar que concuerden, o el listado por cliente mostraría
   * documentos cuyo proyecto es de otro.
   */
  private async verificarDestino(entrada: CotizacionEntrada): Promise<void> {
    await validarDestinoSalida(this.repositorioProyectos, this.repositorioClientes, entrada.proyectoId);

    const proyecto = await this.repositorioProyectos.buscarPorId(entrada.proyectoId);
    if (proyecto && proyecto.clienteId !== entrada.clienteId) {
      throw new ErrorValidacionDominio('El proyecto no pertenece al cliente seleccionado', {
        proyectoId: 'El proyecto seleccionado no pertenece a ese cliente',
      });
    }
  }
}

export interface ActualizarCotizacionEntrada extends CotizacionEntrada {
  readonly id: number;
}

@Injectable()
export class ActualizarCotizacionCasoUso implements CasoDeUso<ActualizarCotizacionEntrada, void> {
  constructor(
    @Inject(REPOSITORIO_COTIZACIONES) private readonly repositorio: RepositorioCotizaciones,
    @Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos,
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
  ) {}

  /**
   * Carga la cotización primero para dar un mensaje de negocio inmediato si ya no es editable;
   * la comprobación ATÓMICA sigue viviendo en el adaptador, dentro de su transacción (mismo
   * criterio que `ActualizarOrdenCompraCasoUso`): si otro usuario la envía entre esta lectura y
   * la escritura, el adaptador vuelve a rechazarla.
   */
  async ejecutar(entrada: ActualizarCotizacionEntrada): Promise<void> {
    const cotizacion = await this.repositorio.buscarPorId(entrada.id);
    if (!cotizacion) throw new NoEncontrado('La cotización');

    // Solo si CAMBIA de destino: una cotización cuyo proyecto se cerró después debe poder
    // corregirse en sus líneas sin obligar a cambiarle también el destinatario.
    if (entrada.proyectoId !== cotizacion.proyecto.id || entrada.clienteId !== cotizacion.cliente.id) {
      await validarDestinoSalida(this.repositorioProyectos, this.repositorioClientes, entrada.proyectoId);
      const proyecto = await this.repositorioProyectos.buscarPorId(entrada.proyectoId);
      if (proyecto && proyecto.clienteId !== entrada.clienteId) {
        throw new ErrorValidacionDominio('El proyecto no pertenece al cliente seleccionado', {
          proyectoId: 'El proyecto seleccionado no pertenece a ese cliente',
        });
      }
    }

    await this.repositorio.actualizar(entrada.id, aDatosPersistencia(entrada), entrada.usuarioId);
  }
}

export interface AccionCotizacionEntrada {
  readonly id: number;
  readonly usuarioId: number;
}

@Injectable()
export class EnviarCotizacionCasoUso implements CasoDeUso<AccionCotizacionEntrada, void> {
  constructor(@Inject(REPOSITORIO_COTIZACIONES) private readonly repositorio: RepositorioCotizaciones) {}

  async ejecutar(entrada: AccionCotizacionEntrada): Promise<void> {
    await this.repositorio.enviar(entrada.id, entrada.usuarioId);
  }
}

/**
 * Aceptar: la única acción del módulo que crea algo fuera de él (FR-115).
 *
 * Devuelve el id de la salida generada para que la interfaz pueda llevar al usuario hasta ella:
 * quien acaba de aceptar una oferta quiere ver el pedido que nació de ella, no volver al
 * listado a buscarlo.
 */
@Injectable()
export class AceptarCotizacionCasoUso implements CasoDeUso<AccionCotizacionEntrada, { salidaId: number }> {
  constructor(@Inject(REPOSITORIO_COTIZACIONES) private readonly repositorio: RepositorioCotizaciones) {}

  async ejecutar(entrada: AccionCotizacionEntrada): Promise<{ salidaId: number }> {
    return this.repositorio.aceptar(entrada.id, entrada.usuarioId);
  }
}

@Injectable()
export class RechazarCotizacionCasoUso implements CasoDeUso<AccionCotizacionEntrada, void> {
  constructor(@Inject(REPOSITORIO_COTIZACIONES) private readonly repositorio: RepositorioCotizaciones) {}

  async ejecutar(entrada: AccionCotizacionEntrada): Promise<void> {
    await this.repositorio.rechazar(entrada.id, entrada.usuarioId);
  }
}

export interface AnularCotizacionEntrada extends AccionCotizacionEntrada {
  readonly motivo: string | undefined;
}

@Injectable()
export class AnularCotizacionCasoUso implements CasoDeUso<AnularCotizacionEntrada, void> {
  constructor(@Inject(REPOSITORIO_COTIZACIONES) private readonly repositorio: RepositorioCotizaciones) {}

  /** El motivo es OBLIGATORIO y se exige aquí, no en el esquema: es una regla de negocio con su
   *  propio mensaje según la operación, igual que en `AnularOrdenCompraCasoUso`. */
  async ejecutar(entrada: AnularCotizacionEntrada): Promise<void> {
    const motivo = entrada.motivo?.trim();
    if (!motivo) {
      throw new ErrorValidacionDominio('El motivo de anulación es obligatorio', {
        motivo: 'El motivo de anulación es obligatorio',
      });
    }
    await this.repositorio.anular(entrada.id, motivo, entrada.usuarioId);
  }
}

function aDatosPersistencia(entrada: CotizacionEntrada) {
  return {
    clienteId: entrada.clienteId,
    proyectoId: entrada.proyectoId,
    fecha: new Date(entrada.fecha),
    fechaValidez: new Date(entrada.fechaValidez),
    observaciones: entrada.observaciones ?? null,
    lineas: entrada.lineas.map((linea) => ({ ...linea })),
  };
}
