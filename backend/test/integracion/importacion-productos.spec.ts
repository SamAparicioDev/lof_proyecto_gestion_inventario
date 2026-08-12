/**
 * Pruebas de integración de CARGA MASIVA DE INVENTARIO (T097, US8, FR-048…FR-051) — API
 * completa + PostgreSQL REAL, contra el harness de `./setup.ts`. Cubre los invariantes que
 * `docs/arquitectura.md` §8 exige probar contra la base real: que el stock inicial de la
 * carga masiva pase por el MISMO flujo atómico de `RepositorioIngresos.crear`/`.recibir` que
 * un ingreso manual (research R15, data-model.md § Carga masiva de inventario — mismo
 * `FOR UPDATE`, mismos movimientos `ENTRADA`), que un SKU existente se actualice sin
 * duplicarse, que el procesamiento sea PARCIAL fila por fila (FR-051) y que un archivo
 * vacío/no válido se rechace sin tocar ningún producto (US8-AS5).
 *
 * Los archivos `.xlsx` de cada caso se generan EN LA PROPIA PRUEBA con `exceljs`
 * (`construirBufferImportacion`) — nunca a partir de la plantilla real del endpoint — para
 * controlar exactamente el contenido de cada fila, incluidas las deliberadamente inválidas.
 * Layout idéntico al que lee `leerFilasImportacionProductos` (columnas por POSICIÓN, hoja
 * "Productos", fila 1 = encabezado, datos desde la fila 2).
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend`.
 */
import request from 'supertest';
import ExcelJS from 'exceljs';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearProductoDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Forma de `ResumenImportacion` (contracts/api-rest.md § Carga masiva de inventario). */
interface ResumenImportacionBody {
  creados: number;
  actualizados: number;
  conStockInicial: number;
  /** US12 (FR-074) — filas cuyo "Valor unitario" cambió realmente el costo del producto. */
  costosActualizados: number;
  errores: { fila: number; mensaje: string }[];
}

/** Una fila de la hoja "Productos", en el mismo orden posicional que
 *  `esquemaFilaImportacionProducto`/`generar-plantilla-productos.ts` — todos los campos
 *  opcionales para poder construir a propósito filas incompletas/inválidas. */
interface FilaExcelImportacion {
  sku?: string | null;
  descripcion?: string | null;
  categoria?: string | null;
  ubicacion?: string | null;
  umbralStockBajo?: number | null;
  cantidadInicial?: number | null;
  valorUnitario?: number | null;
}

