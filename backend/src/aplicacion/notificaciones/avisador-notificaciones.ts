/**
 * `AvisadorDeNotificaciones` — el único sitio del backend que EMITE avisos (US35, FR-139).
 *
 * ## Por qué la emisión vive en la aplicación y no en los repositorios
 *
 * Las transiciones de estado ocurren dentro de las transacciones de los adaptadores
 * (`recibir`, `confirmar`, `anular`). Emitir desde ahí obligaría a que la infraestructura
 * supiera qué se avisa y a quién —negocio puro— y ataría el aviso a la transacción del stock.
 * Aquí, en cambio, cada caso de uso llama a este servicio DESPUÉS de que su operación se
 * completó, que es el único momento en que el hecho es cierto.
 *
 * ## Un aviso NUNCA puede tumbar la operación (FR-146)
 *
 * Ningún método propaga: lo que falla se anota en el log y se sigue. La razón es de daño
 * comparado — la recepción ya ocurrió, el stock ya se movió y los movimientos ya están
 * escritos; hacer fallar esa respuesta porque no se pudo escribir un aviso le diría a la
 * persona que su operación falló cuando no falló, y la llevaría a repetirla. Un aviso perdido
 * es una molestia; un ingreso registrado dos veces es un inventario equivocado.
 *
 * Por lo mismo no se emite dentro de la transacción del documento: un `INSERT` de aviso que
 * fallara ahí haría rollback de la operación entera.
 *
 * ## Los textos se redactan aquí y se guardan hechos
 *
 * Un aviso dice lo que se supo en ese momento (data-model.md § notificaciones). Componerlo al
 * LEERLO obligaría a recargar documentos que quizá ya cambiaron de estado, y entonces el aviso
 * describiría el presente en vez del hecho que anunció.
 *
 * Implementa: FR-139 (qué se avisa y cuándo), FR-140 (a qué entidad lleva), FR-143 (quien lo
 * provoca no lo recibe: se guarda su id para excluirlo al leer), FR-145 (stock bajo solo en el
 * cruce) y FR-146 (nunca impide la operación).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TipoNotificacion } from '../../dominio/entidades/notificacion';
import { cruzaElUmbral } from '../../dominio/entidades/producto';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';
import { REPOSITORIO_INGRESOS, type RepositorioIngresos } from '../../dominio/puertos/repositorio-ingresos';
import {
  REPOSITORIO_NOTIFICACIONES,
  type RepositorioNotificaciones,
} from '../../dominio/puertos/repositorio-notificaciones';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';
import { identificadorIngreso } from '../ingresos/identificador-ingreso';

/** Tope del detalle — el mismo `VARCHAR(300)` de la columna. Se recorta aquí para que un motivo
 *  largo no reviente el `INSERT` y termine costando el aviso entero. */
const MAXIMO_DETALLE = 300;

/** Cuánto bajó el disponible de un producto en la operación que se acaba de aplicar (FR-145). */
export interface BajaDeDisponible {
  readonly productoId: number;
  readonly cantidad: number;
}

@Injectable()
export class AvisadorDeNotificaciones {
  private readonly logger = new Logger(AvisadorDeNotificaciones.name);

  constructor(
    @Inject(REPOSITORIO_NOTIFICACIONES) private readonly repositorioNotificaciones: RepositorioNotificaciones,
    @Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos,
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
  ) {}

  /** Un ingreso quedó PENDIENTE: hay mercancía que alguien tiene que recibir. */
  async ingresoRegistrado(ingresoId: number, actorId: number): Promise<void> {
    await this.deIngreso('INGRESO_REGISTRADO', ingresoId, actorId, (identificador) => ({
      titulo: `Ingreso ${identificador} por recibir`,
    }));
  }

  /** Entró mercancía: el stock ya subió. */
  async ingresoRecibido(ingresoId: number, actorId: number): Promise<void> {
    await this.deIngreso('INGRESO_RECIBIDO', ingresoId, actorId, (identificador) => ({
      titulo: `Ingreso ${identificador} recibido`,
    }));
  }

  /** Se anuló un ingreso. Si estaba RECIBIDO, el stock acaba de bajar. */
  async ingresoAnulado(ingresoId: number, actorId: number, motivo: string): Promise<void> {
    await this.deIngreso('INGRESO_ANULADO', ingresoId, actorId, (identificador) => ({
      titulo: `Ingreso ${identificador} anulado`,
      motivo,
    }));
  }

