/**
 * Caso de uso `ImportarProductosCasoUso` — procesa un archivo de carga masiva de inventario
 * (`POST /api/productos/importar`, US8). Orquesta, en este orden:
 *
 * 1. Lee y valida el archivo con el puerto `LectorImportacionProductos` (T093/T094) — filas ya
 *    validadas en FORMA, más los errores de lectura que el lector ya detectó (campos
 *    inválidos, SKU repetido dentro del archivo).
 * 2. Rechaza el archivo COMPLETO, sin tocar ningún producto, si supera el máximo de filas de
 *    datos permitido (spec.md § Assumptions) — el mismo criterio "todo o nada" que un archivo
 *    vacío o no-`.xlsx` (US8-AS5), aplicado aquí (y no en el controlador) porque es este método
 *    el que ya tiene el conteo de filas sin volver a parsear el archivo.
 * 3. Por cada fila válida, decide crear o actualizar el PRODUCTO vía
 *    `RepositorioProductos.buscarPorSku` (FR-049) y, si la fila trae "Valor unitario", aplica
 *    el COSTO con `RepositorioProductos.actualizarCosto` (US12). El alta/actualización de
 *    catálogo es una escritura aparte, NO transaccional (igual que el alta manual de hoy) —
 *    una fila que falle en este paso (ej. una violación de unicidad de carrera) se captura y
 *    se reporta como error de ESA fila, sin detener las demás (FR-051).
 * 4. Agrupa las filas que tuvieron éxito en el paso 3 y traían `cantidadInicial > 0` en UN
 *    ÚNICO `Ingreso` sintético (`proveedor = 'Carga masiva de inventario'`, `numeroFactura`
 *    autogenerado único) y lo recibe con `RepositorioIngresos.crear` + `.recibir` — el MISMO
 *    flujo atómico (`FOR UPDATE`, movimientos `ENTRADA`) que un ingreso manual (FR-050,
 *    research R15, data-model.md § Carga masiva de inventario). A diferencia del paso 3, un
 *    fallo AQUÍ no se atribuye a una fila individual (afecta a todo el lote de stock inicial de
 *    la corrida): se deja propagar SIN capturar — el catálogo queda creado/actualizado (trade-
 *    off documentado en research R15) y el archivo se puede volver a subir para aplicar el
 *    stock pendiente sin duplicar productos.
 *
 * ## El costo en la carga masiva (US12, FR-070/FR-071/FR-074)
 *
 * Desde US12 el catálogo se descarga CON el costo actual en "Valor unitario" y ese valor es
 * editable: corregir precios a escala es justo el caso de uso que el dueño del proyecto pidió.
 * La regla es una sola y vive en el dominio (`aplicarCambioDeCosto`): un costo se considera
 * cambiado solo si difiere del vigente; una fila con el MISMO valor unitario —o con la columna
 * vacía— no genera registro ni suma a `costosActualizados` (FR-074).
 *
 * Se aplica a TODA fila válida que traiga valor unitario, exista ya el producto o se acabe de
 * crear (en cuyo caso el costo va de 0 al del archivo, y ese registro es precisamente la
 * procedencia del costo de ese producto). Sin excepciones por tipo de fila: un caso especial
 * "solo si ya existía" abriría la puerta a productos con costo sin historial.
 *
 * Interacción con el paso 4, deliberada: en una fila con `cantidadInicial > 0`, el costo ya
 * quedó aplicado en el paso 3, así que cuando el `Ingreso` sintético se recibe y vuelve a
 * escribir `ultimo_costo` con ese MISMO precio, la regla de FR-074 se cumple sola y no se
 * duplica el registro. La entrada del historial queda con `origen: IMPORTACION`, que es la
 * verdad: ese precio lo cambió el archivo.
 *
 * Un cambio de costo NUNCA toca el stock ni escribe movimientos de inventario (FR-073) — el
 * único stock que mueve esta carga es el del paso 4, con su `Ingreso` real.
 *
 * Implementa: FR-048…FR-051, FR-071/FR-072/FR-074.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { ErrorDominio, ErrorValidacionDominio } from '../../dominio/comunes/errores';
import { REPOSITORIO_INGRESOS, type LineaNuevoIngreso, type RepositorioIngresos } from '../../dominio/puertos/repositorio-ingresos';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import {
  LECTOR_IMPORTACION_PRODUCTOS,
  type FilaValidaImportacionProducto,
  type LectorImportacionProductos,
} from './puertos/lector-importacion-productos';

/** Proveedor sintético del `Ingreso` que agrupa el stock inicial de una carga masiva (research R15). */
const PROVEEDOR_CARGA_MASIVA = 'Carga masiva de inventario';

