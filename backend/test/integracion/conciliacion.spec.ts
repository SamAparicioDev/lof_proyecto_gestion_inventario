/**
 * Prueba de CONCILIACIÓN (T058, data-model.md § invariantes) — API completa + PostgreSQL
 * REAL, contra el harness de `./setup.ts`. Verifica el invariante 2 de `data-model.md`:
 * `stock_actual(p) = Σ movimientos(p)` con signo por tipo, tras una secuencia REAL de
 * entradas, salidas y anulaciones que mezcla ambos módulos (US1 + US3) — no una operación
 * aislada, sino el ciclo completo que la operación real produce.
 *
 * También ejercita el trigger de inmutabilidad de `movimientos_inventario` (T009, FR-046,
 * invariante 7) en el contexto real de esta tanda: ni `UPDATE` ni `DELETE` deben poder
 * modificar un movimiento ya insertado.
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
  crearProveedorDePrueba,
  crearProyectoDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Signo con el que cada `tipo` de `movimientos_inventario` afecta `stock_actual`
 *  (data-model.md § movimientos_inventario: "el signo lo define `tipo`"). */
const SIGNO_POR_TIPO: Record<string, 1 | -1> = {
  ENTRADA: 1,
  AJUSTE_ENTRADA: 1,
  SALIDA: -1,
  AJUSTE_SALIDA: -1,
};

