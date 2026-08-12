/**
 * Pruebas de integración de INGRESOS (T037, FR-013…FR-019) — API completa + PostgreSQL REAL,
 * contra el harness de `./setup.ts`. Cubren los invariantes críticos que SOLO se pueden
 * verificar contra la base real (docs/arquitectura.md §8, research R4/R5): unicidad
 * concurrente de `numero_factura`, atomicidad de `recibir`/`anular` (stock + movimientos en
 * la MISMA transacción, verificados consultando la BD directamente y no solo la respuesta
 * HTTP) y los guards de rol por endpoint.
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
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Línea del body de `POST /api/ingresos` (contracts/api-rest.md § Ingresos). */
interface LineaCuerpoIngreso {
  productoId: number;
  cantidad: number;
  precioUnitario: number;
}

describe('Ingresos — /api/ingresos (T037)', () => {
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

  /** Cuerpo mínimo válido de `POST /api/ingresos` (esquemaCrearIngreso) — solo varía la
   *  factura y las líneas, que es lo que cada prueba necesita controlar. */
  function cuerpoIngreso(numeroFactura: string, lineas: LineaCuerpoIngreso[]): Record<string, unknown> {
    return {
      numeroFactura,
      fechaFactura: '2026-01-10',
      proveedor: 'Proveedor de Prueba',
      fechaRecepcion: '2026-01-10',
      lineas,
    };
  }

  it(
    'unicidad concurrente de numeroFactura: de dos POST /api/ingresos en paralelo con la ' +
      'misma factura, exactamente uno recibe 201 y el otro 400 con el campo numeroFactura (FR-015)',
    async () => {
      const producto = await crearProductoDePrueba(contexto.prisma);
      const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

      const cuerpo = cuerpoIngreso('FAC-CONCURRENCIA-0001', [
        { productoId: producto.id, cantidad: 5, precioUnitario: 1000 },
      ]);

      const [respuestaA, respuestaB] = await Promise.all([
        request(servidor()).post('/api/ingresos').set('Cookie', cookie).send(cuerpo),
        request(servidor()).post('/api/ingresos').set('Cookie', cookie).send(cuerpo),
      ]);

      const estados = [respuestaA.status, respuestaB.status].sort((a, b) => a - b);
      expect(estados).toEqual([201, 400]);

      const respuestaRechazada = respuestaA.status === 400 ? respuestaA : respuestaB;
      expect(respuestaRechazada.body.error.campos).toEqual({
        numeroFactura: expect.stringContaining('ya existe'),
      });

      const totalEnBd = await contexto.prisma.ingreso.count({ where: { numeroFactura: 'FAC-CONCURRENCIA-0001' } });
      expect(totalEnBd).toBe(1); // el UNIQUE de BD garantizó que solo uno se insertó de verdad
    },
  );

  it('recibir suma el stock de cada producto y crea movimientos ENTRADA con usuario y documento correctos (FR-017/FR-021)', async () => {
    const productoA = await crearProductoDePrueba(contexto.prisma, { stockActual: 10 });
    const productoB = await crearProductoDePrueba(contexto.prisma, { stockActual: 3 });
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const cuerpo = cuerpoIngreso('FAC-RECIBIR-0001', [
      { productoId: productoA.id, cantidad: 5, precioUnitario: 1000 },
      { productoId: productoB.id, cantidad: 2, precioUnitario: 500 },
    ]);

    const respuestaCrear = await request(servidor()).post('/api/ingresos').set('Cookie', cookie).send(cuerpo);
    expect(respuestaCrear.status).toBe(201);
    const ingresoId: number = respuestaCrear.body.id;

    const respuestaRecibir = await request(servidor())
      .post(`/api/ingresos/${ingresoId}/recibir`)
      .set('Cookie', cookie);
    expect(respuestaRecibir.status).toBe(204);

    // El efecto en stock se verifica consultando la BD directamente, no solo el 204 de la HTTP.
    const [productoADespues, productoBDespues] = await Promise.all([
      contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(productoA.id) } }),
      contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(productoB.id) } }),
    ]);
    expect(productoADespues.stockActual.toNumber()).toBe(15); // 10 + 5
    expect(productoBDespues.stockActual.toNumber()).toBe(5); // 3 + 2

    const movimientos = await contexto.prisma.movimientoInventario.findMany({
      where: { documentoTipo: 'INGRESO', documentoId: BigInt(ingresoId) },
    });
    expect(movimientos).toHaveLength(2);
    for (const movimiento of movimientos) {
      expect(movimiento.tipo).toBe('ENTRADA');
      expect(Number(movimiento.usuarioId)).toBe(usuario.id);
      expect(Number(movimiento.documentoId)).toBe(ingresoId);
    }

    const movimientoA = movimientos.find((movimiento) => Number(movimiento.productoId) === productoA.id);
    expect(movimientoA?.cantidad.toNumber()).toBe(5);
    expect(movimientoA?.stockResultante.toNumber()).toBe(15);

    const movimientoB = movimientos.find((movimiento) => Number(movimiento.productoId) === productoB.id);
    expect(movimientoB?.cantidad.toNumber()).toBe(2);
    expect(movimientoB?.stockResultante.toNumber()).toBe(5);

    const ingresoEnBd = await contexto.prisma.ingreso.findUniqueOrThrow({ where: { id: BigInt(ingresoId) } });
    expect(ingresoEnBd.estado).toBe('RECIBIDO');
  });

  it('anular un ingreso RECIBIDO revierte el stock, crea un movimiento AJUSTE_SALIDA y guarda el motivo (FR-019)', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 10 });
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookieOperario = await iniciarSesion(servidor(), operario.login, operario.password);
    const cookieGerente = await iniciarSesion(servidor(), gerente.login, gerente.password);

    const cuerpo = cuerpoIngreso('FAC-ANULAR-0001', [{ productoId: producto.id, cantidad: 4, precioUnitario: 1000 }]);
    const respuestaCrear = await request(servidor()).post('/api/ingresos').set('Cookie', cookieOperario).send(cuerpo);
    expect(respuestaCrear.status).toBe(201);
    const ingresoId: number = respuestaCrear.body.id;

    const respuestaRecibir = await request(servidor())
      .post(`/api/ingresos/${ingresoId}/recibir`)
      .set('Cookie', cookieOperario);
    expect(respuestaRecibir.status).toBe(204);

    const productoTrasRecibir = await contexto.prisma.producto.findUniqueOrThrow({
      where: { id: BigInt(producto.id) },
    });
    expect(productoTrasRecibir.stockActual.toNumber()).toBe(14); // 10 + 4, punto de partida de la anulación

    const respuestaAnular = await request(servidor())
      .post(`/api/ingresos/${ingresoId}/anular`)
      .set('Cookie', cookieGerente)
      .send({ motivo: 'Factura registrada por error' });
    expect(respuestaAnular.status).toBe(204);

    const productoTrasAnular = await contexto.prisma.producto.findUniqueOrThrow({
      where: { id: BigInt(producto.id) },
    });
    expect(productoTrasAnular.stockActual.toNumber()).toBe(10); // vuelve exactamente al valor original

    const movimientosAjuste = await contexto.prisma.movimientoInventario.findMany({
      where: { documentoTipo: 'INGRESO', documentoId: BigInt(ingresoId), tipo: 'AJUSTE_SALIDA' },
    });
    expect(movimientosAjuste).toHaveLength(1);
    const [movimientoAjuste] = movimientosAjuste;
    expect(movimientoAjuste).toBeDefined();
    expect(movimientoAjuste?.cantidad.toNumber()).toBe(4);
    expect(movimientoAjuste?.stockResultante.toNumber()).toBe(10);
    expect(movimientoAjuste?.motivo).toBe('Factura registrada por error');
    expect(Number(movimientoAjuste?.usuarioId)).toBe(gerente.id);

    const ingresoEnBd = await contexto.prisma.ingreso.findUniqueOrThrow({ where: { id: BigInt(ingresoId) } });
    expect(ingresoEnBd.estado).toBe('ANULADO');
    expect(ingresoEnBd.motivoAnulacion).toBe('Factura registrada por error');
  });

  it(
    'rechaza anular un ingreso RECIBIDO cuyo stock ya bajó del necesario para revertir: 409 ' +
      'y el ingreso SIGUE RECIBIDO, sin anulación a medias (Principio I)',
    async () => {
      const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 10 });
      const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookieOperario = await iniciarSesion(servidor(), operario.login, operario.password);
      const cookieGerente = await iniciarSesion(servidor(), gerente.login, gerente.password);

      const cuerpo = cuerpoIngreso('FAC-INSUFICIENTE-0001', [
        { productoId: producto.id, cantidad: 5, precioUnitario: 1000 },
      ]);
      const respuestaCrear = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookieOperario)
        .send(cuerpo);
      const ingresoId: number = respuestaCrear.body.id;
      await request(servidor()).post(`/api/ingresos/${ingresoId}/recibir`).set('Cookie', cookieOperario);
      // 10 + 5 = 15 tras recibir. Simula que ese stock ya se consumió por una salida (US3,
      // fuera de este alcance) bajándolo DIRECTAMENTE en BD a menos de las 5 unidades que la
      // reversa de la anulación necesitaría devolver.
      await contexto.prisma.producto.update({ where: { id: BigInt(producto.id) }, data: { stockActual: 2 } });

      const respuestaAnular = await request(servidor())
        .post(`/api/ingresos/${ingresoId}/anular`)
        .set('Cookie', cookieGerente)
        .send({ motivo: 'Intento de anulación sin stock suficiente' });

      expect(respuestaAnular.status).toBe(409);
      expect(respuestaAnular.body.error.mensaje).toMatch(/insuficiente/i);

      // Rollback completo: ni el stock ni el estado del ingreso cambiaron (Principio I).
      const productoTrasIntento = await contexto.prisma.producto.findUniqueOrThrow({
        where: { id: BigInt(producto.id) },
      });
      expect(productoTrasIntento.stockActual.toNumber()).toBe(2);

      const ingresoEnBd = await contexto.prisma.ingreso.findUniqueOrThrow({ where: { id: BigInt(ingresoId) } });
      expect(ingresoEnBd.estado).toBe('RECIBIDO');
      expect(ingresoEnBd.motivoAnulacion).toBeNull();

      const totalMovimientosAjuste = await contexto.prisma.movimientoInventario.count({
        where: { documentoTipo: 'INGRESO', documentoId: BigInt(ingresoId), tipo: 'AJUSTE_SALIDA' },
      });
      expect(totalMovimientosAjuste).toBe(0);
    },
  );

  it('rechaza con 403 a un OPERARIO que intenta verificar un ingreso (acción restringida a Administrador/Gerente)', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 5 });
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookieOperario = await iniciarSesion(servidor(), operario.login, operario.password);

    const cuerpo = cuerpoIngreso('FAC-ROL-0001', [{ productoId: producto.id, cantidad: 1, precioUnitario: 500 }]);
    const respuestaCrear = await request(servidor()).post('/api/ingresos').set('Cookie', cookieOperario).send(cuerpo);
    const ingresoId: number = respuestaCrear.body.id;
    await request(servidor()).post(`/api/ingresos/${ingresoId}/recibir`).set('Cookie', cookieOperario);

    const respuestaVerificar = await request(servidor())
      .post(`/api/ingresos/${ingresoId}/verificar`)
      .set('Cookie', cookieOperario);

    expect(respuestaVerificar.status).toBe(403);

    const ingresoEnBd = await contexto.prisma.ingreso.findUniqueOrThrow({ where: { id: BigInt(ingresoId) } });
    expect(ingresoEnBd.estado).toBe('RECIBIDO'); // no avanzó a VERIFICADO
  });
});

/** Hace login por HTTP y devuelve la cookie de sesión lista para `.set('Cookie', …)` — mismo
 *  patrón local que `auth.spec.ts` (cada suite de integración define su propio helper). */
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
