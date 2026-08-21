/**
 * Caso de uso `AnularIngresoCasoUso` — transición `PENDIENTE|RECIBIDO → ANULADO`
 * (`POST /api/ingresos/:id/anular`, solo Gerente/Administrador, motivo obligatorio).
 * `VERIFICADO` (terminal) y `ANULADO` (ya anulado) nunca son anulables — se reutiliza
 * `transicionValidaIngreso` (dominio, `entidades/ingreso.ts`) para esa regla en vez de
 * repetir la lista de estados válidos en esta capa.
 *
 * El motivo se valida aquí (no en el pipe HTTP, ver `contracts/api-rest.md § Ingresos`: el
 * body `{motivo}` no tiene un esquema Zod nombrado, a diferencia de crear/actualizar) con
 * `ErrorValidacionDominio` — mismo criterio que el resto de reglas de forma que no dependen
 * de un esquema compartido.
 *
 * Si el ingreso estaba `RECIBIDO`, `RepositorioIngresosPrisma.anular` revierte el stock
 * atómicamente (`ServicioStock.aplicarReversaEntrada`) ANTES de marcar `ANULADO`; si el
 * disponible no alcanza para revertir, propaga `DisponibilidadInsuficiente` sin que esta
 * capa la capture (Principio I — el rollback es responsabilidad de la transacción).
 *
 * Implementa: FR-019 (anulación con motivo, con o sin reversa de stock según el origen).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { ErrorValidacionDominio, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import { transicionValidaIngreso } from '../../dominio/entidades/ingreso';
import { REPOSITORIO_INGRESOS, type RepositorioIngresos } from '../../dominio/puertos/repositorio-ingresos';
import { AvisadorDeNotificaciones } from '../notificaciones/avisador-notificaciones';

/** Entrada: `usuarioId` viene del token de sesión, nunca del body (FR-045). */
export interface AnularIngresoEntrada {
  readonly ingresoId: number;
  readonly usuarioId: number;
  readonly motivo: string;
}

@Injectable()
export class AnularIngresoCasoUso implements CasoDeUso<AnularIngresoEntrada, void> {
  constructor(
    @Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos,
    private readonly avisador: AvisadorDeNotificaciones,
  ) {}

  async ejecutar(entrada: AnularIngresoEntrada): Promise<void> {
    const motivo = entrada.motivo.trim();
    if (!motivo) {
      throw new ErrorValidacionDominio('El motivo de anulación es obligatorio', {
        motivo: 'El motivo de anulación es obligatorio',
      });
    }

    const ingreso = await this.repositorioIngresos.buscarPorId(entrada.ingresoId);
    if (!ingreso) {
      throw new NoEncontrado('El ingreso');
    }
    if (!transicionValidaIngreso(ingreso.estado, 'ANULADO')) {
      throw new EstadoInvalido(`Un ingreso ${ingreso.estado} no puede anularse`);
    }

    await this.repositorioIngresos.anular(entrada.ingresoId, entrada.usuarioId, motivo);

    // US35 (FR-139/FR-145): anular avisa siempre; además, si el ingreso ya estaba RECIBIDO,
    // la reversa BAJA el stock — y esa bajada puede cruzar el umbral, igual que una salida.
    // Un ingreso PENDIENTE no había tocado nada, así que ahí no hay umbral que revisar.
    await this.avisador.ingresoAnulado(entrada.ingresoId, entrada.usuarioId, motivo);
    if (ingreso.estado !== 'PENDIENTE') {
      await this.avisador.revisarUmbrales(
        ingreso.detalles.map((linea) => ({ productoId: linea.productoId, cantidad: linea.cantidad })),
        entrada.usuarioId,
      );
    }
  }
}