describe('Carga masiva de inventario — /api/productos/{plantilla-importacion,importar} (T097)', () => {
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
    'SKU nuevo con cantidadInicial>0 crea el producto Y agrupa la fila en un Ingreso sintético ' +
      'RECIBIDO con un movimiento ENTRADA — mismo stock/auditoría que un ingreso manual (FR-050)',
    async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);

      const buffer = await construirBufferImportacion([
        {
          sku: 'IMPORT-NUEVO-001',
          descripcion: 'Producto nuevo por carga masiva',
          categoria: 'Ferretería',
          ubicacion: 'Estante B-2',
          umbralStockBajo: 5,
          cantidadInicial: 20,
          valorUnitario: 1500,
        },
      ]);

      const respuesta = await adjuntarArchivo(
        request(servidor()).post('/api/productos/importar').set('Cookie', cookie),
        buffer,
      );

      expect(respuesta.status).toBe(200);
      const resumen = respuesta.body as ResumenImportacionBody;
      // `costosActualizados: 1` (US12): el producto nace con costo 0 y la fila trae 1500, así
      // que ese sí es un cambio de costo y queda registrado con `origen: IMPORTACION`.
      expect(resumen).toEqual({ creados: 1, actualizados: 0, conStockInicial: 1, costosActualizados: 1, errores: [] });

      const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'IMPORT-NUEVO-001' } });
      expect(producto.descripcion).toBe('Producto nuevo por carga masiva');
      expect(producto.categoria).toBe('Ferretería');
      expect(producto.ubicacion).toBe('Estante B-2');
      expect(producto.umbralStockBajo.toNumber()).toBe(5);
      expect(producto.stockActual.toNumber()).toBe(20); // stock_actual resultante correcto

      const ingreso = await contexto.prisma.ingreso.findFirstOrThrow({
        where: { proveedor: 'Carga masiva de inventario' },
      });
      expect(ingreso.numeroFactura).toMatch(/^IMPORTACION-/);
      expect(ingreso.estado).toBe('RECIBIDO'); // pasó por crear() + recibir(), igual que US1

      const movimientos = await contexto.prisma.movimientoInventario.findMany({
        where: { documentoTipo: 'INGRESO', documentoId: ingreso.id },
      });
      expect(movimientos).toHaveLength(1);
      const [movimiento] = movimientos;
      expect(movimiento?.tipo).toBe('ENTRADA');
      expect(Number(movimiento?.productoId)).toBe(Number(producto.id));
      expect(movimiento?.cantidad.toNumber()).toBe(20);
      expect(movimiento?.stockResultante.toNumber()).toBe(20);
      expect(Number(movimiento?.usuarioId)).toBe(admin.id);
    },
  );

  it(
    'SKU existente ACTUALIZA el producto (descripción/categoría/ubicación/umbral) sin duplicarlo ' +
      '— sigue habiendo una sola fila con ese SKU, y el stock no cambia sin cantidadInicial (FR-049)',
    async () => {
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);
      const existente = await crearProductoDePrueba(contexto.prisma, {
        sku: 'IMPORT-EXISTE-001',
        descripcion: 'Descripción original',
        stockActual: 10,
        umbralStockBajo: 2,
      });

      const buffer = await construirBufferImportacion([
        {
          sku: 'IMPORT-EXISTE-001',
          descripcion: 'Descripción actualizada por carga masiva',
          categoria: 'Eléctrico',
          ubicacion: 'Estante C-1',
          umbralStockBajo: 8,
          // sin cantidadInicial: la fila solo actualiza catálogo, no debe mover stock.
        },
      ]);

      const respuesta = await adjuntarArchivo(
        request(servidor()).post('/api/productos/importar').set('Cookie', cookie),
        buffer,
      );

      expect(respuesta.status).toBe(200);
      // `costosActualizados: 0` (US12): la fila no trae "Valor unitario", así que el costo del
      // producto queda intacto y no se registra ningún cambio (FR-074).
      expect(respuesta.body).toEqual({
        creados: 0,
        actualizados: 1,
        conStockInicial: 0,
        costosActualizados: 0,
        errores: [],
      });

      const totalConEseSku = await contexto.prisma.producto.count({ where: { sku: 'IMPORT-EXISTE-001' } });
      expect(totalConEseSku).toBe(1); // ACTUALIZÓ, nunca duplicó

      const productoActualizado = await contexto.prisma.producto.findUniqueOrThrow({
        where: { id: BigInt(existente.id) },
      });
      expect(productoActualizado.descripcion).toBe('Descripción actualizada por carga masiva');
      expect(productoActualizado.categoria).toBe('Eléctrico');
      expect(productoActualizado.ubicacion).toBe('Estante C-1');
      expect(productoActualizado.umbralStockBajo.toNumber()).toBe(8);
      expect(productoActualizado.stockActual.toNumber()).toBe(10); // sin cambios: la fila no traía cantidadInicial

      const totalIngresosSinteticos = await contexto.prisma.ingreso.count({
        where: { proveedor: 'Carga masiva de inventario' },
      });
      expect(totalIngresosSinteticos).toBe(0); // ninguna fila con stock inicial ⇒ no se arma Ingreso
    },
  );

  it(
    'fila inválida no bloquea el resto del archivo (US8-AS3): 2 filas válidas se aplican Y la ' +
      'fila inválida aparece en "errores" con su número de fila REAL del Excel',
    async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);

      const buffer = await construirBufferImportacion([
        // fila 2 (válida, con stock inicial)
        {
          sku: 'IMPORT-PARCIAL-VALIDA-001',
          descripcion: 'Fila válida con stock',
          cantidadInicial: 7,
          valorUnitario: 900,
        },
        // fila 3 (inválida a propósito: sin SKU)
        { sku: null, descripcion: 'Fila sin SKU, debe fallar' },
        // fila 4 (válida, sin stock inicial)
        { sku: 'IMPORT-PARCIAL-VALIDA-002', descripcion: 'Fila válida sin stock' },
      ]);

      const respuesta = await adjuntarArchivo(
        request(servidor()).post('/api/productos/importar').set('Cookie', cookie),
        buffer,
      );

      expect(respuesta.status).toBe(200);
      const resumen = respuesta.body as ResumenImportacionBody;
      expect(resumen.creados).toBe(2);
      expect(resumen.actualizados).toBe(0);
      expect(resumen.conStockInicial).toBe(1);
      expect(resumen.errores).toEqual([{ fila: 3, mensaje: 'El SKU es obligatorio' }]);

      // Las 2 filas válidas SÍ se aplicaron pese al error de la fila 3.
      const productoA = await contexto.prisma.producto.findUniqueOrThrow({
        where: { sku: 'IMPORT-PARCIAL-VALIDA-001' },
      });
      expect(productoA.stockActual.toNumber()).toBe(7);
      await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'IMPORT-PARCIAL-VALIDA-002' } });
    },
  );

  it(
    'SKU repetido DENTRO del mismo archivo: la primera ocurrencia se procesa, la repetición se ' +
      'reporta como fila inválida (sin mezclar datos) y las filas siguientes se siguen procesando',
    async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);

      const buffer = await construirBufferImportacion([
        // fila 2: primera ocurrencia del SKU repetido — esta es la que se procesa.
        { sku: 'IMPORT-REPETIDO-001', descripcion: 'Primera ocurrencia (válida)' },
        // fila 3: mismo SKU, con datos distintos — debe reportarse como inválida, sin aplicarse.
        { sku: 'IMPORT-REPETIDO-001', descripcion: 'Segunda ocurrencia (debe rechazarse)' },
        // fila 4: SKU distinto — el resto del archivo sigue procesándose con normalidad.
        { sku: 'IMPORT-REPETIDO-002', descripcion: 'Fila distinta, no afectada por la repetición' },
      ]);

      const respuesta = await adjuntarArchivo(
        request(servidor()).post('/api/productos/importar').set('Cookie', cookie),
        buffer,
      );

      expect(respuesta.status).toBe(200);
      const resumen = respuesta.body as ResumenImportacionBody;
      expect(resumen.creados).toBe(2); // solo la primera ocurrencia + la fila distinta
      expect(resumen.errores).toEqual([
        {
          fila: 3,
          mensaje: 'El SKU "IMPORT-REPETIDO-001" está repetido en el archivo (ya aparece en la fila 2).',
        },
      ]);

      const totalConSkuRepetido = await contexto.prisma.producto.count({ where: { sku: 'IMPORT-REPETIDO-001' } });
      expect(totalConSkuRepetido).toBe(1); // nunca se mezclaron/duplicaron las dos ocurrencias

      const productoRepetido = await contexto.prisma.producto.findUniqueOrThrow({
        where: { sku: 'IMPORT-REPETIDO-001' },
      });
      expect(productoRepetido.descripcion).toBe('Primera ocurrencia (válida)'); // no la segunda ocurrencia
    },
  );

  it(
    'archivo sin filas de datos (solo encabezados) se rechaza con 400 SIN tocar ningún producto ' +
      '(US8-AS5)',
    async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await crearProductoDePrueba(contexto.prisma); // producto ya existente, para verificar que no se toca
      const totalAntes = await contexto.prisma.producto.count();

      const buffer = await construirBufferImportacion([]); // solo la fila de encabezado, sin datos

      const respuesta = await adjuntarArchivo(
        request(servidor()).post('/api/productos/importar').set('Cookie', cookie),
        buffer,
      );

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.mensaje).toBe('El archivo no tiene filas de datos para procesar.');

      const totalDespues = await contexto.prisma.producto.count();
      expect(totalDespues).toBe(totalAntes); // ningún producto se creó/modificó
    },
  );

  it('archivo que no es un .xlsx válido se rechaza con 400 SIN tocar ningún producto (US8-AS5)', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
    await crearProductoDePrueba(contexto.prisma);
    const totalAntes = await contexto.prisma.producto.count();

    const bufferNoValido = Buffer.from('esto no es un archivo Excel válido', 'utf-8');

    const respuesta = await adjuntarArchivo(
      request(servidor()).post('/api/productos/importar').set('Cookie', cookie),
      bufferNoValido,
    );

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.mensaje).toBe('El archivo no es un Excel (.xlsx) válido.');

    const totalDespues = await contexto.prisma.producto.count();
    expect(totalDespues).toBe(totalAntes);
  });

  it(
    'rechaza con 403 a un OPERARIO en ambas rutas de carga masiva (solo Administrador/Gerente — ' +
      'US8-AS4, FR-002/FR-003)',
    async () => {
      const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const cookie = await iniciarSesion(servidor(), operario.login, operario.password);

      const respuestaPlantilla = await request(servidor())
        .get('/api/productos/plantilla-importacion')
        .set('Cookie', cookie);
      expect(respuestaPlantilla.status).toBe(403);

      const buffer = await construirBufferImportacion([{ sku: 'IMPORT-ROL-001', descripcion: 'No debería crearse' }]);
      const respuestaImportar = await adjuntarArchivo(
        request(servidor()).post('/api/productos/importar').set('Cookie', cookie),
        buffer,
      );
      expect(respuestaImportar.status).toBe(403);

      const totalConEseSku = await contexto.prisma.producto.count({ where: { sku: 'IMPORT-ROL-001' } });
      expect(totalConEseSku).toBe(0); // el guard bloqueó antes de procesar el archivo
    },
  );

  it('las 2 rutas de carga masiva exigen sesión (401 sin cookie)', async () => {
    const respuestaPlantilla = await request(servidor()).get('/api/productos/plantilla-importacion');
    expect(respuestaPlantilla.status).toBe(401);

    const buffer = await construirBufferImportacion([{ sku: 'IMPORT-SESION-001', descripcion: 'No debería crearse' }]);
    const respuestaImportar = await adjuntarArchivo(request(servidor()).post('/api/productos/importar'), buffer);
    expect(respuestaImportar.status).toBe(401);

    const totalConEseSku = await contexto.prisma.producto.count({ where: { sku: 'IMPORT-SESION-001' } });
    expect(totalConEseSku).toBe(0);
  });
});

