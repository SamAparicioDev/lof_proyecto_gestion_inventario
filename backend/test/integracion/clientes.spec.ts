/**
 * Pruebas de integración de CLIENTES Y PROYECTOS (T046, FR-034…FR-038) — API completa +
 * PostgreSQL REAL, contra el harness de `./setup.ts`. Cubren los invariantes que SOLO se
 * pueden verificar contra la base real (docs/arquitectura.md §8): unicidad de NIT, unicidad
 * compuesta de nombre de proyecto por cliente, la traducción exacta de `esDestinoValido`
 * (FR-038, `dominio/entidades/proyecto.ts`) al filtro SQL de `proyectosDestino`, y el guard
 * de rol en el alta de clientes.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend`.
 */
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearClienteDePrueba,
  crearProyectoDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

describe('Clientes y proyectos — /api/clientes, /api/proyectos (T046)', () => {
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

  /** Cuerpo mínimo válido de `POST /api/clientes` (esquemaCrearCliente) — solo varía nombre/NIT. */
  function cuerpoCliente(nombre: string, nit: string): Record<string, unknown> {
    return { nombre, nit };
  }

  /** Cuerpo mínimo válido de `POST /api/clientes/:id/proyectos` (esquemaCrearProyecto). */
  function cuerpoProyecto(nombre: string): Record<string, unknown> {
    return { nombre };
  }

  it('crear dos clientes con el mismo NIT: el segundo recibe 400 con error de campo "nit" (FR-035)', async () => {
    const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);
    const nit = `NIT-DUPLICADO-${Date.now()}`;

    const respuestaUno = await request(servidor())
      .post('/api/clientes')
      .set('Cookie', cookie)
      .send(cuerpoCliente('Cliente Uno', nit));
    expect(respuestaUno.status).toBe(201);

    const respuestaDos = await request(servidor())
      .post('/api/clientes')
      .set('Cookie', cookie)
      .send(cuerpoCliente('Cliente Dos', nit));
    expect(respuestaDos.status).toBe(400);
    expect(respuestaDos.body.error.campos).toEqual({ nit: expect.stringContaining('NIT') });

    const totalEnBd = await contexto.prisma.cliente.count({ where: { nit } });
    expect(totalEnBd).toBe(1); // el UNIQUE de BD garantizó que solo uno se insertó de verdad
  });

  it(
    'crear dos proyectos con el mismo nombre para el MISMO cliente: el segundo recibe 400 con ' +
      'error de campo "nombre"; el mismo nombre para un cliente DISTINTO sí se permite (FR-036)',
    async () => {
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);
      const clienteA = await crearClienteDePrueba(contexto.prisma);
      const clienteB = await crearClienteDePrueba(contexto.prisma);
      const nombreProyecto = `Proyecto Compartido ${Date.now()}`;

      const respuestaUno = await request(servidor())
        .post(`/api/clientes/${clienteA.id}/proyectos`)
        .set('Cookie', cookie)
        .send(cuerpoProyecto(nombreProyecto));
      expect(respuestaUno.status).toBe(201);

      const respuestaDos = await request(servidor())
        .post(`/api/clientes/${clienteA.id}/proyectos`)
        .set('Cookie', cookie)
        .send(cuerpoProyecto(nombreProyecto));
      expect(respuestaDos.status).toBe(400);
      expect(respuestaDos.body.error.campos).toEqual({ nombre: expect.stringContaining('nombre') });

      // El mismo nombre para un cliente DISTINTO no colisiona (UNIQUE compuesta cliente_id+nombre).
      const respuestaClienteDistinto = await request(servidor())
        .post(`/api/clientes/${clienteB.id}/proyectos`)
        .set('Cookie', cookie)
        .send(cuerpoProyecto(nombreProyecto));
      expect(respuestaClienteDistinto.status).toBe(201);

      const totalEnClienteA = await contexto.prisma.proyecto.count({
        where: { clienteId: BigInt(clienteA.id), nombre: nombreProyecto },
      });
      expect(totalEnClienteA).toBe(1);
    },
  );

  it(
    'proyectosDestino de un cliente ACTIVO con 3 proyectos (ACTIVO/SUSPENDIDO/COMPLETADO) ' +
      'devuelve SOLO el ACTIVO (FR-038)',
    async () => {
      const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const cookie = await iniciarSesion(servidor(), operario.login, operario.password);
      const cliente = await crearClienteDePrueba(contexto.prisma, { estado: 'ACTIVO' });
      const proyectoActivo = await crearProyectoDePrueba(contexto.prisma, cliente.id, {
        nombre: 'Proyecto Activo',
        estado: 'ACTIVO',
      });
      await crearProyectoDePrueba(contexto.prisma, cliente.id, {
        nombre: 'Proyecto Suspendido',
        estado: 'SUSPENDIDO',
      });
      await crearProyectoDePrueba(contexto.prisma, cliente.id, {
        nombre: 'Proyecto Completado',
        estado: 'COMPLETADO',
      });

      const respuesta = await request(servidor())
        .get(`/api/clientes/${cliente.id}/proyectos-destino`)
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toHaveLength(1);
      expect(respuesta.body[0]).toMatchObject({ id: proyectoActivo.id, nombre: 'Proyecto Activo', estado: 'ACTIVO' });
    },
  );

  it(
    'proyectosDestino de un cliente INACTIVO con un proyecto ACTIVO devuelve arreglo vacío ' +
      '(el cliente inactivo invalida todos sus proyectos como destino — FR-038)',
    async () => {
      const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const cookie = await iniciarSesion(servidor(), operario.login, operario.password);
      const cliente = await crearClienteDePrueba(contexto.prisma, { estado: 'INACTIVO' });
      await crearProyectoDePrueba(contexto.prisma, cliente.id, { nombre: 'Proyecto Activo', estado: 'ACTIVO' });

      const respuesta = await request(servidor())
        .get(`/api/clientes/${cliente.id}/proyectos-destino`)
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual([]);
    },
  );

  it('un OPERARIO que intenta "POST /api/clientes" recibe 403 (crear cliente es solo A/G)', async () => {
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), operario.login, operario.password);

    const respuesta = await request(servidor())
      .post('/api/clientes')
      .set('Cookie', cookie)
      .send(cuerpoCliente('Cliente Rechazado', `NIT-ROL-${Date.now()}`));

    expect(respuesta.status).toBe(403);

    const totalEnBd = await contexto.prisma.cliente.count();
    expect(totalEnBd).toBe(0); // nada se insertó
  });

  it('"GET /api/clientes/:id" de un cliente con 2 proyectos incluye ambos proyectos anidados con sus campos completos (FR-037)', async () => {
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), operario.login, operario.password);
    const cliente = await crearClienteDePrueba(contexto.prisma, { nombre: 'Cliente Con Proyectos' });
    const proyectoUno = await crearProyectoDePrueba(contexto.prisma, cliente.id, {
      nombre: 'Proyecto Uno',
      descripcion: 'Primer proyecto de prueba',
      responsable: 'Responsable Uno',
      presupuestoEstimado: 5000,
    });
    const proyectoDos = await crearProyectoDePrueba(contexto.prisma, cliente.id, {
      nombre: 'Proyecto Dos',
      estado: 'SUSPENDIDO',
    });

    const respuesta = await request(servidor()).get(`/api/clientes/${cliente.id}`).set('Cookie', cookie);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toMatchObject({ id: cliente.id, nombre: 'Cliente Con Proyectos', nit: cliente.nit });
    expect(respuesta.body.proyectos).toHaveLength(2);

    const idsDevueltos = (respuesta.body.proyectos as Array<{ id: number }>).map((p) => p.id).sort((a, b) => a - b);
    expect(idsDevueltos).toEqual([proyectoUno.id, proyectoDos.id].sort((a, b) => a - b));

    const nombresDevueltos = (respuesta.body.proyectos as Array<{ nombre: string }>).map((p) => p.nombre).sort();
    expect(nombresDevueltos).toEqual(['Proyecto Dos', 'Proyecto Uno']);

    const encontrado = (respuesta.body.proyectos as Array<Record<string, unknown>>).find(
      (p) => p.id === proyectoUno.id,
    );
    expect(encontrado).toMatchObject({
      clienteId: cliente.id,
      nombre: 'Proyecto Uno',
      descripcion: 'Primer proyecto de prueba',
      responsable: 'Responsable Uno',
      presupuestoEstimado: 5000,
      estado: 'ACTIVO',
    });
  });
});

/** Hace login por HTTP y devuelve la cookie de sesión lista para `.set('Cookie', …)` — mismo
 *  patrón local que `ingresos.spec.ts`/`auth.spec.ts` (cada suite de integración define su
 *  propio helper). */
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
