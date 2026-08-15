/**
 * Caso de uso `CrearIngresoCasoUso` — registra una factura de compra en estado `PENDIENTE`
 * (`POST /api/ingresos`, FR-013). Sin efecto en stock: eso solo ocurre al `recibir`
 * (`recibir-ingreso.caso-uso.ts`, FR-017).
 *
 * Adapta la entrada YA VALIDADA en forma por `esquemaCrearIngreso` (el pipe HTTP) al puerto
 * `RepositorioIngresos.crear`: convierte `fechaFactura`/`fechaRecepcion` de texto ISO a
 * `Date` (el esquema Zod las valida como string para poder dar mensajes "obligatoria"
 * distintos de "inválida" — ver `packages/compartido/src/esquemas/ingresos.ts`) y embebe el
 * `usuarioId` de auditoría (FR-018/FR-045).
 *
 * Nota de diseño (decisión heredada de T030, actualizada en T038): el cálculo de
 * `valorTotal` por línea y del total del ingreso (`cantidad × precioUnitario`, FR-014) usa
 * las funciones puras `calcularValorTotalLinea`/`calcularValorTotalIngreso` de
 * `dominio/entidades/ingreso.ts`, invocadas desde `RepositorioIngresosPrisma.crear` — el
 * puerto `DatosNuevoIngreso`/`LineaNuevoIngreso` no tiene un campo para que este caso de uso
 * lo calcule y lo transporte. Recalcularlo aquí sin usarlo sería lógica muerta (Principio V,
 * YAGNI); si el puerto se reabre para separar esa responsabilidad, este caso de uso es el
 * lugar correcto para invocar esas mismas funciones de dominio.
 *
 * Implementa: FR-013 (registro de factura con cabecera + líneas), FR-014 (totales,
 * calculados aguas abajo como se documenta arriba) y FR-015 (unicidad de factura — el
 * adaptador traduce la violación UNIQUE a `Duplicado`, no se captura aquí).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_INGRESOS, type RepositorioIngresos } from '../../dominio/puertos/repositorio-ingresos';
import {
  REPOSITORIO_PROVEEDORES,
  type RepositorioProveedores,
} from '../../dominio/puertos/repositorio-proveedores';
import {
  REPOSITORIO_ORDENES_COMPRA,
  type RepositorioOrdenesCompra,
} from '../../dominio/puertos/repositorio-ordenes-compra';
import { ErrorValidacionDominio } from '../../dominio/comunes/errores';
import { verificarProveedorAsignable } from './verificar-proveedor-asignable';

/** Línea de factura ya validada en forma (producto, cantidad, precio de compra unitario). */
export interface LineaCrearIngresoEntrada {
  readonly productoId: number;
  readonly cantidad: number;
  readonly precioUnitario: number;
}

/** Entrada: datos validados por `esquemaCrearIngreso` + auditoría (FR-045). Las fechas
 *  llegan como texto ISO (`YYYY-MM-DD`) — este caso de uso las convierte a `Date`. */
export interface CrearIngresoEntrada {
  readonly numeroFactura: string;
  readonly fechaFactura: string;
  /** Referencia al catálogo de proveedores (US15, FR-091) — obligatoria. */
  readonly proveedorId: number;
  /** Orden de compra que este ingreso surte (US16, FR-099). Opcional: registrar un ingreso sin
   *  orden previa sigue siendo el camino normal. */
  readonly ordenCompraId?: number;
  readonly fechaRecepcion: string;
  readonly observaciones: string | null;
  readonly lineas: readonly LineaCrearIngresoEntrada[];
  /** Quién registra la factura — nunca confiar en un valor del body (FR-018/FR-045). */
  readonly usuarioId: number;
}

export interface CrearIngresoSalida {
  readonly id: number;
}

@Injectable()
export class CrearIngresoCasoUso implements CasoDeUso<CrearIngresoEntrada, CrearIngresoSalida> {
  constructor(
    @Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos,
    @Inject(REPOSITORIO_PROVEEDORES) private readonly repositorioProveedores: RepositorioProveedores,
    @Inject(REPOSITORIO_ORDENES_COMPRA) private readonly repositorioOrdenes: RepositorioOrdenesCompra,
  ) {}

  async ejecutar(entrada: CrearIngresoEntrada): Promise<CrearIngresoSalida> {
    // US15 (FR-091): el proveedor se comprueba ANTES de escribir. La FK de la BD ya impediría
    // uno inexistente, pero con un error técnico; y el estado INACTIVO no lo cubre ninguna
    // restricción de base de datos — un proveedor retirado no debe aparecer en facturas nuevas.
    await verificarProveedorAsignable(this.repositorioProveedores, entrada.proveedorId);
    if (entrada.ordenCompraId !== undefined) {
      await this.verificarOrdenSurtible(entrada.ordenCompraId, entrada.proveedorId);
    }

    const ingreso = await this.repositorioIngresos.crear({
      numeroFactura: entrada.numeroFactura,
      fechaFactura: new Date(entrada.fechaFactura),
      proveedorId: entrada.proveedorId,
      ordenCompraId: entrada.ordenCompraId ?? null,
      fechaRecepcion: new Date(entrada.fechaRecepcion),
      observaciones: entrada.observaciones,
      lineas: entrada.lineas.map((linea) => ({ ...linea })),
      usuarioId: entrada.usuarioId,
    });
    return { id: ingreso.id };
  }

  /**
   * Una orden solo se puede surtir si está ENVIADA y es del MISMO proveedor (FR-099).
   *
   * Las dos condiciones dicen lo mismo desde ángulos distintos: un ingreso registra mercancía
   * que llegó, y solo puede haber llegado lo que se pidió (ENVIADA) a quien se le pidió. Sin la
   * comprobación de proveedor, el vínculo permitiría cerrar la orden de Formex con una factura
   * de otro proveedor y el historial de compras dejaría de significar nada.
   */
  private async verificarOrdenSurtible(ordenCompraId: number, proveedorId: number): Promise<void> {
    const orden = await this.repositorioOrdenes.buscarPorId(ordenCompraId);
    if (!orden) {
      throw new ErrorValidacionDominio('La orden de compra seleccionada no existe', {
        ordenCompraId: 'La orden de compra seleccionada no existe',
      });
    }
    if (orden.estado !== 'ENVIADA') {
      throw new ErrorValidacionDominio('Solo una orden ENVIADA puede surtirse con un ingreso', {
        ordenCompraId: 'Solo una orden enviada al proveedor puede surtirse con un ingreso.',
      });
    }
    if (orden.proveedor.id !== proveedorId) {
      throw new ErrorValidacionDominio('La orden de compra es de otro proveedor', {
        ordenCompraId: `La orden es de "${orden.proveedor.nombre}": el ingreso debe registrarse a ese mismo proveedor.`,
      });
    }
  }
}