describe('Conciliación de inventario (T058)', () => {
  let contexto: AppDePrueba;
  /** US15 (FR-091): el proveedor de un ingreso es una FK obligatoria — cada prueba necesita
   *  una fila del catálogo, creada tras truncar (el TRUNCATE también vacía `proveedores`). */
  let proveedorId: number;

  beforeAll(async () => {
    contexto = await crearAppDePrueba();
  });

  afterAll(async () => {
    await cerrarAppDePrueba(contexto.app);
  });

  beforeEach(async () => {
    await truncarTablas(contexto.prisma);
    proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor de Conciliación');
  });

  const servidor = (): ReturnType<AppDePrueba['app']['getHttpServer']> => contexto.app.getHttpServer();

  it(
    'secuencia real ingreso→salida→anular→salida concilia: stock_actual final = 50-20+20-15 = 35, ' +
      'e IGUAL a la suma con signo de todos los movimientos del producto (invariante 2)',
    async () => {
      const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });
      const cliente = await crearClienteDePrueba(contexto.prisma);
      const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
      const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookieOperario = await iniciarSesion(servidor(), operario.login, operario.password);
      const cookieGerente = await iniciarSesion(servidor(), gerente.login, gerente.password);

      // 1) Recibir un ingreso: +50
      const respuestaIngreso = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookieOperario)
        .send({
          numeroFactura: 'FAC-CONCILIACION-0001',
          fechaFactura: '2026-01-05',
          proveedorId,
          fechaRecepcion: '2026-01-05',
          lineas: [{ productoId: producto.id, cantidad: 50, precioUnitario: 1000 }],
        });
      expect(respuestaIngreso.status).toBe(201);
      const respuestaRecibir = await request(servidor())
        .post(`/api/ingresos/${respuestaIngreso.body.id}/recibir`)
        .set('Cookie', cookieOperario);
      expect(respuestaRecibir.status).toBe(204);

      // 2) Crear y confirmar una salida: -20
      const respuestaSalida1 = await request(servidor())
        .post('/api/salidas')
        .set('Cookie', cookieOperario)
        .send({
          clienteId: cliente.id,
          proyectoId: proyecto.id,
          fechaSalida: '2026-01-06',
          lineas: [{ productoId: producto.id, cantidad: 20, precioUnitario: 1500 }],
        });
      expect(respuestaSalida1.status).toBe(201);
      const salida1Id: number = respuestaSalida1.body.id;
      const respuestaConfirmar1 = await request(servidor())
        .post(`/api/salidas/${salida1Id}/confirmar`)
        .set('Cookie', cookieOperario);
      expect(respuestaConfirmar1.status).toBe(204);

      // 3) Anular esa salida: +20 (reversa AJUSTE_ENTRADA)
      const respuestaAnular1 = await request(servidor())
        .post(`/api/salidas/${salida1Id}/anular`)
        .set('Cookie', cookieGerente)
        .send({ motivo: 'Reversa para la prueba de conciliación' });
      expect(respuestaAnular1.status).toBe(204);

      // 4) Crear y confirmar otra salida: -15
      const respuestaSalida2 = await request(servidor())
        .post('/api/salidas')
        .set('Cookie', cookieOperario)
        .send({
          clienteId: cliente.id,
          proyectoId: proyecto.id,
          fechaSalida: '2026-01-07',
          lineas: [{ productoId: producto.id, cantidad: 15, precioUnitario: 1500 }],
        });
      expect(respuestaSalida2.status).toBe(201);
      const salida2Id: number = respuestaSalida2.body.id;
      const respuestaConfirmar2 = await request(servidor())
        .post(`/api/salidas/${salida2Id}/confirmar`)
        .set('Cookie', cookieOperario);
      expect(respuestaConfirmar2.status).toBe(204);

      // stock_actual final: 0 + 50 - 20 + 20 - 15 = 35
      const productoFinal = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(producto.id) } });
      expect(productoFinal.stockActual.toNumber()).toBe(35);

      // Conciliación: la suma CON SIGNO de TODOS los movimientos del producto debe dar
      // exactamente lo mismo que stock_actual (invariante 2 de data-model.md) — se recorre la
      // tabla completa, sin asumir cuántos movimientos hay, para que la prueba verifique el
      // invariante y no solo el resultado aritmético esperado a mano.
      const movimientos = await contexto.prisma.movimientoInventario.findMany({
        where: { productoId: BigInt(producto.id) },
      });
      expect(movimientos).toHaveLength(4); // ENTRADA, SALIDA, AJUSTE_ENTRADA, SALIDA
      const sumaConSigno = movimientos.reduce((acumulado, movimiento) => {
        const signo = SIGNO_POR_TIPO[movimiento.tipo];
        if (signo === undefined) {
          throw new Error(`Tipo de movimiento sin signo mapeado en la prueba: ${movimiento.tipo}`);
        }
        return acumulado + signo * movimiento.cantidad.toNumber();
      }, 0);
      expect(sumaConSigno).toBe(35);
      expect(sumaConSigno).toBe(productoFinal.stockActual.toNumber());
    },
  );

  it('movimientos_inventario rechaza UPDATE y DELETE directos vía el trigger de inmutabilidad (FR-046, invariante 7)', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 10 });
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const respuestaSalida = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookie)
      .send({
        clienteId: cliente.id,
        proyectoId: proyecto.id,
        fechaSalida: '2026-01-08',
        lineas: [{ productoId: producto.id, cantidad: 5, precioUnitario: 100 }],
      });
    expect(respuestaSalida.status).toBe(201);
    const respuestaConfirmar = await request(servidor())
      .post(`/api/salidas/${respuestaSalida.body.id}/confirmar`)
      .set('Cookie', cookie);
    expect(respuestaConfirmar.status).toBe(204);

    const movimientos = await contexto.prisma.movimientoInventario.findMany({
      where: { productoId: BigInt(producto.id) },
    });
    const movimiento = movimientos[0];
    expect(movimiento).toBeDefined();
    if (!movimiento) throw new Error('El movimiento de la salida confirmada no se encontró.');

    await expect(
      contexto.prisma.$executeRaw`UPDATE movimientos_inventario SET cantidad = 999 WHERE id = ${movimiento.id}`,
    ).rejects.toThrow();

    await expect(
      contexto.prisma.$executeRaw`DELETE FROM movimientos_inventario WHERE id = ${movimiento.id}`,
    ).rejects.toThrow();

    // El registro sigue intacto: ni el UPDATE ni el DELETE lograron modificarlo.
    const movimientoTrasIntentos = await contexto.prisma.movimientoInventario.findUniqueOrThrow({
      where: { id: movimiento.id },
    });
    expect(movimientoTrasIntentos.cantidad.toNumber()).toBe(5);
  });
});

/** Hace login por HTTP y devuelve la cookie de sesión lista para `.set('Cookie', …)` — mismo
 *  patrón local que el resto de suites de integración (cada una define su propio helper). */
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
