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
  readonly proveedor: string;
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
  constructor(@Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos) {}

  async ejecutar(entrada: CrearIngresoEntrada): Promise<CrearIngresoSalida> {
    const ingreso = await this.repositorioIngresos.crear({
      numeroFactura: entrada.numeroFactura,
      fechaFactura: new Date(entrada.fechaFactura),
      proveedor: entrada.proveedor,
      fechaRecepcion: new Date(entrada.fechaRecepcion),
      observaciones: entrada.observaciones,
      lineas: entrada.lineas.map((linea) => ({ ...linea })),
      usuarioId: entrada.usuarioId,
    });
    return { id: ingreso.id };
  }
}
