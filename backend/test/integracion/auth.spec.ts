/**
 * Pruebas de integración de seguridad (T020) — API completa + PostgreSQL REAL, contra el
 * harness de `./setup.ts` (T019). Cubren FR-001/FR-002/FR-003 y US6-AS4 (mensaje de login
 * genérico) tal como los describe `contracts/api-rest.md` § Autenticación.
 *
 * REQUIERE ENTORNO LOCAL — NO EJECUTABLE EN ESTE SANDBOX (no hay Docker/PostgreSQL aquí):
 *   1. `npm run db:up`                              (levanta `trazo` y `trazo_test`)
 *   2. `npx prisma migrate deploy -w backend`        (aplica la migración T009 contra `trazo_test`
 *                                                      — `jest.setup.ts` ya apunta `DATABASE_URL`
 *                                                      a `DATABASE_URL_TEST` antes de esta suite)
 *   3. `npm run test:integracion -w backend`
 * Que esta suite no corra en este entorno no es un fallo de código: es la limitación de
 * sandbox documentada en el encargo de esta etapa.
 */
import { Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import { RequierePermiso } from '../../src/interfaces/http/comunes/requiere-permiso.decorator';
import { type AppDePrueba, cerrarAppDePrueba, crearAppDePrueba, crearUsuarioDePrueba, truncarTablas } from './setup';

/**
 * Controlador de SOLO PRUEBA — nació en T020, cuando ningún endpoint real declaraba todavía
 * autorización, para poder probar que el guard global de `app.module.ts` rechaza con 403 a un
 * usuario autenticado que no tiene lo que la ruta exige. Vive solo aquí (nunca en
 * `backend/src`, nunca se despliega).
 *
 * T103 (US9) cambió su decorador de `@Roles('ADMINISTRADOR')` a
 * `@RequierePermiso('usuarios.gestionar')` porque el mecanismo viejo se retiró por completo
 * (research R16: no se mantienen dos mecanismos de autorización en paralelo). El equivalente
 * es exacto: `usuarios.gestionar` es un permiso que SOLO tiene el rol Administrador, así que
 * las dos pruebas de abajo siguen ejercitando exactamente lo mismo —Operario 403,
 * Administrador 200— y ninguna de sus aserciones cambió (SC-013).
 */
@Controller('pruebas/solo-administrador')
class ControladorSoloAdministradorDePrueba {
  @RequierePermiso('usuarios.gestionar')
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

describe('Seguridad — /api/auth e integración de guards (T020)', () => {
  let contexto: AppDePrueba;

  beforeAll(async () => {
    contexto = await crearAppDePrueba({ controllers: [ControladorSoloAdministradorDePrueba] });
  });

  afterAll(async () => {
    await cerrarAppDePrueba(contexto.app);
  });

  beforeEach(async () => {
    await truncarTablas(contexto.prisma);
  });

  const servidor = (): ReturnType<AppDePrueba['app']['getHttpServer']> => contexto.app.getHttpServer();

  describe('POST /api/auth/login', () => {
    it('rechaza un login inexistente con el mensaje genérico (401)', async () => {
      const respuesta = await request(servidor())
        .post('/api/auth/login')
        .send({ login: 'no-existe', password: 'lo-que-sea' });

      expect(respuesta.status).toBe(401);
      expect(respuesta.body.error.mensaje).toBe('Usuario o contraseña incorrectos');
    });

    it('rechaza una contraseña incorrecta con el MISMO mensaje genérico (401)', async () => {
      const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });

      const respuesta = await request(servidor())
        .post('/api/auth/login')
        .send({ login: usuario.login, password: 'contraseña-incorrecta' });

      expect(respuesta.status).toBe(401);
      expect(respuesta.body.error.mensaje).toBe('Usuario o contraseña incorrectos');
    });

    it('rechaza a un usuario INACTIVO con el MISMO mensaje genérico (401) — US6-AS4', async () => {
      const usuario = await crearUsuarioDePrueba(contexto, { estado: 'INACTIVO' });

      const respuesta = await request(servidor())
        .post('/api/auth/login')
        .send({ login: usuario.login, password: usuario.password });

      expect(respuesta.status).toBe(401);
      expect(respuesta.body.error.mensaje).toBe('Usuario o contraseña incorrectos');
    });

    it('acepta credenciales válidas: 204 + cookie de sesión trazo_sesion presente', async () => {
      const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });

      const respuesta = await request(servidor())
        .post('/api/auth/login')
        .send({ login: usuario.login, password: usuario.password });

      expect(respuesta.status).toBe(204);
      expect(extraerCookieSesion(respuesta)).not.toBeNull();
    });
  });

  describe('GET /api/auth/perfil', () => {
    it('rechaza la petición sin cookie de sesión (401)', async () => {
      const respuesta = await request(servidor()).get('/api/auth/perfil');

      expect(respuesta.status).toBe(401);
    });

    it('devuelve el perfil correcto con una sesión válida (200)', async () => {
      const usuario = await crearUsuarioDePrueba(contexto, {
        rol: 'OPERARIO',
        nombreCompleto: 'Operario de Integración',
      });
      const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

      const respuesta = await request(servidor()).get('/api/auth/perfil').set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toMatchObject({
        id: usuario.id,
        nombreCompleto: 'Operario de Integración',
        // T106: el perfil publica el rol IDENTIFICADO (`{id, nombre}`) en vez del texto
        // 'OPERARIO' — los roles son datos y un rol propio no cabe en ningún enum (FR-054).
        rol: { nombre: 'Operario' },
        debeCambiarPassword: false,
      });
    });
  });

  describe('PermisosGuard — autorización por permiso efectivo (FR-002/FR-003/FR-058)', () => {
    it('rechaza con 403 a un usuario autenticado sin el rol requerido', async () => {
      const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

      const respuesta = await request(servidor()).get('/api/pruebas/solo-administrador').set('Cookie', cookie);

      expect(respuesta.status).toBe(403);
    });

    it('permite el acceso a un usuario con el rol requerido', async () => {
      const usuario = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

      const respuesta = await request(servidor()).get('/api/pruebas/solo-administrador').set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
    });
  });
});

/** Extrae la cookie `trazo_sesion` de un `set-cookie` de respuesta, o `null` si no vino. */
function extraerCookieSesion(respuesta: request.Response): string | null {
  const cabeceras = (respuesta.headers['set-cookie'] as string[] | undefined) ?? [];
  return cabeceras.find((cabecera) => cabecera.startsWith(`${NOMBRE_COOKIE_SESION}=`)) ?? null;
}

/** Hace login por HTTP y devuelve la cookie de sesión lista para `.set('Cookie', …)`. */
async function iniciarSesion(
  servidorHttp: ReturnType<AppDePrueba['app']['getHttpServer']>,
  login: string,
  password: string,
): Promise<string> {
  const respuesta = await request(servidorHttp).post('/api/auth/login').send({ login, password });
  const cookie = extraerCookieSesion(respuesta);
  if (!cookie) {
    throw new Error('No se recibió la cookie de sesión al iniciar sesión en la prueba.');
  }
  return cookie;
}
