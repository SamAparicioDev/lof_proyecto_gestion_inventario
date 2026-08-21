/**
 * Pruebas de integración de las NOTIFICACIONES (T272, US35, FR-139…FR-147) — API completa +
 * PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Qué asegura cada bloque, y por qué esa comprobación y no otra:
 *
 * 1. **Los avisos nacen de las TRANSICIONES REALES**, no de un `INSERT` de prueba: se registra un
 *    ingreso, se recibe, se registra una salida y se confirma, todo por HTTP. Si mañana alguien
 *    quita la llamada al avisador de un caso de uso, esto se pone rojo — que es el único fallo
 *    que importa aquí, porque una emisión que no ocurre no deja rastro en ninguna parte.
 * 2. **Quien lo provoca no lo recibe** (FR-143): la MISMA persona que registró la salida no la ve
 *    en su bandeja, y otra sí. Se comprueban las dos caras a propósito: "no le llegó a nadie"
 *    también pasaría la mitad de la prueba.
 * 3. **La suscripción no amplía** (FR-142): un rol propio con `notificaciones.salidas` pero SIN
 *    `salidas.ver` recibe la bandeja vacía. Es la comprobación que impide convertir una casilla
 *    de avisos en una puerta lateral a los datos.
 * 4. **Leído es por usuario** (FR-144): marcar con una sesión no cambia el contador de la otra.
 * 5. **El contador y la lista dicen lo mismo**: `noLeidas` del resumen y el de la bandeja se
 *    comparan entre sí — la exclusión del autor está en tres consultas distintas y olvidarla en
 *    una sola produce el defecto más difícil de ver, un número que no cuadra con la lista.
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
  crearRolDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Forma de `GET /api/notificaciones` (contracts/api-rest.md § Notificaciones). */
interface BandejaBody {
  datos: {
    id: number;
    tipo: string;
    titulo: string;
    detalle: string | null;
    entidad: { tipo: string; id: number };
    creadaEn: string;
    leida: boolean;
  }[];
  total: number;
  pagina: number;
  porPagina: number;
  noLeidas: number;
}

