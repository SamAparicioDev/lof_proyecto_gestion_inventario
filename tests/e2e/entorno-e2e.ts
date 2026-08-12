/**
 * Carga y valida las variables de entorno del entorno E2E (T005/T066).
 *
 * MISMO problema que el incidente documentado en `backend/test/integracion/jest.setup.ts`:
 * nada carga `backend/.env` automáticamente en un script standalone de Node/Playwright —
 * `ConfigModule.forRoot()` (NestJS) solo lo lee DENTRO del proceso del backend, cuando ya es
 * tarde para decidir con qué base de datos arrancarlo. Este módulo lo parsea EXPLÍCITAMENTE
 * (con `dotenv.parse`, no `dotenv.config` — no mutamos `process.env` de quien lo importe; la
 * única mutación intencional de `process.env` de toda la suite vive en `global-setup.ts`,
 * documentada ahí) y aplica las MISMAS guardas duras que ese archivo antes de dejar que
 * cualquier comando toque una base de datos: `DATABASE_URL_E2E` DEBE existir y DEBE ser
 * distinta tanto de `DATABASE_URL` (desarrollo — "trazo", con datos reales de tandas
 * anteriores) como de `DATABASE_URL_TEST` (integración — "trazo_test"). Si algo no cuadra,
 * aborta con un mensaje claro en vez de arriesgar un `prisma migrate reset` (DESTRUCTIVO)
 * contra la base equivocada (Principios I/II de la constitución).
 *
 * Reutilizado por:
 *  - `playwright.config.ts`: para inyectar `DATABASE_URL`/`PORT` en el `env` del `webServer`
 *    del backend (SOLO en el `env` de ESE proceso, nunca globalmente).
 *  - `global-setup.ts`: para ejecutar `prisma migrate reset` + `seed:demo` contra
 *    `DATABASE_URL_E2E` antes de que corra cualquier prueba.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parsearEnv } from 'dotenv';

/** Raíz del monorepo — todos los comandos de la suite E2E (`npm run ... -w backend/frontend`) se ejecutan desde aquí. */
export const RAIZ_REPO = resolve(__dirname, '../..');

const RUTA_ENV_BACKEND = resolve(RAIZ_REPO, 'backend/.env');

export interface VariablesE2E {
  /** URL de la base de datos EXCLUSIVA de la suite E2E ("trazo_e2e") — nunca "trazo"/"trazo_test". */
  databaseUrlE2E: string;
  seedAdminLogin: string;
  seedAdminPassword: string;
  seedDemoPassword: string;
  jwtSecret: string;
  puertoBackend: number;
}

/** Lee `backend/.env` como texto y lo parsea SIN mutar `process.env` (ver TSDoc de cabecera). */
function leerEnvBackend(): Record<string, string> {
  let contenido: string;
  try {
    contenido = readFileSync(RUTA_ENV_BACKEND, 'utf-8');
  } catch {
    throw new Error(
      `[E2E] No se pudo leer ${RUTA_ENV_BACKEND} — copia backend/.env.example a backend/.env ` +
        'antes de correr las pruebas E2E (necesita DATABASE_URL_E2E, ver ese archivo).',
    );
  }
  return parsearEnv(contenido);
}

/**
 * Guardas duras (T066) — mismo patrón que `backend/test/integracion/jest.setup.ts`: aborta si
 * `DATABASE_URL_E2E` falta o coincide con `DATABASE_URL`/`DATABASE_URL_TEST`. NUNCA relajar
 * esta función: es la única barrera antes de un `prisma migrate reset --force` (DESTRUYE Y
 * RECREA la base de datos por completo) contra la base equivocada.
 */
export function leerVariablesE2E(): VariablesE2E {
  const env = leerEnvBackend();
  const { DATABASE_URL_E2E, DATABASE_URL, DATABASE_URL_TEST } = env;

  if (!DATABASE_URL_E2E) {
    throw new Error(
      '[E2E] DATABASE_URL_E2E no está definida en backend/.env — abortando para no arriesgar ' +
        'un "prisma migrate reset" contra la base de datos equivocada.',
    );
  }
  if (DATABASE_URL_E2E === DATABASE_URL) {
    throw new Error(
      '[E2E] DATABASE_URL_E2E es IDÉNTICA a DATABASE_URL (desarrollo, "trazo" con datos ' +
        'reales de tandas anteriores) en backend/.env — deben ser bases de datos distintas. ' +
        'Abortando por seguridad.',
    );
  }
  if (DATABASE_URL_E2E === DATABASE_URL_TEST) {
    throw new Error(
      '[E2E] DATABASE_URL_E2E es IDÉNTICA a DATABASE_URL_TEST (integración, "trazo_test") en ' +
        'backend/.env — deben ser bases de datos distintas. Abortando por seguridad.',
    );
  }
  if (!env.SEED_ADMIN_LOGIN || !env.SEED_ADMIN_PASSWORD) {
    throw new Error('[E2E] SEED_ADMIN_LOGIN/SEED_ADMIN_PASSWORD no están definidas en backend/.env.');
  }
  if (!env.SEED_DEMO_PASSWORD) {
    throw new Error('[E2E] SEED_DEMO_PASSWORD no está definida en backend/.env (obligatoria para --demo).');
  }
  if (!env.JWT_SECRET) {
    throw new Error('[E2E] JWT_SECRET no está definida en backend/.env.');
  }

  return {
    databaseUrlE2E: DATABASE_URL_E2E,
    seedAdminLogin: env.SEED_ADMIN_LOGIN,
    seedAdminPassword: env.SEED_ADMIN_PASSWORD,
    seedDemoPassword: env.SEED_DEMO_PASSWORD,
    jwtSecret: env.JWT_SECRET,
    puertoBackend: Number(env.PORT ?? 4000),
  };
}