/**
 * Construye un `.xlsx` en memoria con la hoja "Productos" (mismo nombre y layout posicional
 * que `leerFilasImportacionProductos` — SKU, Descripción, Categoría, Ubicación, Umbral stock
 * bajo, Cantidad inicial, Valor unitario) para las pruebas de esta suite. Cada `fila` puede
 * omitir cualquier campo a propósito, para construir filas inválidas.
 */
async function construirBufferImportacion(filas: FilaExcelImportacion[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Productos');
  hoja.addRow(['SKU', 'Descripción', 'Categoría', 'Ubicación', 'Umbral stock bajo', 'Cantidad inicial', 'Valor unitario']);

  for (const fila of filas) {
    hoja.addRow([
      fila.sku ?? null,
      fila.descripcion ?? null,
      fila.categoria ?? null,
      fila.ubicacion ?? null,
      fila.umbralStockBajo ?? null,
      fila.cantidadInicial ?? null,
      fila.valorUnitario ?? null,
    ]);
  }

  const bufferGenerado = await libro.xlsx.writeBuffer();
  return Buffer.from(bufferGenerado);
}

/** Adjunta `buffer` como el campo `archivo` (`FileInterceptor('archivo')`) de una petición
 *  `multipart/form-data` ya construida — mismo campo que consume `POST /api/productos/importar`. */
function adjuntarArchivo(peticion: request.Test, buffer: Buffer, nombreArchivo = 'carga-masiva.xlsx'): request.Test {
  return peticion.attach('archivo', buffer, nombreArchivo);
}

/** Hace login por HTTP y devuelve la cookie de sesión lista para `.set('Cookie', …)` — mismo
 *  patrón local que el resto de suites de integración (cada una define el suyo). */
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
