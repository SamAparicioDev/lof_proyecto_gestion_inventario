/**
 * E2E del flujo núcleo completo del MVP (T066) — checkpoint "MVP COMPLETO" de
 * `specs/001-gestion-inventarios/tasks.md` (Fase 6, fin de US5).
 *
 * Recorre, con datos reales contra "trazo_e2e" (reseteada y sembrada por
 * `global-setup.ts` antes de esta corrida), el ciclo completo que demuestra que los tres
 * roles semilla pueden operar el sistema de punta a punta:
 *
 *  1. `operario.demo` inicia sesión (cambia su contraseña obligatoria, FR-004) y registra un
 *     ingreso con un producto nuevo y una cantidad conocida; lo marca "Recibido" (suma stock,
 *     FR-017/FR-021).
 *  2. Cierra sesión; `gerente.demo` inicia sesión (mismo cambio obligatorio) y crea un
 *     cliente con un proyecto ACTIVO para él (FR-034/FR-036) — `POST /api/clientes` y
 *     `POST /api/clientes/:id/proyectos` son A,G (contracts/api-rest.md), de ahí el cambio de
 *     rol; `gerente.demo` sigue conectado para el resto del flujo porque `POST/confirmar` de
 *     salidas es A,G,O (no hace falta otro cambio de sesión, criterio explícito de T066).
 *  3. `gerente.demo` crea una salida hacia ese proyecto con el MISMO producto, con una
 *     cantidad menor a la recibida, y la confirma (descuenta stock real, FR-028/029/030).
 *  4. `/inventario` refleja stock/comprometido/disponible esperados (recibido − confirmado).
 *  5. La ficha del producto (`/inventario/:id`) muestra AMBOS movimientos en el historial,
 *     cada uno con el usuario que lo autorizó y el número de documento correlativo correcto
 *     (FR-024/FR-045).
 *
 * Estructura: una secuencia de `test()` DEPENDIENTES dentro de `test.describe.serial` (mismo
 * `page`/sesión de principio a fin, creado una sola vez en `beforeAll`) en vez de un único
 * `test()` gigante — cada paso queda reportado por separado (más fácil ubicar dónde falla)
 * sin perder el estado compartido (cookies de sesión, ids capturados) que el escenario
 * necesita entre pasos.
 *
 * Selectores: por rol/label accesible (Playwright Testing Library style), nunca por clase CSS
 * — el frontend ya expone suficiente semántica (labels, aria-label, role=dialog) sin necesitar
 * `data-testid` adicionales para este flujo.
 */
import { test, expect, type Page } from '@playwright/test';

/**
 * Contraseña de los usuarios semilla `gerente.demo`/`operario.demo`, expuesta en
 * `process.env` por `global-setup.ts` (ver su TSDoc). Se lee de forma PEREZOSA (una función,
 * no una constante de módulo) a propósito: si esto se evaluara al cargar el archivo,
 * `npx playwright test --list` (que importa los specs SIN correr `globalSetup` primero)
 * fallaría solo por listar las pruebas, antes de que hubiera oportunidad de poblar la
 * variable — confirmado en vivo durante T066.
 */
function passwordDemoSemilla(): string {
  const valor = process.env.SEED_DEMO_PASSWORD;
  if (!valor) {
    throw new Error(
      '[E2E] SEED_DEMO_PASSWORD no llegó a este proceso — revisa tests/e2e/global-setup.ts ' +
        '(debe exponerlo en process.env para que los workers de prueba lo hereden).',
    );
  }
  return valor;
}

/** Fecha de hoy en formato `YYYY-MM-DD` — lo que esperan los `<input type="date">` del formulario. */
const FECHA_HOY = new Date().toISOString().slice(0, 10);

/** Datos de prueba únicos por corrida (evita colisiones de UNIQUE si la suite se reintenta sin un reset completo). */
const SUFIJO = Date.now().toString();
const SKU_PRODUCTO = `E2E-${SUFIJO}`;
const DESCRIPCION_PRODUCTO = 'Producto E2E — flujo núcleo (T066)';
const NUMERO_FACTURA = `FE2E-${SUFIJO}`;
const NIT_CLIENTE = `E2E-${SUFIJO}`;
const NOMBRE_CLIENTE = 'Cliente E2E Núcleo';
const NOMBRE_PROYECTO = 'Proyecto E2E Núcleo';

