/**
 * Pruebas de integración de las ÓRDENES DE COMPRA (T176, US16, FR-094…FR-100) — API completa +
 * PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Cubre lo que SOLO se puede verificar contra la base real (docs/arquitectura.md §8):
 *
 *  - **El correlativo bajo CONCURRENCIA** (FR-095): dos altas simultáneas no pueden recibir el
 *    mismo número. Es el mismo invariante que ya se prueba para las salidas, y por el mismo
 *    motivo: `MAX()+1` lo rompería y ninguna prueba con mocks lo detectaría.
 *  - **La edición fuera de BORRADOR** (FR-096): la rechaza el adaptador dentro de su
 *    transacción, releyendo el estado.
 *  - **Las sugerencias** (FR-098): la consulta cruza stock, comprometido y quién suministró qué.
 *  - **El cierre de la orden al recibir el ingreso** (FR-099), verificado consultando la BD:
 *    la orden queda RECIBIDA y el stock se movió UNA sola vez.
 *  - **El reparto de permisos** (FR-100): el Operario arma pedidos pero no los envía.
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

interface OrdenBody {
  id: number;
  numero: number;
  proveedor: { id: number; nombre: string };
  estado: 'BORRADOR' | 'ENVIADA' | 'RECIBIDA' | 'ANULADA';
  valorTotal: number;
  motivoAnulacion: string | null;
  detalles: { productoId: number; cantidad: number; precioUnitario: number; valorTotal: number }[];
}

interface SugerenciaBody {
  productoId: number;
  sku: string;
  disponible: number;
  umbralStockBajo: number;
  cantidadSugerida: number;
  precioSugerido: number;
}

interface CuerpoError {
  error: { mensaje: string; campos?: Record<string, string> };
}

describe('Órdenes de compra — /api/ordenes-compra (T176, US16)', () => {
  let contexto: AppDePrueba;
  let proveedorId: number;

  beforeAll(async () => {
    contexto = await crearAppDePrueba();
  });

  afterAll(async () => {
    await cerrarAppDePrueba(contexto.app);
  });

  beforeEach(async () => {
    await truncarTablas(contexto.prisma);
    proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor de Órdenes');
  });

  const servidor = (): ReturnType<AppDePrueba['app']['getHttpServer']> => contexto.app.getHttpServer();

  /** Sesión de un Gerente: tiene los cinco permisos de órdenes (ver la matriz del seed). */
  async function sesionGerente(): Promise<string> {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    return iniciarSesion(servidor(), usuario.login, usuario.password);
  }

  function cuerpoOrden(productoId: number, cantidad = 10, precioUnitario = 1_000): Record<string, unknown> {
    return {
      proveedorId,
      fechaOrden: '2026-03-01',
      fechaEntregaEsperada: '2026-03-10',
      lineas: [{ productoId, cantidad, precioUnitario }],
    };
  }

  it(
    'correlativo único bajo concurrencia: dos POST en paralelo reciben números DISTINTOS y ' +
      'consecutivos (FR-095)',
    async () => {
      const cookie = await sesionGerente();
      const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });

      const [primera, segunda] = await Promise.all([
        request(servidor()).post('/api/ordenes-compra').set('Cookie', cookie).send(cuerpoOrden(producto.id)),
        request(servidor()).post('/api/ordenes-compra').set('Cookie', cookie).send(cuerpoOrden(producto.id)),
      ]);

      expect(primera.status).toBe(201);
      expect(segunda.status).toBe(201);
      const numeroPrimera = primera.body.numero as number;
      const numeroSegunda = segunda.body.numero as number;
      const menor = Math.min(numeroPrimera, numeroSegunda);
      const mayor = Math.max(numeroPrimera, numeroSegunda);
      expect(menor).not.toBe(mayor);
      expect(mayor).toBe(menor + 1);

      // El contador quedó en el último número entregado: sin huecos ni números "quemados".
      const contador = await contexto.prisma.contador.findUniqueOrThrow({ where: { clave: 'orden_compra' } });
      expect(Number(contador.valor)).toBe(mayor);
    },
  );

  it('calcula el valor total a partir de las líneas: nunca se teclea (FR-094)', async () => {
    const cookie = await sesionGerente();
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });

    const creada = await request(servidor())
      .post('/api/ordenes-compra')
      .set('Cookie', cookie)
      .send({
        proveedorId,
        fechaOrden: '2026-03-01',
        lineas: [{ productoId: producto.id, cantidad: 3, precioUnitario: 2_500 }],
      });
    expect(creada.status).toBe(201);

    const detalle = await request(servidor()).get(`/api/ordenes-compra/${creada.body.id}`).set('Cookie', cookie);
    const orden = detalle.body as OrdenBody;
    expect(orden.valorTotal).toBe(7_500);
    expect(orden.detalles).toHaveLength(1);
    expect(orden.detalles[0]?.valorTotal).toBe(7_500);
    expect(orden.estado).toBe('BORRADOR');
  });

  it('una orden ENVIADA ya no se edita, pero sí se anula con motivo (FR-096)', async () => {
    const cookie = await sesionGerente();
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });
    const creada = await request(servidor())
      .post('/api/ordenes-compra')
      .set('Cookie', cookie)
      .send(cuerpoOrden(producto.id));
    const ordenId = creada.body.id as number;

    expect((await request(servidor()).post(`/api/ordenes-compra/${ordenId}/enviar`).set('Cookie', cookie)).status).toBe(
      204,
    );

    const edicion = await request(servidor())
      .put(`/api/ordenes-compra/${ordenId}`)
      .set('Cookie', cookie)
      .send(cuerpoOrden(producto.id, 99));
    expect(edicion.status).toBe(409);

    // Enviarla dos veces tampoco: `ENVIADA → ENVIADA` no es una transición válida.
    expect((await request(servidor()).post(`/api/ordenes-compra/${ordenId}/enviar`).set('Cookie', cookie)).status).toBe(
      409,
    );

    const anulada = await request(servidor())
      .post(`/api/ordenes-compra/${ordenId}/anular`)
      .set('Cookie', cookie)
      .send({ motivo: 'El proveedor no tiene existencias' });
    expect(anulada.status).toBe(204);

    const detalle = await request(servidor()).get(`/api/ordenes-compra/${ordenId}`).set('Cookie', cookie);
    expect((detalle.body as OrdenBody).estado).toBe('ANULADA');
    expect((detalle.body as OrdenBody).motivoAnulacion).toBe('El proveedor no tiene existencias');
  });

  it('anular sin motivo se rechaza señalando el campo', async () => {
    const cookie = await sesionGerente();
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });
    const creada = await request(servidor())
      .post('/api/ordenes-compra')
      .set('Cookie', cookie)
      .send(cuerpoOrden(producto.id));

    const sinMotivo = await request(servidor())
      .post(`/api/ordenes-compra/${creada.body.id}/anular`)
      .set('Cookie', cookie)
      .send({ motivo: '   ' });

    expect(sinMotivo.status).toBe(400);
    expect((sinMotivo.body as CuerpoError).error.campos?.motivo).toContain('obligatorio');
  });

  describe('sugerencias por proveedor (FR-098)', () => {
    it('trae solo lo que está bajo umbral Y este proveedor ya suministró, con su cantidad sugerida', async () => {
      const cookie = await sesionGerente();

      // Los umbrales son ALTOS a propósito: acreditar a un proveedor exige recibirle un ingreso,
      // y ese ingreso sube el stock. Con un umbral de 5 y una recepción de 4 unidades, el
      // producto dejaría de estar bajo mínimos justo por el paso que lo hace elegible.

      // 1) Bajo umbral y suministrado por ESTE proveedor → se sugiere.
      const bajoDelProveedor = await crearProductoDePrueba(contexto.prisma, {
        sku: 'SUG-BAJO-PROVEEDOR',
        stockActual: 2,
        umbralStockBajo: 20,
      });
      // 2) Bajo umbral pero suministrado por OTRO proveedor → no se sugiere.
      const bajoDeOtro = await crearProductoDePrueba(contexto.prisma, {
        sku: 'SUG-BAJO-OTRO',
        stockActual: 1,
        umbralStockBajo: 20,
      });
      // 3) Suministrado por este proveedor pero CON stock de sobra → no se sugiere.
      const holgado = await crearProductoDePrueba(contexto.prisma, {
        sku: 'SUG-HOLGADO',
        stockActual: 100,
        umbralStockBajo: 5,
      });

      const otroProveedorId = await crearProveedorDePrueba(contexto.prisma, 'Otro Proveedor');
      await registrarIngresoRecibido(cookie, proveedorId, [bajoDelProveedor.id, holgado.id], 'FAC-SUG-001');
      await registrarIngresoRecibido(cookie, otroProveedorId, [bajoDeOtro.id], 'FAC-SUG-002');

      const respuesta = await request(servidor())
        .get('/api/ordenes-compra/sugerencias')
        .query({ proveedorId })
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      const sugerencias = respuesta.body as SugerenciaBody[];
      const skus = sugerencias.map((sugerencia) => sugerencia.sku);
      expect(skus).toContain('SUG-BAJO-PROVEEDOR');
      expect(skus).not.toContain('SUG-BAJO-OTRO'); // es de otro proveedor
      expect(skus).not.toContain('SUG-HOLGADO'); // no está bajo umbral

      // El ingreso sumó 4 a las 2 que ya tenía: 6 disponibles contra un umbral de 20. La
      // sugerencia lleva el stock al doble del umbral (40 − 6 = 34), que es el primer valor con
      // margen real — reponer hasta el umbral lo dejaría en alerta permanente.
      const sugerida = sugerencias.find((sugerencia) => sugerencia.sku === 'SUG-BAJO-PROVEEDOR');
      expect(sugerida).toBeDefined();
      expect(sugerida?.disponible).toBe(6);
      expect(sugerida?.cantidadSugerida).toBe(34);
      expect(sugerida?.precioSugerido).toBe(1_500); // el último costo pagado, del ingreso de arriba
    });

    it('un proveedor sin nada que pedirle devuelve una lista vacía, no un error', async () => {
      const cookie = await sesionGerente();
      const respuesta = await request(servidor())
        .get('/api/ordenes-compra/sugerencias')
        .query({ proveedorId })
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual([]);
    });
  });

  describe('enlace con el ingreso (FR-099)', () => {
    it('recibir el ingreso vinculado deja la orden RECIBIDA y mueve el stock UNA sola vez', async () => {
      const cookie = await sesionGerente();
      const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });

      const creada = await request(servidor())
        .post('/api/ordenes-compra')
        .set('Cookie', cookie)
        .send(cuerpoOrden(producto.id, 25, 4_000));
      const ordenId = creada.body.id as number;
      await request(servidor()).post(`/api/ordenes-compra/${ordenId}/enviar`).set('Cookie', cookie);

      const ingreso = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie)
        .send({
          numeroFactura: 'FAC-DESDE-ORDEN-001',
          fechaFactura: '2026-03-08',
          proveedorId,
          ordenCompraId: ordenId,
          fechaRecepcion: '2026-03-09',
          lineas: [{ productoId: producto.id, cantidad: 25, precioUnitario: 4_000 }],
        });
      expect(ingreso.status).toBe(201);

      // Antes de recibir: la orden sigue ENVIADA y el stock no se ha movido. Crear el ingreso
      // no es recibir la mercancía.
      let orden = await contexto.prisma.ordenCompra.findUniqueOrThrow({ where: { id: BigInt(ordenId) } });
      expect(orden.estado).toBe('ENVIADA');
      let enBd = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(producto.id) } });
      expect(enBd.stockActual.toNumber()).toBe(0);

      const recibido = await request(servidor())
        .post(`/api/ingresos/${ingreso.body.id}/recibir`)
        .set('Cookie', cookie);
      expect(recibido.status).toBe(204);

      orden = await contexto.prisma.ordenCompra.findUniqueOrThrow({ where: { id: BigInt(ordenId) } });
      expect(orden.estado).toBe('RECIBIDA');

      enBd = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(producto.id) } });
      expect(enBd.stockActual.toNumber()).toBe(25); // una sola vez, no 50

      // Y un solo movimiento ENTRADA: la orden no escribe en el historial de inventario (FR-096).
      const movimientos = await contexto.prisma.movimientoInventario.findMany({
        where: { productoId: BigInt(producto.id) },
      });
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0]?.documentoTipo).toBe('INGRESO');
    });

    it('rechaza vincular un ingreso a una orden de OTRO proveedor, señalando el campo', async () => {
      const cookie = await sesionGerente();
      const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });
      const otroProveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor Ajeno');

      const creada = await request(servidor())
        .post('/api/ordenes-compra')
        .set('Cookie', cookie)
        .send(cuerpoOrden(producto.id));
      await request(servidor()).post(`/api/ordenes-compra/${creada.body.id}/enviar`).set('Cookie', cookie);

      const intento = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie)
        .send({
          numeroFactura: 'FAC-CRUZADA-001',
          fechaFactura: '2026-03-08',
          proveedorId: otroProveedorId,
          ordenCompraId: creada.body.id,
          fechaRecepcion: '2026-03-09',
          lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1_000 }],
        });

      expect(intento.status).toBe(400);
      expect((intento.body as CuerpoError).error.campos?.ordenCompraId).toContain('Proveedor de Órdenes');
    });

    it('rechaza vincular un ingreso a una orden que todavía es BORRADOR', async () => {
      const cookie = await sesionGerente();
      const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });
      const creada = await request(servidor())
        .post('/api/ordenes-compra')
        .set('Cookie', cookie)
        .send(cuerpoOrden(producto.id));

      const intento = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie)
        .send({
          numeroFactura: 'FAC-BORRADOR-001',
          fechaFactura: '2026-03-08',
          proveedorId,
          ordenCompraId: creada.body.id,
          fechaRecepcion: '2026-03-09',
          lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1_000 }],
        });

      expect(intento.status).toBe(400);
      expect((intento.body as CuerpoError).error.campos?.ordenCompraId).toContain('enviada');
    });
  });

  it('el Operario arma pedidos pero no los envía ni los anula (FR-100)', async () => {
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), operario.login, operario.password);
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });

    const creada = await request(servidor())
      .post('/api/ordenes-compra')
      .set('Cookie', cookie)
      .send(cuerpoOrden(producto.id));
    expect(creada.status).toBe(201); // sí puede crear: es quien ve faltar la mercancía

    const listado = await request(servidor()).get('/api/ordenes-compra').set('Cookie', cookie);
    expect(listado.status).toBe(200);

    const edicion = await request(servidor())
      .put(`/api/ordenes-compra/${creada.body.id}`)
      .set('Cookie', cookie)
      .send(cuerpoOrden(producto.id, 5));
    expect(edicion.status).toBe(204); // editar su borrador, también

    // Pero comprometer el gasto frente al proveedor, no.
    expect((await request(servidor()).post(`/api/ordenes-compra/${creada.body.id}/enviar`).set('Cookie', cookie)).status).toBe(403);
    expect(
      (
        await request(servidor())
          .post(`/api/ordenes-compra/${creada.body.id}/anular`)
          .set('Cookie', cookie)
          .send({ motivo: 'da igual' })
      ).status,
    ).toBe(403);
  });

  /** Registra un ingreso y lo recibe, para que esos productos queden acreditados como
   *  suministrados por ese proveedor (lo que la consulta de sugerencias exige). */
  async function registrarIngresoRecibido(
    cookie: string,
    proveedor: number,
    productoIds: readonly number[],
    numeroFactura: string,
  ): Promise<void> {
    const creado = await request(servidor())
      .post('/api/ingresos')
      .set('Cookie', cookie)
      .send({
        numeroFactura,
        fechaFactura: '2026-02-01',
        proveedorId: proveedor,
        fechaRecepcion: '2026-02-02',
        lineas: productoIds.map((productoId) => ({ productoId, cantidad: 4, precioUnitario: 1_500 })),
      });
    expect(creado.status).toBe(201);
    const recibido = await request(servidor()).post(`/api/ingresos/${creado.body.id}/recibir`).set('Cookie', cookie);
    expect(recibido.status).toBe(204);
  }
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
