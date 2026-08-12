/**
 * Pruebas de integración de los FILTROS DE LISTADO nuevos (T138, US13 — FR-075…FR-077) — API
 * completa + PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Qué verifica y por qué aquí y no en unitarias: cada filtro nuevo es una traducción a SQL (o,
 * en el caso del rango de disponible, una composición de SQL + agregado de salidas). Lo único que
 * demuestra que un filtro FUNCIONA es que, con datos conocidos en la base real, devuelva
 * EXACTAMENTE el conjunto esperado — por eso cada caso lleva su **control negativo**: una fila
 * que NO debe aparecer. Un filtro que devolviera todo pasaría cualquier aserción de "contiene X";
 * es la comprobación de "no contiene Y" la que lo detecta.
 *
 * Los cinco listados viven en un mismo archivo a propósito: son la misma capacidad transversal
 * (FR-075) y las suites por módulo (`inventario.spec.ts`, `salidas.spec.ts`…) siguen cubriendo el
 * comportamiento previo sin que esta tanda tocara una sola de sus aserciones.
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
  obtenerRolDelSistemaId,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Página genérica `{datos, total, pagina, porPagina}` (contracts/api-rest.md). */
interface PaginaBody<T> {
  datos: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

/** Fila de `GET /api/inventario` — solo los campos que estas pruebas miran. */
interface FilaInventarioBody {
  producto: { id: number; categoria: string | null; ubicacion: string | null; estado: string };
  stock: number;
  comprometido: number;
  disponible: number;
}

describe('Filtros de listado — US13 (T138)', () => {
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

  /** Ids de producto de una respuesta de `GET /api/inventario`. */
  function idsDeInventario(cuerpo: unknown): number[] {
    return (cuerpo as PaginaBody<FilaInventarioBody>).datos.map((fila) => fila.producto.id);
  }

  // ==========================================================================
  // Inventario (FR-075/FR-076/FR-077)
  // ==========================================================================

  it('filtra el inventario por categoría y por ubicación con igualdad exacta, y las combina con Y lógico', async () => {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const objetivo = await crearProductoDePrueba(contexto.prisma, {
      categoria: 'Ferretería',
      ubicacion: 'Bodega 1',
    });
    const mismaCategoriaOtraUbicacion = await crearProductoDePrueba(contexto.prisma, {
      categoria: 'Ferretería',
      ubicacion: 'Bodega 2',
    });
    const otraCategoria = await crearProductoDePrueba(contexto.prisma, {
      categoria: 'Eléctricos',
      ubicacion: 'Bodega 1',
    });
    const sinClasificacion = await crearProductoDePrueba(contexto.prisma, {});

    const porCategoria = await request(servidor())
      .get('/api/inventario')
      .query({ categoria: 'Ferretería', porPagina: 100 })
      .set('Cookie', cookie);
    expect(porCategoria.status).toBe(200);
    const idsCategoria = idsDeInventario(porCategoria.body);
    expect(idsCategoria).toEqual(expect.arrayContaining([objetivo.id, mismaCategoriaOtraUbicacion.id]));
    expect(idsCategoria).not.toContain(otraCategoria.id); // control negativo
    expect(idsCategoria).not.toContain(sinClasificacion.id); // un producto sin categoría nunca matchea

    const porUbicacion = await request(servidor())
      .get('/api/inventario')
      .query({ ubicacion: 'Bodega 1', porPagina: 100 })
      .set('Cookie', cookie);
    expect(porUbicacion.status).toBe(200);
    const idsUbicacion = idsDeInventario(porUbicacion.body);
    expect(idsUbicacion).toEqual(expect.arrayContaining([objetivo.id, otraCategoria.id]));
    expect(idsUbicacion).not.toContain(mismaCategoriaOtraUbicacion.id);

    // Y lógico: solo el que cumple LAS DOS condiciones.
    const combinado = await request(servidor())
      .get('/api/inventario')
      .query({ categoria: 'Ferretería', ubicacion: 'Bodega 1', porPagina: 100 })
      .set('Cookie', cookie);
    expect(combinado.status).toBe(200);
    expect(idsDeInventario(combinado.body)).toEqual([objetivo.id]);
    expect((combinado.body as PaginaBody<FilaInventarioBody>).total).toBe(1);
  });

  /**
   * FR-076 — el selector se alimenta de lo que EXISTE. Verifica además el ORDEN de rutas del
   * controlador: si `@Get('opciones-filtro')` no estuviera declarada antes de
   * `@Get(':productoId')`, Express la resolvería como un id y `ParseIntPipe` respondería `400`.
   */
  it('GET /api/inventario/opciones-filtro trae las categorías y ubicaciones existentes, sin repetir ni nulos', async () => {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    await crearProductoDePrueba(contexto.prisma, { categoria: 'Ferretería', ubicacion: 'Bodega 1' });
    await crearProductoDePrueba(contexto.prisma, { categoria: 'Ferretería', ubicacion: 'Bodega 2' });
    await crearProductoDePrueba(contexto.prisma, { categoria: 'Eléctricos', ubicacion: null });
    await crearProductoDePrueba(contexto.prisma, {}); // sin categoría ni ubicación

    const respuesta = await request(servidor()).get('/api/inventario/opciones-filtro').set('Cookie', cookie);
    expect(respuesta.status).toBe(200);

    const cuerpo = respuesta.body as { categorias: string[]; ubicaciones: string[] };
    expect(cuerpo.categorias).toEqual(['Eléctricos', 'Ferretería']); // ordenadas y sin repetir
    expect(cuerpo.ubicaciones).toEqual(['Bodega 1', 'Bodega 2']); // los nulos no aportan opción
  });

  it('filtra el inventario por estado del producto, y sin ese filtro sigue devolviendo activos e inactivos (FR-012)', async () => {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const activo = await crearProductoDePrueba(contexto.prisma, { estado: 'ACTIVO' });
    const inactivo = await crearProductoDePrueba(contexto.prisma, { estado: 'INACTIVO' });

    const soloInactivos = await request(servidor())
      .get('/api/inventario')
      .query({ estado: 'INACTIVO', porPagina: 100 })
      .set('Cookie', cookie);
    expect(soloInactivos.status).toBe(200);
    expect(idsDeInventario(soloInactivos.body)).toEqual([inactivo.id]);

    // Control: el DEFAULT de la pantalla no cambia — sin filtro se siguen viendo los dos (T111).
    const sinFiltro = await request(servidor())
      .get('/api/inventario')
      .query({ porPagina: 100 })
      .set('Cookie', cookie);
    expect(sinFiltro.status).toBe(200);
    expect(idsDeInventario(sinFiltro.body)).toEqual(expect.arrayContaining([activo.id, inactivo.id]));
  });

  /**
   * FR-077 — el rango se mide contra DISPONIBLE (stock − comprometido), nunca contra el stock
   * crudo. El escenario está construido para que las dos lecturas den resultados OPUESTOS: el
   * producto con más stock físico es el que tiene MENOS disponible.
   */
  it('el rango disponibleMin/disponibleMax se mide contra el disponible, no contra el stock crudo', async () => {
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    // Stock 100, pero 95 comprometidos en una salida PENDIENTE → disponible 5.
    const casiAgotado = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
    await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyecto.id,
      lineas: [{ productoId: casiAgotado.id, cantidad: 95 }],
    });
    // Stock 20, sin compromisos → disponible 20.
    const holgado = await crearProductoDePrueba(contexto.prisma, { stockActual: 20 });

    const hastaDiez = await request(servidor())
      .get('/api/inventario')
      .query({ disponibleMax: 10, porPagina: 100 })
      .set('Cookie', cookie);
    expect(hastaDiez.status).toBe(200);
    const filas = (hastaDiez.body as PaginaBody<FilaInventarioBody>).datos;
    expect(filas.map((fila) => fila.producto.id)).toEqual([casiAgotado.id]);
    expect(filas[0]?.disponible).toBe(5); // 100 − 95: si se hubiera filtrado por stock, no estaría
    expect((hastaDiez.body as PaginaBody<FilaInventarioBody>).total).toBe(1);

    const desdeDiez = await request(servidor())
      .get('/api/inventario')
      .query({ disponibleMin: 10, porPagina: 100 })
      .set('Cookie', cookie);
    expect(desdeDiez.status).toBe(200);
    expect(idsDeInventario(desdeDiez.body)).toEqual([holgado.id]);
  });

