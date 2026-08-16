/**
 * Caso de uso `CrearProductoCasoUso` — alta de un producto del catálogo
 * (`POST /api/productos`). El mismo endpoint sirve tanto al alta explícita desde el
 * listado de inventario como al dialog de "alta rápida" que se abrirá desde el formulario
 * de ingresos (US1): no hay regla distinta según el origen de la petición, por eso es un
 * único caso de uso reutilizado (Principio V — sin duplicar reglas por pantalla).
 *
 * Delegación directa al puerto `RepositorioProductos.crear`: el SKU duplicado ya lo
 * traduce el adaptador Prisma a `Duplicado('sku', ...)` (docs/arquitectura.md §3), así que
 * este caso de uso no necesita pre-validar unicidad ni capturar el error.
 *
 * ## Existencias iniciales (US18, FR-106)
 *
 * El alta puede traer proveedor, cantidad y valor unitario, y entonces hace en una gestión lo
 * que antes eran dos: crear el producto y registrar el ingreso que le da stock. Lo que NO hace
 * —ni podría— es escribir el stock en el producto: la cantidad se convierte en un INGRESO real
 * que se crea y se recibe por los mismos puertos que un ingreso manual, con su línea, su
 * movimiento de `ENTRADA` y su registro en el historial de costos. Es el mismo camino que la
 * carga masiva eligió para su columna "Cantidad inicial" (FR-050, research R15), y por la misma
 * razón: el stock solo se mueve con un movimiento que deje rastro (Principio I y II).
 *
 * De ahí que el proveedor sea obligatorio en cuanto hay cantidad: un ingreso sin proveedor no
 * existe (FR-091), y atribuirlo a uno sintético —como sí hace la carga masiva, que no tiene a
 * quién preguntarle— haría que el movimiento mintiera sobre de dónde vino la mercancía.
 *
 * El producto y su ingreso NO comparten transacción, mismo trade-off que la carga masiva: si el
 * ingreso fallara, el producto queda creado (en cero) y el usuario puede registrarle el ingreso
 * a mano sin duplicar nada. Envolverlos exigiría una unidad de trabajo que abarcara dos
 * agregados para un caso que se resuelve solo.
 *
 * Implementa: FR-010 (alta de producto con SKU/descripción/ubicación/umbral de stock
 * bajo), FR-011 (alta rápida reutilizable desde ingresos), FR-086 (`categoriaId`: referencia al
 * catálogo, opcional) y FR-106 (existencias iniciales como ingreso real).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import {
  REPOSITORIO_INGRESOS,
  type LineaNuevoIngreso,
  type RepositorioIngresos,
} from '../../dominio/puertos/repositorio-ingresos';
import {
  REPOSITORIO_PROVEEDORES,
  type RepositorioProveedores,
} from '../../dominio/puertos/repositorio-proveedores';
import { verificarProveedorAsignable } from '../ingresos/verificar-proveedor-asignable';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import {
  REPOSITORIO_UNIDADES_MEDIDA,
  type RepositorioUnidadesMedida,
} from '../../dominio/puertos/repositorio-unidades-medida';
import { verificarUnidadMedidaAsignable } from './verificar-unidad-medida-asignable';


/** Entrada: datos ya validados por `esquemaCrearProducto` (pipe HTTP) + auditoría (FR-045). */
export interface CrearProductoEntrada {
  readonly sku: string;
  readonly descripcion: string;
  readonly categoriaId: number | null;
  /** US17 (FR-102): obligatoria — una cantidad sin unidad no se puede interpretar. */
  readonly unidadMedidaId: number;
  readonly ubicacion: string | null;
  readonly umbralStockBajo: number;
  /**
   * Existencias iniciales (US18, FR-106) — los tres o ninguno. `esquemaCrearProducto` ya
   * garantiza que con `cantidadInicial > 0` llegan también los otros dos, así que aquí no hay
   * que volver a comprobarlo: la validación cruzada vive en el esquema compartido, que es el
   * único sitio donde frontend y backend la ven igual.
   */
  readonly proveedorId?: number;
  readonly cantidadInicial?: number;
  readonly valorUnitario?: number;
  /** Quién da de alta el producto — nunca confiar en un valor del body (FR-045). */
  readonly usuarioId: number;
}

