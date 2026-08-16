/**
 * Pruebas de integración del ALTA DE PRODUCTO CON EXISTENCIAS INICIALES (T190, US18,
 * FR-106/FR-107) — API completa + PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Lo que hay que demostrar aquí no es que el producto se cree —eso ya lo cubre `inventario.spec`—
 * sino que la cantidad inicial NO se escribe como stock, sino que genera el MISMO rastro que un
 * ingreso registrado a mano: documento, línea, movimiento de `ENTRADA` y registro de costo. Es
 * un invariante de los que `docs/arquitectura.md` §8 exige probar contra la base real, porque lo
 * que se verifica es que cuatro tablas quedan coherentes entre sí.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend`.
 */
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearProveedorDePrueba,
  crearUnidadMedidaDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

interface CuerpoError {
  error: { mensaje: string; campos?: Record<string, string> };
}

describe('Alta de producto con existencias iniciales — POST /api/productos (T190, US18)', () => {
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

  /** Unidad de medida (obligatoria desde US17) + proveedor al que atribuir el ingreso. */
  async function catalogoMinimo(): Promise<{ unidadMedidaId: number; proveedorId: number }> {
    return {
      unidadMedidaId: await crearUnidadMedidaDePrueba(contexto.prisma, 'Bulto', 'bulto'),
      proveedorId: await crearProveedorDePrueba(contexto.prisma, 'Cementos del Valle'),
    };
  }

  it('registra la cantidad inicial como un INGRESO recibido, con movimiento de entrada e historial de costo', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const { unidadMedidaId, proveedorId } = await catalogoMinimo();

    const respuesta = await request(servidor())
      .post('/api/productos')
      .set('Cookie', cookie)
      .send({
        sku: 'ALTA-CON-STOCK-001',
        descripcion: 'Cemento gris 50 kg',
        unidadMedidaId,
        umbralStockBajo: 5,
        proveedorId,
        cantidadInicial: 40,
        valorUnitario: 28_500,
      });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.ingresoId).toEqual(expect.any(Number));

    // 1. El producto tiene el stock y el costo informados.
    const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'ALTA-CON-STOCK-001' } });
    expect(producto.stockActual.toNumber()).toBe(40);
    expect(producto.ultimoCosto.toNumber()).toBe(28_500);

    // 2. Y ese stock lo respalda un ingreso RECIBIDO del proveedor informado — no un proveedor
    //    sintético: es la diferencia deliberada con la carga masiva, que no tiene a quién
    //    preguntarle.
    const ingreso = await contexto.prisma.ingreso.findUniqueOrThrow({
      where: { id: BigInt(respuesta.body.ingresoId) },
      include: { detalles: true, proveedor: true },
    });
    expect(ingreso.estado).toBe('RECIBIDO');
    expect(ingreso.numeroFactura).toMatch(/^ALTA-/);
    expect(ingreso.proveedor.nombre).toBe('Cementos del Valle');
    expect(Number(ingreso.usuarioRegistraId)).toBe(admin.id);
    expect(ingreso.detalles).toHaveLength(1);
    expect(ingreso.detalles[0]?.cantidad.toNumber()).toBe(40);
    expect(ingreso.detalles[0]?.precioUnitario.toNumber()).toBe(28_500);

    // 3. Con su movimiento de inventario: el stock no se escribió, se movió (Principio I y II).
    const movimientos = await contexto.prisma.movimientoInventario.findMany({
      where: { documentoTipo: 'INGRESO', documentoId: ingreso.id },
    });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]?.tipo).toBe('ENTRADA');
    expect(movimientos[0]?.cantidad.toNumber()).toBe(40);
    expect(Number(movimientos[0]?.productoId)).toBe(Number(producto.id));

    // 4. Y el costo con el que nace el producto queda registrado, no aparecido de la nada.
    const historial = await contexto.prisma.historialCostoProducto.findMany({
      where: { productoId: producto.id },
    });
    expect(historial).toHaveLength(1);
    expect(historial[0]?.costoNuevo.toNumber()).toBe(28_500);
  });

  it('sin cantidad inicial el alta se comporta como antes de US18: producto en cero y ningún ingreso', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const { unidadMedidaId } = await catalogoMinimo();

    const respuesta = await request(servidor())
      .post('/api/productos')
      .set('Cookie', cookie)
      .send({ sku: 'ALTA-SIN-STOCK-001', descripcion: 'Producto sin existencias', unidadMedidaId });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.ingresoId).toBeNull();

    const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'ALTA-SIN-STOCK-001' } });
    expect(producto.stockActual.toNumber()).toBe(0);
    expect(await contexto.prisma.ingreso.count()).toBe(0);
    expect(await contexto.prisma.movimientoInventario.count()).toBe(0);
  });

  /**
   * La validación cruzada de FR-106, anclada al campo que falta. Un mensaje general obligaría al
   * usuario a adivinar cuál de los dos campos le está faltando.
   */
  it('rechaza una cantidad inicial sin proveedor o sin valor unitario, señalando el campo, y no crea nada', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const { unidadMedidaId, proveedorId } = await catalogoMinimo();

    const sinProveedor = await request(servidor())
      .post('/api/productos')
      .set('Cookie', cookie)
      .send({
        sku: 'ALTA-SIN-PROVEEDOR',
        descripcion: 'Producto con cantidad y sin proveedor',
        unidadMedidaId,
        cantidadInicial: 10,
        valorUnitario: 1_000,
      });
    expect(sinProveedor.status).toBe(400);
    expect((sinProveedor.body as CuerpoError).error.campos?.proveedorId).toBeDefined();

    const sinValor = await request(servidor())
      .post('/api/productos')
      .set('Cookie', cookie)
      .send({
        sku: 'ALTA-SIN-VALOR',
        descripcion: 'Producto con cantidad y sin valor unitario',
        unidadMedidaId,
        proveedorId,
        cantidadInicial: 10,
      });
    expect(sinValor.status).toBe(400);
    expect((sinValor.body as CuerpoError).error.campos?.valorUnitario).toBeDefined();

    // Ninguno de los dos rechazos dejó producto a medio crear.
    expect(await contexto.prisma.producto.count()).toBe(0);
  });

  it('acepta proveedor y valor unitario sin cantidad: sin cantidad no hay nada que registrar', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const { unidadMedidaId, proveedorId } = await catalogoMinimo();

    const respuesta = await request(servidor())
      .post('/api/productos')
      .set('Cookie', cookie)
      .send({
        sku: 'ALTA-CANTIDAD-CERO',
        descripcion: 'Producto con cantidad en cero',
        unidadMedidaId,
        proveedorId,
        cantidadInicial: 0,
        valorUnitario: 500,
      });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.ingresoId).toBeNull();
    expect(await contexto.prisma.ingreso.count()).toBe(0);
  });

  it('el OPERARIO también puede dar de alta con existencias: es la misma acción que ya podía hacer en dos pasos', async () => {
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), operario.login, operario.password);
    const { unidadMedidaId, proveedorId } = await catalogoMinimo();

    const respuesta = await request(servidor())
      .post('/api/productos')
      .set('Cookie', cookie)
      .send({
        sku: 'ALTA-OPERARIO-001',
        descripcion: 'Producto dado de alta por el operario',
        unidadMedidaId,
        proveedorId,
        cantidadInicial: 3,
        valorUnitario: 900,
      });

    expect(respuesta.status).toBe(201);
    const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'ALTA-OPERARIO-001' } });
    expect(producto.stockActual.toNumber()).toBe(3);
  });

  it('rechaza un proveedor INACTIVO igual que lo haría un ingreso manual', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    const { unidadMedidaId } = await catalogoMinimo();
    const proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor Retirado');
    await request(servidor())
      .put(`/api/proveedores/${proveedorId}/estado`)
      .set('Cookie', cookie)
      .send({ estado: 'INACTIVO' });

    const respuesta = await request(servidor())
      .post('/api/productos')
      .set('Cookie', cookie)
      .send({
        sku: 'ALTA-PROVEEDOR-INACTIVO',
        descripcion: 'Producto con proveedor retirado',
        unidadMedidaId,
        proveedorId,
        cantidadInicial: 5,
        valorUnitario: 100,
      });

    expect(respuesta.status).toBe(400);
    expect((respuesta.body as CuerpoError).error.campos?.proveedorId).toContain('inactivo');
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
