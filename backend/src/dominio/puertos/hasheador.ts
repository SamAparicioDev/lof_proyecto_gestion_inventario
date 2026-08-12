/**
 * Puerto `Hasheador` — abstrae el algoritmo de hash de contraseñas frente al dominio y la
 * aplicación (patrón Adapter/DIP, docs/arquitectura.md §3). El dominio jamás importa
 * `bcryptjs` directamente: `infraestructura/seguridad/adaptador-hash-bcrypt.ts` implementa
 * este puerto con el costo de trabajo concreto.
 *
 * Implementa: FR-007 (las contraseñas SIEMPRE se almacenan y comparan como hash
 * criptográfico, nunca en texto plano — Principio III, Control de Acceso por Roles).
 */
export interface Hasheador {
  /** Genera el hash de una contraseña en texto plano para almacenarla. */
  hash(password: string): Promise<string>;

  /** Compara una contraseña en texto plano contra un hash ya almacenado. */
  comparar(password: string, hash: string): Promise<boolean>;
}

/** Token de inyección de NestJS para el puerto `Hasheador` (cableado en `auth.module.ts`). */
export const HASHEADOR = 'Hasheador';