export interface CrearProductoSalida {
  readonly id: number;
  /** Ingreso generado por las existencias iniciales, `null` si el alta no las traía — permite
   *  al frontend enlazar al documento que respalda ese stock (US18, FR-106). */
  readonly ingresoId: number | null;
}

/**
 * Número de documento del ingreso que respalda unas existencias iniciales.
 *
 * Se autogenera en vez de pedirlo, y el prefijo lo dice: este ingreso no nace de una factura que
 * alguien tenga en la mano, sino de un alta de catálogo. Pedir número y fechas convertiría el
 * diálogo de alta en un formulario de ingreso, que es exactamente lo que esta historia vino a
 * evitar. Mismo criterio (y mismo formato) que el `IMPORTACION-` de la carga masiva.
 */
function numeroDocumentoDeAlta(): string {
  const sufijo = Math.random().toString(36).slice(2, 8);
  return `ALTA-${Date.now()}-${sufijo}`;
}

@Injectable()
export class CrearProductoCasoUso implements CasoDeUso<CrearProductoEntrada, CrearProductoSalida> {
  constructor(
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_UNIDADES_MEDIDA) private readonly repositorioUnidades: RepositorioUnidadesMedida,
    @Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos,
    @Inject(REPOSITORIO_PROVEEDORES) private readonly repositorioProveedores: RepositorioProveedores,
  ) {}

  async ejecutar(entrada: CrearProductoEntrada): Promise<CrearProductoSalida> {
    await verificarUnidadMedidaAsignable(this.repositorioUnidades, entrada.unidadMedidaId);

    const producto = await this.repositorioProductos.crear({
      sku: entrada.sku,
      descripcion: entrada.descripcion,
      categoriaId: entrada.categoriaId,
      unidadMedidaId: entrada.unidadMedidaId,
      ubicacion: entrada.ubicacion,
      umbralStockBajo: entrada.umbralStockBajo,
      usuarioCreacionId: entrada.usuarioId,
    });

    return { id: producto.id, ingresoId: await this.registrarExistenciasIniciales(producto.id, entrada) };
  }

  /**
   * Convierte las existencias iniciales en un ingreso RECIBIDO (FR-106) — o en nada, si el alta
   * no las traía, que es como se comportaba el endpoint antes de US18.
   */
  private async registrarExistenciasIniciales(
    productoId: number,
    entrada: CrearProductoEntrada,
  ): Promise<number | null> {
    if (!entrada.cantidadInicial || entrada.cantidadInicial <= 0) return null;
    if (entrada.proveedorId === undefined || entrada.valorUnitario === undefined) return null;

    // El mismo control que hace `CrearIngresoCasoUso`, y con la misma función: este ingreso es un
    // ingreso como cualquier otro, así que un proveedor retirado del catálogo tampoco vale aquí
    // (US15, FR-091). Va ANTES de crear el ingreso para que el error señale `proveedorId` en vez
    // de estallar como violación de estado a medio camino.
    await verificarProveedorAsignable(this.repositorioProveedores, entrada.proveedorId);

    const lineas: LineaNuevoIngreso[] = [
      { productoId, cantidad: entrada.cantidadInicial, precioUnitario: entrada.valorUnitario },
    ];

    const ahora = new Date();
    const ingreso = await this.repositorioIngresos.crear({
      numeroFactura: numeroDocumentoDeAlta(),
      fechaFactura: ahora,
      proveedorId: entrada.proveedorId,
      // Un alta de catálogo no responde a ninguna orden de compra (US16, FR-099).
      ordenCompraId: null,
      fechaRecepcion: ahora,
      observaciones: `Existencias iniciales registradas al dar de alta el producto ${entrada.sku} (US18).`,
      lineas,
      usuarioId: entrada.usuarioId,
    });

    // `recibir` es lo que mueve el stock y escribe el movimiento de ENTRADA: sin esto el ingreso
    // quedaría PENDIENTE y el producto seguiría en cero, que es justo lo que el usuario quería
    // evitar al informar la cantidad.
    await this.repositorioIngresos.recibir(ingreso.id, entrada.usuarioId);
    return ingreso.id;
  }
}