/** Máximo de filas de datos por archivo (spec.md § Assumptions) — validado DESPUÉS de leer el
 *  archivo (ya se conoce el total sin volver a parsear) pero ANTES de procesar cualquier fila. */
const LIMITE_FILAS_IMPORTACION = 2000;

/** Entrada: el archivo tal cual llega del `multipart/form-data` + auditoría (FR-045). */
export interface ImportarProductosEntrada {
  readonly archivo: Buffer;
  /** Quién sube el archivo — auditoría del alta/actualización de catálogo y del ingreso sintético. */
  readonly usuarioId: number;
}

/** Fila con error del resumen — mismo shape que expone el contrato (`fila`/`mensaje`). */
export interface ErrorFilaImportacion {
  readonly fila: number;
  readonly mensaje: string;
}

/** Forma EXACTA de `ResumenImportacion` (contracts/api-rest.md § Carga masiva de inventario). */
export interface ResumenImportacion {
  readonly creados: number;
  readonly actualizados: number;
  readonly conStockInicial: number;
  /** Filas cuyo "Valor unitario" cambió REALMENTE el costo del producto (US12, FR-074). */
  readonly costosActualizados: number;
  readonly errores: ErrorFilaImportacion[];
}

/** Fila que superó el paso de catálogo y trae `cantidadInicial > 0` — lista para convertirse
 *  en línea del `Ingreso` sintético. */
interface FilaConStockPendiente {
  readonly productoId: number;
  readonly cantidad: number;
  readonly precioUnitario: number;
}

@Injectable()
export class ImportarProductosCasoUso implements CasoDeUso<ImportarProductosEntrada, ResumenImportacion> {
  constructor(
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos,
    @Inject(LECTOR_IMPORTACION_PRODUCTOS) private readonly lectorImportacion: LectorImportacionProductos,
  ) {}

  async ejecutar(entrada: ImportarProductosEntrada): Promise<ResumenImportacion> {
    const { filasValidas, erroresIniciales } = await this.lectorImportacion.leer(entrada.archivo);
    verificarLimiteDeFilas(filasValidas.length + erroresIniciales.length);

    const errores: ErrorFilaImportacion[] = [...erroresIniciales];
    const filasConStockPendiente: FilaConStockPendiente[] = [];
    let creados = 0;
    let actualizados = 0;
    let costosActualizados = 0;

    for (const fila of filasValidas) {
      const resultado = await this.procesarCatalogo(fila, entrada.usuarioId);
      if (!resultado.exito) {
        errores.push({ fila: fila.numeroFila, mensaje: resultado.mensaje });
        continue;
      }
      if (resultado.creado) {
        creados++;
      } else {
        actualizados++;
      }
      if (resultado.costoCambio) {
        costosActualizados++;
      }

      if (tieneStockInicial(fila.datos)) {
        filasConStockPendiente.push({
          productoId: resultado.productoId,
          cantidad: fila.datos.cantidadInicial,
          precioUnitario: fila.datos.valorUnitario,
        });
      }
    }

    if (filasConStockPendiente.length > 0) {
      await this.registrarStockInicial(filasConStockPendiente, entrada.usuarioId);
    }

    return {
      creados,
      actualizados,
      conStockInicial: filasConStockPendiente.length,
      costosActualizados,
      errores,
    };
  }

