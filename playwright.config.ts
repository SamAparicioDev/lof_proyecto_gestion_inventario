/**
 * Configuración de Playwright (T005) — flujo E2E completo del MVP (T066).
 *
 * `webServer` dual: levanta backend (NestJS) y frontend (Next.js) como procesos DEDICADOS
 * a esta suite, cada uno con su propio comando y su propio healthcheck.
 *
 * Puertos NO estándar a propósito (4100/3100 en vez de los 4000/3000 de desarrollo,
 * `CLAUDE.md` raíz): el entorno de Samuel corre backend+frontend de desarrollo de forma
 * persistente contra "trazo" (datos reales de tandas anteriores). Si esta suite reutilizara
 * los puertos 4000/3000 con `reuseExistingServer: true` (el valor por defecto fuera de CI),
 * Playwright se conectaría EN SILENCIO a esos procesos de desarrollo — apuntando a la base
 * de datos equivocada — en vez de arrancar sus propias instancias contra "trazo_e2e". Usar
 * puertos dedicados hace esa confusión estructuralmente imposible: como nada más escucha ahí,
 * ambos `webServer` siempre son instancias frescas de esta suite. Por el mismo motivo,
 * `reuseExistingServer` se fija en `false` siempre (ni siquiera en local): un E2E que
 * reutiliza un servidor de una corrida anterior podría estar sirviendo con el `DATABASE_URL`
 * de esa corrida (aunque en la práctica sea el mismo valor, no vale la pena el riesgo).
 *
 * `globalSetup` dejar "trazo_e2e" limpia (reset + seed) ANTES de que corran las pruebas —
 * ver el TSDoc de `tests/e2e/global-setup.ts` para la nota de orden webServer/globalSetup de
 * esta versión de Playwright y por qué es segura.
 *
 * `workers: 1` / `fullyParallel: false`: todos los specs de esta suite comparten la MISMA
 * base de datos ("trazo_e2e") y mutan estado real (crean ingresos/salidas/clientes) — nada de
 * paralelismo entre archivos o tests, para no interferirse entre sí (Principio I: el stock
 * y los correlativos deben quedar en un estado predecible para las aserciones).
 */
import { defineConfig, devices } from '@playwright/test';
import { RAIZ_REPO, leerVariablesE2E } from './tests/e2e/entorno-e2e';

const variables = leerVariablesE2E();

/** Puertos dedicados de la suite E2E — ver TSDoc de cabecera. */
const PUERTO_BACKEND_E2E = 4100;
const PUERTO_FRONTEND_E2E = 3100;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './tests/e2e/global-setup.ts',

  use: {
    baseURL: `http://localhost:${PUERTO_FRONTEND_E2E}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // Backend NestJS — DATABASE_URL/PORT inyectados SOLO para este subproceso (nunca
      // globalmente, misma regla que global-setup.ts).
      command: 'npm run start:dev -w backend',
      cwd: RAIZ_REPO,
      url: `http://localhost:${PUERTO_BACKEND_E2E}/api/salud`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: variables.databaseUrlE2E,
        PORT: String(PUERTO_BACKEND_E2E),
        JWT_SECRET: variables.jwtSecret,
      },
    },
    {
      // Frontend Next.js — apunta su proxy /api/* (next.config.ts) al backend E2E de arriba.
      command: 'npm run dev -w frontend',
      cwd: RAIZ_REPO,
      url: `http://localhost:${PUERTO_FRONTEND_E2E}`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PORT: String(PUERTO_FRONTEND_E2E),
        BACKEND_URL: `http://localhost:${PUERTO_BACKEND_E2E}`,
      },
    },
  ],
});
