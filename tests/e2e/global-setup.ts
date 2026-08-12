/**
 * Global setup de Playwright (T066) — corre UNA vez antes de toda la corrida E2E, antes de
 * que se ejecute cualquier `test()`.
 *
 * Qué hace y por qué (ver también la nota de seguridad completa en `entorno-e2e.ts` y en
 * `specs/001-gestion-inventarios/tasks.md`, tarea T066): deja "trazo_e2e" en un estado
 * limpio y conocido para que `flujo-nucleo.spec.ts` pueda verificar el flujo completo del
 * MVP contra datos reales, sin arrastrar basura de corridas anteriores ni —el punto NO
 * NEGOCIABLE— tocar jamás "trazo" (desarrollo, con datos reales de tandas anteriores) ni
 * "trazo_test" (integración).
 *
 * 1. `leerVariablesE2E()` ya carga y valida `backend/.env` con las MISMAS guardas duras que
 *    `backend/test/integracion/jest.setup.ts` (DATABASE_URL_E2E debe existir y ser distinta
 *    de DATABASE_URL/DATABASE_URL_TEST) — si algo no cuadra, esa función lanza y Playwright
 *    aborta la corrida ANTES de ejecutar un solo comando.
 * 2. `migrate:reset:e2e` (`prisma migrate reset --force --skip-seed`) recrea el esquema
 *    completo de "trazo_e2e" desde las migraciones existentes (`backend/prisma/migrations`)
 *    — DESTRUCTIVO a propósito: es la base de datos EXCLUSIVA de esta suite.
 * 3. `seed:demo` puebla admin/`gerente.demo`/`operario.demo` (los mismos tres roles semilla
 *    que usa el resto del sistema) para que el spec pueda iniciar sesión con ellos.
 *
 * `DATABASE_URL` se inyecta SOLO en el `env` de cada subproceso (`execSync`) — NUNCA se
 * asigna a `process.env.DATABASE_URL` de este script ni del runner de Playwright, tal como
 * exige T066 ("nunca la cambies globalmente de forma que pudiera afectar otra cosa"). El
 * `webServer` del backend (`playwright.config.ts`) recibe su propia copia de esta misma
 * variable, de forma independiente, por el mismo mecanismo.
 *
 * Nota de orden (Playwright 1.62): los procesos de `webServer` arrancan ANTES que este
 * `globalSetup` (verificado en `node_modules/playwright/lib/runner/index.js`:
 * `createGlobalSetupTasks` ejecuta `createPluginSetupTasks` —que incluye el plugin de
 * `webServer`— antes que `config.globalSetups`). Esto es seguro aquí porque (a)
 * `GET /api/salud` —el healthcheck del `webServer` del backend— NO consulta la base de
 * datos (`backend/src/interfaces/http/salud/controlador-salud.ts`) y (b)
 * `PrismaService.onModuleInit` solo abre la conexión (`$connect()`), sin ejecutar consultas;
 * ninguna consulta real llega a la base de datos hasta que las pruebas empiezan a interactuar
 * con la UI, y eso ocurre siempre DESPUÉS de que este `globalSetup` termine. Si en el futuro
 * el backend agrega una consulta a la BD en su arranque o en `/api/salud`, este orden dejaría
 * de ser seguro y habría que mover el reset+seed a un script previo al propio comando del
 * `webServer`.
 *
 * `SEED_DEMO_PASSWORD`/`SEED_ADMIN_LOGIN`/`SEED_ADMIN_PASSWORD` SÍ se exponen en
 * `process.env` de ESTE proceso a propósito: Playwright ejecuta los workers de prueba como
 * hijos del proceso que corre `globalSetup` (y los heredan), así que mutar aquí es el
 * mecanismo oficialmente documentado por Playwright para pasarle credenciales a
 * `flujo-nucleo.spec.ts` sin hardcodearlas ni leer `backend/.env` una segunda vez desde el
 * spec — mismo patrón que ya usaba `tests/e2e/auth.spec.ts` (T027), que hasta ahora dependía
 * de que alguien las exportara a mano en la terminal.
 */
import { execSync } from 'node:child_process';
import { RAIZ_REPO, leerVariablesE2E } from './entorno-e2e';

/** Corre un script de `backend/package.json` con `DATABASE_URL` apuntando a "trazo_e2e" — SOLO para este subproceso. */
function ejecutarScriptBackend(script: string, databaseUrlE2E: string): void {
  execSync(`npm run ${script} -w backend`, {
    cwd: RAIZ_REPO,
    env: { ...process.env, DATABASE_URL: databaseUrlE2E },
    stdio: 'inherit',
  });
}

export default async function globalSetupE2E(): Promise<void> {
  const variables = leerVariablesE2E();

  console.log('[E2E] Reiniciando "trazo_e2e" (prisma migrate reset --force --skip-seed)…');
  ejecutarScriptBackend('migrate:reset:e2e', variables.databaseUrlE2E);

  console.log('[E2E] Sembrando usuarios semilla (admin/gerente.demo/operario.demo)…');
  ejecutarScriptBackend('seed:demo', variables.databaseUrlE2E);

  // Ver TSDoc de cabecera: exposición intencional para que flujo-nucleo.spec.ts (y cualquier
  // otro spec) pueda iniciar sesión con los usuarios semilla sin leer backend/.env de nuevo.
  process.env.SEED_DEMO_PASSWORD = variables.seedDemoPassword;
  process.env.SEED_ADMIN_LOGIN = variables.seedAdminLogin;
  process.env.SEED_ADMIN_PASSWORD = variables.seedAdminPassword;

  console.log('[E2E] Base de datos "trazo_e2e" lista.');
}
