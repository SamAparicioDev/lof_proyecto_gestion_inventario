/**
 * `aplicarCambioDeCosto` — servicio de dominio 100% PURO (Principio VI): recibe el costo
 * vigente ya leído en memoria y el costo que se pretende aplicar, y devuelve QUÉ registrar,
 * sin tocar Prisma ni la BD. Cero `await`, cero I/O — mismo criterio que `ServicioStock`
 * (research R10: así se prueba con Jest puro, sin levantar PostgreSQL).
 *
 * Es la ÚNICA fuente de verdad de "¿cambió el costo?" (FR-074). Los TRES caminos por los que
 * `productos.ultimo_costo` puede cambiar la consumen sin duplicar la regla:
 *
 *   1. Edición manual   → `PUT /api/productos/:id`            (`EDICION_MANUAL`)
 *   2. Carga masiva     → `POST /api/productos/importar`      (`IMPORTACION`)
 *   3. Recepción        → `POST /api/ingresos/:id/recibir`    (`RECEPCION_INGRESO`)
 *
 * El tercero YA actualizaba el costo desde US1 y hasta US12 no dejaba rastro del cambio de
 * precio: pasar los tres por aquí es lo que cierra ese hueco preexistente sin escribir la
 * comparación tres veces (y sin que un cuarto camino futuro pueda "olvidarla").
 *
 * Devolver `null` NO es un error: es la respuesta correcta a "este archivo/formulario traía el
 * MISMO costo" o "no traía costo". Quien llama simplemente no escribe nada — ni en
 * `productos.ultimo_costo` ni en `historial_costos_producto` (FR-074: las filas cuyo valor
 * unitario llega igual, o vacío, NO generan un registro de cambio).
 *
 * Lo que este servicio deliberadamente NO hace: NO produce ningún movimiento de inventario
 * (FR-073). Un cambio de costo no altera cantidades; registrarlo como movimiento rompería el
 * invariante `stock = Σ movimientos` (invariante 2 de data-model.md).
 *
 * Implementa: FR-071 (el costo es corregible), FR-072 (todo cambio queda registrado con costo
 * anterior/nuevo, usuario y origen), FR-074 (solo se registra si REALMENTE cambió).
 */
import { ErrorValidacionDominio } from '../comunes/errores';
import type { OrigenCambioCosto } from '../entidades/cambio-costo-producto';

/**
 * Decimales con los que se compara y se persiste un costo — los mismos de la columna
 * `DECIMAL(14,2)` de `productos.ultimo_costo` y de `historial_costos_producto` (data-model.md
 * § Campos). Comparar y redondear con la MISMA precisión que la base es lo que impide dos
 * defectos simétricos: registrar un "cambio" de 1000 a 1000.0000001 que la BD guardaría igual
 * (una fila de historial sin cambio visible, que además violaría el CHECK
 * `costo_nuevo <> costo_anterior`), y persistir un valor distinto del que se comparó.
 */
const DECIMALES_DE_COSTO = 2;

/** Datos de entrada de una solicitud de cambio de costo — todo ya leído por el llamador. */
export interface SolicitudCambioCosto {
  readonly productoId: number;
  /** Costo vigente del producto (`productos.ultimo_costo`), leído dentro de la transacción. */
  readonly costoAnterior: number;
  /**
   * Costo que se pretende aplicar. `undefined`/`null` significa "el origen no trae costo"
   * (una edición que no tocó el campo, una fila de Excel con "Valor unitario" vacío) — nunca
   * "ponlo en cero": ver el `return null` de la primera guarda (FR-074).
   */
  readonly costoNuevo: number | null | undefined;
  readonly origen: OrigenCambioCosto;
  /** Quién hace el cambio — nunca un valor del body (FR-045). */
  readonly usuarioId: number;
  /** Ingreso que lo origina cuando `origen === 'RECEPCION_INGRESO'`; ausente en el resto. */
  readonly documentoId?: number | null;
}

/**
 * Lo que hay que escribir cuando el costo SÍ cambió: la fila de `historial_costos_producto` y,
 * en `costoNuevo`, el valor EXACTO que debe quedar en `productos.ultimo_costo` (ya redondeado
 * a los decimales de la columna, ver `DECIMALES_DE_COSTO`). Ambas escrituras van en la MISMA
 * transacción — jamás un costo cambiado sin su registro (FR-072).
 */
export interface RegistroCambioCosto {
  readonly productoId: number;
  readonly costoAnterior: number;
  readonly costoNuevo: number;
  readonly origen: OrigenCambioCosto;
  readonly usuarioId: number;
  readonly documentoId: number | null;
}

/**
 * Decide si el costo cambió y, en ese caso, produce el registro a persistir.
 *
 * Devuelve `null` cuando no hay nada que hacer: el origen no trajo costo, o el costo que trajo
 * es el mismo que ya tiene el producto (FR-074).
 *
 * Lanza `ErrorValidacionDominio` ante un costo negativo: los esquemas Zod de `@trazo/compartido`
 * ya lo rechazan en ambos lados (Principio IV), pero el dominio no delega su invariante en
 * quien lo llame — un costo negativo no existe como hecho de negocio y dejaría el inventario
 * valorizado en negativo.
 */
export function aplicarCambioDeCosto(solicitud: SolicitudCambioCosto): RegistroCambioCosto | null {
  if (solicitud.costoNuevo === undefined || solicitud.costoNuevo === null) return null;

  if (!Number.isFinite(solicitud.costoNuevo) || solicitud.costoNuevo < 0) {
    throw new ErrorValidacionDominio('El costo unitario no puede ser negativo', {
      ultimoCosto: 'El costo unitario no puede ser negativo',
    });
  }

  const costoAnterior = redondearACostoDeColumna(solicitud.costoAnterior);
  const costoNuevo = redondearACostoDeColumna(solicitud.costoNuevo);
  if (costoNuevo === costoAnterior) return null;

  return {
    productoId: solicitud.productoId,
    costoAnterior,
    costoNuevo,
    origen: solicitud.origen,
    usuarioId: solicitud.usuarioId,
    documentoId: solicitud.documentoId ?? null,
  };
}

/** Redondeo a los decimales de la columna `DECIMAL(14,2)` — ver `DECIMALES_DE_COSTO`. */
function redondearACostoDeColumna(costo: number): number {
  const factor = 10 ** DECIMALES_DE_COSTO;
  return Math.round(costo * factor) / factor;
}
