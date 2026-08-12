/**
 * Adaptador de conexión a PostgreSQL vía Prisma.
 *
 * ÚNICO punto del backend donde vive el ciclo de vida de la conexión a la base de datos.
 * Regla de dependencia (Principio VI): Prisma SOLO puede importarse dentro de
 * `infraestructura/persistencia` — el dominio y la aplicación hablan con la BD únicamente
 * a través de puertos (interfaces) implementados por los repositorios de esta carpeta.
 *
 * Aquí también vivirá la `UnidadDeTrabajo` (tarea T010): el helper que ejecuta los casos
 * de uso críticos de stock dentro de `prisma.$transaction` con bloqueo de fila
 * `SELECT ... FOR UPDATE` ordenado por id (research R4) — la pieza que garantiza que el
 * stock NUNCA quede negativo bajo concurrencia (Principio I, FR-028).
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
