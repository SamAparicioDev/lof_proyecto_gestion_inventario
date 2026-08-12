/**
 * Errores de dominio de Trazo — la ÚNICA forma de señalar fallos de reglas de negocio.
 *
 * Por qué existen (docs/arquitectura.md — clean code): las reglas de negocio no lanzan
 * strings ni códigos sueltos; lanzan errores TIPADOS con los datos necesarios para que la
 * capa HTTP construya el mensaje en español del contrato ({ error: { mensaje, campos } }).
 * El dominio NO conoce HTTP: la traducción a códigos 400/404/409 la hace
 * interfaces/http/comunes/filtro-errores-dominio.ts.
 *
 * Mapa error → HTTP (contracts/api-rest.md):
 *   ErrorValidacionDominio → 400 · NoEncontrado → 404 · Duplicado → 400 (error de campo)
 *   EstadoInvalido → 409 · DisponibilidadInsuficiente → 409 (FR-028)
 */

/** Base de todos los errores de negocio. `mensaje` SIEMPRE en español (FR-047). */
export abstract class ErrorDominio extends Error {
  protected constructor(mensaje: string) {
    super(mensaje);
    this.name = new.target.name;
  }
}

/** Regla de negocio de datos violada fuera de un esquema Zod (p. ej. líneas vacías). */
export class ErrorValidacionDominio extends ErrorDominio {
  constructor(
    mensaje: string,
    /** Errores por campo para pintarlos junto al formulario, si aplica. */
    readonly campos: Record<string, string> | null = null,
  ) {
    super(mensaje);
  }
}

/** El recurso solicitado no existe (o está fuera del alcance del usuario). */
export class NoEncontrado extends ErrorDominio {
  constructor(recurso: string) {
    super(`${recurso} no existe`);
  }
}

/**
 * Violación de unicidad (número de factura, SKU, NIT, login, email…).
 * Los adaptadores de persistencia traducen el error UNIQUE de PostgreSQL a esta clase,
 * indicando el campo, para que el formulario marque exactamente dónde está el problema
 * (FR-009/FR-015/FR-035, research R5).
 */
export class Duplicado extends ErrorDominio {
  constructor(
    readonly campo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/** Transición de estado no permitida (máquinas de estado de data-model.md). */
export class EstadoInvalido extends ErrorDominio {
  constructor(mensaje: string) {
    super(mensaje);
  }
}

/**
 * Intento de comprometer o descontar más stock del disponible — el invariante crítico
 * del sistema (Principio I, FR-028). Lleva el detalle por producto para que el mensaje
 * muestre el disponible REAL en el momento del rechazo (US3-AS2).
 */
export class DisponibilidadInsuficiente extends ErrorDominio {
  constructor(
    readonly detalles: ReadonlyArray<{
      productoId: number;
      descripcion: string;
      solicitado: number;
      disponible: number;
    }>,
  ) {
    super(
      detalles
        .map(
          (d) =>
            `Disponibilidad insuficiente de "${d.descripcion}": solicitado ${d.solicitado}, disponible ${d.disponible}`,
        )
        .join('. '),
    );
  }
}
