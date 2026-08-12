/**
 * E2E de humo — autenticación y navegación por rol (T027).
 *
 * REQUIERE backend + frontend levantados contra PostgreSQL real (`npm run db:up`,
 * `npx prisma migrate deploy -w backend` y el seed con `--demo` para tener los tres
 * usuarios semilla: Administrador, `gerente.demo`, `operario.demo` — ver
 * `backend/prisma/seed.ts`) y `playwright.config.ts` en la raíz con su `webServer` dual
 * (tarea T005 de tasks.md, TODAVÍA PENDIENTE al escribir este archivo). NO se ejecuta en
 * este sandbox (sin Docker/Postgres disponible) — queda escrito y listo, pendiente de
 * correrse localmente una vez existan T005 y una BD real.
 *
 * Nota de diseño: los usuarios semilla nacen con `debeCambiarPassword = true`
 * (FR-004/FR-005), así que un primer login aterriza en `/cambiar-password`, no en `/`. El
 * layout autenticado (frontend/src/app/(app)/layout.tsx, T025) envuelve ambas rutas con la
 * misma navegación, así que estas pruebas verifican la sesión y el filtrado por rol sin
 * depender de completar el cambio de contraseña.
 */
import { test, expect, type Page } from '@playwright/test';

interface UsuarioDePrueba {
  rol: 'ADMINISTRADOR' | 'GERENTE' | 'OPERARIO';
  login: string;
  password: string;
}

/** Credenciales de los tres roles semilla — vía variables de entorno (nunca hardcodeadas). */
const USUARIOS: UsuarioDePrueba[] = [
  {
    rol: 'ADMINISTRADOR',
    login: process.env.SEED_ADMIN_LOGIN ?? 'admin',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'cambia-esta-clave',
  },
  {
    rol: 'GERENTE',
    login: 'gerente.demo',
    password: process.env.SEED_DEMO_PASSWORD ?? 'demo-trazo',
  },
  {
    rol: 'OPERARIO',
    login: 'operario.demo',
    password: process.env.SEED_DEMO_PASSWORD ?? 'demo-trazo',
  },
];

function usuarioDePrueba(rol: UsuarioDePrueba['rol']): UsuarioDePrueba {
  const usuario = USUARIOS.find((candidato) => candidato.rol === rol);
  if (!usuario) {
    throw new Error(`No hay usuario de prueba configurado para el rol ${rol}`);
  }
  return usuario;
}

/** Llena y envía el formulario de /login; confirma que la sesión quedó establecida. */
async function iniciarSesion(page: Page, usuario: UsuarioDePrueba): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Usuario').fill(usuario.login);
  await page.getByLabel('Contraseña').fill(usuario.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  // Login exitoso saca de /login (aterriza en "/" o, la primera vez, en /cambiar-password).
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('Autenticación y navegación por rol (T027)', () => {
  for (const usuario of USUARIOS) {
    test(`${usuario.rol} inicia sesión correctamente`, async ({ page }) => {
      await iniciarSesion(page, usuario);
      await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
    });
  }

  test('el Operario no ve los enlaces de Reportes ni Usuarios', async ({ page }) => {
    await iniciarSesion(page, usuarioDePrueba('OPERARIO'));

    const nav = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(nav.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Reportes' })).toHaveCount(0);

    // Sí debe ver los módulos operativos comunes a los tres roles.
    await expect(nav.getByRole('link', { name: 'Inventario' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Salidas' })).toBeVisible();
  });

  test('el Administrador sí ve Usuarios y Reportes', async ({ page }) => {
    await iniciarSesion(page, usuarioDePrueba('ADMINISTRADOR'));

    const nav = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(nav.getByRole('link', { name: 'Usuarios' })).toBeVisible();
    await expect(
      nav.getByRole('link', { name: 'Reportes' }).first(),
    ).toBeVisible();
  });

  test('logout vuelve a /login y protege las rutas de nuevo', async ({ page }) => {
    await iniciarSesion(page, usuarioDePrueba('GERENTE'));

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/login/);

    // Sin cookie de sesión, el middleware (T022) rebota cualquier ruta protegida a /login.
    await page.goto('/inventario');
    await expect(page).toHaveURL(/\/login/);
  });
});
