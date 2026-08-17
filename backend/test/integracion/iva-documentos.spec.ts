/**
 * Pruebas de integración del IVA en los documentos (T206, US20, FR-109…FR-111) — API completa +
 * PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Lo que se verifica aquí y no en la prueba unitaria del servicio: que lo calculado llegue
 * ESCRITO a las columnas correctas y que el resto del sistema no cambie de escala por ello. Son
 * tres afirmaciones sobre datos que conviven en cuatro tablas, así que la base real es el único
 * sitio donde se pueden comprobar juntas (docs/arquitectura.md §8):
 *
 *  - el impuesto se guarda LÍNEA A LÍNEA y la cabecera es su suma (FR-110);
 *  - recibir un ingreso con IVA deja el costo del producto en la BASE, no en el total, y el
 *    historial de costos guarda esa misma base (FR-111) — es la afirmación que protege todos
 *    los reportes de valorización;
 *  - un documento sin tasa vale exactamente lo que valía antes de la historia.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend`.
 */
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearProductoDePrueba,
  crearProveedorDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

describe('IVA en los documentos — US20 (T206)', () => {
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

  /**
   * El caso que justifica calcular línea a línea (FR-110): dos tasas conviviendo. Sobre una base
   * total de 30.000, aplicar 19% al total daría 5.700; lo correcto son 1.900 + 500 = 2.400.
   */
  it('guarda el impuesto de cada línea y la cabecera con su suma, con tasas distintas en el mismo documento', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor con IVA');
    const gravado = await crearProductoDePrueba(contexto.prisma, { sku: 'IVA-19', stockActual: 0 });
    const reducido = await crearProductoDePrueba(contexto.prisma, { sku: 'IVA-05', stockActual: 0 });
    const exento = await crearProductoDePrueba(contexto.prisma, { sku: 'IVA-00', stockActual: 0 });

    const respuesta = await request(servidor())
      .post('/api/ingresos')
      .set('Cookie', cookie)
      .send({
        numeroFactura: 'FAC-IVA-0001',
        fechaFactura: '2026-08-16',
        proveedorId,
        fechaRecepcion: '2026-08-16',
        lineas: [
          { productoId: gravado.id, cantidad: 10, precioUnitario: 1_000, tasaIva: 19 },
          { productoId: reducido.id, cantidad: 10, precioUnitario: 1_000, tasaIva: 5 },
          { productoId: exento.id, cantidad: 10, precioUnitario: 1_000, tasaIva: 0 },
        ],
      });

    expect(respuesta.status).toBe(201);

    const ingreso = await contexto.prisma.ingreso.findUniqueOrThrow({
      where: { id: BigInt(respuesta.body.id) },
      include: { detalles: { orderBy: { id: 'asc' } } },
    });

    // Base intacta: `valor_total` NO cambió de significado con US20.
    expect(ingreso.valorTotal.toNumber()).toBe(30_000);
    expect(ingreso.valorIva.toNumber()).toBe(2_400);

    expect(ingreso.detalles.map((detalle) => detalle.tasaIva.toNumber())).toEqual([19, 5, 0]);
    expect(ingreso.detalles.map((detalle) => detalle.valorIva.toNumber())).toEqual([1_900, 500, 0]);
    // La cabecera es exactamente la suma de sus líneas, no un cálculo aparte.
    const sumaLineas = ingreso.detalles.reduce((suma, detalle) => suma + detalle.valorIva.toNumber(), 0);
    expect(ingreso.valorIva.toNumber()).toBe(sumaLineas);
  });

  /**
   * FR-111, la afirmación que protege todos los reportes de valorización: el IVA es un impuesto
   * recuperable, no lo que vale la mercancía. Si el costo se contaminara con el impuesto, el
   * valor del inventario subiría un 19% frente a la contabilidad sin que nadie lo decidiera.
   */
  it('recibir un ingreso con IVA deja el costo del producto en la BASE, no en el total', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor del costo');
    const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'IVA-COSTO', stockActual: 0 });

    const ingreso = await request(servidor())
      .post('/api/ingresos')
      .set('Cookie', cookie)
      .send({
        numeroFactura: 'FAC-IVA-COSTO',
        fechaFactura: '2026-08-16',
        proveedorId,
        fechaRecepcion: '2026-08-16',
        lineas: [{ productoId: producto.id, cantidad: 4, precioUnitario: 25_000, tasaIva: 19 }],
      });
    expect(ingreso.status).toBe(201);

    const recibido = await request(servidor())
      .post(`/api/ingresos/${ingreso.body.id}/recibir`)
      .set('Cookie', cookie);
    expect(recibido.status).toBe(204);

    const actualizado = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(producto.id) } });
    expect(actualizado.ultimoCosto.toNumber()).toBe(25_000); // NO 29.750
    expect(actualizado.stockActual.toNumber()).toBe(4);

    const historial = await contexto.prisma.historialCostoProducto.findMany({
      where: { productoId: BigInt(producto.id) },
    });
    expect(historial).toHaveLength(1);
    expect(historial[0]?.costoNuevo.toNumber()).toBe(25_000);
  });

  it('un documento sin tasa vale exactamente lo que valía antes de US20', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor sin IVA');
    const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'IVA-AUSENTE', stockActual: 0 });

    // El cuerpo NO trae `tasaIva`, igual que lo enviaría un cliente anterior a la historia.
    const respuesta = await request(servidor())
      .post('/api/ingresos')
      .set('Cookie', cookie)
      .send({
        numeroFactura: 'FAC-SIN-IVA',
        fechaFactura: '2026-08-16',
        proveedorId,
        fechaRecepcion: '2026-08-16',
        lineas: [{ productoId: producto.id, cantidad: 2, precioUnitario: 5_000 }],
      });

    expect(respuesta.status).toBe(201);
    const ingreso = await contexto.prisma.ingreso.findUniqueOrThrow({
      where: { id: BigInt(respuesta.body.id) },
      include: { detalles: true },
    });
    expect(ingreso.valorTotal.toNumber()).toBe(10_000);
    expect(ingreso.valorIva.toNumber()).toBe(0);
    expect(ingreso.detalles[0]?.tasaIva.toNumber()).toBe(0);
  });

  it('rechaza una tasa que no es de las vigentes en Colombia, sin crear el documento', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor tasa inválida');
    const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'IVA-INVALIDA', stockActual: 0 });

    const respuesta = await request(servidor())
      .post('/api/ingresos')
      .set('Cookie', cookie)
      .send({
        numeroFactura: 'FAC-IVA-MALA',
        fechaFactura: '2026-08-16',
        proveedorId,
        fechaRecepcion: '2026-08-16',
        lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1_000, tasaIva: 16 }],
      });

    expect(respuesta.status).toBe(400);
    expect(await contexto.prisma.ingreso.count()).toBe(0);
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