  /** Una salida quedó PENDIENTE: hay algo esperando aprobación. Es el aviso de US35-AS1. */
  async salidaPorAprobar(salidaId: number, actorId: number): Promise<void> {
    await this.deSalida('SALIDA_POR_APROBAR', salidaId, actorId, (numero) => ({
      titulo: `Salida ${numero} por aprobar`,
    }));
  }

  /** Se confirmó una salida: el stock ya se descontó. */
  async salidaConfirmada(salidaId: number, actorId: number): Promise<void> {
    await this.deSalida('SALIDA_CONFIRMADA', salidaId, actorId, (numero) => ({
      titulo: `Salida ${numero} confirmada`,
    }));
  }

  /** Se anuló una salida; si estaba confirmada, la mercancía volvió al inventario. */
  async salidaAnulada(salidaId: number, actorId: number, motivo: string): Promise<void> {
    await this.deSalida('SALIDA_ANULADA', salidaId, actorId, (numero) => ({
      titulo: `Salida ${numero} anulada`,
      motivo,
    }));
  }

  /**
   * Alguien escribió el stock a mano (US31, FR-130). Se avisa SIEMPRE, sin depender de umbrales:
   * es la única operación capaz de desmentir a todos los documentos a la vez, así que enterarse
   * no debería depender de que además el producto quede bajo.
   */
  async cantidadCorregida(
    productoId: number,
    actorId: number,
    cambio: { readonly anterior: number; readonly nueva: number; readonly motivo: string },
  ): Promise<void> {
    await this.intentar(`cantidad corregida del producto ${productoId}`, async () => {
      const [producto] = await this.repositorioProductos.buscarPorIds([productoId]);
      if (!producto) return;

      await this.repositorioNotificaciones.crear({
        tipo: 'CANTIDAD_CORREGIDA',
        titulo: `Cantidad corregida: ${producto.descripcion}`,
        detalle: recortar(`De ${cambio.anterior} a ${cambio.nueva} · ${cambio.motivo}`),
        entidadId: productoId,
        usuarioOrigenId: actorId,
      });
    });
  }

  /**
   * Avisa de los productos que ACABAN de cruzar su umbral hacia abajo (FR-145).
   *
   * Quien llama pasa cuánto bajó el disponible de cada producto en la operación que acaba de
   * aplicar; con eso se reconstruye el "antes" y se distingue un CRUCE de un "sigue bajo". La
   * alternativa —leer el disponible antes y después— atribuiría el cruce al documento
   * equivocado en cuanto dos personas muevan el mismo producto a la vez.
   *
   * De dónde se llama y de dónde NO: se llama al registrar una salida (compromete disponible),
   * al anular un ingreso recibido y al corregir una cantidad a la baja. NO se llama al CONFIRMAR
   * una salida, y no es un olvido: confirmar mueve la cantidad de "comprometida" a "descontada"
   * y el disponible no cambia — el cruce ya ocurrió cuando se registró la salida. Tampoco desde
   * la edición de una salida pendiente: ahí el delta exigiría comparar el documento con su
   * versión anterior, y el cruce que importa casi siempre lo produce el alta.
   */
  async revisarUmbrales(bajas: readonly BajaDeDisponible[], actorId: number): Promise<void> {
    if (bajas.length === 0) return;

    await this.intentar('umbral de stock', async () => {
      const porProducto = agruparBajas(bajas);
      const ids = [...porProducto.keys()];
      const [productos, comprometido] = await Promise.all([
        this.repositorioProductos.buscarPorIds(ids),
        this.repositorioSalidas.comprometidoPorProducto(ids),
      ]);

      for (const producto of productos) {
        const disponible = producto.stockActual - (comprometido.get(producto.id) ?? 0);
        const baja = porProducto.get(producto.id) ?? 0;
        if (!cruzaElUmbral(disponible, baja, producto.umbralStockBajo)) continue;

        await this.repositorioNotificaciones.crear({
          tipo: 'STOCK_BAJO',
          titulo: `Stock bajo: ${producto.descripcion}`,
          detalle: recortar(`Quedan ${disponible} disponibles · umbral ${producto.umbralStockBajo}`),
          entidadId: producto.id,
          usuarioOrigenId: actorId,
        });
      }
    });
  }