  /**
   * Crea o actualiza el PRODUCTO de una fila (FR-049) y aplica su costo si la fila lo trae
   * (US12) — no toca stock. Captura cualquier error de dominio ocurrido al procesar ESTA fila
   * para no detener el resto del archivo (FR-051); un error inesperado (no de dominio) se
   * reporta con un mensaje genérico, sin filtrar detalles internos al usuario (mismo criterio
   * que `FiltroErroresDominio`).
   *
   * `costoCambio` refleja lo que `actualizarCosto` REALMENTE hizo (FR-074): es `false` cuando
   * la fila no traía valor unitario o cuando el que traía coincidía con el vigente — el caso de
   * uso no vuelve a comparar nada por su cuenta, la regla es del dominio.
   */
  private async procesarCatalogo(
    fila: FilaValidaImportacionProducto,
    usuarioId: number,
  ): Promise<
    { exito: true; creado: boolean; productoId: number; costoCambio: boolean } | { exito: false; mensaje: string }
  > {
    try {
      const existente = await this.repositorioProductos.buscarPorSku(fila.datos.sku);
      const creado = !existente;
      let productoId: number;

      if (existente) {
        await this.repositorioProductos.actualizar(existente.id, {
          descripcion: fila.datos.descripcion,
          categoria: fila.datos.categoria ?? null,
          ubicacion: fila.datos.ubicacion ?? null,
          umbralStockBajo: fila.datos.umbralStockBajo,
          usuarioModificacionId: usuarioId,
        });
        productoId = existente.id;
      } else {
        const producto = await this.repositorioProductos.crear({
          sku: fila.datos.sku,
          descripcion: fila.datos.descripcion,
          categoria: fila.datos.categoria ?? null,
          ubicacion: fila.datos.ubicacion ?? null,
          umbralStockBajo: fila.datos.umbralStockBajo,
          usuarioCreacionId: usuarioId,
        });
        productoId = producto.id;
      }

      const costoCambio =
        fila.datos.valorUnitario === undefined
          ? false
          : await this.repositorioProductos.actualizarCosto(productoId, fila.datos.valorUnitario, {
              usuarioId,
              origen: 'IMPORTACION',
            });

      return { exito: true, creado, productoId, costoCambio };
    } catch (error) {
      return { exito: false, mensaje: mensajeDeErrorDeFila(error) };
    }
  }

  /**
   * Agrupa el stock inicial en UN `Ingreso` sintético y lo recibe — mismo flujo atómico
   * (`FOR UPDATE`, movimientos `ENTRADA`) que un ingreso manual (FR-050, research R15). No
   * captura errores: un fallo aquí afecta a todo el lote, no a una fila puntual (ver TSDoc de
   * cabecera).
   */
  private async registrarStockInicial(filas: readonly FilaConStockPendiente[], usuarioId: number): Promise<void> {
    const lineas: LineaNuevoIngreso[] = filas.map((fila) => ({
      productoId: fila.productoId,
      cantidad: fila.cantidad,
      precioUnitario: fila.precioUnitario,
    }));

    const ahora = new Date();
    const ingreso = await this.repositorioIngresos.crear({
      numeroFactura: numeroFacturaSintetico(),
      fechaFactura: ahora,
      proveedor: PROVEEDOR_CARGA_MASIVA,
      fechaRecepcion: ahora,
      observaciones: 'Ingreso generado automáticamente por carga masiva de inventario (US8).',
      lineas,
      usuarioId,
    });
    await this.repositorioIngresos.recibir(ingreso.id, usuarioId);
  }
}

/**
 * `true` si la fila trae `cantidadInicial > 0` — con el tipo ya angostado a `valorUnitario:
 * number` (nunca `undefined`) porque `esquemaFilaImportacionProducto.superRefine` (T092)
 * garantiza esa invariante para toda fila que llegó a `filasValidas`.
 */
function tieneStockInicial(
  datos: FilaValidaImportacionProducto['datos'],
): datos is FilaValidaImportacionProducto['datos'] & { cantidadInicial: number; valorUnitario: number } {
  return typeof datos.cantidadInicial === 'number' && datos.cantidadInicial > 0;
}

/** Límite de filas de datos por archivo (spec.md § Assumptions, US8-AS5: rechazo total, sin
 *  tocar ningún producto). */
function verificarLimiteDeFilas(totalFilas: number): void {
  if (totalFilas > LIMITE_FILAS_IMPORTACION) {
    throw new ErrorValidacionDominio(
      `El archivo tiene ${totalFilas} filas de datos; el máximo permitido por carga es ${LIMITE_FILAS_IMPORTACION}.`,
    );
  }
}

/** `numeroFactura` único del `Ingreso` sintético: timestamp + sufijo aleatorio corto — el
 *  sufijo evita una colisión de `UNIQUE(numero_factura)` si dos cargas se procesan dentro del
 *  mismo milisegundo (ej. pruebas de integración consecutivas). */
function numeroFacturaSintetico(): string {
  const sufijo = Math.random().toString(36).slice(2, 8);
  return `IMPORTACION-${Date.now()}-${sufijo}`;
}

/** Mensaje en español de un error atrapado al procesar UNA fila del catálogo — solo los
 *  errores de dominio (`dominio/comunes/errores.ts`) traen mensaje seguro para mostrar al
 *  usuario; cualquier otro se reporta genérico (mismo criterio que `FiltroErroresDominio`). */
function mensajeDeErrorDeFila(error: unknown): string {
  return error instanceof ErrorDominio ? error.message : 'No se pudo procesar la fila por un error inesperado.';
}
