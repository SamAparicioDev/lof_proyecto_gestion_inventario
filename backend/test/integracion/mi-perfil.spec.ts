/**
 * Pruebas de integración de los DATOS PERSONALES PROPIOS (T144, US14, FR-080…FR-083) —
 * `PUT /api/auth/perfil`, API completa + PostgreSQL REAL contra el harness de `./setup.ts`.
 *
 * El corazón de esta suite no es "se puede editar el nombre" —eso es un CRUD— sino lo que NO
 * se puede hacer por esta vía: **cambiarse el rol, el estado o el nombre de usuario**. Un
 * endpoint que edita al usuario de la sesión es, por definición, un endpoint donde cualquiera
 * puede escribir; si aceptara un `rolId` del cuerpo, cualquier Operario se haría Administrador
 * con una sola petición. Por eso esas comprobaciones se hacen contra la BASE DE DATOS después
 * de la llamada, no contra el código de respuesta: un `204` no demuestra que no se haya
 * escrito de más.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend`.
 */
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearUsuarioDePrueba,
  obtenerRolDelSistemaId,
  truncarTablas,
  type AppDePrueba,
} from './setup';

describe('Mis datos personales — PUT /api/auth/perfil (T144, US14)', () => {
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

  it('un usuario corrige su nombre y su correo, y GET /api/auth/perfil lo refleja sin volver a iniciar sesión (US14-AS1)', async () => {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const respuesta = await request(servidor())
      .put('/api/auth/perfil')
      .set('Cookie', cookie)
      .send({ nombreCompleto: 'Nombre Corregido', email: 'corregido@trazo.local' });
    expect(respuesta.status).toBe(204);

    // Con la MISMA cookie: el cambio se ve de inmediato, sin re-login.
    const perfil = await request(servidor()).get('/api/auth/perfil').set('Cookie', cookie);
    expect(perfil.status).toBe(200);
    expect((perfil.body as { nombreCompleto: string }).nombreCompleto).toBe('Nombre Corregido');

    const enBd = await contexto.prisma.usuario.findUniqueOrThrow({ where: { id: BigInt(usuario.id) } });
    expect(enBd.nombreCompleto).toBe('Nombre Corregido');
    expect(enBd.email).toBe('corregido@trazo.local');
  });

  /**
   * LA PRUEBA QUE JUSTIFICA LA SUITE (FR-082): el cuerpo trae `rolId` de Administrador,
   * `estado: INACTIVO` y un `login` nuevo. La respuesta puede ser `204` —el endpoint hace su
   * trabajo con los campos que sí acepta— pero NINGUNO de los tres puede haberse aplicado.
   * Sin esta barrera, un Operario se haría Administrador con una sola petición.
   */
  it('enviar rolId, estado o login en el cuerpo NO los cambia: sigue siendo Operario, ACTIVO y con su login (FR-082, US14-AS4)', async () => {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);
    const rolAdministrador = await obtenerRolDelSistemaId(contexto.prisma, 'ADMINISTRADOR');
    const rolOperario = await obtenerRolDelSistemaId(contexto.prisma, 'OPERARIO');

    await request(servidor())
      .put('/api/auth/perfil')
      .set('Cookie', cookie)
      .send({
        nombreCompleto: 'Intento De Escalada',
        email: 'escalada@trazo.local',
        rolId: rolAdministrador,
        estado: 'INACTIVO',
        login: 'nuevo.login.usurpado',
      });

    const enBd = await contexto.prisma.usuario.findUniqueOrThrow({ where: { id: BigInt(usuario.id) } });
    expect(Number(enBd.rolId)).toBe(rolOperario);
    expect(enBd.estado).toBe('ACTIVO');
    expect(enBd.login).toBe(usuario.login);
    // Lo que SÍ debía cambiar, cambió: el rechazo es selectivo, no un bloqueo total.
    expect(enBd.nombreCompleto).toBe('Intento De Escalada');

    // Y sigue sin poder entrar donde no le corresponde (comprobación de extremo a extremo).
    expect((await request(servidor()).get('/api/usuarios').set('Cookie', cookie)).status).toBe(403);
  });

  it('un correo ya usado por otro usuario se rechaza con 400 señalando el campo, sin aplicar nada (FR-083, US14-AS2)', async () => {
    const otro = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);
    // El correo lo genera la factory, así que se lee de la base en vez de suponerlo.
    const correoAjeno = (
      await contexto.prisma.usuario.findUniqueOrThrow({ where: { id: BigInt(otro.id) } })
    ).email;
    const antes = await contexto.prisma.usuario.findUniqueOrThrow({ where: { id: BigInt(usuario.id) } });

    const respuesta = await request(servidor())
      .put('/api/auth/perfil')
      .set('Cookie', cookie)
      .send({ nombreCompleto: 'Nombre Nuevo', email: correoAjeno });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.campos?.email).toBeDefined();

    // Ni el correo ni el nombre se aplicaron: la operación es todo o nada.
    const despues = await contexto.prisma.usuario.findUniqueOrThrow({ where: { id: BigInt(usuario.id) } });
    expect(despues.email).toBe(antes.email);
    expect(despues.nombreCompleto).toBe(antes.nombreCompleto);
  });

  it('sin sesión responde 401 (los datos propios exigen saber quién es "uno mismo")', async () => {
    const respuesta = await request(servidor())
      .put('/api/auth/perfil')
      .send({ nombreCompleto: 'Anónimo', email: 'anonimo@trazo.local' });
    expect(respuesta.status).toBe(401);
  });

  /**
   * FR-081: el usuario afectado sale del token, nunca del cliente. La ruta no admite un id, así
   * que la única forma de intentar dirigirla a otro es colar su id en el cuerpo — y eso no debe
   * tocar a nadie más.
   */
  it('no hay forma de editar a OTRO usuario por esta vía (FR-081)', async () => {
    const victima = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const atacante = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), atacante.login, atacante.password);

    await request(servidor())
      .put('/api/auth/perfil')
      .set('Cookie', cookie)
      .send({
        id: victima.id,
        usuarioId: victima.id,
        nombreCompleto: 'Suplantado',
        email: 'suplantado@trazo.local',
      });

    const victimaEnBd = await contexto.prisma.usuario.findUniqueOrThrow({ where: { id: BigInt(victima.id) } });
    expect(victimaEnBd.nombreCompleto).not.toBe('Suplantado');
    expect(victimaEnBd.email).not.toBe('suplantado@trazo.local');

    // El cambio recayó sobre quien hizo la petición, que es lo correcto.
    const atacanteEnBd = await contexto.prisma.usuario.findUniqueOrThrow({ where: { id: BigInt(atacante.id) } });
    expect(atacanteEnBd.nombreCompleto).toBe('Suplantado');
  });

  it('rechaza campos inválidos con mensajes en español (nombre vacío, correo mal formado)', async () => {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const respuesta = await request(servidor())
      .put('/api/auth/perfil')
      .set('Cookie', cookie)
      .send({ nombreCompleto: '   ', email: 'esto-no-es-un-correo' });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.campos?.nombreCompleto).toBeDefined();
    expect(respuesta.body.error.campos?.email).toBeDefined();
  });
});

/** Hace login por HTTP y devuelve la cookie de sesión — mismo patrón local que el resto de
 *  suites de integración (cada una define el suyo). */
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