  /** Redacta y emite un aviso de ingreso; el detalle es siempre proveedor + líneas. */
  private async deIngreso(
    tipo: TipoNotificacion,
    ingresoId: number,
    actorId: number,
    redactar: (identificador: string) => { titulo: string; motivo?: string },
  ): Promise<void> {
    await this.intentar(`aviso de ingreso ${ingresoId}`, async () => {
      const ingreso = await this.repositorioIngresos.buscarPorId(ingresoId);
      if (!ingreso) return;

      const { titulo, motivo } = redactar(identificadorIngreso(ingreso));
      const origen = ingreso.proveedor?.nombre ?? 'Ajuste de inventario';
      await this.repositorioNotificaciones.crear({
        tipo,
        titulo,
        detalle: recortar(unidos([origen, lineas(ingreso.detalles.length), motivo])),
        entidadId: ingresoId,
        usuarioOrigenId: actorId,
      });
    });
  }

  /** Redacta y emite un aviso de salida; el detalle es siempre cliente + líneas. */
  private async deSalida(
    tipo: TipoNotificacion,
    salidaId: number,
    actorId: number,
    redactar: (numero: string) => { titulo: string; motivo?: string },
  ): Promise<void> {
    await this.intentar(`aviso de salida ${salidaId}`, async () => {
      const salida = await this.repositorioSalidas.buscarPorId(salidaId);
      if (!salida) return;

      const cliente = await this.repositorioClientes.buscarPorId(salida.clienteId);
      const { titulo, motivo } = redactar(formatoNumeroSalida(salida.numero));
      await this.repositorioNotificaciones.crear({
        tipo,
        titulo,
        detalle: recortar(unidos([cliente?.nombre, lineas(salida.detalles.length), motivo])),
        entidadId: salidaId,
        usuarioOrigenId: actorId,
      });
    });
  }

  /**
   * Ejecuta la emisión sin dejar que un fallo suyo salga de aquí (FR-146).
   *
   * `warn` y no `error` a propósito: no hay nada roto en el sistema de negocio, y un `error` en
   * el log por algo que no lo es enseña a ignorar los errores del log.
   */
  private async intentar(descripcion: string, tarea: () => Promise<void>): Promise<void> {
    try {
      await tarea();
    } catch (error) {
      this.logger.warn(
        `No se pudo emitir el aviso (${descripcion}); la operación se completó igual: ${String(error)}`,
      );
    }
  }
}

/** Suma las bajas repetidas del mismo producto: un documento puede traerlo en varias líneas. */
function agruparBajas(bajas: readonly BajaDeDisponible[]): Map<number, number> {
  const total = new Map<number, number>();
  for (const baja of bajas) {
    total.set(baja.productoId, (total.get(baja.productoId) ?? 0) + baja.cantidad);
  }
  return total;
}

/** `SAL-000231` — el mismo formato con el que la pantalla y los exportables muestran el
 *  correlativo de una salida (`formatoNumeroSalida` de `@trazo/compartido` para el navegador). */
function formatoNumeroSalida(numero: number): string {
  return `SAL-${String(numero).padStart(6, '0')}`;
}

/** "1 línea" / "4 líneas" — en español, sin el "(s)" que nadie dice en voz alta. */
function lineas(cuantas: number): string {
  return cuantas === 1 ? '1 línea' : `${cuantas} líneas`;
}

/** Une las partes que existen con el separador de la bandeja, sin dejar "·" colgando cuando una
 *  falta (un cliente borrado, un aviso sin motivo). */
function unidos(partes: readonly (string | undefined | null)[]): string {
  return partes.filter((parte): parte is string => Boolean(parte)).join(' · ');
}

/** Recorta al ancho de la columna sin cortar a mitad de palabra cuando se puede. */
function recortar(detalle: string): string {
  if (detalle.length <= MAXIMO_DETALLE) return detalle;
  const cortado = detalle.slice(0, MAXIMO_DETALLE - 1);
  const ultimoEspacio = cortado.lastIndexOf(' ');
  return `${ultimoEspacio > MAXIMO_DETALLE / 2 ? cortado.slice(0, ultimoEspacio) : cortado}…`;
}
