/**
 * Casos de uso de las órdenes de compra (US16, T170).
 *
 * Van juntos en un archivo, como los de categorías y proveedores: son las operaciones de UN
 * documento cuyas decisiones no triviales son pocas y se leen mejor seguidas — validar el
 * proveedor al crear, exigir motivo al anular, y dejar que la máquina de estados del dominio
 * decida el resto. Si alguna gana lógica propia, se separa.
 *
 * NINGUNO toca stock (FR-096). Es la diferencia de fondo con los casos de uso de ingresos y
 * salidas, que existen precisamente para moverlo: aquí no hay `UnidadDeTrabajo` que orquestar
 * ni `ServicioStock` que aplicar, porque pedir mercancía no es tenerla.
 *
 * Implementa: FR-094 (alta con proveedor y líneas), FR-096 (estados y edición solo en
 * BORRADOR), FR-098 (sugerencias), FR-100 (los permisos los exige el controlador).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { ErrorValidacionDominio, NoEncontrado } from '../../dominio/comunes/errores';
import { puedeRecibirIngresos } from '../../dominio/entidades/proveedor';
import type { OrdenCompra } from '../../dominio/entidades/orden-compra';
import {
  REPOSITORIO_ORDENES_COMPRA,
  type FiltrosListarOrdenesCompra,
  type OrdenCompraConDetalles,
  type PaginaOrdenesCompra,
  type RepositorioOrdenesCompra,
} from '../../dominio/puertos/repositorio-ordenes-compra';
import {
  REPOSITORIO_PROVEEDORES,
  type RepositorioProveedores,
} from '../../dominio/puertos/repositorio-proveedores';
import {
  SUGERENCIAS_COMPRA,
  type SugerenciaCompra,
  type SugerenciasCompra,
} from '../../dominio/puertos/sugerencias-compra';

@Injectable()
export class ListarOrdenesCompraCasoUso implements CasoDeUso<FiltrosListarOrdenesCompra, PaginaOrdenesCompra> {
  constructor(@Inject(REPOSITORIO_ORDENES_COMPRA) private readonly repositorio: RepositorioOrdenesCompra) {}

  async ejecutar(filtros: FiltrosListarOrdenesCompra): Promise<PaginaOrdenesCompra> {
    return this.repositorio.listar(filtros);
  }
}

@Injectable()
export class ObtenerOrdenCompraCasoUso implements CasoDeUso<number, OrdenCompraConDetalles> {
  constructor(@Inject(REPOSITORIO_ORDENES_COMPRA) private readonly repositorio: RepositorioOrdenesCompra) {}

  async ejecutar(id: number): Promise<OrdenCompraConDetalles> {
    const orden = await this.repositorio.buscarPorId(id);
    if (!orden) throw new NoEncontrado('La orden de compra');
    return orden;
  }
}

/** Línea ya validada en forma por `esquemaCrearOrdenCompra`. */
export interface LineaOrdenCompraEntrada {
  readonly productoId: number;
  readonly cantidad: number;
  readonly precioUnitario: number;
}

/** Entrada de alta/edición. Las fechas llegan como texto ISO (`YYYY-MM-DD`) — el esquema Zod las
 *  valida como string para poder distinguir "obligatoria" de "inválida"; aquí se convierten. */
export interface OrdenCompraEntrada {
  readonly proveedorId: number;
  readonly fechaOrden: string;
  readonly fechaEntregaEsperada?: string;
  readonly observaciones?: string;
  readonly lineas: readonly LineaOrdenCompraEntrada[];
  /** Quién arma la orden — nunca se confía en un valor del body (FR-045). */
  readonly usuarioId: number;
}

@Injectable()
export class CrearOrdenCompraCasoUso implements CasoDeUso<OrdenCompraEntrada, OrdenCompra> {
  constructor(
    @Inject(REPOSITORIO_ORDENES_COMPRA) private readonly repositorio: RepositorioOrdenesCompra,
    @Inject(REPOSITORIO_PROVEEDORES) private readonly repositorioProveedores: RepositorioProveedores,
  ) {}

  async ejecutar(entrada: OrdenCompraEntrada): Promise<OrdenCompra> {
    await verificarProveedor(this.repositorioProveedores, entrada.proveedorId);
    return this.repositorio.crear({
      ...aDatosPersistencia(entrada),
      usuarioId: entrada.usuarioId,
    });
  }
}

export interface ActualizarOrdenCompraEntrada extends OrdenCompraEntrada {
  readonly id: number;
}

@Injectable()
export class ActualizarOrdenCompraCasoUso implements CasoDeUso<ActualizarOrdenCompraEntrada, void> {
  constructor(
    @Inject(REPOSITORIO_ORDENES_COMPRA) private readonly repositorio: RepositorioOrdenesCompra,
    @Inject(REPOSITORIO_PROVEEDORES) private readonly repositorioProveedores: RepositorioProveedores,
  ) {}

