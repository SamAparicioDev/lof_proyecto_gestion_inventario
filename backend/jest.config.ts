/**
 * Configuración de Jest del backend, dividida en dos proyectos (research R10):
 *
 * - `unit`        → pruebas de dominio y aplicación PURAS (sin BD, sin NestJS levantado).
 *                   Son posibles gracias a la arquitectura hexagonal: los casos de uso
 *                   reciben puertos falsos en memoria.
 * - `integracion` → API completa contra PostgreSQL REAL (DATABASE_URL_TEST), porque la
 *                   semántica de FOR UPDATE, CHECKs y triggers SOLO se valida contra la
 *                   base real (invariantes críticos de data-model.md).
 *
 * Scripts: `npm run test` (unit) | `npm run test:integracion` (secuencial, --runInBand,
 * porque las suites comparten la BD de prueba). T004 de tasks.md afina esta configuración.
 */
import type { Config } from 'jest';

const comun: Partial<Config> = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
};

const config: Config = {
  projects: [
    {
      ...comun,
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
    },
    {
      ...comun,
      displayName: 'integracion',
      testMatch: ['<rootDir>/test/integracion/**/*.spec.ts'],
      // setup de BD de prueba (migraciones + truncado) — se completa en T004/T019
      setupFilesAfterEnv: ['<rootDir>/test/integracion/jest.setup.ts'],
    },
  ],
};

export default config;
