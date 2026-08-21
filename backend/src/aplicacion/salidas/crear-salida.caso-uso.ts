/**
 * Caso de uso `CrearSalidaCasoUso` — registra una salida en estado `PENDIENTE`
 * (`POST /api/salidas`, FR-025/FR-026/FR-027). Sin efecto en `stock_actual`: una salida
 * `PENDIENTE` solo COMPROMETE disponibilidad como agregado derivado
 * (`RepositorioSalidas.comprometidoPorProducto`) — el descuento real ocurre al `confirmar`
 * (`confirmar-salida.caso-uso.ts`, FR-028/FR-029).
 *
 * Antes de crear, valida DOS reglas de negocio que el esquema Zod no puede expresar (no
 * conoce el catálogo ni el estado de proyectos/clientes en BD):
 * 1. **Destino válido** (FR-027/FR-038/FR-124) — `validar-destino-salida.ts`: el `clienteId`
 *    debe existir y estar `ACTIVO`; el `proyectoId`, si viaja, debe existir, estar `ACTIVO` y
 *    ser de ESE cliente.
 * 2. **Disponibilidad por línea** (FR-028, UX temprana) — `validar-disponibilidad-lineas.ts`:
 *    `cantidad ≤ disponible` con `disponible = stockActual − comprometido` de TODAS las
 *    salidas `PENDIENTE` (sin excluir nada — es una salida nueva, no puede tener compromiso
 *    propio todavía). Esta validación es de UX, NO la garantía dura del sistema (Principio
 *    I) — esa vive en la transacción atómica de `confirmar`.
 *
 * Implementa: FR-025 (registro con destino + líneas), FR-026 (correlativo, asignado por el
 * repositorio dentro de su propia transacción — research R5), FR-027/FR-124 (destino
 * obligatorio: el cliente; el proyecto es opcional).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../dominio/puertos/repositorio-clientes';
import { REPOSITORIO_PRODUCTOS, type RepositorioProductos } from '../../dominio/puertos/repositorio-productos';
import { REPOSITORIO_PROYECTOS, type RepositorioProyectos } from '../../dominio/puertos/repositorio-proyectos';
import { REPOSITORIO_SALIDAS, type RepositorioSalidas } from '../../dominio/puertos/repositorio-salidas';
import { AvisadorDeNotificaciones } from '../notificaciones/avisador-notificaciones';
import { validarDestinoSalida } from './validar-destino-salida';
import { validarDisponibilidadLineas } from './validar-disponibilidad-lineas';

/** Línea de salida ya validada en forma (producto, cantidad, precio unitario de referencia). */
export interface LineaCrearSalidaEntrada {
  readonly productoId: number;
  readonly cantidad: number;
  readonly precioUnitario: number;
}

/** Entrada: datos validados por `esquemaCrearSalida` + auditoría (FR-045). La fecha llega
 *  como texto ISO (`YYYY-MM-DD`) — este caso de uso la convierte a `Date`. */
export interface CrearSalidaEntrada {
  /** US28 (FR-124): destino obligatorio de la entrega. */
  readonly clienteId: number;
  /** US28 (FR-124): `null` cuando la entrega no corresponde a una obra concreta. */
  readonly proyectoId: number | null;
  readonly fechaSalida: string;
  readonly observaciones: string | null;
  readonly lineas: readonly LineaCrearSalidaEntrada[];
  /** Quién registra la salida — nunca confiar en un valor del body (FR-045). */
  readonly usuarioId: number;
}

export interface CrearSalidaSalida {
  readonly id: number;
  readonly numero: number;
}

@Injectable()
export class CrearSalidaCasoUso implements CasoDeUso<CrearSalidaEntrada, CrearSalidaSalida> {
  constructor(
    @Inject(REPOSITORIO_PROYECTOS) private readonly repositorioProyectos: RepositorioProyectos,
    @Inject(REPOSITORIO_CLIENTES) private readonly repositorioClientes: RepositorioClientes,
    @Inject(REPOSITORIO_PRODUCTOS) private readonly repositorioProductos: RepositorioProductos,
    @Inject(REPOSITORIO_SALIDAS) private readonly repositorioSalidas: RepositorioSalidas,
    private readonly avisador: AvisadorDeNotificaciones,
  ) {}

  async ejecutar(entrada: CrearSalidaEntrada): Promise<CrearSalidaSalida> {
    await validarDestinoSalida(
      this.repositorioProyectos,
      this.repositorioClientes,
      entrada.clienteId,
      entrada.proyectoId,
    );
    await validarDisponibilidadLineas(this.repositorioProductos, this.repositorioSalidas, entrada.lineas);

    const salida = await this.repositorioSalidas.crear(
      {
        clienteId: entrada.clienteId,
        proyectoId: entrada.proyectoId,
        fechaSalida: new Date(entrada.fechaSalida),
        observaciones: entrada.observaciones,
        lineas: entrada.lineas.map((linea) => ({ ...linea })),
      },
      entrada.usuarioId,
    );

    // US35 (FR-139/FR-145): la salida queda PENDIENTE, o sea esperando que alguien la apruebe, y
    // su compromiso ya bajó el disponible. Los dos avisos van DESPUÉS de que la salida existe y
    // ninguno puede tumbarla (ver `AvisadorDeNotificaciones`).
    await this.avisador.salidaPorAprobar(salida.id, entrada.usuarioId);
    await this.avisador.revisarUmbrales(
      entrada.lineas.map((linea) => ({ productoId: linea.productoId, cantidad: linea.cantidad })),
      entrada.usuarioId,
    );

    return { id: salida.id, numero: salida.numero };
  }
}