  /**
   * Carga la orden primero para dar un mensaje de negocio inmediato si ya no es editable; la
   * comprobación ATÓMICA sigue viviendo en el adaptador, dentro de su transacción (mismo
   * criterio que `ActualizarIngresoCasoUso`): si otro usuario la envía entre esta lectura y la
   * escritura, el adaptador vuelve a rechazarla.
   */
  async ejecutar(entrada: ActualizarOrdenCompraEntrada): Promise<void> {
    const orden = await this.repositorio.buscarPorId(entrada.id);
    if (!orden) throw new NoEncontrado('La orden de compra');

    // Solo si CAMBIA de proveedor: una orden que ya apuntaba a uno luego desactivado debe poder
    // corregirse en sus líneas sin obligar a cambiarle también el destinatario.
    if (entrada.proveedorId !== orden.proveedor.id) {
      await verificarProveedor(this.repositorioProveedores, entrada.proveedorId);
    }

    await this.repositorio.actualizar(entrada.id, aDatosPersistencia(entrada), entrada.usuarioId);
  }
}

export interface AccionOrdenCompraEntrada {
  readonly id: number;
  readonly usuarioId: number;
}

@Injectable()
export class EnviarOrdenCompraCasoUso implements CasoDeUso<AccionOrdenCompraEntrada, void> {
  constructor(@Inject(REPOSITORIO_ORDENES_COMPRA) private readonly repositorio: RepositorioOrdenesCompra) {}

  async ejecutar(entrada: AccionOrdenCompraEntrada): Promise<void> {
    await this.repositorio.enviar(entrada.id, entrada.usuarioId);
  }
}

export interface AnularOrdenCompraEntrada extends AccionOrdenCompraEntrada {
  readonly motivo: string | undefined;
}

@Injectable()
export class AnularOrdenCompraCasoUso implements CasoDeUso<AnularOrdenCompraEntrada, void> {
  constructor(@Inject(REPOSITORIO_ORDENES_COMPRA) private readonly repositorio: RepositorioOrdenesCompra) {}

  /** El motivo es OBLIGATORIO y se exige aquí, no en el esquema: es una regla de negocio con su
   *  propio mensaje según la operación, igual que en `AnularIngresoCasoUso` (ver el TSDoc de
   *  `esquemaMotivo` en `@trazo/compartido`). */
  async ejecutar(entrada: AnularOrdenCompraEntrada): Promise<void> {
    const motivo = entrada.motivo?.trim();
    if (!motivo) {
      throw new ErrorValidacionDominio('El motivo de anulación es obligatorio', {
        motivo: 'El motivo de anulación es obligatorio',
      });
    }
    await this.repositorio.anular(entrada.id, entrada.usuarioId, motivo);
  }
}

@Injectable()
export class SugerirCompraCasoUso implements CasoDeUso<number, SugerenciaCompra[]> {
  constructor(
    @Inject(SUGERENCIAS_COMPRA) private readonly sugerencias: SugerenciasCompra,
    @Inject(REPOSITORIO_PROVEEDORES) private readonly repositorioProveedores: RepositorioProveedores,
  ) {}

  /** Se comprueba que el proveedor EXISTA antes de consultar: una lista vacía es una respuesta
   *  legítima ("hoy no hay nada que pedirle"), y sin esta comprobación un id equivocado daría
   *  exactamente la misma respuesta que un proveedor al día — dos situaciones muy distintas. */
  async ejecutar(proveedorId: number): Promise<SugerenciaCompra[]> {
    const proveedor = await this.repositorioProveedores.buscarPorId(proveedorId);
    if (!proveedor) throw new NoEncontrado('El proveedor');
    return this.sugerencias.paraProveedor(proveedorId);
  }
}

/** El proveedor de una orden debe existir y estar ACTIVO (FR-094) — mismo criterio que el de un
 *  ingreso: no se le hace un pedido nuevo a un proveedor retirado del catálogo. */
async function verificarProveedor(repositorio: RepositorioProveedores, proveedorId: number): Promise<void> {
  const proveedor = await repositorio.buscarPorId(proveedorId);
  if (!proveedor) {
    throw new ErrorValidacionDominio('El proveedor seleccionado no existe', {
      proveedorId: 'El proveedor seleccionado no existe',
    });
  }
  if (!puedeRecibirIngresos(proveedor)) {
    throw new ErrorValidacionDominio(`El proveedor "${proveedor.nombre}" está inactivo`, {
      proveedorId: `El proveedor "${proveedor.nombre}" está inactivo. Actívalo o elige otro.`,
    });
  }
}

function aDatosPersistencia(entrada: OrdenCompraEntrada) {
  return {
    proveedorId: entrada.proveedorId,
    fechaOrden: new Date(entrada.fechaOrden),
    fechaEntregaEsperada: entrada.fechaEntregaEsperada ? new Date(entrada.fechaEntregaEsperada) : null,
    observaciones: entrada.observaciones ?? null,
    lineas: entrada.lineas.map((linea) => ({ ...linea })),
  };
}
