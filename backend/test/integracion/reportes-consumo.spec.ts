/**
 * Pruebas de integración de los REPORTES DE CONSUMO (T073, US4, FR-039/FR-040/FR-044) —
 * API completa + PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * `trazo_test` es una base DISTINTA a `trazo` (donde vive el seed `--demo` de "Jumbo" que
 * documenta T067) — esta suite NO asume esos datos y arma su propio escenario equivalente
 * con las factories existentes (`crearClienteDePrueba`/`crearProyectoDePrueba`/
 * `crearProductoDePrueba`/`crearSalidaDePrueba`), reproduciendo la MISMA lógica de negocio:
 * un cliente con un proyecto CON presupuesto (margen 40%, igual que el ejemplo de spec.md
 * US4-AS2), un proyecto SIN presupuesto (margen `null`) y salidas en los 4 estados para
 * probar que solo CONFIRMADA/COMPLETADA cuentan como consumo (FR-044).
 *
 * `crearSalidaDePrueba` ya admite `estado`/`motivoAnulacion` como parámetros (T056/T057/T058)
 * — no hizo falta una factory nueva para dejar salidas en CONFIRMADA/COMPLETADA/PENDIENTE/
 * ANULADA con montos conocidos.
 *
 * Escenario base (`crearEscenarioDeConsumo`) — números documentados aquí para que las
 * aserciones de cada prueba se puedan verificar a ojo sin releer el código:
 *   Proyecto CON presupuesto (10.000.000):
 *     - CONFIRMADA 100 x 25.000 = 2.500.000
 *     - COMPLETADA  60 x 25.000 = 1.500.000  → total CONFIRMADA+COMPLETADA = 4.000.000
 *     - PENDIENTE   20 x 25.000 =   500.000  → NUNCA debe sumar
 *     - ANULADA     10 x 25.000 =   250.000  → NUNCA debe sumar
 *     totalProyecto esperado = 4.000.000; margen = 4.000.000 / 10.000.000 = 0.4
 *   Proyecto SIN presupuesto (null):
 *     - CONFIRMADA 50 x 18.000 = 900.000
 *     totalProyecto esperado = 900.000; margen = null
 *   Proyecto SIN NINGUNA salida: totalProyecto esperado = 0 (aparece igual, US4-AS4).
 *   totalCliente esperado = 4.000.000 + 900.000 = 4.900.000.
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

/** Fila de `proyectos` dentro de `GET /api/reportes/consumo-cliente` (ver
 *  `ReporteConsumoClienteCasoUso`). */
interface ProyectoConsumoBody {
  proyecto: { id: number; nombre: string; estado: string };
  productos: { productoId: number; nombre: string; cantidad: number; valorTotal: number }[];
  totalProyecto: number;
}

interface ReporteConsumoClienteBody {
  cliente: { id: number; nombre: string; nit: string };
  filtros: { desde: string | null; hasta: string | null };
  proyectos: ProyectoConsumoBody[];
  totalCliente: number;
}

interface ReporteConsumoProyectoBody {
  proyecto: { id: number; nombre: string; estado: string };
  cliente: { id: number; nombre: string };
  filtros: { desde: string | null; hasta: string | null };
  lineas: { fecha: string; numeroSalida: number; producto: string; cantidad: number; valorUnitario: number; valorTotal: number }[];
  totalConsumo: number;
  presupuestoEstimado: number | null;
  margen: number | null;
  serie: { producto: string; valor: number }[];
}

