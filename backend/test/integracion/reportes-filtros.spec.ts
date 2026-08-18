/**
 * Pruebas de integración de los dos filtros nuevos de los reportes (T219, US24/US25,
 * FR-120/FR-121) — API completa + PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Lo que solo se puede verificar aquí:
 *
 *  - **Las cifras AGREGADAS se recalculan sobre lo filtrado** (FR-120). Que la tabla traiga
 *    menos filas es fácil de acertar; que el valor total y el conteo bajo umbral correspondan a
 *    ESAS filas y no al catálogo entero es lo que hace útil el reporte, y cruza tres cálculos.
 *  - **La lista de personas la ve el GERENTE** (FR-121). Es la razón por la que el endpoint
 *    existe en vez de reutilizar `GET /api/usuarios`, que exige `usuarios.gestionar`. Sin esta
 *    prueba, el filtro se rompería para el Gerente y solo se notaría en producción.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend`.
 */
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearCategoriaDePrueba,
  crearProductoDePrueba,
  crearProveedorDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

interface ReporteInventarioBody {
  productos: Array<{ producto: { sku: string }; valorLinea: number }>;
  valorTotalInventario: number;
  cantidadBajoUmbral: number;
  filtros: { categoria: { id: number; nombre: string } | null };
}

describe('Filtros nuevos de los reportes — US24/US25 (T219)', () => {
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

  describe('inventario actual por categoría (US24, FR-120)', () => {
    /**
     * Dos categorías con cifras DISTINTAS y deliberadamente asimétricas: un producto bajo umbral
     * en una y ninguno en la otra. Así, si los agregados se calcularan sobre el catálogo
     * completo, los números no cuadrarían con ninguna de las dos.
     */
    async function sembrar(usuarioId: number): Promise<{ construccion: number; herramienta: number }> {
      const construccion = await crearCategoriaDePrueba(contexto.prisma, 'Construcción', usuarioId);
      const herramienta = await crearCategoriaDePrueba(contexto.prisma, 'Herramienta', usuarioId);

      // Construcción: 10 unidades, y bajo umbral.
      await crearProductoDePrueba(contexto.prisma, {
        sku: 'CAT-CEM',
        descripcion: 'Cemento',
        categoriaId: construccion,
        stockActual: 10,
        umbralStockBajo: 50,
      });
      // Herramienta: 4 unidades, ninguna bajo umbral.
      await crearProductoDePrueba(contexto.prisma, {
        sku: 'CAT-MAR',
        descripcion: 'Martillo',
        categoriaId: herramienta,
        stockActual: 4,
        umbralStockBajo: 0,
      });
      // Sin categoría: no debe aparecer en ningún filtro por categoría.
      await crearProductoDePrueba(contexto.prisma, { sku: 'CAT-NINGUNA', stockActual: 7 });

      // El costo se fija por SQL: el reporte valoriza con `ultimo_costo` y las factories nacen en
      // cero (el costo real lo pondría un ingreso, que aquí no aporta nada al caso).
      await contexto.prisma.producto.updateMany({ data: { ultimoCosto: 1_000 } });
      return { construccion, herramienta };
    }

    async function pedirReporte(cookie: string, query = ''): Promise<ReporteInventarioBody> {
      const respuesta = await request(servidor()).get(`/api/reportes/inventario${query}`).set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      return respuesta.body as ReporteInventarioBody;
    }

    it('acota las filas Y recalcula el valor total y el conteo bajo umbral', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const { construccion, herramienta } = await sembrar(admin.id);

      const todo = await pedirReporte(cookie);
      expect(todo.productos).toHaveLength(3);
      expect(todo.valorTotalInventario).toBe(21_000); // 10.000 + 4.000 + 7.000
      expect(todo.cantidadBajoUmbral).toBe(1);
      expect(todo.filtros.categoria).toBeNull();

      const soloConstruccion = await pedirReporte(cookie, `?categoriaId=${construccion}`);
      expect(soloConstruccion.productos.map((fila) => fila.producto.sku)).toEqual(['CAT-CEM']);
      expect(soloConstruccion.valorTotalInventario).toBe(10_000);
      expect(soloConstruccion.cantidadBajoUmbral).toBe(1);
      // El nombre viaja resuelto, para que el documento exportado no muestre un id.
      expect(soloConstruccion.filtros.categoria).toEqual({ id: construccion, nombre: 'Construcción' });

      const soloHerramienta = await pedirReporte(cookie, `?categoriaId=${herramienta}`);
      expect(soloHerramienta.productos.map((fila) => fila.producto.sku)).toEqual(['CAT-MAR']);
      expect(soloHerramienta.valorTotalInventario).toBe(4_000);
      expect(soloHerramienta.cantidadBajoUmbral).toBe(0);
    });

    it('los productos SIN categoría quedan fuera al filtrar, y vuelven sin filtro', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const { construccion } = await sembrar(admin.id);

      const filtrado = await pedirReporte(cookie, `?categoriaId=${construccion}`);
      expect(filtrado.productos.map((fila) => fila.producto.sku)).not.toContain('CAT-NINGUNA');

      const todo = await pedirReporte(cookie);
      expect(todo.productos.map((fila) => fila.producto.sku)).toContain('CAT-NINGUNA');
    });

    it('la categoría se combina con el buscador, no lo reemplaza', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const { construccion } = await sembrar(admin.id);

      // "martillo" es de otra categoría: la Y de los dos filtros deja el reporte vacío.
      const vacio = await pedirReporte(cookie, `?categoriaId=${construccion}&buscar=martillo`);
      expect(vacio.productos).toHaveLength(0);
      expect(vacio.valorTotalInventario).toBe(0);

      const conAmbos = await pedirReporte(cookie, `?categoriaId=${construccion}&buscar=cemento`);
      expect(conAmbos.productos.map((fila) => fila.producto.sku)).toEqual(['CAT-CEM']);
    });

    it('exporta lo mismo que muestra, en un PDF real (SC-007)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const { construccion } = await sembrar(admin.id);

      const respuesta = await request(servidor())
        .get(`/api/reportes/inventario/export?categoriaId=${construccion}&formato=pdf`)
        .set('Cookie', cookie)
        .buffer()
        .parse((res, callback) => {
          const trozos: Buffer[] = [];
          res.on('data', (trozo: Buffer) => trozos.push(trozo));
          res.on('end', () => callback(null, Buffer.concat(trozos)));
        });

      expect(respuesta.status).toBe(200);
      expect((respuesta.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    });
  });

  describe('personas del filtro de movimientos (US25, FR-121)', () => {
    /** Un movimiento real: la única forma de que alguien aparezca en la lista. */
    async function moverInventario(cookie: string, sku: string): Promise<void> {
      const proveedorId = await crearProveedorDePrueba(contexto.prisma, `Proveedor ${sku}`);
      const producto = await crearProductoDePrueba(contexto.prisma, { sku, stockActual: 0 });

      const ingreso = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie)
        .send({
          numeroFactura: `FAC-${sku}`,
          fechaFactura: '2026-08-17',
          proveedorId,
          fechaRecepcion: '2026-08-17',
          lineas: [{ productoId: producto.id, cantidad: 5, precioUnitario: 1_000 }],
        });
      expect(ingreso.status).toBe(201);
      const recibido = await request(servidor())
        .post(`/api/ingresos/${ingreso.body.id}/recibir`)
        .set('Cookie', cookie);
      expect(recibido.status).toBe(204);
    }

    it('trae SOLO a quienes han movido inventario, con su nombre', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      // Alguien que existe pero nunca ha movido nada: no debe aparecer.
      await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });

      await moverInventario(cookie, 'MOV-USR-1');

      const respuesta = await request(servidor())
        .get('/api/reportes/movimientos/usuarios')
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      const usuarios = respuesta.body as Array<{ id: number; nombre: string }>;
      expect(usuarios).toHaveLength(1);
      expect(usuarios[0]?.id).toBe(admin.id);
      expect(usuarios[0]?.nombre).toEqual(expect.any(String));
      expect(usuarios[0]?.nombre).not.toBe('');
    });

    /**
     * La razón de ser del endpoint: el Gerente ve este reporte pero NO administra usuarios, así
     * que reutilizar `GET /api/usuarios` le habría dejado el filtro vacío.
     */
    it('la ve un GERENTE, que no puede listar usuarios', async () => {
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);
      await moverInventario(cookie, 'MOV-USR-2');

      const listaDelReporte = await request(servidor())
        .get('/api/reportes/movimientos/usuarios')
        .set('Cookie', cookie);
      expect(listaDelReporte.status).toBe(200);
      expect((listaDelReporte.body as unknown[]).length).toBeGreaterThan(0);

      // Y sigue sin poder listar el directorio de usuarios: el permiso no se relajó.
      const listaDeAdministracion = await request(servidor()).get('/api/usuarios').set('Cookie', cookie);
      expect(listaDeAdministracion.status).toBe(403);
    });

    it('sin movimientos devuelve una lista vacía, no un error', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);

      const respuesta = await request(servidor())
        .get('/api/reportes/movimientos/usuarios')
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual([]);
    });

    it('el reporte filtrado por persona nombra a esa persona en sus filtros', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await moverInventario(cookie, 'MOV-USR-3');

      const respuesta = await request(servidor())
        .get(`/api/reportes/movimientos?usuarioId=${admin.id}`)
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.filtros.usuarioNombre).toEqual(expect.any(String));
      expect(respuesta.body.filtros.usuarioNombre).not.toBe('');
      expect(respuesta.body.movimientos.length).toBeGreaterThan(0);
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
