/**
 * Prueba de integración del ASISTENTE (T256, US33) — la ruta real contra la aplicación montada.
 *
 * Lo que SOLO se puede ver aquí, y que las unitarias no cubren: que el endpoint existe con su
 * permiso, que exige sesión, y sobre todo que **sin clave del proveedor responde 200 con un aviso
 * en lugar de 500** (FR-136). Ese es el escenario de producción antes de configurar la clave, y es
 * exactamente el que no se puede probar con dobles: hay que atravesar el controlador, el filtro de
 * errores y la serialización.
 *
 * La suite APAGA el proveedor a propósito: retira las variables de entorno antes de construir la
 * aplicación (el adaptador las lee en su constructor) y las devuelve al terminar. Sin eso, la
 * prueba dependería de si la máquina donde corre tiene clave configurada: con clave llamaría a la
 * API de verdad en cada corrida — gastando cuota y heredando sus 503 transitorios como fallos
 * falsos— y sin clave pasaría por casualidad. Una prueba cuyo escenario lo decide el entorno no
 * prueba nada.
 */
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import { cerrarAppDePrueba, crearAppDePrueba, crearUsuarioDePrueba, truncarTablas, type AppDePrueba } from './setup';

describe('Asistente de consultas — /api/asistente (T256, US33)', () => {
  let contexto: AppDePrueba;

  /** Las tres variables que el adaptador consulta para decidir si hay servicio configurado. */
  const VARIABLES_DEL_PROVEEDOR = ['API_KEY_GOOGLE_AI_STUDIO', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'] as const;
  const valoresOriginales = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const nombre of VARIABLES_DEL_PROVEEDOR) {
      valoresOriginales.set(nombre, process.env[nombre]);
      // Se dejan VACÍAS en vez de borrarlas: `ConfigModule.forRoot()` recarga `backend/.env` al
      // construir la aplicación, y dotenv repone toda clave que no exista ya en `process.env` —
      // borrarlas las traía de vuelta. Una cadena vacía sí existe, así que no se repone, y el
      // adaptador la trata como ausencia de clave.
      process.env[nombre] = '';
    }
    contexto = await crearAppDePrueba();
  });

  afterAll(async () => {
    await cerrarAppDePrueba(contexto.app);
    for (const [nombre, valor] of valoresOriginales) {
      if (valor === undefined) delete process.env[nombre];
      else process.env[nombre] = valor;
    }
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
    // El proveedor está apagado por el `beforeAll` de arriba, no por casualidad del entorno.
    for (const nombre of VARIABLES_DEL_PROVEEDOR) {
      expect(process.env[nombre] ?? '').toBe('');
    }

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