  // ==========================================================================
  // Ingresos (FR-075)
  // ==========================================================================

  /**
   * El valor del filtro nuevo está justamente en lo que `buscar` NO puede hacer: `buscar` cruza
   * número de factura OR proveedor, así que "3M" trae también la factura `3M-200` de otro
   * proveedor. La prueba usa ese solapamiento a propósito.
   */
  it('filtra ingresos por proveedor sin arrastrar los que solo coinciden por número de factura', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const delProveedor = await crearIngreso(cookie, {
      numeroFactura: 'FAC-US13-0001',
      proveedor: '3M Colombia',
      productoId: producto.id,
    });
    const conNumeroParecido = await crearIngreso(cookie, {
      numeroFactura: '3M-200',
      proveedor: 'Distribuidora Andina',
      productoId: producto.id,
    });

    // Control: `buscar` trae los DOS — es exactamente el problema que el filtro nuevo resuelve.
    const conBuscar = await request(servidor())
      .get('/api/ingresos')
      .query({ buscar: '3M', porPagina: 100 })
      .set('Cookie', cookie);
    expect(conBuscar.status).toBe(200);
    const idsBuscar = (conBuscar.body as PaginaBody<{ id: number }>).datos.map((fila) => fila.id);
    expect(idsBuscar).toEqual(expect.arrayContaining([delProveedor, conNumeroParecido]));

    const porProveedor = await request(servidor())
      .get('/api/ingresos')
      .query({ proveedor: '3m', porPagina: 100 }) // minúsculas: la búsqueda es insensible
      .set('Cookie', cookie);
    expect(porProveedor.status).toBe(200);
    const cuerpo = porProveedor.body as PaginaBody<{ id: number }>;
    expect(cuerpo.datos.map((fila) => fila.id)).toEqual([delProveedor]);
    expect(cuerpo.total).toBe(1);
  });

  // ==========================================================================
  // Salidas (FR-075)
  // ==========================================================================

  it('filtra salidas por número de salida (el correlativo de negocio, no el id) y devuelve página vacía si no existe', async () => {
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const primera = await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyecto.id,
      lineas: [{ productoId: producto.id, cantidad: 1 }],
    });
    const segunda = await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyecto.id,
      lineas: [{ productoId: producto.id, cantidad: 2 }],
    });

    const porNumero = await request(servidor())
      .get('/api/salidas')
      .query({ numero: segunda.numero, porPagina: 100 })
      .set('Cookie', cookie);
    expect(porNumero.status).toBe(200);
    const cuerpo = porNumero.body as PaginaBody<{ id: number; numero: number }>;
    expect(cuerpo.datos.map((fila) => fila.id)).toEqual([segunda.id]);
    expect(cuerpo.datos[0]?.numero).toBe(segunda.numero);
    expect(cuerpo.datos.map((fila) => fila.id)).not.toContain(primera.id);

    // Un número que no existe es una página vacía, NUNCA un 404: sigue siendo un listado.
    const inexistente = await request(servidor())
      .get('/api/salidas')
      .query({ numero: 999999 })
      .set('Cookie', cookie);
    expect(inexistente.status).toBe(200);
    expect((inexistente.body as PaginaBody<unknown>).total).toBe(0);
  });

  it('filtra salidas por el usuario que autoriza, y las PENDIENTE (sin autorizante) nunca aparecen', async () => {
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 500 });
    const autorizante = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const otro = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), autorizante.login, autorizante.password);

    const confirmadaPorAutorizante = await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyecto.id,
      lineas: [{ productoId: producto.id, cantidad: 5 }],
      estado: 'CONFIRMADA',
      usuarioAutorizaId: autorizante.id,
      fechaConfirmacion: new Date('2026-02-01T10:00:00Z'),
    });
    const confirmadaPorOtro = await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyecto.id,
      lineas: [{ productoId: producto.id, cantidad: 5 }],
      estado: 'CONFIRMADA',
      usuarioAutorizaId: otro.id,
      fechaConfirmacion: new Date('2026-02-01T11:00:00Z'),
    });
    const pendiente = await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyecto.id,
      lineas: [{ productoId: producto.id, cantidad: 5 }],
    });

    const respuesta = await request(servidor())
      .get('/api/salidas')
      .query({ usuarioAutorizaId: autorizante.id, porPagina: 100 })
      .set('Cookie', cookie);
    expect(respuesta.status).toBe(200);
    const ids = (respuesta.body as PaginaBody<{ id: number }>).datos.map((fila) => fila.id);
    expect(ids).toEqual([confirmadaPorAutorizante.id]);
    expect(ids).not.toContain(confirmadaPorOtro.id);
    expect(ids).not.toContain(pendiente.id); // sin autorizante: nunca matchea, para ningún valor
  });

  // ==========================================================================
  // Clientes (FR-075/FR-076)
  // ==========================================================================

  it('filtra clientes por ciudad y publica en opciones-filtro solo las ciudades existentes, sin repetir ni nulos', async () => {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const enMedellin = await crearClienteDePrueba(contexto.prisma, { ciudad: 'Medellín' });
    const otroEnMedellin = await crearClienteDePrueba(contexto.prisma, { ciudad: 'Medellín' });
    const enBogota = await crearClienteDePrueba(contexto.prisma, { ciudad: 'Bogotá' });
    const sinCiudad = await crearClienteDePrueba(contexto.prisma, {});

    const porCiudad = await request(servidor())
      .get('/api/clientes')
      .query({ ciudad: 'Medellín', porPagina: 100 })
      .set('Cookie', cookie);
    expect(porCiudad.status).toBe(200);
    const cuerpo = porCiudad.body as PaginaBody<{ id: number }>;
    const ids = cuerpo.datos.map((fila) => fila.id);
    expect(ids).toEqual(expect.arrayContaining([enMedellin.id, otroEnMedellin.id]));
    expect(ids).not.toContain(enBogota.id);
    expect(ids).not.toContain(sinCiudad.id);
    expect(cuerpo.total).toBe(2);

    // Igual que en inventario, esta ruta va declarada ANTES de `@Get(':id')` — si no, el
    // `ParseIntPipe` de la ruta paramétrica respondería `400` en vez de `200`.
    const opciones = await request(servidor()).get('/api/clientes/opciones-filtro').set('Cookie', cookie);
    expect(opciones.status).toBe(200);
    expect((opciones.body as { ciudades: string[] }).ciudades).toEqual(['Bogotá', 'Medellín']);
  });

  // ==========================================================================
  // Usuarios (FR-075)
  // ==========================================================================

  it('filtra usuarios por rol y devuelve página vacía (no un error) para un rol sin usuarios', async () => {
    const administrador = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), administrador.login, administrador.password);

    const rolOperarioId = await obtenerRolDelSistemaId(contexto.prisma, 'OPERARIO');
    const rolGerenteId = await obtenerRolDelSistemaId(contexto.prisma, 'GERENTE');

    const porRol = await request(servidor())
      .get('/api/usuarios')
      .query({ rolId: rolOperarioId, porPagina: 100 })
      .set('Cookie', cookie);
    expect(porRol.status).toBe(200);
    const ids = (porRol.body as PaginaBody<{ id: number }>).datos.map((fila) => fila.id);
    expect(ids).toContain(operario.id);
    expect(ids).not.toContain(administrador.id); // control negativo

    // Un rol existente pero sin titulares: página vacía, nunca un 400/404 (un filtro acota, no
    // valida la existencia del recurso).
    const sinTitulares = await request(servidor())
      .get('/api/usuarios')
      .query({ rolId: rolGerenteId })
      .set('Cookie', cookie);
    expect(sinTitulares.status).toBe(200);
    expect((sinTitulares.body as PaginaBody<unknown>).total).toBe(0);
  });

  // ==========================================================================
  // Transversal
  // ==========================================================================

  /**
   * Un campo de filtro en blanco viaja igual en la URL (`?disponibleMax=`) porque un
   * `<form method="GET">` envía SIEMPRE todos sus campos. Sin el saneamiento de
   * `esquemas/comunes.ts`, `z.coerce.number()` lo leería como `0` y "disponible hasta 0" no
   * devolvería NADA: el usuario vería un listado vacío por pulsar "Filtrar" sin llenar nada.
   */
  it('un filtro numérico enviado en blanco no recorta el listado (no se interpreta como cero)', async () => {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 50 });

    const respuesta = await request(servidor())
      .get('/api/inventario?disponibleMin=&disponibleMax=&categoria=&ubicacion=&porPagina=100')
      .set('Cookie', cookie);
    expect(respuesta.status).toBe(200);
    expect(idsDeInventario(respuesta.body)).toContain(producto.id);
  });

  /** Cuerpo mínimo válido de `POST /api/ingresos`, con proveedor y número parametrizables. */
  async function crearIngreso(
    cookie: string,
    datos: { numeroFactura: string; proveedor: string; productoId: number },
  ): Promise<number> {
    const respuesta = await request(servidor())
      .post('/api/ingresos')
      .set('Cookie', cookie)
      .send({
        numeroFactura: datos.numeroFactura,
        fechaFactura: '2026-02-01',
        proveedor: datos.proveedor,
        fechaRecepcion: '2026-02-02',
        lineas: [{ productoId: datos.productoId, cantidad: 3, precioUnitario: 1000 }],
      });
    expect(respuesta.status).toBe(201);
    return respuesta.body.id as number;
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