describe('Reportes de consumo — /api/reportes (T073, FR-039/FR-040/FR-044)', () => {
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

  /** Escenario base descrito en el TSDoc de cabecera — un cliente, un proyecto con
   *  presupuesto, uno sin presupuesto y uno sin ninguna salida, con salidas en los 4 estados
   *  de la máquina de estados para ejercitar FR-044 (solo CONFIRMADA/COMPLETADA cuentan). */
  async function crearEscenarioDeConsumo(): Promise<{
    clienteId: number;
    proyectoConPresupuestoId: number;
    proyectoSinPresupuestoId: number;
    proyectoSinConsumoId: number;
  }> {
    const cliente = await crearClienteDePrueba(contexto.prisma, { nombre: 'Cliente de Prueba — Consumo' });
    const cemento = await crearProductoDePrueba(contexto.prisma, {
      sku: 'CEM-001-TEST',
      descripcion: 'Cemento gris 50kg (prueba)',
      stockActual: 10_000,
      umbralStockBajo: 50,
    });
    const varilla = await crearProductoDePrueba(contexto.prisma, {
      sku: 'VAR-001-TEST',
      descripcion: 'Varilla 3/8 x 6m (prueba)',
      stockActual: 10_000,
      umbralStockBajo: 30,
    });
    const proyectoConPresupuesto = await crearProyectoDePrueba(contexto.prisma, cliente.id, {
      nombre: 'Proyecto Con Presupuesto',
      presupuestoEstimado: 10_000_000,
    });
    const proyectoSinPresupuesto = await crearProyectoDePrueba(contexto.prisma, cliente.id, {
      nombre: 'Proyecto Sin Presupuesto',
      presupuestoEstimado: null,
    });
    const proyectoSinConsumo = await crearProyectoDePrueba(contexto.prisma, cliente.id, {
      nombre: 'Proyecto Sin Consumo',
    });

    // Proyecto CON presupuesto: CONFIRMADA + COMPLETADA suman 4.000.000; PENDIENTE (500.000) y
    // ANULADA (250.000) existen a propósito con montos que, si se incluyeran por error,
    // cambiarían el total observable — las pruebas verifican que NO lo hacen.
    await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyectoConPresupuesto.id,
      lineas: [{ productoId: cemento.id, cantidad: 100, precioUnitario: 25_000 }],
      estado: 'CONFIRMADA',
      fechaSalida: new Date('2026-02-05'),
      fechaConfirmacion: new Date('2026-02-05'),
    });
    await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyectoConPresupuesto.id,
      lineas: [{ productoId: cemento.id, cantidad: 60, precioUnitario: 25_000 }],
      estado: 'COMPLETADA',
      fechaSalida: new Date('2026-02-10'),
      fechaConfirmacion: new Date('2026-02-10'),
    });
    await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyectoConPresupuesto.id,
      lineas: [{ productoId: cemento.id, cantidad: 20, precioUnitario: 25_000 }],
      estado: 'PENDIENTE',
      fechaSalida: new Date('2026-02-12'),
    });
    await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyectoConPresupuesto.id,
      lineas: [{ productoId: cemento.id, cantidad: 10, precioUnitario: 25_000 }],
      estado: 'ANULADA',
      motivoAnulacion: 'Prueba de exclusión de consumo (T073)',
      fechaSalida: new Date('2026-02-15'),
    });

    // Proyecto SIN presupuesto: una sola CONFIRMADA de 900.000 — el margen debe ser null.
    await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyectoSinPresupuesto.id,
      lineas: [{ productoId: varilla.id, cantidad: 50, precioUnitario: 18_000 }],
      estado: 'CONFIRMADA',
      fechaSalida: new Date('2026-02-07'),
      fechaConfirmacion: new Date('2026-02-07'),
    });

    return {
      clienteId: cliente.id,
      proyectoConPresupuestoId: proyectoConPresupuesto.id,
      proyectoSinPresupuestoId: proyectoSinPresupuesto.id,
      proyectoSinConsumoId: proyectoSinConsumo.id,
    };
  }

  it('GET consumo-cliente: totales correctos por proyecto y por cliente, excluye PENDIENTE/ANULADA, e incluye el proyecto sin consumo con totalProyecto 0 (US4-AS1/AS4, FR-044)', async () => {
    const escenario = await crearEscenarioDeConsumo();
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const respuesta = await request(servidor())
      .get('/api/reportes/consumo-cliente')
      .query({ clienteId: escenario.clienteId })
      .set('Cookie', cookie);

    expect(respuesta.status).toBe(200);
    const cuerpo = respuesta.body as ReporteConsumoClienteBody;
    expect(cuerpo.cliente.id).toBe(escenario.clienteId);
    expect(cuerpo.proyectos).toHaveLength(3); // los 3 proyectos del cliente, ninguno omitido

    const proyectoConPresupuesto = cuerpo.proyectos.find(
      (p) => p.proyecto.id === escenario.proyectoConPresupuestoId,
    );
    // 100+60 = 160 unidades a 25.000 = 4.000.000 — si PENDIENTE/ANULADA contaran, sería 4.750.000.
    expect(proyectoConPresupuesto?.totalProyecto).toBe(4_000_000);

    const proyectoSinPresupuesto = cuerpo.proyectos.find(
      (p) => p.proyecto.id === escenario.proyectoSinPresupuestoId,
    );
    expect(proyectoSinPresupuesto?.totalProyecto).toBe(900_000);

    const proyectoSinConsumo = cuerpo.proyectos.find((p) => p.proyecto.id === escenario.proyectoSinConsumoId);
    expect(proyectoSinConsumo).toBeDefined(); // NUNCA se omite, aunque no tenga ninguna salida
    expect(proyectoSinConsumo?.productos).toEqual([]);
    expect(proyectoSinConsumo?.totalProyecto).toBe(0);

    expect(cuerpo.totalCliente).toBe(4_900_000); // 4.000.000 + 900.000
  });

  it('GET consumo-proyecto: margen correcto con presupuesto (40%) y margen null sin presupuesto (US4-AS2)', async () => {
    const escenario = await crearEscenarioDeConsumo();
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const respuestaConPresupuesto = await request(servidor())
      .get('/api/reportes/consumo-proyecto')
      .query({ proyectoId: escenario.proyectoConPresupuestoId })
      .set('Cookie', cookie);
    expect(respuestaConPresupuesto.status).toBe(200);
    const cuerpoConPresupuesto = respuestaConPresupuesto.body as ReporteConsumoProyectoBody;
    expect(cuerpoConPresupuesto.totalConsumo).toBe(4_000_000);
    expect(cuerpoConPresupuesto.presupuestoEstimado).toBe(10_000_000);
    expect(cuerpoConPresupuesto.margen).toBe(0.4);
    expect(cuerpoConPresupuesto.lineas).toHaveLength(2); // solo CONFIRMADA + COMPLETADA, nunca PENDIENTE/ANULADA

    const respuestaSinPresupuesto = await request(servidor())
      .get('/api/reportes/consumo-proyecto')
      .query({ proyectoId: escenario.proyectoSinPresupuestoId })
      .set('Cookie', cookie);
    expect(respuestaSinPresupuesto.status).toBe(200);
    const cuerpoSinPresupuesto = respuestaSinPresupuesto.body as ReporteConsumoProyectoBody;
    expect(cuerpoSinPresupuesto.totalConsumo).toBe(900_000);
    expect(cuerpoSinPresupuesto.presupuestoEstimado).toBeNull();
    expect(cuerpoSinPresupuesto.margen).toBeNull(); // nunca 0 ni una división por cero
  });

  it('filtro desde/hasta excluye salidas de consumo fuera de rango (FR-039/FR-040)', async () => {
    const escenario = await crearEscenarioDeConsumo();
    // Salida CONFIRMADA fuera del rango que se usará en el filtro (antes de febrero) — si el
    // filtro de fechas no funcionara, este monto se colaría en el total.
    await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: escenario.proyectoConPresupuestoId,
      lineas: [{ productoId: (await crearProductoDePrueba(contexto.prisma)).id, cantidad: 1, precioUnitario: 999_000 }],
      estado: 'CONFIRMADA',
      fechaSalida: new Date('2026-01-01'),
      fechaConfirmacion: new Date('2026-01-01'),
    });
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    // Sin filtro: el monto de enero se suma (prueba de control — confirma que el dato existe).
    const respuestaSinFiltro = await request(servidor())
      .get('/api/reportes/consumo-proyecto')
      .query({ proyectoId: escenario.proyectoConPresupuestoId })
      .set('Cookie', cookie);
    expect((respuestaSinFiltro.body as ReporteConsumoProyectoBody).totalConsumo).toBe(4_999_000);

    // Con desde=2026-02-01/hasta=2026-02-28: el monto de enero queda fuera, vuelve a 4.000.000.
    const respuestaConFiltro = await request(servidor())
      .get('/api/reportes/consumo-proyecto')
      .query({ proyectoId: escenario.proyectoConPresupuestoId, desde: '2026-02-01', hasta: '2026-02-28' })
      .set('Cookie', cookie);
    expect(respuestaConFiltro.status).toBe(200);
    expect((respuestaConFiltro.body as ReporteConsumoProyectoBody).totalConsumo).toBe(4_000_000);
  });

  it('un OPERARIO recibe 403 en los 4 endpoints de consumo, incluidos los de exportación (reportes son solo Administrador/Gerente — hallazgo de revisión adversarial: las rutas /export no tenían cobertura propia)', async () => {
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), operario.login, operario.password);

    const respuestaCliente = await request(servidor())
      .get('/api/reportes/consumo-cliente')
      .query({ clienteId: cliente.id })
      .set('Cookie', cookie);
    expect(respuestaCliente.status).toBe(403);

    const respuestaProyecto = await request(servidor())
      .get('/api/reportes/consumo-proyecto')
      .query({ proyectoId: proyecto.id })
      .set('Cookie', cookie);
    expect(respuestaProyecto.status).toBe(403);

    const respuestaExportCliente = await request(servidor())
      .get('/api/reportes/consumo-cliente/export')
      .query({ clienteId: cliente.id, formato: 'xlsx' })
      .set('Cookie', cookie);
    expect(respuestaExportCliente.status).toBe(403);

    const respuestaExportProyecto = await request(servidor())
      .get('/api/reportes/consumo-proyecto/export')
      .query({ proyectoId: proyecto.id, formato: 'pdf' })
      .set('Cookie', cookie);
    expect(respuestaExportProyecto.status).toBe(403);
  });

  it('sin cookie de sesión, los 4 endpoints de consumo (datos y exportación) responden 401', async () => {
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);

    const respuestaCliente = await request(servidor())
      .get('/api/reportes/consumo-cliente')
      .query({ clienteId: cliente.id });
    expect(respuestaCliente.status).toBe(401);

    const respuestaProyecto = await request(servidor())
      .get('/api/reportes/consumo-proyecto')
      .query({ proyectoId: proyecto.id });
    expect(respuestaProyecto.status).toBe(401);

    const respuestaExportCliente = await request(servidor())
      .get('/api/reportes/consumo-cliente/export')
      .query({ clienteId: cliente.id, formato: 'xlsx' });
    expect(respuestaExportCliente.status).toBe(401);

    const respuestaExportProyecto = await request(servidor())
      .get('/api/reportes/consumo-proyecto/export')
      .query({ proyectoId: proyecto.id, formato: 'pdf' });
    expect(respuestaExportProyecto.status).toBe(401);
  });

  it('margen es null (nunca Infinity/NaN) cuando presupuestoEstimado es exactamente 0, distinto de "sin presupuesto" solo en el valor mostrado (hallazgo de revisión adversarial)', async () => {
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 10_000 });
    const proyectoPresupuestoCero = await crearProyectoDePrueba(contexto.prisma, cliente.id, {
      nombre: 'Proyecto Presupuesto Cero',
      presupuestoEstimado: 0,
    });
    await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyectoPresupuestoCero.id,
      lineas: [{ productoId: producto.id, cantidad: 5, precioUnitario: 1_000 }],
      estado: 'CONFIRMADA',
      fechaSalida: new Date('2026-02-05'),
      fechaConfirmacion: new Date('2026-02-05'),
    });
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const respuesta = await request(servidor())
      .get('/api/reportes/consumo-proyecto')
      .query({ proyectoId: proyectoPresupuestoCero.id })
      .set('Cookie', cookie);
    expect(respuesta.status).toBe(200);
    const cuerpo = respuesta.body as ReporteConsumoProyectoBody;
    expect(cuerpo.presupuestoEstimado).toBe(0);
    expect(cuerpo.margen).toBeNull(); // nunca Infinity/NaN (que JSON serializaría igualmente como null, pero por accidente)
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
