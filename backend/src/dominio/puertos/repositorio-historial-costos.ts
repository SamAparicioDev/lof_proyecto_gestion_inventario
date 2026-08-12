/**
 * Puerto `RepositorioHistorialCostos` — lectura del historial INMUTABLE de cambios de costo
 * de un producto (US12, T124). Implementado por
 * `infraestructura/persistencia/repositorio-historial-costos.prisma.ts`.
 *
 * SOLO LECTURA a propósito — mismo criterio (y mismo motivo) que `RepositorioMovimientos`:
 * `historial_costos_producto` solo admite INSERT (trigger de BD, Principio II) y esos INSERT
 * NO pueden vivir aquí, porque deben ocurrir DENTRO de la misma transacción que actualiza
 * `productos.ultimo_costo` (FR-072: jamás un costo cambiado sin su registro). Esa transacción
 * la abren los repositorios que son dueños de la escritura del costo:
 *
 *   - `RepositorioProductos.actualizarCosto` → edición manual y carga masiva
 *   - `RepositorioIngresos.recibir`          → recepción de mercancía
 *
 * Un método `registrar()` en este puerto sería una invitación a escribir el historial en una
 * transacción distinta de la del costo, que es exactamente el estado inconsistente que US12
 * existe para impedir. La decisión de SI registrar (y con qué valores) no está duplicada en
 * esos dos sitios: vive en el servicio de dominio puro
 * `dominio/servicios/servicio-costo-producto.ts#aplicarCambioDeCosto` (FR-074).
 *
 * Implementa: FR-072 (el historial es consultable desde la ficha del producto).
 */
import type { CambioCostoProducto } from '../entidades/cambio-costo-producto';

/** Paginación del historial de costos — sin filtro de fechas (ver `esquemaFiltroHistorialCostos`). */
export interface FiltrosHistorialCostos {
  readonly pagina: number;
  readonly porPagina: number;
}

/** Página de cambios de costo (mismo shape que `Paginado<T>` de `@trazo/compartido`, sin
 *  importarlo: el dominio no depende de ningún paquete externo — docs/arquitectura.md §2). */
export interface PaginaHistorialCostos {
  readonly datos: CambioCostoProducto[];
  readonly total: number;
}

export interface RepositorioHistorialCostos {
  /** Cambios de costo de un producto, MÁS RECIENTE PRIMERO y paginados (contracts/api-rest.md
   *  § Historial de costos del producto). */
  listarPorProducto(productoId: number, filtros: FiltrosHistorialCostos): Promise<PaginaHistorialCostos>;
}

/** Token de inyección de NestJS para el puerto `RepositorioHistorialCostos`. */
export const REPOSITORIO_HISTORIAL_COSTOS = 'RepositorioHistorialCostos';