/** Cantidad recibida > cantidad de la salida — deja un disponible predecible para las aserciones finales. */
const CANTIDAD_RECIBIDA = 50;
const CANTIDAD_SALIDA = 20;
const DISPONIBLE_ESPERADO = CANTIDAD_RECIBIDA - CANTIDAD_SALIDA;

/** Cambia la contraseña obligatoria del primer login (mismo flujo para cualquier usuario semilla, FR-004). */
async function cambiarPasswordObligatoria(page: Page, passwordActual: string, passwordNueva: string): Promise<void> {
  await expect(page).toHaveURL(/\/cambiar-password/);
  await page.getByLabel('Contraseña actual').fill(passwordActual);
  await page.getByLabel('Nueva contraseña').fill(passwordNueva);
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(page).toHaveURL(/\/inventario/);
}

/** Inicia sesión con usuario/contraseña en el formulario de /login (asume que la página ya está ahí). */
async function llenarFormularioLogin(page: Page, login: string, password: string): Promise<void> {
  await page.getByLabel('Usuario').fill(login);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

test.describe.serial('Flujo núcleo del MVP (T066)', () => {
  let page: Page;
  /** Contraseñas NUEVAS del cambio obligatorio de primer login (FR-004) — resueltas en `beforeAll`, distintas entre sí a propósito. */
  let passwordNuevaOperario = '';
  let passwordNuevaGerente = '';
  /** Correlativo de la salida (capturado del encabezado "Salida N.º X" tras crearla) — usado para ubicar su fila en el historial. */
  let numeroSalida = '';

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    const passwordSemilla = passwordDemoSemilla();
    passwordNuevaOperario = `${passwordSemilla}-Op1`;
    passwordNuevaGerente = `${passwordSemilla}-Ge1`;
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('1. operario.demo inicia sesión y cambia su contraseña obligatoria', async () => {
    await page.goto('/login');
    await llenarFormularioLogin(page, 'operario.demo', passwordDemoSemilla());
    await cambiarPasswordObligatoria(page, passwordDemoSemilla(), passwordNuevaOperario);
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  });

  test('2. operario.demo registra un ingreso con un producto nuevo y cantidad conocida', async () => {
    await page.goto('/ingresos/nuevo');
    await page.getByLabel('Número de factura').fill(NUMERO_FACTURA);
    await page.getByLabel('Proveedor').fill('Proveedor E2E');
    await page.getByLabel('Fecha de la factura').fill(FECHA_HOY);
    await page.getByLabel('Fecha de recepción').fill(FECHA_HOY);

    // Alta rápida del producto (FR-011) desde la línea 1 — se preselecciona solo al cerrar el diálogo.
    await page.getByRole('button', { name: 'Crear producto nuevo para la línea 1' }).click();
    const dialogoProducto = page.getByRole('dialog');
    await dialogoProducto.getByLabel('SKU').fill(SKU_PRODUCTO);
    await dialogoProducto.getByLabel('Descripción').fill(DESCRIPCION_PRODUCTO);
    await dialogoProducto.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByLabel('Cantidad de la línea 1').fill(String(CANTIDAD_RECIBIDA));
    await page.getByLabel('Precio unitario de la línea 1').fill('1000');

    await page.getByRole('button', { name: 'Registrar ingreso' }).click();
    await expect(page).toHaveURL(/\/ingresos\/\d+$/);
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
  });

  test('3. recibe el ingreso (suma stock real, FR-017/FR-021)', async () => {
    await page.getByRole('button', { name: 'Recibir' }).click();
    await expect(page.getByText('Recibido', { exact: true })).toBeVisible();
  });

  test('4. cierra sesión de operario.demo', async () => {
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('5. gerente.demo inicia sesión y cambia su contraseña obligatoria', async () => {
    await llenarFormularioLogin(page, 'gerente.demo', passwordDemoSemilla());
    await cambiarPasswordObligatoria(page, passwordDemoSemilla(), passwordNuevaGerente);
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  });

  test('6. gerente.demo crea un cliente (FR-034)', async () => {
    await page.goto('/clientes/nuevo');
    await page.getByLabel('Nombre').fill(NOMBRE_CLIENTE);
    await page.getByLabel('NIT').fill(NIT_CLIENTE);
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(page).toHaveURL(/\/clientes\/\d+$/);
  });

  test('7. gerente.demo crea un proyecto ACTIVO para el cliente (FR-036)', async () => {
    await page.getByRole('button', { name: 'Nuevo proyecto' }).click();
    const dialogoProyecto = page.getByRole('dialog');
    await dialogoProyecto.getByLabel('Nombre').fill(NOMBRE_PROYECTO);
    await dialogoProyecto.getByRole('button', { name: 'Crear proyecto' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const tarjetaProyecto = page.locator('.card', { hasText: NOMBRE_PROYECTO });
    await expect(tarjetaProyecto.getByText('Activo', { exact: true })).toBeVisible();
  });

  test('8. gerente.demo crea una salida hacia el proyecto, con cantidad menor a lo recibido (FR-025/FR-027)', async () => {
    await page.goto('/salidas/nueva');

    await page.locator('#cliente').selectOption({ label: NOMBRE_CLIENTE });
    const selectProyecto = page.locator('#proyectoId');
    await expect(selectProyecto).toBeEnabled();
    await selectProyecto.selectOption({ label: NOMBRE_PROYECTO });

    await page.getByLabel('Fecha de salida').fill(FECHA_HOY);
    await page
      .getByLabel('Producto de la línea 1')
      .selectOption({ label: `${SKU_PRODUCTO} — ${DESCRIPCION_PRODUCTO}` });
    await page.getByLabel('Cantidad de la línea 1').fill(String(CANTIDAD_SALIDA));

    await page.getByRole('button', { name: 'Registrar salida' }).click();
    await expect(page).toHaveURL(/\/salidas\/\d+$/);
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();

    const encabezado = (await page.locator('main h2').textContent()) ?? '';
    const coincidencia = /Salida N\.º\s*(\d+)/.exec(encabezado);
    expect(coincidencia, `encabezado inesperado: "${encabezado}"`).not.toBeNull();
    numeroSalida = coincidencia![1];
  });

  test('9. confirma la salida (descuenta stock real, FR-028/029/030)', async () => {
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByText('Confirmada', { exact: true })).toBeVisible();
  });

  test('10. /inventario refleja stock/comprometido/disponible esperados (recibido − confirmado, FR-020)', async () => {
    await page.goto(`/inventario?buscar=${encodeURIComponent(SKU_PRODUCTO)}`);

    const fila = page.locator('tbody tr', { hasText: SKU_PRODUCTO });
    await expect(fila).toBeVisible();
    const celdas = fila.locator('td');
    await expect(celdas.nth(2)).toHaveText(String(DISPONIBLE_ESPERADO)); // stock
    await expect(celdas.nth(3)).toHaveText('0'); // comprometido (la salida ya no está PENDIENTE)
    await expect(celdas.nth(4)).toHaveText(String(DISPONIBLE_ESPERADO)); // disponible

    await fila.getByRole('link', { name: SKU_PRODUCTO }).click();
    await expect(page).toHaveURL(/\/inventario\/\d+$/);
  });

  test('11. el historial del producto muestra ambos movimientos, con usuario y correlativo (FR-024/FR-045)', async () => {
    const filaEntrada = page.locator('tbody tr', { hasText: NUMERO_FACTURA });
    await expect(filaEntrada).toBeVisible();
    await expect(filaEntrada.getByText('Entrada', { exact: true })).toBeVisible();
    await expect(filaEntrada).toContainText('Operario Demo');
    await expect(filaEntrada).toContainText(`+${CANTIDAD_RECIBIDA}`);

    const filaSalida = page.locator('tbody tr', { hasText: `N.º ${numeroSalida}` });
    await expect(filaSalida).toBeVisible();
    await expect(filaSalida.getByText('Salida', { exact: true })).toBeVisible();
    await expect(filaSalida).toContainText('Gerente Demo');
    await expect(filaSalida).toContainText(NOMBRE_PROYECTO);
    await expect(filaSalida).toContainText(`-${CANTIDAD_SALIDA}`);
  });
});
