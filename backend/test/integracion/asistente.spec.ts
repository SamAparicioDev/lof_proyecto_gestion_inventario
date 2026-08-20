/**
 * Prueba de integración del ASISTENTE (T256, US33) — la ruta real contra la aplicación montada.
 *
 * Lo que SOLO se puede ver aquí, y que las unitarias no cubren: que el endpoint existe con su
 * permiso, que exige sesión, y sobre todo que **sin `ANTHROPIC_API_KEY` responde 200 con un aviso
 * en lugar de 500** (FR-136). Ese es el escenario de producción antes de configurar la clave, y es
 * exactamente el que no se puede probar con dobles: hay que atravesar el controlador, el filtro de
 * errores y la serialización.
 *
 * El entorno de pruebas no define la clave a propósito — si algún día la definiera, esta suite
 * empezaría a llamar a la API de verdad, y eso se nota en la primera corrida.
 */
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import { cerrarAppDePrueba, crearAppDePrueba, crearUsuarioDePrueba, truncarTablas, type AppDePrueba } from './setup';

describe('Asistente de consultas — /api/asistente (T256, US33)', () => {
  let contexto: AppDePrueba;

  beforeAll(async () => {
    contexto = await crearAppDePrueba();
  });

  afterAll(async () => {
    await cerrarAppDePrueba(contexto.app);
  });

  beforeEach(async () => {
    await truncarTablas(contexto.prisma);
  });

  const servidor = (): ReturnType<AppDePrueba['app']['getHttpServer']> => contexto.app.getHttpServer();

  it('sin sesión responde 401, como toda ruta de negocio', async () => {
    const respuesta = await request(servidor()).post('/api/asistente/consulta').send({ pregunta: '¿Cuánto hay?' });
    expect(respuesta.status).toBe(401);
  });

  it('sin la clave del servicio responde 200 con aviso, NUNCA 500 (FR-136)', async () => {
    expect(process.env.ANTHROPIC_API_KEY ?? '').toBe('');

    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const respuesta = await request(servidor())
      .post('/api/asistente/consulta')
      .set('Cookie', cookie)
      .send({ pregunta: '¿Cuánto cemento hay?' });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.disponible).toBe(false);
    expect(respuesta.body.respuesta).toContain('no está disponible');
    expect(respuesta.body.fuentes).toEqual([]);
  });

  it('valida la pregunta con el esquema compartido, con mensaje en español', async () => {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const vacia = await request(servidor()).post('/api/asistente/consulta').set('Cookie', cookie).send({ pregunta: '  ' });
    expect(vacia.status).toBe(400);
    expect(vacia.body.error.campos.pregunta).toContain('pregunta');
  });
});

/** Hace login por HTTP y devuelve la cookie de sesión — mismo patrón local que el resto de suites. */
async function iniciarSesion(
  servidorHttp: ReturnType<AppDePrueba['app']['getHttpServer']>,
  login: string,
  password: string,
): Promise<string> {
  const respuesta = await request(servidorHttp).post('/api/auth/login').send({ login, password });
  const cabeceras = (respuesta.headers['set-cookie'] as string[] | undefined) ?? [];
  const cookie = cabeceras.find((cabecera) => cabecera.startsWith(`${NOMBRE_COOKIE_SESION}=`));
  if (!cookie) {
    throw new Error('No se recibió la cookie de sesión al iniciar sesión en la prueba.');
  }
  return cookie;
}
