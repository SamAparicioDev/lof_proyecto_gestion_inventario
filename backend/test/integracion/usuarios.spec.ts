/**
 * Pruebas de integración de USUARIOS (T078, FR-005…FR-009) — API completa + PostgreSQL
 * REAL, contra el harness de `./setup.ts`. Cubren los invariantes que solo se pueden
 * verificar con la base real y el guard de roles completo (docs/arquitectura.md §8):
 * unicidad de `login`/`email`, que un usuario INACTIVO no autentica pero sus movimientos
 * históricos siguen resolviendo su nombre (FK viva, nunca DELETE), el bloqueo de
 * auto-desactivación de un Administrador (US6-AS), el restablecimiento de contraseña de
 * OTRO usuario sin conocer la anterior (forzando `debeCambiarPassword`) y el guard de rol
 * (`@Roles('ADMINISTRADOR')`, FR-002/FR-003) en las 5 rutas de `/api/usuarios`.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend` (NUNCA contra `trazo`, ver
 * `truncarTablas()` en `./setup.ts`).
 */
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearProductoDePrueba,
  crearUsuarioDePrueba,
  obtenerRolDelSistemaId,
  truncarTablas,
  type AppDePrueba,
} from './setup';

describe('Usuarios — /api/usuarios (T078)', () => {
  let contexto: AppDePrueba;
  /** Id del rol Operario: desde US9/T104 el cuerpo de alta/edición envía `rolId`, no el nombre
   *  del rol. Se resuelve una vez — los roles del sistema los siembra la migración y
   *  `truncarTablas()` no los borra. */
  let rolOperarioId: number;

  beforeAll(async () => {
    contexto = await crearAppDePrueba();
    rolOperarioId = await obtenerRolDelSistemaId(contexto.prisma, 'OPERARIO');
  });

  afterAll(async () => {
    await cerrarAppDePrueba(contexto.app);
  });

  beforeEach(async () => {
    await truncarTablas(contexto.prisma);
  });

  const servidor = (): ReturnType<AppDePrueba['app']['getHttpServer']> => contexto.app.getHttpServer();

  /** Cuerpo mínimo válido de `POST /api/usuarios` (esquemaCrearUsuario) — solo varía lo que cada prueba necesita. */
  function cuerpoCrearUsuario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const sufijo = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    return {
      nombreCompleto: 'Usuario De Prueba Alta',
      email: `usuario.alta.${sufijo}@pruebas.trazo.local`,
      login: `usuario.alta.${sufijo}`,
      passwordTemporal: 'ClaveTemp#123',
      rolId: rolOperarioId,
      ...overrides,
    };
  }

  /** Cuerpo mínimo válido de `POST /api/ingresos` (esquemaCrearIngreso) — mismo patrón que `inventario.spec.ts`. */
  function cuerpoIngreso(
    numeroFactura: string,
    lineas: { productoId: number; cantidad: number; precioUnitario: number }[],
  ): Record<string, unknown> {
    return {
      numeroFactura,
      fechaFactura: '2026-01-05',
      proveedor: 'Proveedor de Prueba de Usuarios',
      fechaRecepcion: '2026-01-05',
      lineas,
    };
  }

  /**
   * Construye, sin ejecutar todavía, una petición fresca a cada una de las 5 rutas de
   * `/api/usuarios` — se usa TANTO para la prueba de "sin cookie" (401) como para la de
   * roles insuficientes (403), porque un `request.Test` de supertest se consume al
   * `await`-earse y no puede reutilizarse entre pruebas.
   */
  function construirPeticionesDeUsuarios(idObjetivo: number): Array<() => request.Test> {
    return [
      () => request(servidor()).get('/api/usuarios'),
      () => request(servidor()).post('/api/usuarios').send(cuerpoCrearUsuario()),
      () =>
        request(servidor())
          .put(`/api/usuarios/${idObjetivo}`)
          .send({ nombreCompleto: 'Actualizado', email: `actualizado.${Date.now()}@pruebas.trazo.local`, rolId: rolOperarioId }),
      () =>
        request(servidor())
          .put(`/api/usuarios/${idObjetivo}/restablecer-password`)
          .send({ passwordTemporal: 'ClaveTemp#123' }),
      () => request(servidor()).put(`/api/usuarios/${idObjetivo}/estado`).send({ estado: 'ACTIVO' }),
    ];
  }

  it('crear dos usuarios con el mismo login: el segundo recibe 400 con error de campo "login" (FR-009)', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const sufijo = `${Date.now()}`;
    const loginDuplicado = `usuario.dup.login.${sufijo}`;

    const respuestaUno = await request(servidor())
      .post('/api/usuarios')
      .set('Cookie', cookie)
      .send(cuerpoCrearUsuario({ login: loginDuplicado, email: `uno.${sufijo}@pruebas.trazo.local` }));
    expect(respuestaUno.status).toBe(201);

    const respuestaDos = await request(servidor())
      .post('/api/usuarios')
      .set('Cookie', cookie)
      .send(cuerpoCrearUsuario({ login: loginDuplicado, email: `dos.${sufijo}@pruebas.trazo.local` }));
    expect(respuestaDos.status).toBe(400);
    expect(respuestaDos.body.error.campos).toEqual({ login: expect.stringContaining('usuario') });

    const totalEnBd = await contexto.prisma.usuario.count({ where: { login: loginDuplicado } });
    expect(totalEnBd).toBe(1); // el UNIQUE de BD garantizó que solo uno se insertó de verdad
  });

  it('crear dos usuarios con el mismo email: el segundo recibe 400 con error de campo "email" (FR-009)', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const sufijo = `${Date.now()}`;
    const emailDuplicado = `duplicado.${sufijo}@pruebas.trazo.local`;

    const respuestaUno = await request(servidor())
      .post('/api/usuarios')
      .set('Cookie', cookie)
      .send(cuerpoCrearUsuario({ login: `usuario.uno.${sufijo}`, email: emailDuplicado }));
    expect(respuestaUno.status).toBe(201);

    const respuestaDos = await request(servidor())
      .post('/api/usuarios')
      .set('Cookie', cookie)
      .send(cuerpoCrearUsuario({ login: `usuario.dos.${sufijo}`, email: emailDuplicado }));
    expect(respuestaDos.status).toBe(400);
    expect(respuestaDos.body.error.campos).toEqual({ email: expect.stringContaining('correo') });

    const totalEnBd = await contexto.prisma.usuario.count({ where: { email: emailDuplicado } });
    expect(totalEnBd).toBe(1);
  });

  it(
    'un usuario INACTIVO no puede iniciar sesión (401, mismo mensaje genérico) pero un movimiento que ' +
      'registró ANTES de la baja sigue mostrando su nombre en el historial (FR-008, US6-AS4)',
    async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookieAdmin = await iniciarSesion(servidor(), admin.login, admin.password);
      const operario = await crearUsuarioDePrueba(contexto, {
        rol: 'OPERARIO',
        nombreCompleto: 'Operario A Desactivar',
      });
      const cookieOperario = await iniciarSesion(servidor(), operario.login, operario.password);
      const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });

      // El operario registra y recibe un ingreso ANTES de ser desactivado.
      const respuestaCrearIngreso = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookieOperario)
        .send(cuerpoIngreso(`FAC-USUARIOS-${Date.now()}`, [{ productoId: producto.id, cantidad: 10, precioUnitario: 500 }]));
      expect(respuestaCrearIngreso.status).toBe(201);
      const ingresoId: number = respuestaCrearIngreso.body.id;

      const respuestaRecibir = await request(servidor())
        .post(`/api/ingresos/${ingresoId}/recibir`)
        .set('Cookie', cookieOperario);
      expect(respuestaRecibir.status).toBe(204);

      // El Administrador desactiva al operario (baja lógica, nunca DELETE).
      const respuestaDesactivar = await request(servidor())
        .put(`/api/usuarios/${operario.id}/estado`)
        .set('Cookie', cookieAdmin)
        .send({ estado: 'INACTIVO' });
      expect(respuestaDesactivar.status).toBe(204);

      // El operario inactivo ya no puede iniciar sesión, con el MISMO mensaje genérico (US6-AS4).
      const respuestaLoginInactivo = await request(servidor())
        .post('/api/auth/login')
        .send({ login: operario.login, password: operario.password });
      expect(respuestaLoginInactivo.status).toBe(401);
      expect(respuestaLoginInactivo.body.error.mensaje).toBe('Usuario o contraseña incorrectos');

      // Pero su movimiento histórico sigue mostrando su nombre (FK viva, sin DELETE — FR-008).
      const respuestaHistorial = await request(servidor())
        .get(`/api/inventario/${producto.id}/movimientos`)
        .set('Cookie', cookieAdmin);
      expect(respuestaHistorial.status).toBe(200);
      expect(respuestaHistorial.body.datos).toHaveLength(1);
      expect(respuestaHistorial.body.datos[0]).toMatchObject({
        usuarioId: operario.id,
        usuarioNombre: 'Operario A Desactivar',
      });
    },
  );

  it('un Administrador no puede desactivarse a sí mismo (409, mismo id de sesión) — US6-AS', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);

    const respuesta = await request(servidor())
      .put(`/api/usuarios/${admin.id}/estado`)
      .set('Cookie', cookie)
      .send({ estado: 'INACTIVO' });

    expect(respuesta.status).toBe(409);
    expect(respuesta.body.error.mensaje).toContain('desactivar tu propio usuario');

    // El estado NO cambió: la mutación se rechazó antes de tocar la fila.
    const registro = await contexto.prisma.usuario.findUnique({ where: { id: BigInt(admin.id) } });
    expect(registro?.estado).toBe('ACTIVO');
  });

  it(
    'el Administrador restablece la contraseña de OTRO usuario sin conocer la anterior, y fuerza el ' +
      'cambio en el próximo login (FR-005)',
    async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookieAdmin = await iniciarSesion(servidor(), admin.login, admin.password);
      const objetivo = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' }); // password conocida, pero nunca se envía

      const nuevaPassword = 'ClaveRestablecida#789';
      const respuestaRestablecer = await request(servidor())
        .put(`/api/usuarios/${objetivo.id}/restablecer-password`)
        .set('Cookie', cookieAdmin)
        .send({ passwordTemporal: nuevaPassword }); // sin campo de "password anterior" — el contrato no lo pide

      expect(respuestaRestablecer.status).toBe(204);

      // La contraseña anterior ya no sirve.
      const respuestaLoginAnterior = await request(servidor())
        .post('/api/auth/login')
        .send({ login: objetivo.login, password: objetivo.password });
      expect(respuestaLoginAnterior.status).toBe(401);

      // La nueva sí funciona, y el próximo login queda marcado para forzar el cambio.
      const cookieObjetivo = await iniciarSesion(servidor(), objetivo.login, nuevaPassword);
      const respuestaPerfil = await request(servidor()).get('/api/auth/perfil').set('Cookie', cookieObjetivo);
      expect(respuestaPerfil.status).toBe(200);
      expect(respuestaPerfil.body).toMatchObject({ id: objetivo.id, debeCambiarPassword: true });
    },
  );

  it('GERENTE y OPERARIO reciben 403 en las 5 rutas de administración de usuarios (solo Administrador — FR-002/FR-003)', async () => {
    const objetivo = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });

    for (const rol of ['GERENTE', 'OPERARIO'] as const) {
      const usuario = await crearUsuarioDePrueba(contexto, { rol });
      const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

      for (const construirPeticion of construirPeticionesDeUsuarios(objetivo.id)) {
        const respuesta = await construirPeticion().set('Cookie', cookie);
        expect(respuesta.status).toBe(403);
      }
    }

    // Ninguna de las peticiones rechazadas (incluida la de alta) insertó nada.
    const totalUsuarios = await contexto.prisma.usuario.count();
    expect(totalUsuarios).toBe(3); // el objetivo + el GERENTE + el OPERARIO creados arriba
  });

  it('las 5 rutas de administración de usuarios exigen sesión (401 sin cookie)', async () => {
    const objetivo = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });

    for (const construirPeticion of construirPeticionesDeUsuarios(objetivo.id)) {
      const respuesta = await construirPeticion();
      expect(respuesta.status).toBe(401);
    }
  });
});

/** Hace login por HTTP y devuelve la cookie de sesión lista para `.set('Cookie', …)` — mismo
 *  patrón local que el resto de suites de integración (cada una define el suyo). */
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
