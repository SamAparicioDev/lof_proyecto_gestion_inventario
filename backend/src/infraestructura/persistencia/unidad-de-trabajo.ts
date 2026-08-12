/**
 * Unidad de Trabajo — helper tipado sobre `prisma.$transaction` (patrón Unit of Work,
 * docs/arquitectura.md §3).
 *
 * Por qué existe (Principio I, FR-028, research R4): TODA mutación de `stock_actual` debe
 * ocurrir dentro de una transacción que además bloquea las filas de producto involucradas
 * con `SELECT ... FOR UPDATE ORDER BY id` (orden fijo por id, para evitar deadlocks bajo
 * concurrencia) antes de revalidar disponibilidad y escribir el/los `movimientos_inventario`
 * correspondientes. Esta clase NO implementa esa lógica de stock — eso vive en
 * `ServicioStock` (dominio, tareas US1/US3) y en los repositorios de infraestructura que se
 * apoyan en `ejecutar()`. Aquí solo se define el MECANISMO genérico de transacción que esos
 * casos de uso reutilizarán, para no repetir `prisma.$transaction` suelto en cada adaptador
 * (tarea T010 — el mecanismo; la lógica de stock es tarea de US1/US3, fuera de este alcance).
 *
 * Uso previsto por los repositorios de US1/US3 (ejemplo ilustrativo):
 *   await unidadDeTrabajo.ejecutar(async (tx) => {
 *     const productos = await tx.$queryRaw`
 *       SELECT id, stock_actual FROM productos WHERE id IN (...) ORDER BY id FOR UPDATE`;
 *     // revalidar disponibilidad con los valores bloqueados, UPDATE stock_actual,
 *     // INSERT movimientos_inventario — todo dentro de la MISMA transacción (tx).
 *   });
 *
 * Si `fn` lanza (incluidos errores de dominio tipados como `DisponibilidadInsuficiente`),
 * Prisma revierte automáticamente todo lo escrito en `tx` — ninguna escritura parcial de
 * stock o movimientos queda persistida (Principio I: el stock nunca queda inconsistente).
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * Cliente Prisma acotado al contexto de una transacción activa (no expone `$transaction`
 * anidado ni el ciclo de vida de conexión — solo las operaciones de modelos y `$queryRaw`/
 * `$executeRaw` necesarias para el `SELECT ... FOR UPDATE` de research R4).
 */
export type PrismaTransactionClient = Prisma.TransactionClient;

@Injectable()
export class UnidadDeTrabajo {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ejecuta `fn` dentro de una transacción de Prisma y devuelve su resultado.
   * Puerto de infraestructura consumido por los repositorios/casos de uso que necesitan
   * atomicidad (research R4) — no contiene reglas de negocio, solo el mecanismo.
   */
  async ejecutar<T>(fn: (tx: PrismaTransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(tx));
  }
}
