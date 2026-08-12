/**
 * E2E de la matriz de acceso por rol (T079) — cierra el checkpoint de Fase 8 (US6) de
 * `specs/001-gestion-inventarios/tasks.md`: "control de acceso verificado end-to-end".
 *
 * Cubre las dos mitades que pide la tarea:
 *  1. **UI**: qué enlaces de `contracts/rutas-frontend.md` (columna "Mapa de rutas UI") ve
 *     cada rol en la navegación lateral (`frontend/src/lib/navegacion.ts`) — Panel/Ingresos/
 *     Inventario/Salidas/Clientes y proyectos son comunes a los tres roles; "Reportes" es
 *     A,G; "Usuarios" es solo A. Ocultar un enlace es solo UX (FR-003) — por eso la mitad 2
 *     es la que de verdad importa.
 *  2. **API**: que el guard del backend (`RolesGuard`, FR-002/FR-003) responde `403` para
 *     cada rol sin permiso en las rutas restringidas de `contracts/api-rest.md` (Usuarios,
 *     Reportes, mutaciones de Clientes) y NO `403` en las rutas operativas comunes a los
 *     tres roles (Inventario/Ingresos/Salidas/lectura de Clientes) — cerrando así el mismo
 *     hueco que ya cubren las pruebas de integración (`backend/test/integracion/*.spec.ts`)
 *     pero contra el proceso NestJS real levantado por `playwright.config.ts`, a través del
 *     proxy `/api/*` del frontend (next.config.ts) — el mismo camino que usa la app real,
 *     nunca el puerto del backend a pelo.
 *
 * Diseño de las pruebas de API: `page.request` comparte el almacén de cookies del
 * `BrowserContext` de `page` (documentado por Playwright) — iniciar sesión por la UI deja la
 * cookie `trazo_sesion` (httpOnly) puesta, y las llamadas subsiguientes de `page.request.*`
 * la reenvían solas, exactamente como haría `fetch(..., {credentials:'include'})` desde el
 * propio frontend (`frontend/src/lib/api/cliente.ts`). Nunca se lee ni se manipula el JWT a
 * mano.
 *
 * `RolesGuard` corre ANTES que `PipeValidacionZod` en el pipeline de Nest (Guards →
 * Interceptors → Pipes → Handler) — por eso las pruebas de rutas restringidas envían cuerpos
 * vacíos/mínimos a propósito (`data: {}`, ids fijos como `1`): si el rol no tiene permiso, el
 * guard corta la petición con `403` antes de que la validación de forma o la búsqueda del
 * recurso lleguen a ejecutarse, así que estas pruebas nunca mutan datos reales ni dependen de
 * que el id exista.
 *
 * Usuarios de prueba: en vez de reutilizar `gerente.demo`/`operario.demo` (cuya contraseña
 * `flujo-nucleo.spec.ts`, T066, cambia de forma permanente en "trazo_e2e" si esa suite llega
 * a correr completa), este archivo crea sus DOS propios usuarios GERENTE/OPERARIO desde cero
 * vía `POST /api/usuarios` (el mismo endpoint de T076) con login/email sufijados por
 * `Date.now()` — mismo criterio de unicidad por corrida que ya usa `flujo-nucleo.spec.ts`
 * para SKU/factura/NIT. Así esta suite es independiente del orden en que Playwright descubra
 * los archivos de `tests/e2e/` y de si T066 llegó a completarse en la misma corrida.
 *
 * REQUIERE lo mismo que el resto de la suite E2E (`playwright.config.ts` + `global-setup.ts`
 * contra "trazo_e2e") — ver el bloqueo de entorno documentado en la anotación de T066 de
 * `specs/001-gestion-inventarios/tasks.md`: `prisma migrate reset` invocado por un agente de
 * IA (Claude Code) queda bloqueado por el propio CLI de Prisma exigiendo consentimiento
 * humano explícito (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`). Este archivo se dejó
 * escrito y compilando limpio, sin poder correrse de punta a punta en este sandbox por el
 * mismo motivo — pendiente de que Samuel corra `npm run test:e2e` en su propia terminal.
 */
import { test, expect, type Page, type APIResponse } from '@playwright/test';

interface CredencialesUsuario {
  login: string;
  password: string;
}

/** Credenciales del Administrador semilla — nunca mutadas por otros specs (a diferencia de `gerente.demo`/`operario.demo`). */
function adminSemilla(): CredencialesUsuario {
  return {
    login: process.env.SEED_ADMIN_LOGIN ?? 'admin',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'cambia-esta-clave',
  };
}

/** Sufijo único por corrida — evita colisiones de `UNIQUE(login)`/`UNIQUE(email)` si la suite se reintenta (mismo criterio que `flujo-nucleo.spec.ts`). */
const SUFIJO = Date.now().toString();

const GERENTE_PRUEBA = {
  nombreCompleto: 'Gerente E2E Roles',
  email: `e2e.gerente.${SUFIJO}@trazo-e2e.test`,
  login: `e2e.gerente.${SUFIJO}`,
  passwordTemporal: `ClaveE2E-Roles-${SUFIJO}`,
  rol: 'GERENTE' as const,
};