describe('Notificaciones — /api/notificaciones (T272, US35, FR-139…FR-147)', () => {
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
    proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor de los Avisos');
  });

  const servidor = (): ReturnType<AppDePrueba['app']['getHttpServer']> => contexto.app.getHttpServer();

  /** Trae la bandeja de una sesión. */
  async function bandejaDe(cookie: string, query = ''): Promise<BandejaBody> {
    const respuesta = await request(servidor())
      .get(`/api/notificaciones${query}`)
      .set('Cookie', cookie)
      .expect(200);
    return respuesta.body as BandejaBody;
  }

  /** El número del indicador de una sesión. */
  async function noLeidasDe(cookie: string): Promise<number> {
    const respuesta = await request(servidor())
      .get('/api/notificaciones/resumen')
      .set('Cookie', cookie)
      .expect(200);
    return (respuesta.body as { noLeidas: number }).noLeidas;
  }

  describe('Los avisos nacen de las transiciones reales (FR-139)', () => {
    it('registrar y recibir un ingreso deja sus dos avisos, apuntando a ese ingreso (FR-140)', async () => {
      const quienRegistra = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookieRegistra = await iniciarSesion(servidor(), quienRegistra.login, quienRegistra.password);
      const otra = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookieOtra = await iniciarSesion(servidor(), otra.login, otra.password);
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'AVISO-001', stockActual: 0 });

      const creado = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookieRegistra)
        .send({
          numeroFactura: 'F-AVISO-1',
          fechaFactura: '2026-08-20',
          proveedorId,
          fechaRecepcion: '2026-08-20',
          lineas: [{ productoId: producto.id, cantidad: 10, precioUnitario: 1000 }],
        })
        .expect(201);
      const ingresoId = (creado.body as { id: number }).id;

      await request(servidor())
        .post(`/api/ingresos/${ingresoId}/recibir`)
        .set('Cookie', cookieRegistra)
        .expect(204);

      const bandeja = await bandejaDe(cookieOtra);
      expect(bandeja.datos.map((aviso) => aviso.tipo)).toEqual(['INGRESO_RECIBIDO', 'INGRESO_REGISTRADO']);
      expect(bandeja.datos[0]).toMatchObject({
        entidad: { tipo: 'INGRESO', id: ingresoId },
        leida: false,
      });
      // El detalle se redacta en el momento del hecho: proveedor y número de líneas.
      expect(bandeja.datos[0]?.detalle).toContain('Proveedor de los Avisos');
      expect(bandeja.datos[0]?.titulo).toContain('F-AVISO-1');
    });

    it('una salida PENDIENTE avisa a quien puede aprobarla, y confirmarla vuelve a avisar (US35-AS1)', async () => {
      const { cookieOperario, cookieGerente, salidaId } = await escenarioDeSalida();

      const antes = await bandejaDe(cookieGerente);
      expect(antes.datos[0]).toMatchObject({
        tipo: 'SALIDA_POR_APROBAR',
        entidad: { tipo: 'SALIDA', id: salidaId },
      });
      expect(antes.datos[0]?.titulo).toMatch(/^Salida SAL-\d{6} por aprobar$/);

      await request(servidor())
        .post(`/api/salidas/${salidaId}/confirmar`)
        .set('Cookie', cookieGerente)
        .expect(204);

      // Quien confirma no ve SU aviso de confirmación, pero sí sigue viendo el que creó el otro.
      const delGerente = await bandejaDe(cookieGerente);
      expect(delGerente.datos.map((aviso) => aviso.tipo)).toEqual(['SALIDA_POR_APROBAR']);

      const delOperario = await bandejaDe(cookieOperario);
      expect(delOperario.datos.map((aviso) => aviso.tipo)).toEqual(['SALIDA_CONFIRMADA']);
    });

    it('el aviso de STOCK BAJO se emite en el CRUCE del umbral y no se repite (FR-145)', async () => {
      const { cookieOperario, cookieGerente, clienteId, productoId } = await escenarioDeSalida({
        stockInicial: 20,
        umbral: 10,
        cantidad: 12, // 20 − 12 = 8 disponibles: cruza.
      });

      const primera = await bandejaDe(cookieGerente);
      expect(primera.datos.filter((aviso) => aviso.tipo === 'STOCK_BAJO')).toHaveLength(1);
      expect(primera.datos.find((aviso) => aviso.tipo === 'STOCK_BAJO')).toMatchObject({
        entidad: { tipo: 'PRODUCTO', id: productoId },
      });

      // Segunda salida del mismo producto: ya estaba bajo, así que NO vuelve a avisar.
      await request(servidor())
        .post('/api/salidas')
        .set('Cookie', cookieOperario)
        .send({
          clienteId,
          fechaSalida: '2026-08-20',
          lineas: [{ productoId, cantidad: 2, precioUnitario: 500 }],
        })
        .expect(201);

      const segunda = await bandejaDe(cookieGerente);
      expect(segunda.datos.filter((aviso) => aviso.tipo === 'STOCK_BAJO')).toHaveLength(1);
    });
  });

  describe('Quién recibe qué', () => {
    it('quien provoca el hecho NO recibe su propio aviso (FR-143, US35-AS2)', async () => {
      const { cookieOperario, cookieGerente } = await escenarioDeSalida();

      expect(await noLeidasDe(cookieOperario)).toBe(0);
      expect(await noLeidasDe(cookieGerente)).toBe(1);
    });

    it('con la suscripción marcada pero SIN poder ver el módulo, la bandeja llega vacía (FR-142)', async () => {
      // Rol propio: se suscribe a los avisos de salidas y no puede ver salidas. El aviso existe
      // —otro usuario lo verá— pero a este no le llega: la casilla suscribe, no abre puertas.
      const rol = await crearRolDePrueba(contexto.prisma, ['inventario.ver', 'notificaciones.salidas']);
      const mirón = await crearUsuarioDePrueba(contexto, { rolId: rol.id });
      const cookieMiron = await iniciarSesion(servidor(), mirón.login, mirón.password);

      const { cookieGerente } = await escenarioDeSalida();

      expect(await bandejaDe(cookieMiron)).toMatchObject({ datos: [], total: 0, noLeidas: 0 });
      expect(await noLeidasDe(cookieGerente)).toBe(1);
    });

    it('sin ninguna suscripción la respuesta es 200 con la bandeja vacía, nunca 403', async () => {
      const rol = await crearRolDePrueba(contexto.prisma, ['inventario.ver', 'salidas.ver']);
      const sinAvisos = await crearUsuarioDePrueba(contexto, { rolId: rol.id });
      const cookie = await iniciarSesion(servidor(), sinAvisos.login, sinAvisos.password);

      await escenarioDeSalida();

      // No tener suscripciones no es un error de acceso: es no haberse suscrito.
      expect(await bandejaDe(cookie)).toMatchObject({ datos: [], total: 0, noLeidas: 0 });
    });
  });

  describe('Leído y no leído (FR-144)', () => {
    it('marcar una la saca del contador de QUIEN la marcó, y solo de ese', async () => {
      const tercera = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookieTercera = await iniciarSesion(servidor(), tercera.login, tercera.password);
      const { cookieGerente } = await escenarioDeSalida();

      const bandeja = await bandejaDe(cookieGerente);
      const avisoId = bandeja.datos[0]?.id as number;

      await request(servidor())
        .post(`/api/notificaciones/${avisoId}/leer`)
        .set('Cookie', cookieGerente)
        .expect(204);

      expect(await noLeidasDe(cookieGerente)).toBe(0);
      expect(await noLeidasDe(cookieTercera)).toBe(1);

      // Sigue en el historial, marcada — leerla no la borra.
      const despues = await bandejaDe(cookieGerente);
      expect(despues.datos).toHaveLength(1);
      expect(despues.datos[0]?.leida).toBe(true);

      // Y el filtro de no leídas ya no la trae.
      expect(await bandejaDe(cookieGerente, '?soloNoLeidas=true')).toMatchObject({ datos: [], noLeidas: 0 });
    });

    it('marcarla dos veces no es un error (idempotente)', async () => {
      const { cookieGerente } = await escenarioDeSalida();
      const avisoId = (await bandejaDe(cookieGerente)).datos[0]?.id as number;

      await request(servidor()).post(`/api/notificaciones/${avisoId}/leer`).set('Cookie', cookieGerente).expect(204);
      await request(servidor()).post(`/api/notificaciones/${avisoId}/leer`).set('Cookie', cookieGerente).expect(204);
    });

    it('un aviso que la sesión no puede ver responde 404 al marcarlo, no 403', async () => {
      const { cookieOperario, cookieGerente } = await escenarioDeSalida();
      const avisoId = (await bandejaDe(cookieGerente)).datos[0]?.id as number;

      // El operario lo PROVOCÓ, así que para él no existe: decir "existe pero no es tuyo" ya
      // sería información sobre lo que pasa en el sistema.
      await request(servidor())
        .post(`/api/notificaciones/${avisoId}/leer`)
        .set('Cookie', cookieOperario)
        .expect(404);
    });

    it('"leer todas" vacía el indicador y devuelve cuántas marcó', async () => {
      const { cookieGerente } = await escenarioDeSalida();

      const respuesta = await request(servidor())
        .post('/api/notificaciones/leer-todas')
        .set('Cookie', cookieGerente)
        .expect(200);

      expect(respuesta.body).toEqual({ marcadas: 1 });
      expect(await noLeidasDe(cookieGerente)).toBe(0);
    });
  });

  it('el contador del resumen y el de la bandeja coinciden siempre', async () => {
    const { cookieGerente } = await escenarioDeSalida();

    const bandeja = await bandejaDe(cookieGerente);
    expect(await noLeidasDe(cookieGerente)).toBe(bandeja.noLeidas);
    expect(bandeja.noLeidas).toBe(bandeja.datos.filter((aviso) => !aviso.leida).length);
  });

  /**
   * Escenario base: un Operario registra una salida PENDIENTE y un Gerente la ve como aviso.
   * Devuelve las dos sesiones para poder comprobar las DOS caras de cada regla de entrega.
   */
  async function escenarioDeSalida(
    opciones: { stockInicial?: number; umbral?: number; cantidad?: number } = {},
  ): Promise<{
    cookieOperario: string;
    cookieGerente: string;
    salidaId: number;
    clienteId: number;
    productoId: number;
  }> {
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookieOperario = await iniciarSesion(servidor(), operario.login, operario.password);
    const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookieGerente = await iniciarSesion(servidor(), gerente.login, gerente.password);

    const producto = await crearProductoDePrueba(contexto.prisma, {
      sku: `AVISO-SAL-${Math.random().toString(36).slice(2, 7)}`,
      stockActual: opciones.stockInicial ?? 100,
      umbralStockBajo: opciones.umbral ?? 0,
    });
    const cliente = await crearClienteDePrueba(contexto.prisma, { nombre: 'Cliente de los Avisos' });

    const creada = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookieOperario)
      .send({
        clienteId: cliente.id,
        fechaSalida: '2026-08-20',
        lineas: [{ productoId: producto.id, cantidad: opciones.cantidad ?? 5, precioUnitario: 500 }],
      })
      .expect(201);

    return {
      cookieOperario,
      cookieGerente,
      salidaId: (creada.body as { id: number }).id,
      clienteId: cliente.id,
      productoId: producto.id,
    };
  }
});

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
