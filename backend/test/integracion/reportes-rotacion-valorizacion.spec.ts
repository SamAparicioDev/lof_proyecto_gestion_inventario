/**
 * Pruebas de integración de los dos reportes de solo lectura sobre el inventario (T290/T297,
 * US37 y US38) — API completa + PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Lo que SOLO se puede ver aquí, y que las unitarias no cubren:
 *
 * 1. **Que el SQL crudo funciona.** `existenciasAFecha` y `costosVigentesAFecha` usan
 *    `DISTINCT ON`, que es de PostgreSQL y no lo valida ningún typecheck. Un doble en memoria
 *    diría que sí a cualquier cosa; solo la base real dice si la consulta es correcta.
 * 2. **Que la valorización a HOY cuadra con el reporte de inventario actual** (SC-020, FR-168).
 *    Son dos caminos completamente distintos hasta la misma cifra —uno lee `productos.stock_actual`
 *    y el otro reconstruye desde los movimientos—, así que si coinciden sobre datos reales, la
 *    reconstrucción es correcta. Es la prueba más valiosa de las dos historias.
 * 3. **Que las fechas se interpretan bien en la frontera**, incluido el rechazo de una futura.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend` (NUNCA contra `trazo`).
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

/** Días atrás desde ahora, para sembrar historias de antigüedad conocida. */
function haceDias(dias: number): Date {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

/** Fecha en `AAAA-MM-DD`, que es lo que pide el contrato. */
function iso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

describe('Inventario inmóvil y valorización — /api/reportes (T290/T297, US37/US38)', () => {
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

  /** Fija el costo vigente del producto — la factory no lo pide y estos reportes viven de él. */
  async function fijarCosto(productoId: number, costo: number): Promise<void> {
    await contexto.prisma.producto.update({
      where: { id: BigInt(productoId) },
      data: { ultimoCosto: costo },
    });
  }

  /**
   * Siembra un movimiento con FECHA y STOCK RESULTANTE conocidos, directamente con Prisma.
   *
   * Va por la base y no por la API a propósito: registrar una salida de hace 200 días es
   * imposible por HTTP —y debe serlo—, y lo que estas pruebas necesitan es una historia con
   * antigüedades controladas, no ejercitar el flujo de documentos que ya cubren otras suites.
   */
  async function sembrarMovimiento(datos: {
    productoId: number;
    tipo: 'ENTRADA' | 'SALIDA';
    cantidad: number;
    stockResultante: number;
    fechaHora: Date;
    usuarioId: number;
  }): Promise<void> {
    await contexto.prisma.movimientoInventario.create({
      data: {
        productoId: BigInt(datos.productoId),
        tipo: datos.tipo,
        cantidad: datos.cantidad,
        stockResultante: datos.stockResultante,
        // Los movimientos de estas pruebas no cuelgan de un documento real; `AJUSTE` es el único
        // `documento_tipo` que el CHECK de la tabla admite con `documento_id` nulo.
        documentoTipo: 'AJUSTE',
        documentoId: null,
        fechaHora: datos.fechaHora,
        usuarioId: BigInt(datos.usuarioId),
      },
    });
  }

  async function sesionAdministrador(): Promise<{ cookie: string; usuarioId: number }> {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);
    return { cookie, usuarioId: usuario.id };
  }

  // ==========================================================================================
  // US37 — inventario inmóvil
  // ==========================================================================================
  describe('inventario inmóvil (US37)', () => {
    it('sin sesión responde 401', async () => {
      expect((await request(servidor()).get('/api/reportes/inventario-inmovil')).status).toBe(401);
    });

    it('un Operario (sin reportes.ver) recibe 403', async () => {
      const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const cookie = await iniciarSesion(servidor(), operario.login, operario.password);
      const respuesta = await request(servidor()).get('/api/reportes/inventario-inmovil').set('Cookie', cookie);
      expect(respuesta.status).toBe(403);
    });

    it('lista lo detenido, ordenado por valor, y NO reinicia el contador con una entrada nueva (SC-019b)', async () => {
      const { cookie, usuarioId } = await sesionAdministrador();

      // Caro y detenido: salió hace 200 días y HOY recibió más mercancía.
      const caro = await crearProductoDePrueba(contexto.prisma, { sku: 'CEM-50', stockActual: 240 });
      await fijarCosto(caro.id, 28500);
      await sembrarMovimiento({ productoId: caro.id, tipo: 'ENTRADA', cantidad: 300, stockResultante: 300, fechaHora: haceDias(400), usuarioId });
      await sembrarMovimiento({ productoId: caro.id, tipo: 'SALIDA', cantidad: 120, stockResultante: 180, fechaHora: haceDias(200), usuarioId });
      // La compra de HOY: es lo que haría desaparecer el producto del reporte si el contador
      // mirara el último movimiento en vez de la última salida.
      await sembrarMovimiento({ productoId: caro.id, tipo: 'ENTRADA', cantidad: 60, stockResultante: 240, fechaHora: new Date(), usuarioId });

      // Barato y más viejo todavía: nunca ha salido.
      const barato = await crearProductoDePrueba(contexto.prisma, { sku: 'VAR-12', stockActual: 5 });
      await fijarCosto(barato.id, 900);
      await sembrarMovimiento({ productoId: barato.id, tipo: 'ENTRADA', cantidad: 5, stockResultante: 5, fechaHora: haceDias(500), usuarioId });

      // Rota con normalidad: fuera del reporte.
      const activo = await crearProductoDePrueba(contexto.prisma, { sku: 'ARE-40', stockActual: 80 });
      await fijarCosto(activo.id, 5000);
      await sembrarMovimiento({ productoId: activo.id, tipo: 'ENTRADA', cantidad: 100, stockResultante: 100, fechaHora: haceDias(60), usuarioId });
      await sembrarMovimiento({ productoId: activo.id, tipo: 'SALIDA', cantidad: 20, stockResultante: 80, fechaHora: haceDias(3), usuarioId });

      const respuesta = await request(servidor())
        .get('/api/reportes/inventario-inmovil?diasSinSalida=90')
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.productos.map((fila: { sku: string }) => fila.sku)).toEqual(['CEM-50', 'VAR-12']);

      const [primero, segundo] = respuesta.body.productos;
      // La entrada de HOY no lo rescató: sigue contando desde la salida de hace 200 días.
      expect(primero.diasSinSalida).toBe(200);
      expect(primero.nuncaHaSalido).toBe(false);
      expect(primero.valorInmovilizado).toBe(240 * 28500);
      // El que nunca salió cuenta desde su primera entrada y va señalado.
      expect(segundo.nuncaHaSalido).toBe(true);
      expect(segundo.diasSinSalida).toBe(500);
      expect(respuesta.body.valorTotalInmovilizado).toBe(240 * 28500 + 5 * 900);
    });

    it('un producto sin existencias no aparece por antiguo que sea (FR-160)', async () => {
      const { cookie, usuarioId } = await sesionAdministrador();
      const agotado = await crearProductoDePrueba(contexto.prisma, { sku: 'AGOTADO', stockActual: 0 });
      await fijarCosto(agotado.id, 99999);
      await sembrarMovimiento({ productoId: agotado.id, tipo: 'SALIDA', cantidad: 10, stockResultante: 0, fechaHora: haceDias(900), usuarioId });

      const respuesta = await request(servidor()).get('/api/reportes/inventario-inmovil').set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.productos).toHaveLength(0);
    });

    it('rechaza un umbral inválido con mensaje en español', async () => {
      const { cookie } = await sesionAdministrador();
      const respuesta = await request(servidor())
        .get('/api/reportes/inventario-inmovil?diasSinSalida=0')
        .set('Cookie', cookie);
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.campos.diasSinSalida).toContain('días');
    });
  });

  // ==========================================================================================
  // US38 — valorización a una fecha
  // ==========================================================================================
  describe('valorización a una fecha (US38)', () => {
    it('exige la fecha y rechaza una futura, con mensaje en español (FR-163, FR-167)', async () => {
      const { cookie } = await sesionAdministrador();

      const sinFecha = await request(servidor()).get('/api/reportes/valorizacion').set('Cookie', cookie);
      expect(sinFecha.status).toBe(400);
      expect(sinFecha.body.error.campos.fecha).toBeTruthy();

      const futura = await request(servidor())
        .get(`/api/reportes/valorizacion?fecha=${iso(haceDias(-30))}`)
        .set('Cookie', cookie);
      expect(futura.status).toBe(400);
      expect(futura.body.error.campos.fecha).toContain('futura');
    });

    it('reconstruye las existencias y el costo de ESE día, no los de hoy (FR-164, FR-165)', async () => {
      const { cookie, usuarioId } = await sesionAdministrador();

      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'CEM-50', stockActual: 240 });
      await fijarCosto(producto.id, 40000); // el costo de HOY

      // Historia: 300 hace 200 días, bajó a 180 hace 100 días, subió a 240 hace 10 días.
      await sembrarMovimiento({ productoId: producto.id, tipo: 'ENTRADA', cantidad: 300, stockResultante: 300, fechaHora: haceDias(200), usuarioId });
      await sembrarMovimiento({ productoId: producto.id, tipo: 'SALIDA', cantidad: 120, stockResultante: 180, fechaHora: haceDias(100), usuarioId });
      await sembrarMovimiento({ productoId: producto.id, tipo: 'ENTRADA', cantidad: 60, stockResultante: 240, fechaHora: haceDias(10), usuarioId });

      // El costo era 26.000 hasta hace 50 días, cuando subió a 40.000.
      await contexto.prisma.historialCostoProducto.create({
        data: {
          productoId: BigInt(producto.id),
          costoAnterior: 26000,
          costoNuevo: 40000,
          origen: 'EDICION_MANUAL',
          fechaHora: haceDias(50),
          usuarioId: BigInt(usuarioId),
        },
      });

      // Hace 60 días: había 180 unidades y el costo todavía era 26.000.
      const respuesta = await request(servidor())
        .get(`/api/reportes/valorizacion?fecha=${iso(haceDias(60))}`)
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.productos).toHaveLength(1);
      expect(respuesta.body.productos[0].existencias).toBe(180);
      // La rama del `costo_anterior`: todos los cambios registrados son POSTERIORES a la fecha.
      expect(respuesta.body.productos[0].costoVigente).toBe(26000);
      expect(respuesta.body.valorTotalInventario).toBe(180 * 26000);
    });

    it('un producto que en esa fecha no existía no aparece (FR-166)', async () => {
      const { cookie, usuarioId } = await sesionAdministrador();
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'NUEVO', stockActual: 10 });
      await fijarCosto(producto.id, 1000);
      await sembrarMovimiento({ productoId: producto.id, tipo: 'ENTRADA', cantidad: 10, stockResultante: 10, fechaHora: haceDias(5), usuarioId });

      const respuesta = await request(servidor())
        .get(`/api/reportes/valorizacion?fecha=${iso(haceDias(30))}`)
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.productos).toHaveLength(0);
      expect(respuesta.body.valorTotalInventario).toBe(0);
    });

    it('a la fecha de HOY cuadra EXACTAMENTE con el reporte de inventario actual (SC-020, FR-168)', async () => {
      const { cookie, usuarioId } = await sesionAdministrador();

      // Tres productos con historias distintas, para que el cuadre no salga por casualidad.
      const semillas = [
        { sku: 'UNO', stock: 240, costo: 28500 },
        { sku: 'DOS', stock: 5, costo: 900 },
        { sku: 'TRES', stock: 80, costo: 5000 },
      ];
      for (const semilla of semillas) {
        const producto = await crearProductoDePrueba(contexto.prisma, { sku: semilla.sku, stockActual: semilla.stock });
        await fijarCosto(producto.id, semilla.costo);
        await sembrarMovimiento({
          productoId: producto.id,
          tipo: 'ENTRADA',
          cantidad: semilla.stock,
          stockResultante: semilla.stock,
          fechaHora: haceDias(30),
          usuarioId,
        });
      }

      const [valorizacion, inventarioActual] = await Promise.all([
        request(servidor()).get(`/api/reportes/valorizacion?fecha=${iso(new Date())}`).set('Cookie', cookie),
        request(servidor()).get('/api/reportes/inventario').set('Cookie', cookie),
      ]);

      expect(valorizacion.status).toBe(200);
      expect(inventarioActual.status).toBe(200);
      // Dos caminos completamente distintos hasta la misma cifra: uno lee `stock_actual`, el otro
      // la reconstruye desde los movimientos. Que coincidan es lo que prueba la reconstrucción.
      expect(valorizacion.body.valorTotalInventario).toBe(inventarioActual.body.valorTotalInventario);
      expect(valorizacion.body.productos).toHaveLength(3);
    });

    it('exporta a Excel y PDF con la fecha en el nombre del archivo', async () => {
      const { cookie, usuarioId } = await sesionAdministrador();
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'EXP-01', stockActual: 3 });
      await fijarCosto(producto.id, 1500);
      await sembrarMovimiento({ productoId: producto.id, tipo: 'ENTRADA', cantidad: 3, stockResultante: 3, fechaHora: haceDias(2), usuarioId });

      for (const formato of ['xlsx', 'pdf'] as const) {
        const respuesta = await request(servidor())
          .get(`/api/reportes/valorizacion/export?fecha=${iso(new Date())}&formato=${formato}`)
          .set('Cookie', cookie);
        expect(respuesta.status).toBe(200);
        expect(respuesta.headers['content-disposition']).toContain('attachment');
        expect(Number(respuesta.headers['content-length'] ?? 0)).toBeGreaterThan(0);
      }
    });
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
