/**
 * Pruebas de integración del PANEL DE CONTROL (T117, US10, FR-060…FR-063) — API completa +
 * PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Qué asegura cada bloque, y por qué esa comprobación y no otra:
 *
 * 1. **Cada cifra coincide con la de su endpoint de detalle** (US10-AS4). No se comparan solo
 *    números "esperados" escritos a mano: cada cifra del panel se contrasta contra la MISMA
 *    petición HTTP que hace la pantalla de detalle a la que enlaza la tarjeta
 *    (`/api/inventario`, `/api/inventario?soloStockBajo=true`, `/api/reportes/inventario`,
 *    `/api/salidas?estado=PENDIENTE`, `/api/ingresos?estado=PENDIENTE`,
 *    `/api/reportes/consumo-cliente`, `/api/reportes/movimientos`). Es la prueba de FR-063: si
 *    alguien reemplazara la composición por una consulta agregada propia, esta prueba se pone
 *    roja en cuanto los dos caminos difieran, que es exactamente el fallo que hay que impedir.
 *    Los valores absolutos también se afirman, para que la prueba no pueda pasar por "ambos
 *    lados devuelven lo mismo… y ambos están mal".
 * 2. **Recorte por permisos en el SERVIDOR** (US10-AS2/FR-062), verificado sobre el CUERPO
 *    CRUDO (`respuesta.text`): a un Operario las claves de valorización y consumo no le llegan
 *    ocultas, no llegan. Un `expect(cuerpo.consumoMes).toBeUndefined()` solo probaría que el
 *    objeto parseado no las tiene; mirar el texto prueba que no viajaron por la red.
 * 3. **Sistema sin datos** (US10-AS3): ceros y listas vacías, `200`, sin error ni `NaN`.
 * 4. **Un rol PROPIO con un solo permiso** (US9 + FR-062): el recorte se resuelve con los
 *    permisos efectivos del rol, no con su nombre — un rol de solo salidas recibe únicamente
 *    su cifra de salidas pendientes.
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
  crearRolDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Forma de `GET /api/panel` (ver `ResumenPanel` de `@trazo/compartido` / del caso de uso). */
interface ResumenPanelBody {
  inventario?: { productosActivos: number; bajoUmbral: number; valorTotal?: number };
  pendientes?: { salidasPendientes?: number; ingresosPendientes?: number };
  consumoMes?: { desde: string; total: number };
  movimientosRecientes?: {
    id: number;
    fechaHora: string;
    tipo: 'ENTRADA' | 'SALIDA' | 'AJUSTE_ENTRADA' | 'AJUSTE_SALIDA';
    producto: string;
    cantidad: number;
    usuario: string;
  }[];
}

/** Página de cualquier listado del contrato (`{ datos, total, pagina, porPagina }`). */
interface PaginadoBody {
  total: number;
}

/** Recorte de `GET /api/reportes/inventario` que esta suite compara. */
interface ReporteInventarioBody {
  valorTotalInventario: number;
  cantidadBajoUmbral: number;
}

/** Recorte de `GET /api/reportes/consumo-cliente` que esta suite compara. */
interface ReporteConsumoClienteBody {
  totalCliente: number;
}

/** Recorte de `GET /api/reportes/movimientos` que esta suite compara. */
interface ReporteMovimientosBody {
  movimientos: {
    fecha: string;
    tipo: string;
    cantidad: number;
    producto: { sku: string; descripcion: string };
    usuario: string;
  }[];
}

/** Cuántos movimientos publica "actividad reciente" (contracts/api-rest.md § Panel de control). */
const MOVIMIENTOS_RECIENTES = 10;

