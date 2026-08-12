/**
 * Puerto `Contadores` — correlativos únicos y consecutivos vistos desde el dominio (patrón
 * Repository de un solo método, docs/arquitectura.md §3/§4 "I" de SOLID: interfaz pequeña y
 * específica). Implementado por `infraestructura/persistencia/contadores.prisma.ts`.
 *
 * Por qué existe (research R5): el número de una salida (FR-026) no puede asignarse con
 * `MAX(numero)+1` (carrera clásica bajo concurrencia) ni con una secuencia de PostgreSQL
 * (deja huecos si la transacción que la usó revierte). La tabla técnica `contadores`
 * (data-model.md) resuelve esto con `UPDATE contadores SET valor = valor + 1 WHERE clave =
 * $1 RETURNING valor`, que es atómico por sí mismo Y debe ejecutarse DENTRO de la MISMA
 * transacción que crea el documento — si la creación falla, el `UPDATE` del contador se
 * revierte junto con ella y el número no se "pierde" (no queda un hueco visible).
 *
 * Implementa: FR-026 (número de salida correlativo, sin duplicados bajo concurrencia).
 */
export interface Contadores {
  /**
   * Devuelve el siguiente número para `clave` (p. ej. `'salida'`), incrementando el
   * contador atómicamente. Sin argumento de transacción en la firma del PUERTO (el dominio
   * no conoce Prisma) — el adaptador decide cómo integrarse con la transacción activa del
   * llamador (ver TSDoc de `contadores.prisma.ts`).
   */
  siguienteNumero(clave: string): Promise<number>;
}

/** Token de inyección de NestJS para el puerto `Contadores`. */
export const CONTADORES = 'Contadores';

/** Clave del correlativo de salidas en la tabla `contadores` (research R5, FR-026). */
export const CLAVE_CONTADOR_SALIDA = 'salida';
