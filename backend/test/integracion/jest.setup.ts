/**
 * Setup de las pruebas de INTEGRACIÓN del backend.
 *
 * Se ejecuta antes de cada suite de test/integracion:
 *  - Carga `backend/.env` EXPLÍCITAMENTE (ver nota de incidente abajo) y apunta Prisma a
 *    `DATABASE_URL_TEST` — JAMÁS la de desarrollo, porque las suites TRUNCAN tablas.
 *  - Aborta con un error claro si `DATABASE_URL_TEST` falta o es igual a `DATABASE_URL`.
 *
 * Por qué integración contra PostgreSQL REAL y no mocks: los invariantes críticos del
 * sistema (bloqueos FOR UPDATE, constraints UNIQUE/CHECK, trigger de inmutabilidad)
 * viven en la base de datos; probarlos contra un mock daría confianza falsa exactamente
 * donde la constitución la exige (research R10).
 *
 * INCIDENTE (2026-08-10) — por qué este archivo carga dotenv él mismo: la primera versión
 * solo leía `process.env.DATABASE_URL_TEST` asumiendo que ya estaba poblada, pero nada la
 * carga tan temprano — `ConfigModule.forRoot()` (NestJS) recién lee `.env` DENTRO del test,
 * al compilar `AppModule`, momento en el que este archivo ya terminó de ejecutarse. Con la
 * variable indefinida, el `if` nunca disparaba el override y Prisma terminaba conectando (y
 * truncando) la base de DESARROLLO. Se detectó al correr las pruebas contra Postgres real
 * por primera vez; de ahí las dos verificaciones duras de abajo, además de la comprobación
 * de `current_database()` en `truncarTablas()` (setup.ts) como segunda capa de defensa.
 */
import { config as cargarVariablesDeEntorno } from 'dotenv';
import { resolve } from 'node:path';

cargarVariablesDeEntorno({ path: resolve(__dirname, '../../.env') });

if (!process.env.DATABASE_URL_TEST) {
  throw new Error(
    'DATABASE_URL_TEST no está definida en backend/.env — abortando las pruebas de ' +
      'integración para no arriesgar un TRUNCATE contra la base de desarrollo.',
  );
}

if (process.env.DATABASE_URL_TEST === process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL_TEST es idéntica a DATABASE_URL en backend/.env — deben ser bases de ' +
      'datos distintas (p. ej. "trazo_test" vs "trazo"). Abortando por seguridad.',
  );
}

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
