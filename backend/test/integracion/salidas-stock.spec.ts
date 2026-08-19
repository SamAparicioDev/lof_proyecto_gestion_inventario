/**
 * Pruebas de integración CRÍTICAS de SALIDAS (T056, FR-028/FR-029/FR-030, Principio I) — API
 * completa + PostgreSQL REAL, contra el harness de `./setup.ts`. Es la suite MÁS IMPORTANTE
 * del proyecto: ejercita el invariante "el stock nunca queda negativo" bajo concurrencia real
 * (research R4) — algo que NINGÚN mock puede probar de verdad (`SELECT ... FOR UPDATE` solo
 * bloquea filas contra una base de datos real).
 *
 * Cubre (contracts/api-rest.md § Salidas, data-model.md § invariantes 1/3):
 * 1. Rechazo de `confirmar` cuando la cantidad excede el disponible, con el disponible REAL
 *    en el mensaje de error y el stock intacto en BD (US3-AS2).
 * 2. LA PRUEBA DE CARRERA (SC-002): dos confirmaciones concurrentes sobre el mismo producto,
 *    cada una individualmente cabría pero juntas exceden el stock — exactamente una debe
 *    ganar. Se repite en un bucle (con truncado entre iteración) para descartar que sea una
 *    condición de carrera que "por suerte" no se manifiesta siempre.
 * 3. Rechazo de `POST /api/salidas` con un proyecto `SUSPENDIDO` como destino (FR-038).
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
  crearSalidaDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Iteraciones del bucle de la prueba de carrera (T056 punto 2) — el mandato del encargo
 *  exige "al menos 5" para descartar que la garantía sea una carrera que a veces no se
 *  manifiesta; cada iteración monta su propio producto/cliente/proyecto/usuario desde cero
 *  (truncando antes) para que ninguna arrastre estado de la anterior. */
const ITERACIONES_PRUEBA_DE_CARRERA = 5;

/** Timeout generoso para la prueba de carrera: son 5 iteraciones, cada una con varias
 *  llamadas HTTP + escrituras en Postgres real — el timeout por defecto de Jest (5s) se
 *  queda corto en una máquina cargada. */
const TIMEOUT_PRUEBA_DE_CARRERA_MS = 60_000;

