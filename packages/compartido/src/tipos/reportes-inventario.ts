/**
 * Formas de RESPUESTA de los dos reportes de solo lectura sobre el inventario: inventario inmóvil
 * (US37) y valorización a una fecha (US38).
 *
 * Los dos comparten la misma columna vertebral —producto, existencias, un costo y un valor— y a
 * propósito NO se fusionan en un tipo genérico: significan cosas distintas. En el inmóvil el valor
 * es plata DETENIDA hoy; en la valorización es lo que el inventario VALÍA un día concreto. Un tipo
 * común obligaría a llamar a ambas cosas igual, y la primera confusión entre las dos aparecería en
 * un documento firmado.
 */

/** Una fila del reporte de inventario inmóvil (US37, FR-158). */
export interface FilaInventarioInmovil {
  readonly productoId: string;
  readonly sku: string;
  readonly descripcion: string;
  readonly categoria: string | null;
  readonly unidadMedida: string | null;
  readonly existencias: number;
  readonly ultimoCosto: number;
  /** `existencias × ultimoCosto` — la plata que lleva quieta el tiempo que dice `diasSinSalida`. */
  readonly valorInmovilizado: number;
  /** `null` cuando nunca ha salido; entonces el contador arranca en la primera entrada (FR-159). */
  readonly ultimaSalida: string | null;
  readonly diasSinSalida: number;
  /** El caso más grave, señalado y no disimulado como un número más (FR-159). */
  readonly nuncaHaSalido: boolean;
}

export interface ReporteInventarioInmovil {
  readonly productos: FilaInventarioInmovil[];
  readonly valorTotalInmovilizado: number;
  readonly filtros: {
    readonly diasSinSalida: number;
    /** Viaja RESUELTA —id y nombre— para que el archivo exportado pueda nombrar la categoría en
     *  vez de mostrar un número que no le dice nada a quien lo abre (mismo criterio que US24). */
    readonly categoria: { readonly id: number; readonly nombre: string } | null;
    readonly buscar: string | null;
  };
}

/** Una fila de la valorización a una fecha (US38, FR-163). */
export interface FilaValorizacion {
  readonly productoId: string;
  readonly sku: string;
  readonly descripcion: string;
  readonly categoria: string | null;
  readonly unidadMedida: string | null;
  /** Las que había ESE día, reconstruidas de los movimientos (FR-164). */
  readonly existencias: number;
  /** El que regía ESE día, no el de hoy (FR-165). */
  readonly costoVigente: number;
  readonly valorLinea: number;
}

export interface ReporteValorizacion {
  /** La fecha del corte, en `AAAA-MM-DD`. Va en la respuesta —y no solo en la petición— porque el
   *  documento exportado la imprime: una valorización sin su fecha no significa nada (FR-163). */
  readonly fecha: string;
  readonly productos: FilaValorizacion[];
  readonly valorTotalInventario: number;
  readonly filtros: {
    readonly categoria: { readonly id: number; readonly nombre: string } | null;
    readonly buscar: string | null;
  };
}