const OPERARIO_PRUEBA = {
  nombreCompleto: 'Operario E2E Roles',
  email: `e2e.operario.${SUFIJO}@trazo-e2e.test`,
  login: `e2e.operario.${SUFIJO}`,
  passwordTemporal: `ClaveE2E-Roles-${SUFIJO}`,
  rol: 'OPERARIO' as const,
};

/** Enlaces de la navegación lateral comunes a los tres roles (frontend/src/lib/navegacion.ts). */
const ENLACES_COMUNES = ['Panel', 'Ingresos', 'Inventario', 'Salidas', 'Clientes y proyectos'];

/** Llena y envía el formulario de /login; confirma que la sesión quedó establecida (puede aterrizar en "/" o, si `debeCambiarPassword`, en /cambiar-password — FR-004). */
async function iniciarSesion(page: Page, credenciales: CredencialesUsuario): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Usuario').fill(credenciales.login);
  await page.getByLabel('Contraseña').fill(credenciales.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Alta de un usuario de prueba vía `POST /api/usuarios` (T076) — requiere que `page` tenga
 * una sesión de Administrador vigente (única forma de llamar esta ruta sin `403`, FR-005).
 */
async function crearUsuarioDePrueba(
  page: Page,
  datos: { nombreCompleto: string; email: string; login: string; passwordTemporal: string; rol: 'GERENTE' | 'OPERARIO' },
): Promise<void> {
  const respuesta = await page.request.post('/api/usuarios', { data: datos });
  if (respuesta.status() !== 201) {
    throw new Error(
      `[roles.spec] No se pudo crear el usuario de prueba "${datos.login}" — esperaba 201, obtuvo ` +
        `${respuesta.status()}: ${await respuesta.text()}`,
    );
  }
}

/** Falla con un mensaje claro si la respuesta NO es 403 (rutas que un rol sin permiso debe ver bloqueadas). */
async function esperar403(respuestaPromesa: Promise<APIResponse>, ruta: string): Promise<void> {
  const respuesta = await respuestaPromesa;
  if (respuesta.status() !== 403) {
    throw new Error(`[roles.spec] ${ruta}: se esperaba 403, se obtuvo ${respuesta.status()}: ${await respuesta.text()}`);
  }
}

/** Falla con un mensaje claro si la respuesta SÍ es 403 (rutas operativas que el rol SÍ debe poder usar — FR-003: el guard nunca debe bloquearlas). */
async function esperarNo403(respuestaPromesa: Promise<APIResponse>, ruta: string): Promise<void> {
  const respuesta = await respuestaPromesa;
  if (respuesta.status() === 403) {
    throw new Error(`[roles.spec] ${ruta}: no debía responder 403 (el rol sí tiene permiso), cuerpo: ${await respuesta.text()}`);
  }
}

test.describe.serial('Matriz de acceso por rol (T079)', () => {
  // Alta única de los dos usuarios de prueba (GERENTE/OPERARIO) antes de cualquier test —
  // en `serial` para que, si esta alta falla, el resto del archivo se marque "skipped" en vez
  // de fallar uno por uno con 401 confusos por falta de credenciales válidas.
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await iniciarSesion(page, adminSemilla());
    await crearUsuarioDePrueba(page, GERENTE_PRUEBA);
    await crearUsuarioDePrueba(page, OPERARIO_PRUEBA);
    await context.close();
  });

  test.describe('UI — navegación lateral filtrada por rol (contracts/rutas-frontend.md)', () => {
    test('ADMINISTRADOR ve todos los módulos, incluidos Reportes y Usuarios', async ({ page }) => {
      await iniciarSesion(page, adminSemilla());
      const nav = page.getByRole('navigation', { name: 'Navegación principal' });
      for (const etiqueta of [...ENLACES_COMUNES, 'Reportes', 'Usuarios']) {
        await expect(nav.getByRole('link', { name: etiqueta })).toBeVisible();
      }
    });

    test('GERENTE ve los módulos operativos y Reportes, pero NO Usuarios', async ({ page }) => {
      await iniciarSesion(page, { login: GERENTE_PRUEBA.login, password: GERENTE_PRUEBA.passwordTemporal });
      const nav = page.getByRole('navigation', { name: 'Navegación principal' });
      for (const etiqueta of [...ENLACES_COMUNES, 'Reportes']) {
        await expect(nav.getByRole('link', { name: etiqueta })).toBeVisible();
      }
      await expect(nav.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
    });

    test('OPERARIO ve solo los módulos operativos comunes: NI Reportes NI Usuarios', async ({ page }) => {
      await iniciarSesion(page, { login: OPERARIO_PRUEBA.login, password: OPERARIO_PRUEBA.passwordTemporal });
      const nav = page.getByRole('navigation', { name: 'Navegación principal' });
      for (const etiqueta of ENLACES_COMUNES) {
        await expect(nav.getByRole('link', { name: etiqueta })).toBeVisible();
      }
      await expect(nav.getByRole('link', { name: 'Reportes' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
    });
  });

  test.describe('API — 403 del guard de roles en rutas restringidas (contracts/api-rest.md)', () => {
    test('ADMINISTRADOR: /api/usuarios nunca responde 403', async ({ page }) => {
      await iniciarSesion(page, adminSemilla());
      await esperarNo403(page.request.get('/api/usuarios'), 'GET /api/usuarios (ADMINISTRADOR)');
    });

    test('GERENTE recibe 403 en las 5 rutas de /api/usuarios (exclusivas de Administrador, FR-005)', async ({ page }) => {
      await iniciarSesion(page, { login: GERENTE_PRUEBA.login, password: GERENTE_PRUEBA.passwordTemporal });
      await esperar403(page.request.get('/api/usuarios'), 'GET /api/usuarios (GERENTE)');
      await esperar403(page.request.post('/api/usuarios', { data: {} }), 'POST /api/usuarios (GERENTE)');
      await esperar403(page.request.put('/api/usuarios/1', { data: {} }), 'PUT /api/usuarios/1 (GERENTE)');
      await esperar403(
        page.request.put('/api/usuarios/1/estado', { data: {} }),
        'PUT /api/usuarios/1/estado (GERENTE)',
      );
      await esperar403(
        page.request.put('/api/usuarios/1/restablecer-password', { data: {} }),
        'PUT /api/usuarios/1/restablecer-password (GERENTE)',
      );
    });

    test('OPERARIO recibe 403 en /api/usuarios, /api/reportes/* y las mutaciones de /api/clientes', async ({ page }) => {
      await iniciarSesion(page, { login: OPERARIO_PRUEBA.login, password: OPERARIO_PRUEBA.passwordTemporal });

      // Usuarios — solo Administrador (FR-005…FR-009).
      await esperar403(page.request.get('/api/usuarios'), 'GET /api/usuarios (OPERARIO)');
      await esperar403(page.request.post('/api/usuarios', { data: {} }), 'POST /api/usuarios (OPERARIO)');

      // Reportes — solo A,G (FR-039…FR-044); rutas-frontend.md marca "/reportes/*" con "✗" para O.
      await esperar403(page.request.get('/api/reportes/consumo-cliente'), 'GET /api/reportes/consumo-cliente (OPERARIO)');
      await esperar403(page.request.get('/api/reportes/consumo-proyecto'), 'GET /api/reportes/consumo-proyecto (OPERARIO)');

      // Clientes — rutas-frontend.md marca la fila "/clientes" como "lectura" para O: el
      // Operario puede LEER pero no mutar (crear/editar/cambiar estado/agregar proyecto).
      await esperar403(page.request.post('/api/clientes', { data: {} }), 'POST /api/clientes (OPERARIO)');
      await esperar403(page.request.put('/api/clientes/1', { data: {} }), 'PUT /api/clientes/1 (OPERARIO)');
      await esperar403(page.request.put('/api/clientes/1/estado', { data: {} }), 'PUT /api/clientes/1/estado (OPERARIO)');
      await esperar403(
        page.request.post('/api/clientes/1/proyectos', { data: {} }),
        'POST /api/clientes/1/proyectos (OPERARIO)',
      );
    });

    test('GERENTE NO recibe 403 en Reportes ni al crear un cliente (rutas propias de su rol)', async ({ page }) => {
      await iniciarSesion(page, { login: GERENTE_PRUEBA.login, password: GERENTE_PRUEBA.passwordTemporal });
      await esperarNo403(
        page.request.get('/api/reportes/consumo-cliente'),
        'GET /api/reportes/consumo-cliente (GERENTE)',
      );
      await esperarNo403(
        page.request.get('/api/reportes/consumo-proyecto'),
        'GET /api/reportes/consumo-proyecto (GERENTE)',
      );
      // Cuerpo vacío a propósito: si el rol no bloqueara, esto sería 400 (validación de forma)
      // nunca 403 — ver TSDoc de cabecera sobre el orden Guards → Pipes.
      await esperarNo403(page.request.post('/api/clientes', { data: {} }), 'POST /api/clientes (GERENTE)');
    });

    test('GERENTE y OPERARIO nunca reciben 403 en las rutas operativas comunes a los tres roles', async ({ page }) => {
      for (const usuario of [GERENTE_PRUEBA, OPERARIO_PRUEBA]) {
        await iniciarSesion(page, { login: usuario.login, password: usuario.passwordTemporal });
        await esperarNo403(page.request.get('/api/inventario'), `GET /api/inventario (${usuario.rol})`);
        await esperarNo403(page.request.get('/api/ingresos'), `GET /api/ingresos (${usuario.rol})`);
        await esperarNo403(page.request.get('/api/salidas'), `GET /api/salidas (${usuario.rol})`);
        await esperarNo403(page.request.get('/api/clientes'), `GET /api/clientes (${usuario.rol}, lectura)`);
      }
    });
  });
});