describe('Salidas — invariante crítico de stock (T056)', () => {
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

  it(
    'confirmar una salida PENDIENTE cuya cantidad excede el disponible responde 409 con el ' +
      'disponible real en el mensaje; el stock en BD no cambia (US3-AS2, Principio I)',
    async () => {
      const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
      const cliente = await crearClienteDePrueba(contexto.prisma);
      const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
      const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

      // Insertada DIRECTAMENTE en BD (bypass de `POST /api/salidas`, que ya rechazaría esto
      // en la creación) para ejercitar específicamente el rechazo dentro de `confirmar`
      // (mismo invariante, otro punto de entrada — p. ej. una salida que sí cabía al crearse
      // pero cuyo disponible bajó después por otro movimiento).
      const salida = await crearSalidaDePrueba(contexto.prisma, {
        proyectoId: proyecto.id,
        lineas: [{ productoId: producto.id, cantidad: 150 }],
      });

      const respuesta = await request(servidor()).post(`/api/salidas/${salida.id}/confirmar`).set('Cookie', cookie);

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error.mensaje).toMatch(/insuficiente/i);
      expect(respuesta.body.error.mensaje).toContain('100'); // disponible real
      expect(respuesta.body.error.mensaje).toContain('150'); // solicitado

      const productoEnBd = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(producto.id) } });
      expect(productoEnBd.stockActual.toNumber()).toBe(100); // sin cambios: la transacción revirtió todo

      const salidaEnBd = await contexto.prisma.salida.findUniqueOrThrow({ where: { id: BigInt(salida.id) } });
      expect(salidaEnBd.estado).toBe('PENDIENTE'); // no avanzó de estado
    },
  );

  it(
    'CARRERA REAL (SC-002): dos salidas PENDIENTE de 70 unidades cada una sobre un producto ' +
      'con 100 en stock — al confirmarlas EN PARALELO exactamente una gana (204) y la otra ' +
      'pierde (409); el stock final es SIEMPRE 30, nunca negativo, nunca 100 ni -40. Se repite ' +
      `${ITERACIONES_PRUEBA_DE_CARRERA} veces para descartar una carrera intermitente.`,
    async () => {
      for (let iteracion = 1; iteracion <= ITERACIONES_PRUEBA_DE_CARRERA; iteracion++) {
        await truncarTablas(contexto.prisma); // aislamiento total entre iteraciones

        const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
        const cliente = await crearClienteDePrueba(contexto.prisma);
        const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
        const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
        const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

        const salidaA = await crearSalidaDePrueba(contexto.prisma, {
          proyectoId: proyecto.id,
          lineas: [{ productoId: producto.id, cantidad: 70 }],
        });
        const salidaB = await crearSalidaDePrueba(contexto.prisma, {
          proyectoId: proyecto.id,
          lineas: [{ productoId: producto.id, cantidad: 70 }],
        });

        // Las dos confirmaciones salen EN PARALELO de verdad (Promise.all, sin await entre
        // ellas) para que ambas transacciones compitan por el mismo `FOR UPDATE` del producto.
        const [respuestaA, respuestaB] = await Promise.all([
          request(servidor()).post(`/api/salidas/${salidaA.id}/confirmar`).set('Cookie', cookie),
          request(servidor()).post(`/api/salidas/${salidaB.id}/confirmar`).set('Cookie', cookie),
        ]);

        const estados = [respuestaA.status, respuestaB.status].sort((a, b) => a - b);
        expect(estados).toEqual([204, 409]);

        const productoFinal = await contexto.prisma.producto.findUniqueOrThrow({
          where: { id: BigInt(producto.id) },
        });
        expect(productoFinal.stockActual.toNumber()).toBe(30); // 100 - 70, EXACTAMENTE una vez

        // La salida que perdió debe seguir PENDIENTE (no a medias, no CONFIRMADA a la fuerza).
        const [salidaAEnBd, salidaBEnBd] = await Promise.all([
          contexto.prisma.salida.findUniqueOrThrow({ where: { id: BigInt(salidaA.id) } }),
          contexto.prisma.salida.findUniqueOrThrow({ where: { id: BigInt(salidaB.id) } }),
        ]);
        const estadosSalidas = [salidaAEnBd.estado, salidaBEnBd.estado].sort();
        expect(estadosSalidas).toEqual(['CONFIRMADA', 'PENDIENTE']);

        // Exactamente un movimiento SALIDA para el producto (el de la salida que ganó).
        const movimientos = await contexto.prisma.movimientoInventario.findMany({
          where: { productoId: BigInt(producto.id), tipo: 'SALIDA' },
        });
        expect(movimientos).toHaveLength(1);
        expect(movimientos[0]?.cantidad.toNumber()).toBe(70);
        expect(movimientos[0]?.stockResultante.toNumber()).toBe(30);
      }
    },
    TIMEOUT_PRUEBA_DE_CARRERA_MS,
  );

  it(
    'POST /api/salidas con un proyecto SUSPENDIDO como destino responde 409 y no crea nada ' +
      '(FR-038 — creado SUSPENDIDO desde el principio, no cambiado después)',
    async () => {
      const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 50 });
      const cliente = await crearClienteDePrueba(contexto.prisma);
      const proyectoSuspendido = await crearProyectoDePrueba(contexto.prisma, cliente.id, { estado: 'SUSPENDIDO' });
      const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

      const respuesta = await request(servidor()).post('/api/salidas').set('Cookie', cookie).send({
        // US28 (FR-124): el cliente está ACTIVO; lo que invalida el destino es el proyecto, que
        // es justo lo que esta prueba quiere aislar.
        clienteId: cliente.id,
        proyectoId: proyectoSuspendido.id,
        fechaSalida: '2026-01-10',
        lineas: [{ productoId: producto.id, cantidad: 5, precioUnitario: 100 }],
      });

      expect(respuesta.status).toBe(409);

      const totalSalidas = await contexto.prisma.salida.count();
      expect(totalSalidas).toBe(0); // nada se creó — rollback total, no una salida "a medias"

      const productoEnBd = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(producto.id) } });
      expect(productoEnBd.stockActual.toNumber()).toBe(50); // sin efecto en stock
    },
  );
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
