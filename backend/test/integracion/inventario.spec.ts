/**
 * Pruebas de integración de INVENTARIO (T064, FR-020…FR-024) — API completa + PostgreSQL
 * REAL, contra el harness de `./setup.ts`. Verifica lo que solo se puede comprobar con datos
 * reales: cifras stock/comprometido/disponible derivadas de una salida `PENDIENTE` real
 * (`comprometidoPorProducto`), el filtro `soloStockBajo` comparando contra `disponible` (NUNCA
 * contra `stock_actual` crudo — decisión documentada en `dominio/entidades/producto.ts`),
 * búsqueda por SKU/descripción y el historial de movimientos enriquecido (número de
 * documento, nombre de usuario, nombre de proyecto) con una ENTRADA y una SALIDA reales sobre
 * el mismo producto.
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
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Fila de `GET /api/inventario` / `GET /api/inventario/:id` (ver `FilaInventario`). */
interface FilaInventarioBody {
  producto: {
    id: number;
    sku: string;
    descripcion: string;
    ubicacion: string | null;
    fechaUltimoMovimiento: string | null;
  };
  stock: number;
  comprometido: number;
  disponible: number;
  stockBajo: boolean;
}

/** Página genérica `{datos, total, pagina, porPagina}` (contracts/api-rest.md). */
interface PaginaBody<T> {
  datos: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

/** Fila de `GET /api/inventario/:productoId/movimientos` (ver `MovimientoHistorialProducto`). */
interface MovimientoHistorialBody {
  id: number;
  fechaHora: string;
  tipo: 'ENTRADA' | 'SALIDA' | 'AJUSTE_ENTRADA' | 'AJUSTE_SALIDA';
  cantidad: number;
  stockResultante: number;
  documentoTipo: 'INGRESO' | 'SALIDA';
  documentoId: number;
  numeroDocumento: string;
  usuarioId: number;
  usuarioNombre: string;
  proyectoId: number | null;
  proyectoNombre: string | null;
  motivo: string | null;
}

describe('Inventario — /api/inventario (T064)', () => {
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

  /** Cuerpo mínimo válido de `POST /api/ingresos` (esquemaCrearIngreso) — mismo patrón que `ingresos.spec.ts`. */
  function cuerpoIngreso(
    numeroFactura: string,
    lineas: { productoId: number; cantidad: number; precioUnitario: number }[],
  ): Record<string, unknown> {
    return {
      numeroFactura,
      fechaFactura: '2026-01-05',
      proveedor: 'Proveedor de Prueba de Inventario',
      fechaRecepcion: '2026-01-05',
      lineas,
    };
  }

  /** Cuerpo mínimo válido de `POST /api/salidas` (esquemaCrearSalida) — mismo patrón que `salidas.spec.ts`. */
  function cuerpoSalida(
    proyectoId: number,
    lineas: { productoId: number; cantidad: number; precioUnitario: number }[],
  ): Record<string, unknown> {
    return { proyectoId, fechaSalida: '2026-01-10', lineas };
  }

  it('un producto sin salidas aparece en GET /api/inventario con comprometido 0 y disponible igual al stock físico', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const respuesta = await request(servidor()).get('/api/inventario').set('Cookie', cookie);
    expect(respuesta.status).toBe(200);

    const cuerpo = respuesta.body as PaginaBody<FilaInventarioBody>;
    const fila = cuerpo.datos.find((f) => f.producto.id === producto.id);
    expect(fila).toBeDefined();
    expect(fila?.stock).toBe(100);
    expect(fila?.comprometido).toBe(0);
    expect(fila?.disponible).toBe(100);
    expect(fila?.stockBajo).toBe(false);
  });

  it('una salida PENDIENTE de 20 sobre un producto con stock 100 deja comprometido 20/disponible 80 en la ficha (GET /api/inventario/:id)', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const respuestaCrearSalida = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookie)
      .send(cuerpoSalida(proyecto.id, [{ productoId: producto.id, cantidad: 20, precioUnitario: 100 }]));
    expect(respuestaCrearSalida.status).toBe(201); // PENDIENTE: no toca stock físico, solo compromete

    const respuestaFicha = await request(servidor()).get(`/api/inventario/${producto.id}`).set('Cookie', cookie);
    expect(respuestaFicha.status).toBe(200);

    const ficha = respuestaFicha.body as FilaInventarioBody;
    expect(ficha.stock).toBe(100);
    expect(ficha.comprometido).toBe(20);
    expect(ficha.disponible).toBe(80);
  });

  it('soloStockBajo=true incluye solo productos cuyo DISPONIBLE (no el stock crudo) está en o por debajo de su umbral (FR-022, US5-AS2)', async () => {
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    // stock 18, umbral 10, salida PENDIENTE de 10 -> disponible 8 <= 10 -> SÍ es stock bajo,
    // aunque el stock físico (18) esté por encima del umbral: la comparación correcta es
    // contra "disponible", nunca contra "stock_actual" crudo.
    const productoBajo = await crearProductoDePrueba(contexto.prisma, { stockActual: 18, umbralStockBajo: 10 });
    const respuestaSalidaBajo = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookie)
      .send(cuerpoSalida(proyecto.id, [{ productoId: productoBajo.id, cantidad: 10, precioUnitario: 100 }]));
    expect(respuestaSalidaBajo.status).toBe(201);

    // stock 100, umbral 10, sin salidas -> disponible 100, muy por encima del umbral.
    const productoNormal = await crearProductoDePrueba(contexto.prisma, { stockActual: 100, umbralStockBajo: 10 });

    const respuesta = await request(servidor())
      .get('/api/inventario')
      .query({ soloStockBajo: 'true' })
      .set('Cookie', cookie);
    expect(respuesta.status).toBe(200);

    const cuerpo = respuesta.body as PaginaBody<FilaInventarioBody>;
    const ids = cuerpo.datos.map((f) => f.producto.id);
    expect(ids).toContain(productoBajo.id);
    expect(ids).not.toContain(productoNormal.id);

    const filaBajo = cuerpo.datos.find((f) => f.producto.id === productoBajo.id);
    expect(filaBajo?.disponible).toBe(8);
    expect(filaBajo?.stockBajo).toBe(true);
  });

  it('la búsqueda por SKU y por descripción (parcial, insensible a mayúsculas) devuelve los productos correctos (FR-023)', async () => {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const productoObjetivo = await crearProductoDePrueba(contexto.prisma, {
      sku: 'TOR-HEX-9001',
      descripcion: 'Tornillo Hexagonal Galvanizado 1/2 pulgada',
    });
    const otroProducto = await crearProductoDePrueba(contexto.prisma, {
      sku: 'CAB-ELE-3002',
      descripcion: 'Cable eléctrico calibre 12',
    });

    const respuestaPorSku = await request(servidor())
      .get('/api/inventario')
      .query({ buscar: 'tor-hex' }) // minúsculas, parcial, sobre el SKU
      .set('Cookie', cookie);
    expect(respuestaPorSku.status).toBe(200);
    const idsPorSku = (respuestaPorSku.body as PaginaBody<FilaInventarioBody>).datos.map((f) => f.producto.id);
    expect(idsPorSku).toContain(productoObjetivo.id);
    expect(idsPorSku).not.toContain(otroProducto.id);

    const respuestaPorDescripcion = await request(servidor())
      .get('/api/inventario')
      .query({ buscar: 'hexagonal' }) // minúsculas, parcial, sobre la descripción
      .set('Cookie', cookie);
    expect(respuestaPorDescripcion.status).toBe(200);
    const idsPorDescripcion = (respuestaPorDescripcion.body as PaginaBody<FilaInventarioBody>).datos.map(
      (f) => f.producto.id,
    );
    expect(idsPorDescripcion).toContain(productoObjetivo.id);
    expect(idsPorDescripcion).not.toContain(otroProducto.id);
  });

  it(
    'el historial de un producto incluye AMBOS movimientos (ENTRADA de un ingreso recibido y SALIDA de una ' +
      'salida confirmada), el más reciente primero, con numeroDocumento/usuarioNombre resueltos y ' +
      'proyectoNombre solo en la SALIDA (FR-024/FR-045)',
    async () => {
      const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });
      const cliente = await crearClienteDePrueba(contexto.prisma);
      const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
      const usuario = await crearUsuarioDePrueba(contexto, {
        rol: 'OPERARIO',
        nombreCompleto: 'Operario Historial de Prueba',
      });
      const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

      // 1) ENTRADA real: crear + recibir un ingreso (sube el stock de 0 a 15).
      const respuestaCrearIngreso = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie)
        .send(cuerpoIngreso('FAC-INVENTARIO-0001', [{ productoId: producto.id, cantidad: 15, precioUnitario: 1000 }]));
      expect(respuestaCrearIngreso.status).toBe(201);
      const ingresoId: number = respuestaCrearIngreso.body.id;

      const respuestaRecibir = await request(servidor())
        .post(`/api/ingresos/${ingresoId}/recibir`)
        .set('Cookie', cookie);
      expect(respuestaRecibir.status).toBe(204);

      // 2) SALIDA real: crear + confirmar una salida sobre el MISMO producto (descuenta 5).
      const respuestaCrearSalida = await request(servidor())
        .post('/api/salidas')
        .set('Cookie', cookie)
        .send(cuerpoSalida(proyecto.id, [{ productoId: producto.id, cantidad: 5, precioUnitario: 1000 }]));
      expect(respuestaCrearSalida.status).toBe(201);
      const salidaId: number = respuestaCrearSalida.body.id;
      const salidaNumero: number = respuestaCrearSalida.body.numero;

      const respuestaConfirmar = await request(servidor())
        .post(`/api/salidas/${salidaId}/confirmar`)
        .set('Cookie', cookie);
      expect(respuestaConfirmar.status).toBe(204);

      const respuestaHistorial = await request(servidor())
        .get(`/api/inventario/${producto.id}/movimientos`)
        .set('Cookie', cookie);
      expect(respuestaHistorial.status).toBe(200);

      const historial = respuestaHistorial.body as PaginaBody<MovimientoHistorialBody>;
      expect(historial.datos).toHaveLength(2);

      // Más reciente primero: la SALIDA se confirmó DESPUÉS de recibir el ingreso.
      const [masReciente, masAntiguo] = historial.datos;
      expect(masReciente?.tipo).toBe('SALIDA');
      expect(masReciente?.documentoTipo).toBe('SALIDA');
      expect(masReciente?.documentoId).toBe(salidaId);
      expect(masReciente?.numeroDocumento).toBe(String(salidaNumero)); // número de salida, no el id
      expect(masReciente?.usuarioNombre).toBe('Operario Historial de Prueba'); // no un id crudo
      expect(masReciente?.proyectoId).toBe(proyecto.id);
      expect(masReciente?.proyectoNombre).toBe(proyecto.nombre); // presente SOLO en el movimiento de salida
      expect(masReciente?.cantidad).toBe(5);

      expect(masAntiguo?.tipo).toBe('ENTRADA');
      expect(masAntiguo?.documentoTipo).toBe('INGRESO');
      expect(masAntiguo?.documentoId).toBe(ingresoId);
      expect(masAntiguo?.numeroDocumento).toBe('FAC-INVENTARIO-0001'); // número de factura, no el id
      expect(masAntiguo?.usuarioNombre).toBe('Operario Historial de Prueba');
      expect(masAntiguo?.proyectoId).toBeNull(); // ausente/null en el movimiento de entrada
      expect(masAntiguo?.proyectoNombre).toBeNull();
      expect(masAntiguo?.cantidad).toBe(15);
    },
  );

  /**
   * FR-012 — la baja lógica de un producto tiene que SIGNIFICAR algo: un producto INACTIVO
   * deja de ofrecerse para documentos NUEVOS (el selector de líneas de ingresos y salidas se
   * alimenta de `GET /api/productos`), pero sigue visible en la consulta de inventario con su
   * etiqueta de estado, porque su historial y su stock siguen existiendo (Principio II).
   *
   * Regresión real: hasta la tanda de CRUD de productos (T111) el botón "Desactivar" no tenía
   * ningún efecto observable — el selector no filtraba por estado, así que un producto dado de
   * baja seguía apareciendo al crear un ingreso o una salida. Mismo criterio que
   * `proyectosDestino` con FR-038.
   */
  it('un producto INACTIVO desaparece del selector de documentos nuevos pero sigue visible en el inventario (FR-012)', async () => {
    const activo = await crearProductoDePrueba(contexto.prisma, { stockActual: 50 });
    const inactivo = await crearProductoDePrueba(contexto.prisma, { stockActual: 30 });
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    // Ambos aparecen mientras los dos están ACTIVOS (control positivo: si el filtro fuera
    // demasiado agresivo, esta aserción lo detectaría).
    const antes = await request(servidor()).get('/api/productos').set('Cookie', cookie);
    expect(antes.status).toBe(200);
    const idsAntes = (antes.body as { id: number }[]).map((p) => p.id);
    expect(idsAntes).toEqual(expect.arrayContaining([activo.id, inactivo.id]));

    const baja = await request(servidor())
      .put(`/api/productos/${inactivo.id}/estado`)
      .send({ estado: 'INACTIVO' })
      .set('Cookie', cookie);
    expect(baja.status).toBe(204);

    // Selector de documentos nuevos: el dado de baja YA NO se ofrece.
    const despues = await request(servidor()).get('/api/productos').set('Cookie', cookie);
    expect(despues.status).toBe(200);
    const idsDespues = (despues.body as { id: number }[]).map((p) => p.id);
    expect(idsDespues).toContain(activo.id);
    expect(idsDespues).not.toContain(inactivo.id);

    // Consulta de inventario: sigue visible (su stock y su historial no desaparecen).
    const inventario = await request(servidor())
      .get('/api/inventario')
      .query({ porPagina: 100 })
      .set('Cookie', cookie);
    expect(inventario.status).toBe(200);
    const idsInventario = (inventario.body as { datos: { producto: { id: number } }[] }).datos.map(
      (fila) => fila.producto.id,
    );
    expect(idsInventario).toEqual(expect.arrayContaining([activo.id, inactivo.id]));
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
