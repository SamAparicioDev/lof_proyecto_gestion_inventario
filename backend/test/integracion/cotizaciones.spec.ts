/**
 * Pruebas de integración del módulo de COTIZACIONES (T205, US21, FR-112…FR-117) — API completa +
 * PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Lo que solo se puede verificar aquí (docs/arquitectura.md §8):
 *
 *  - **El correlativo** sale de `contadores` dentro de la transacción (FR-112).
 *  - **Aceptar escribe en DOS tablas a la vez** (FR-115): la cotización queda ACEPTADA y nace
 *    una salida PENDIENTE con las mismas líneas, enlazada. Y —lo que más importa— el inventario
 *    NO se mueve: sin movimientos, sin stock tocado. Esa afirmación cruza cuatro tablas y es
 *    justo la que la intuición pone en duda.
 *  - **Solo BORRADOR es editable** (FR-114), comprobado contra el estado real de la base.
 *  - **"Vencida" se DERIVA**, no se marca: una cotización con validez pasada llega con
 *    `vencida: true` sin que nadie haya corrido nada.
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
  crearProductoDePrueba,
  crearProyectoDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

interface CuerpoError {
  error: { mensaje: string; campos?: Record<string, string> };
}

describe('Cotizaciones — /api/cotizaciones (T205, US21)', () => {
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

  /** Cliente + proyecto + producto: el mínimo para poder cotizar algo. */
  async function escenario(): Promise<{ clienteId: number; proyectoId: number; productoId: number }> {
    const cliente = await crearClienteDePrueba(contexto.prisma, { nombre: 'Constructora Demo' });
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id, { nombre: 'Torre Norte' });
    const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'COT-PROD-001', stockActual: 100 });
    return { clienteId: cliente.id, proyectoId: proyecto.id, productoId: producto.id };
  }

  function cuerpoValido(base: { clienteId: number; proyectoId: number; productoId: number }) {
    return {
      clienteId: base.clienteId,
      proyectoId: base.proyectoId,
      fecha: '2026-08-16',
      fechaValidez: '2026-09-16',
      observaciones: 'Precios sostenidos un mes.',
      lineas: [{ productoId: base.productoId, cantidad: 10, precioUnitario: 30_000, tasaIva: 19 }],
    };
  }

  it('crea la cotización en BORRADOR con correlativo propio y las tres cifras del documento', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const base = await escenario();

    const primera = await request(servidor()).post('/api/cotizaciones').set('Cookie', cookie).send(cuerpoValido(base));
    const segunda = await request(servidor()).post('/api/cotizaciones').set('Cookie', cookie).send(cuerpoValido(base));

    expect(primera.status).toBe(201);
    expect(primera.body.numero).toBe(1);
    expect(segunda.body.numero).toBe(2); // correlativo, no el id

    const detalle = await request(servidor()).get(`/api/cotizaciones/${primera.body.id}`).set('Cookie', cookie);
    expect(detalle.status).toBe(200);
    expect(detalle.body.estado).toBe('BORRADOR');
    expect(detalle.body.cliente.nombre).toBe('Constructora Demo');
    expect(detalle.body.proyecto.nombre).toBe('Torre Norte');
    // Base 300.000 + IVA 57.000. El total NO viaja como campo: se deriva sumando los dos.
    expect(detalle.body.valorTotal).toBe(300_000);
    expect(detalle.body.valorIva).toBe(57_000);
    expect(detalle.body.salidaId).toBeNull();
  });

  it('rechaza un proyecto que no pertenece al cliente indicado, señalando el campo', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const base = await escenario();
    const otroCliente = await crearClienteDePrueba(contexto.prisma, { nombre: 'Otra Constructora' });

    const respuesta = await request(servidor())
      .post('/api/cotizaciones')
      .set('Cookie', cookie)
      .send({ ...cuerpoValido(base), clienteId: otroCliente.id });

    expect(respuesta.status).toBe(400);
    expect((respuesta.body as CuerpoError).error.campos?.proyectoId).toBeDefined();
    expect(await contexto.prisma.cotizacion.count()).toBe(0);
  });

  it('rechaza una validez anterior a la fecha: sería una oferta nacida vencida', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const base = await escenario();

    const respuesta = await request(servidor())
      .post('/api/cotizaciones')
      .set('Cookie', cookie)
      .send({ ...cuerpoValido(base), fecha: '2026-08-16', fechaValidez: '2026-08-01' });

    expect(respuesta.status).toBe(400);
    expect((respuesta.body as CuerpoError).error.campos?.fechaValidez).toBeDefined();
  });

  it('solo permite editar mientras está en BORRADOR (FR-114)', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const base = await escenario();
    const creada = await request(servidor()).post('/api/cotizaciones').set('Cookie', cookie).send(cuerpoValido(base));

    const editadaEnBorrador = await request(servidor())
      .put(`/api/cotizaciones/${creada.body.id}`)
      .set('Cookie', cookie)
      .send({ ...cuerpoValido(base), observaciones: 'Precio corregido antes de enviar.' });
    expect(editadaEnBorrador.status).toBe(204);

    const enviada = await request(servidor())
      .post(`/api/cotizaciones/${creada.body.id}/enviar`)
      .set('Cookie', cookie);
    expect(enviada.status).toBe(204);

    const editadaTrasEnviar = await request(servidor())
      .put(`/api/cotizaciones/${creada.body.id}`)
      .set('Cookie', cookie)
      .send({ ...cuerpoValido(base), observaciones: 'Cambio a espaldas del cliente.' });
    expect(editadaTrasEnviar.status).toBe(409);

    // Y no quedó a medias: las observaciones siguen siendo las de antes de enviarla.
    const detalle = await request(servidor()).get(`/api/cotizaciones/${creada.body.id}`).set('Cookie', cookie);
    expect(detalle.body.observaciones).toBe('Precio corregido antes de enviar.');
  });

  /**
   * El corazón de US21 (FR-115/FR-113): aceptar crea la salida y NO mueve inventario. Las cuatro
   * comprobaciones van juntas a propósito — lo que hay que demostrar es que el sistema queda
   * coherente, no que una tabla concreta cambió.
   */
  it('aceptar genera una salida PENDIENTE con las mismas líneas y NO mueve stock', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const base = await escenario();
    const creada = await request(servidor()).post('/api/cotizaciones').set('Cookie', cookie).send(cuerpoValido(base));
    await request(servidor()).post(`/api/cotizaciones/${creada.body.id}/enviar`).set('Cookie', cookie);

    const stockAntes = (
      await contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(base.productoId) } })
    ).stockActual.toNumber();

    const aceptada = await request(servidor())
      .post(`/api/cotizaciones/${creada.body.id}/aceptar`)
      .set('Cookie', cookie);

    expect(aceptada.status).toBe(200);
    expect(aceptada.body.salidaId).toEqual(expect.any(Number));

    // 1. La cotización quedó ACEPTADA y enlazada a su salida.
    const detalle = await request(servidor()).get(`/api/cotizaciones/${creada.body.id}`).set('Cookie', cookie);
    expect(detalle.body.estado).toBe('ACEPTADA');
    expect(detalle.body.salidaId).toBe(aceptada.body.salidaId);

    // 2. La salida existe, es PENDIENTE y trae las MISMAS líneas, con su precio y su impuesto.
    const salida = await contexto.prisma.salida.findUniqueOrThrow({
      where: { id: BigInt(aceptada.body.salidaId) },
      include: { detalles: true },
    });
    expect(salida.estado).toBe('PENDIENTE');
    expect(Number(salida.cotizacionId)).toBe(creada.body.id);
    expect(salida.valorTotal.toNumber()).toBe(300_000);
    expect(salida.valorIva.toNumber()).toBe(57_000);
    expect(salida.detalles).toHaveLength(1);
    expect(salida.detalles[0]?.cantidad.toNumber()).toBe(10);
    expect(salida.detalles[0]?.precioUnitario.toNumber()).toBe(30_000);
    expect(salida.detalles[0]?.tasaIva.toNumber()).toBe(19);

    // 3. El stock NO se movió: ofrecer no es entregar, ni siquiera apartar (FR-113).
    const productoDespues = await contexto.prisma.producto.findUniqueOrThrow({
      where: { id: BigInt(base.productoId) },
    });
    expect(productoDespues.stockActual.toNumber()).toBe(stockAntes);

    // 4. Y no se escribió ningún movimiento de inventario.
    expect(await contexto.prisma.movimientoInventario.count()).toBe(0);
  });

  it('rechazar no genera nada y deja la cotización RECHAZADA', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const base = await escenario();
    const creada = await request(servidor()).post('/api/cotizaciones').set('Cookie', cookie).send(cuerpoValido(base));
    await request(servidor()).post(`/api/cotizaciones/${creada.body.id}/enviar`).set('Cookie', cookie);

    const rechazada = await request(servidor())
      .post(`/api/cotizaciones/${creada.body.id}/rechazar`)
      .set('Cookie', cookie);

    expect(rechazada.status).toBe(204);
    const detalle = await request(servidor()).get(`/api/cotizaciones/${creada.body.id}`).set('Cookie', cookie);
    expect(detalle.body.estado).toBe('RECHAZADA');
    expect(await contexto.prisma.salida.count()).toBe(0);
  });

  it('no se puede aceptar una cotización que sigue en BORRADOR', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const base = await escenario();
    const creada = await request(servidor()).post('/api/cotizaciones').set('Cookie', cookie).send(cuerpoValido(base));

    const intento = await request(servidor())
      .post(`/api/cotizaciones/${creada.body.id}/aceptar`)
      .set('Cookie', cookie);

    expect(intento.status).toBe(409);
    expect(await contexto.prisma.salida.count()).toBe(0);
  });

  /** "Vencida" se DERIVA de la fecha de validez, no la marca nadie (FR-112). */
  it('marca como vencida una cotización cuya validez ya pasó, sin que nadie la toque', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const base = await escenario();

    const vieja = await request(servidor())
      .post('/api/cotizaciones')
      .set('Cookie', cookie)
      .send({ ...cuerpoValido(base), fecha: '2020-01-01', fechaValidez: '2020-02-01' });
    const vigente = await request(servidor())
      .post('/api/cotizaciones')
      .set('Cookie', cookie)
      .send({ ...cuerpoValido(base), fecha: '2026-08-16', fechaValidez: '2099-01-01' });

    const listado = await request(servidor()).get('/api/cotizaciones').set('Cookie', cookie);
    const porId = new Map(
      (listado.body.datos as Array<{ id: number; vencida: boolean }>).map((fila) => [fila.id, fila.vencida]),
    );

    expect(porId.get(vieja.body.id)).toBe(true);
    expect(porId.get(vigente.body.id)).toBe(false);
  });

  it('anular exige motivo y deja la cotización ANULADA', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const base = await escenario();
    const creada = await request(servidor()).post('/api/cotizaciones').set('Cookie', cookie).send(cuerpoValido(base));

    const sinMotivo = await request(servidor())
      .post(`/api/cotizaciones/${creada.body.id}/anular`)
      .set('Cookie', cookie)
      .send({});
    expect(sinMotivo.status).toBe(400);

    const conMotivo = await request(servidor())
      .post(`/api/cotizaciones/${creada.body.id}/anular`)
      .set('Cookie', cookie)
      .send({ motivo: 'El cliente cambió el alcance del proyecto.' });
    expect(conMotivo.status).toBe(204);

    const detalle = await request(servidor()).get(`/api/cotizaciones/${creada.body.id}`).set('Cookie', cookie);
    expect(detalle.body.estado).toBe('ANULADA');
    expect(detalle.body.motivoAnulacion).toContain('alcance');
  });

  it('el OPERARIO puede armar cotizaciones pero no enviarlas ni cerrarlas (FR-117)', async () => {
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), operario.login, operario.password);
    const base = await escenario();

    const creada = await request(servidor()).post('/api/cotizaciones').set('Cookie', cookie).send(cuerpoValido(base));
    expect(creada.status).toBe(201);

    const enviada = await request(servidor())
      .post(`/api/cotizaciones/${creada.body.id}/enviar`)
      .set('Cookie', cookie);
    expect(enviada.status).toBe(403);

    const aceptada = await request(servidor())
      .post(`/api/cotizaciones/${creada.body.id}/aceptar`)
      .set('Cookie', cookie);
    expect(aceptada.status).toBe(403);
  });

  it('exporta la cotización como PDF con su número en el nombre del archivo (FR-116)', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const base = await escenario();
    const creada = await request(servidor()).post('/api/cotizaciones').set('Cookie', cookie).send(cuerpoValido(base));

    const respuesta = await request(servidor())
      .get(`/api/cotizaciones/${creada.body.id}/export?formato=pdf`)
      .set('Cookie', cookie)
      .buffer()
      .parse((res, callback) => {
        const trozos: Buffer[] = [];
        res.on('data', (trozo: Buffer) => trozos.push(trozo));
        res.on('end', () => callback(null, Buffer.concat(trozos)));
      });

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers['content-disposition']).toContain('COT-000001');
    // Un PDF real empieza por `%PDF`; comprobarlo evita dar por bueno un cuerpo vacío.
    expect((respuesta.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
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