describe('Panel de control — GET /api/panel (T117, US10, FR-060…FR-063)', () => {
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

  /** Cuerpo mínimo válido de `POST /api/ingresos` (`esquemaCrearIngreso`). */
  function cuerpoIngreso(
    numeroFactura: string,
    lineas: { productoId: number; cantidad: number; precioUnitario: number }[],
  ): Record<string, unknown> {
    return {
      numeroFactura,
      fechaFactura: '2026-01-05',
      proveedor: 'Proveedor de Prueba del Panel',
      fechaRecepcion: '2026-01-05',
      lineas,
    };
  }

  /** Cuerpo mínimo válido de `POST /api/salidas` (`esquemaCrearSalida`). */
  function cuerpoSalida(
    proyectoId: number,
    fechaSalida: string,
    lineas: { productoId: number; cantidad: number; precioUnitario: number }[],
  ): Record<string, unknown> {
    return { proyectoId, fechaSalida, lineas };
  }

  /**
   * Escenario conocido, montado por los endpoints REALES (los movimientos solo nacen dentro de
   * `recibir`/`confirmar` — misma restricción documentada en `reportes-inventario.spec.ts`):
   *
   * - `PANEL-A`: ingreso RECIBIDO de 100 @ 2.000 → stock 100, `ultimoCosto` 2.000.
   *   Salida CONFIRMADA de 10 @ 5.000 con fecha de HOY (consumo del mes = 50.000) y salida
   *   CONFIRMADA de 2 @ 7.000 con fecha del MES ANTERIOR (14.000 que el panel NO debe contar).
   *   Salida PENDIENTE de 4 (compromete, nunca toca stock) → stock final 88, disponible 84.
   * - `PANEL-B`: creado directo con stock 5 y umbral 20 → único producto bajo umbral.
   *   `ultimoCosto` 1.000 por `UPDATE` directo (no hay endpoint para fijarlo sin un ingreso).
   * - Un segundo ingreso queda PENDIENTE (ingresos por recibir = 1).
   *
   * Cifras esperadas: productos 2, bajo umbral 1, valor 88×2.000 + 5×1.000 = 181.000,
   * salidas pendientes 1, ingresos pendientes 1, consumo del mes 50.000, 3 movimientos.
   */
  async function crearEscenario(): Promise<{
    cookieAdmin: string;
    clienteId: number;
    productoA: { id: number; descripcion: string };
    productoB: { id: number; descripcion: string };
    nombreAdmin: string;
  }> {
    const nombreAdmin = 'Administradora del Panel';
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR', nombreCompleto: nombreAdmin });
    const cookieAdmin = await iniciarSesion(servidor(), admin.login, admin.password);

    const productoA = await crearProductoDePrueba(contexto.prisma, {
      sku: 'PANEL-A-001',
      descripcion: 'Producto A del panel',
      stockActual: 0,
      umbralStockBajo: 10,
    });
    const productoB = await crearProductoDePrueba(contexto.prisma, {
      sku: 'PANEL-B-001',
      descripcion: 'Producto B del panel',
      stockActual: 5,
      umbralStockBajo: 20, // disponible (5) <= umbral (20) -> único bajo umbral
    });
    await contexto.prisma.producto.update({ where: { id: BigInt(productoB.id) }, data: { ultimoCosto: 1_000 } });

    // Ingreso RECIBIDO: +100 de A a 2.000 (fija `ultimoCosto`) y su movimiento ENTRADA.
    const ingresoRecibido = await request(servidor())
      .post('/api/ingresos')
      .set('Cookie', cookieAdmin)
      .send(cuerpoIngreso('FAC-PANEL-0001', [{ productoId: productoA.id, cantidad: 100, precioUnitario: 2_000 }]));
    expect(ingresoRecibido.status).toBe(201);
    const recibir = await request(servidor())
      .post(`/api/ingresos/${ingresoRecibido.body.id}/recibir`)
      .set('Cookie', cookieAdmin);
    expect(recibir.status).toBe(204);

    // Ingreso que se queda PENDIENTE (por recibir).
    const ingresoPendiente = await request(servidor())
      .post('/api/ingresos')
      .set('Cookie', cookieAdmin)
      .send(cuerpoIngreso('FAC-PANEL-0002', [{ productoId: productoA.id, cantidad: 7, precioUnitario: 2_000 }]));
    expect(ingresoPendiente.status).toBe(201);

    const cliente = await crearClienteDePrueba(contexto.prisma, { nombre: 'Cliente del Panel' });
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id, { nombre: 'Proyecto del Panel' });

    // Salida CONFIRMADA dentro del mes en curso: 10 x 5.000 = 50.000 de consumo.
    const salidaDelMes = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookieAdmin)
      .send(cuerpoSalida(proyecto.id, fechaDeHoyEnBogota(), [
        { productoId: productoA.id, cantidad: 10, precioUnitario: 5_000 },
      ]));
    expect(salidaDelMes.status).toBe(201);
    expect((await request(servidor()).post(`/api/salidas/${salidaDelMes.body.id}/confirmar`).set('Cookie', cookieAdmin)).status).toBe(204);

    // Salida CONFIRMADA del MES ANTERIOR: 2 x 7.000 = 14.000 que el consumo del mes NO cuenta.
    const salidaMesAnterior = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookieAdmin)
      .send(cuerpoSalida(proyecto.id, ultimoDiaDelMesAnterior(), [
        { productoId: productoA.id, cantidad: 2, precioUnitario: 7_000 },
      ]));
    expect(salidaMesAnterior.status).toBe(201);
    expect((await request(servidor()).post(`/api/salidas/${salidaMesAnterior.body.id}/confirmar`).set('Cookie', cookieAdmin)).status).toBe(204);

    // Salida que se queda PENDIENTE (por confirmar): compromete 4, no toca stock ni consumo.
    const salidaPendiente = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookieAdmin)
      .send(cuerpoSalida(proyecto.id, fechaDeHoyEnBogota(), [
        { productoId: productoA.id, cantidad: 4, precioUnitario: 5_000 },
      ]));
    expect(salidaPendiente.status).toBe(201);

    return {
      cookieAdmin,
      clienteId: cliente.id,
      productoA: { id: productoA.id, descripcion: productoA.descripcion },
      productoB: { id: productoB.id, descripcion: productoB.descripcion },
      nombreAdmin,
    };
  }

  describe('Composición: cada cifra coincide con su endpoint de detalle (US10-AS4, FR-063)', () => {
    it('inventario, pendientes, consumo del mes y actividad reciente cuadran con los endpoints a los que enlaza cada tarjeta', async () => {
      const escenario = await crearEscenario();

      const respuesta = await request(servidor()).get('/api/panel').set('Cookie', escenario.cookieAdmin);
      expect(respuesta.status).toBe(200);
      const panel = respuesta.body as ResumenPanelBody;

      // --- Detalle: los MISMOS endpoints que abren las tarjetas del panel ---
      const [inventarioTodo, inventarioBajo, reporteInventario, salidasPendientes, ingresosPendientes, consumoCliente, reporteMovimientos] =
        await Promise.all([
          request(servidor()).get('/api/inventario').set('Cookie', escenario.cookieAdmin),
          request(servidor()).get('/api/inventario').query({ soloStockBajo: 'true' }).set('Cookie', escenario.cookieAdmin),
          request(servidor()).get('/api/reportes/inventario').set('Cookie', escenario.cookieAdmin),
          request(servidor()).get('/api/salidas').query({ estado: 'PENDIENTE' }).set('Cookie', escenario.cookieAdmin),
          request(servidor()).get('/api/ingresos').query({ estado: 'PENDIENTE' }).set('Cookie', escenario.cookieAdmin),
          request(servidor())
            .get('/api/reportes/consumo-cliente')
            .query({ clienteId: escenario.clienteId, desde: panel.consumoMes?.desde })
            .set('Cookie', escenario.cookieAdmin),
          request(servidor()).get('/api/reportes/movimientos').set('Cookie', escenario.cookieAdmin),
        ]);
      expect(
        [inventarioTodo, inventarioBajo, reporteInventario, salidasPendientes, ingresosPendientes, consumoCliente, reporteMovimientos].map(
          (r) => r.status,
        ),
      ).toEqual([200, 200, 200, 200, 200, 200, 200]);

      // --- Inventario: los dos conteos y la valorización ---
      expect(panel.inventario?.productosActivos).toBe((inventarioTodo.body as PaginadoBody).total);
      expect(panel.inventario?.bajoUmbral).toBe((inventarioBajo.body as PaginadoBody).total);
      expect(panel.inventario?.valorTotal).toBe((reporteInventario.body as ReporteInventarioBody).valorTotalInventario);
      // Y los valores absolutos, para que la prueba no pueda pasar con ambos lados igual de mal:
      expect(panel.inventario?.productosActivos).toBe(2);
      expect(panel.inventario?.bajoUmbral).toBe(1); // solo PANEL-B (5 <= 20)
      expect(panel.inventario?.valorTotal).toBe(181_000); // 88 x 2.000 + 5 x 1.000

      // --- Pendientes: el total de cada listado filtrado por estado PENDIENTE ---
      expect(panel.pendientes?.salidasPendientes).toBe((salidasPendientes.body as PaginadoBody).total);
      expect(panel.pendientes?.ingresosPendientes).toBe((ingresosPendientes.body as PaginadoBody).total);
      expect(panel.pendientes?.salidasPendientes).toBe(1);
      expect(panel.pendientes?.ingresosPendientes).toBe(1);

      // --- Consumo del mes: mismo universo de salidas que el reporte de consumo (FR-044) ---
      // El único cliente del escenario es este, así que su total de consumo desde `desde` ES el
      // consumo del mes que publica el panel; la salida del mes anterior (14.000) queda fuera de
      // ambos, y la PENDIENTE nunca cuenta como consumo.
      expect(panel.consumoMes?.total).toBe((consumoCliente.body as ReporteConsumoClienteBody).totalCliente);
      expect(panel.consumoMes?.total).toBe(50_000);
      expect(panel.consumoMes?.desde).toBe(primerDiaDelMesEnBogota());

      // --- Actividad reciente: las mismas filas, en el mismo orden, que el reporte ---
      const movimientosReporte = (reporteMovimientos.body as ReporteMovimientosBody).movimientos;
      expect(movimientosReporte).toHaveLength(3); // 1 ENTRADA + 2 SALIDA confirmadas
      expect(panel.movimientosRecientes).toHaveLength(3);
      panel.movimientosRecientes?.forEach((movimientoPanel, indice) => {
        const movimientoReporte = movimientosReporte[indice];
        expect(movimientoPanel.tipo).toBe(movimientoReporte?.tipo);
        expect(movimientoPanel.cantidad).toBe(movimientoReporte?.cantidad);
        expect(movimientoPanel.producto).toBe(movimientoReporte?.producto.descripcion);
        expect(movimientoPanel.usuario).toBe(movimientoReporte?.usuario);
        expect(new Date(movimientoPanel.fechaHora).toISOString()).toBe(new Date(movimientoReporte?.fecha ?? '').toISOString());
      });
      expect(panel.movimientosRecientes?.every((movimiento) => movimiento.usuario === escenario.nombreAdmin)).toBe(true);
      expect(panel.movimientosRecientes?.map((movimiento) => movimiento.producto)).toEqual([
        escenario.productoA.descripcion,
        escenario.productoA.descripcion,
        escenario.productoA.descripcion,
      ]);
    });

    it('la actividad reciente se limita a los 10 más recientes, del más nuevo al más viejo', async () => {
      const escenario = await crearEscenario();
      // 12 movimientos sintéticos, insertados DIRECTO con Prisma y con `fechaHora` explícita y
      // distinta cada uno: `movimientos_inventario` solo prohíbe UPDATE/DELETE (trigger de
      // inmutabilidad, T009), nunca INSERT — mismo recurso que usa el seed. Es la forma barata
      // de superar el tope de 10 sin montar 12 documentos completos, y con tiempos distintos el
      // orden esperado es determinista (dos movimientos de la misma transacción comparten
      // `fecha_hora` y no permitirían afirmar un orden entre ellos).
      const base = new Date('2030-01-01T12:00:00.000Z').getTime();
      const usuarioId = (await contexto.prisma.usuario.findFirstOrThrow({ select: { id: true } })).id;
      for (let indice = 0; indice < 12; indice += 1) {
        await contexto.prisma.movimientoInventario.create({
          data: {
            fechaHora: new Date(base + indice * 60_000),
            tipo: 'AJUSTE_ENTRADA',
            productoId: BigInt(escenario.productoB.id),
            cantidad: indice + 1,
            stockResultante: 5,
            documentoTipo: 'INGRESO',
            documentoId: BigInt(1),
            usuarioId,
            motivo: 'Movimiento sintético de la prueba del panel',
          },
        });
      }

      const respuesta = await request(servidor()).get('/api/panel').set('Cookie', escenario.cookieAdmin);
      expect(respuesta.status).toBe(200);
      const panel = respuesta.body as ResumenPanelBody;

      expect(panel.movimientosRecientes).toHaveLength(MOVIMIENTOS_RECIENTES);
      // Los 12 sintéticos son los más recientes (2030); el más nuevo es el de `indice = 11`.
      expect(panel.movimientosRecientes?.map((movimiento) => movimiento.cantidad)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
      const fechas = panel.movimientosRecientes?.map((movimiento) => new Date(movimiento.fechaHora).getTime()) ?? [];
      expect(fechas).toEqual([...fechas].sort((a, b) => b - a));
    });
  });

  describe('Recorte por permisos en el servidor (US10-AS2, FR-062)', () => {
    it('un Operario NO recibe las claves de valorización ni de consumo en el cuerpo crudo', async () => {
      await crearEscenario();
      const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const cookie = await iniciarSesion(servidor(), operario.login, operario.password);

      const respuesta = await request(servidor()).get('/api/panel').set('Cookie', cookie);
      expect(respuesta.status).toBe(200);

      // 1) Sobre el TEXTO tal cual viajó por la red: las claves no existen en el JSON. Esta es
      //    la aserción que distingue "recortado en el servidor" de "oculto en el cliente".
      expect(respuesta.text).not.toContain('valorTotal');
      expect(respuesta.text).not.toContain('consumoMes');

      // 2) Y sobre el objeto ya parseado, para dejar explícito qué SÍ recibe un Operario.
      const panel = respuesta.body as ResumenPanelBody;
      expect(panel.consumoMes).toBeUndefined();
      expect(panel.inventario).toBeDefined();
      expect(panel.inventario).not.toHaveProperty('valorTotal');
      expect(panel.inventario?.productosActivos).toBe(2);
      expect(panel.inventario?.bajoUmbral).toBe(1);
      expect(panel.pendientes).toEqual({ salidasPendientes: 1, ingresosPendientes: 1 });
      expect(panel.movimientosRecientes).toHaveLength(3);

      // 3) El motivo del recorte: ese mismo Operario no puede abrir los reportes de donde salen
      //    esas dos cifras (matriz de permisos vigente, sin tocarla).
      expect((await request(servidor()).get('/api/reportes/inventario').set('Cookie', cookie)).status).toBe(403);
    });

    it('un rol PROPIO con solo `salidas.ver` recibe únicamente su cifra de salidas pendientes', async () => {
      await crearEscenario();
      const rol = await crearRolDePrueba(contexto.prisma, ['salidas.ver']);
      const usuario = await crearUsuarioDePrueba(contexto, { rolId: rol.id });
      const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

      const respuesta = await request(servidor()).get('/api/panel').set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      const panel = respuesta.body as ResumenPanelBody;

      expect(panel).toEqual({ pendientes: { salidasPendientes: 1 } });
      expect(respuesta.text).not.toContain('ingresosPendientes');
      expect(respuesta.text).not.toContain('movimientosRecientes');
      expect(respuesta.text).not.toContain('inventario');
    });

    it('sin sesión responde 401 (el panel no es una ruta pública)', async () => {
      const respuesta = await request(servidor()).get('/api/panel');
      expect(respuesta.status).toBe(401);
    });
  });

  describe('Sistema sin datos (US10-AS3)', () => {
    it('responde 200 con ceros y listas vacías, nunca un error ni cifras en blanco', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);

      const respuesta = await request(servidor()).get('/api/panel').set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      const panel = respuesta.body as ResumenPanelBody;

      expect(panel.inventario).toEqual({ productosActivos: 0, bajoUmbral: 0, valorTotal: 0 });
      expect(panel.pendientes).toEqual({ salidasPendientes: 0, ingresosPendientes: 0 });
      expect(panel.consumoMes).toEqual({ desde: primerDiaDelMesEnBogota(), total: 0 });
      expect(panel.movimientosRecientes).toEqual([]);
      // Ninguna cifra puede ser NaN/null: se serializarían como `null` en JSON.
      expect(respuesta.text).not.toContain('null');
    });
  });
});

/**
 * Fecha de HOY en hora de Bogotá (`AAAA-MM-DD`) — las salidas del escenario se fechan así para
 * caer con certeza dentro del mes que el panel acumula. Se calcula con el MISMO criterio que el
 * backend (UTC−5 fijo, sin horario de verano — spec.md § Moneda y localización) para que la
 * prueba y el código bajo prueba no puedan discrepar en la frontera del día.
 */
function fechaDeHoyEnBogota(): string {
  return new Date(Date.now() - DESFASE_BOGOTA_MS).toISOString().slice(0, 10);
}

/** Primer día del mes en curso en hora de Bogotá (`AAAA-MM-DD`) — el `desde` que debe publicar
 *  el panel. */
function primerDiaDelMesEnBogota(): string {
  return `${fechaDeHoyEnBogota().slice(0, 7)}-01`;
}

/** Último día del mes ANTERIOR (`AAAA-MM-DD`): una fecha con la que una salida confirmada queda
 *  fuera del consumo del mes por un solo día, que es el borde que interesa probar. */
function ultimoDiaDelMesAnterior(): string {
  const primerDia = new Date(`${primerDiaDelMesEnBogota()}T00:00:00.000Z`);
  return new Date(primerDia.getTime() - UN_DIA_MS).toISOString().slice(0, 10);
}

const DESFASE_BOGOTA_MS = 5 * 60 * 60 * 1000;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

/** Inicia sesión y devuelve la cookie — misma helper local que el resto de suites de integración. */
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
