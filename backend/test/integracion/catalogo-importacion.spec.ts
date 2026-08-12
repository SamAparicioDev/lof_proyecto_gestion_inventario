/**
 * Pruebas de integración del CATÁLOGO EXPORTABLE en formato de plantilla (T113, Phase 13,
 * FR-053) — API completa + PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Lo que se prueba aquí no se puede probar con mocks: el valor de esta ruta es el CICLO
 * COMPLETO descargar → editar → volver a subir. La prueba central baja el `.xlsx` real del
 * endpoint, lo relee con `exceljs` y lo vuelve a subir TAL CUAL por `POST /api/productos/
 * importar` (el mismo endpoint que usa el usuario, sin atajos), comprobando el invariante que
 * motiva toda la tarea: **el stock de cada producto queda EXACTAMENTE igual antes y después**.
 * Es la red que impide que alguien "complete" mañana las columnas `Cantidad inicial`/`Valor
 * unitario` con el stock actual: si lo hiciera, re-subir el archivo lo volvería a SUMAR
 * (`ImportarProductosCasoUso` agrupa esas filas en un `Ingreso` sintético, FR-050) y el
 * inventario quedaría duplicado.
 *
 * A diferencia de `importacion-productos.spec.ts` —que construye sus `.xlsx` en la propia
 * prueba para controlar filas inválidas a propósito— aquí el archivo SIEMPRE sale del endpoint
 * real: probar el generador contra un archivo fabricado por la prueba no demostraría nada
 * sobre lo que descarga el usuario.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend`.
 */
import request from 'supertest';
import ExcelJS from 'exceljs';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import { cerrarAppDePrueba, crearAppDePrueba, crearUsuarioDePrueba, truncarTablas, type AppDePrueba } from './setup';

/** Columnas de la hoja "Productos" (`generar-plantilla-productos.ts`), por POSICIÓN. */
/** 7 columnas del contrato de importación + la 8ª informativa "Stock actual" (FR-070). */
const TOTAL_COLUMNAS = 8;
const COLUMNA_SKU = 0;
const COLUMNA_DESCRIPCION = 1;
const COLUMNA_CATEGORIA = 2;
const COLUMNA_UBICACION = 3;
const COLUMNA_UMBRAL = 4;
const COLUMNA_CANTIDAD_INICIAL = 5;
const COLUMNA_VALOR_UNITARIO = 6;
/** Columna 8 (índice 7): informativa, FUERA del rango 1..7 que lee el importador — FR-070. */
const COLUMNA_STOCK_INFORMATIVO = 7;

/** Content-Type del `.xlsx` (contracts/api-rest.md § Carga masiva de inventario). */
const CONTENT_TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Forma de `ResumenImportacion` (contracts/api-rest.md § Carga masiva de inventario). */
interface ResumenImportacionBody {
  creados: number;
  actualizados: number;
  conStockInicial: number;
  /** US12 (FR-074) — filas cuyo "Valor unitario" cambió realmente el costo del producto. */
  costosActualizados: number;
  errores: { fila: number; mensaje: string }[];
}

/** Datos de un producto sembrado directamente con Prisma para esta suite. */
interface ProductoSembrado {
  sku: string;
  descripcion: string;
  categoria: string | null;
  ubicacion: string | null;
  umbralStockBajo: number;
  stockActual: number;
  ultimoCosto: number;
  estado?: 'ACTIVO' | 'INACTIVO';
}

/**
 * Catálogo de partida de las pruebas. Deliberadamente variado: stock y último costo distintos
 * de cero (para que "columna vacía" sea una afirmación con contenido, no una casualidad de una
 * BD recién truncada), un producto sin categoría ni ubicación (columnas opcionales vacías) y
 * uno dado de baja (sigue siendo parte del catálogo — FR-012 es baja lógica, nunca DELETE).
 */
const CATALOGO_SEMBRADO: readonly ProductoSembrado[] = [
  {
    sku: 'CAT-EXPORT-001',
    descripcion: 'Cemento gris 50 kg',
    categoria: 'Construcción',
    ubicacion: 'Bodega A-1',
    umbralStockBajo: 10,
    stockActual: 42,
    ultimoCosto: 28500,
  },
  {
    sku: 'CAT-EXPORT-002',
    descripcion: 'Producto sin categoría ni ubicación',
    categoria: null,
    ubicacion: null,
    umbralStockBajo: 0,
    stockActual: 7.5,
    ultimoCosto: 1200,
  },
  {
    sku: 'CAT-EXPORT-003',
    descripcion: 'Producto dado de baja',
    categoria: 'Eléctrico',
    ubicacion: 'Estante C-4',
    umbralStockBajo: 5,
    stockActual: 3,
    ultimoCosto: 9900,
    estado: 'INACTIVO',
  },
];

describe('Catálogo exportable en formato de plantilla — GET /api/productos/catalogo-importacion (T113)', () => {
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
    'devuelve UNA FILA POR PRODUCTO con sus datos, el costo y el stock VISIBLES, y "Cantidad ' +
      'inicial" VACÍA — la única columna que al re-subir duplicaría inventario (FR-053/FR-070)',
    async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);

      const respuesta = await pedirBinario(servidor(), '/api/productos/catalogo-importacion').set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      expect(respuesta.headers['content-type']).toContain(CONTENT_TYPE_XLSX);
      expect(respuesta.headers['content-disposition']).toBe(
        `attachment; filename="catalogo-inventario-${fechaHoyIso()}.xlsx"`,
      );

      const hoja = await hojaProductos(respuesta.body as Buffer);

      // Una fila de encabezado + una fila por producto existente. Ni de más (fila de ejemplo de
      // la plantilla vacía) ni de menos (el producto INACTIVO también es catálogo).
      expect(hoja.rowCount).toBe(CATALOGO_SEMBRADO.length + 1);

      const filas = filasPorSku(hoja);
      expect([...filas.keys()].sort()).toEqual(CATALOGO_SEMBRADO.map((producto) => producto.sku).sort());

      for (const sembrado of CATALOGO_SEMBRADO) {
        const fila = filas.get(sembrado.sku) as unknown[];
        expect(fila[COLUMNA_DESCRIPCION]).toBe(sembrado.descripcion);
        expect(fila[COLUMNA_CATEGORIA] ?? null).toBe(sembrado.categoria);
        expect(fila[COLUMNA_UBICACION] ?? null).toBe(sembrado.ubicacion);
        expect(fila[COLUMNA_UMBRAL]).toBe(sembrado.umbralStockBajo);

        // EL INVARIANTE QUE SOSTIENE EL INVENTARIO: "Cantidad inicial" vacía SIEMPRE. Es la única
        // columna que, al volver a subir el archivo, SUMARÍA su valor al stock — escribir ahí el
        // stock actual lo duplicaría. Con `stockActual` distinto de cero en el sembrado, esta
        // aserción solo pasa si el generador nunca lo escribe en esa columna.
        expect(fila[COLUMNA_CANTIDAD_INICIAL] ?? null).toBeNull();

        // Lo que SÍ debe verse (FR-070, corrige la decisión original de vaciar ambas): el costo
        // en su columna —segura, porque el importador solo la consume acompañada de una
        // cantidad— y el stock en la columna informativa, fuera del rango que lee el importador.
        expect(fila[COLUMNA_VALOR_UNITARIO]).toBe(sembrado.ultimoCosto);
        expect(fila[COLUMNA_STOCK_INFORMATIVO]).toBe(sembrado.stockActual);
      }
    },
  );

  it(
    'usa EXACTAMENTE la misma hoja y los mismos encabezados que la plantilla vacía, más una hoja ' +
      '"Instrucciones" que advierte que las columnas de stock deben quedarse vacías',
    async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);

      const respuestaCatalogo = await pedirBinario(servidor(), '/api/productos/catalogo-importacion').set(
        'Cookie',
        cookie,
      );
      const respuestaPlantilla = await pedirBinario(servidor(), '/api/productos/plantilla-importacion').set(
        'Cookie',
        cookie,
      );

      const hojaCatalogo = await hojaProductos(respuestaCatalogo.body as Buffer);
      const hojaPlantilla = await hojaProductos(respuestaPlantilla.body as Buffer);

      // Mismo nombre de hoja (`hojaProductos` fallaría si no existiera "Productos") y mismos
      // encabezados en el mismo orden: es lo que permite subir los dos por el mismo endpoint.
      expect(valoresFila(hojaCatalogo, 1, TOTAL_COLUMNAS)).toEqual(valoresFila(hojaPlantilla, 1, TOTAL_COLUMNAS));

      const libroCatalogo = await cargarLibroXlsx(respuestaCatalogo.body as Buffer);
      const instrucciones = libroCatalogo.getWorksheet('Instrucciones');
      expect(instrucciones).toBeDefined();
      const textoInstrucciones = textoDeLaHoja(instrucciones as ExcelJS.Worksheet);
      expect(textoInstrucciones).toContain('Cantidad inicial');
      expect(textoInstrucciones).toContain('Valor unitario');
      // El aviso pasó de "ambas columnas van vacías" a señalar la ÚNICA que puede inflar el
      // inventario (FR-070): el costo y el stock ahora sí se muestran, en su columna segura.
      expect(textoInstrucciones).toContain('VACÍA A PROPÓSITO');
      expect(textoInstrucciones).toContain('Stock actual');
    },
  );

  it(
    'volver a subir el archivo descargado ACTUALIZA el catálogo sin duplicar productos NI alterar ' +
      'el stock — verificado antes/después producto por producto (FR-053 + FR-049)',
    async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);

      const totalProductosAntes = await contexto.prisma.producto.count();
      const stockAntes = await stockPorSku();
      const totalMovimientosAntes = await contexto.prisma.movimientoInventario.count();

      const descarga = await pedirBinario(servidor(), '/api/productos/catalogo-importacion').set('Cookie', cookie);
      expect(descarga.status).toBe(200);

      // El archivo se vuelve a subir TAL CUAL se descargó, sin tocar una sola celda: es el caso
      // "lo abrí, no cambié nada y lo volví a subir", el más peligroso para el stock.
      const respuesta = await request(servidor())
        .post('/api/productos/importar')
        .set('Cookie', cookie)
        .attach('archivo', descarga.body as Buffer, 'catalogo-inventario.xlsx');

      expect(respuesta.status).toBe(200);
      const resumen = respuesta.body as ResumenImportacionBody;
      expect(resumen).toEqual({
        creados: 0, // ningún SKU es nuevo: todos venían del propio catálogo
        actualizados: CATALOGO_SEMBRADO.length,
        conStockInicial: 0, // las columnas de stock viajaron vacías ⇒ ninguna fila mueve inventario
        // US12/FR-074: el archivo trae el costo ACTUAL de cada producto, así que subirlo sin
        // tocar nada no cambia ningún precio ni ensucia el historial con filas iguales.
        costosActualizados: 0,
        errores: [],
      });
      expect(await contexto.prisma.historialCostoProducto.count()).toBe(0);

      expect(await contexto.prisma.producto.count()).toBe(totalProductosAntes); // no duplicó nada
      expect(await stockPorSku()).toEqual(stockAntes); // stock IDÉNTICO producto por producto

      // Ni ingreso sintético ni movimientos nuevos: no hubo entrada de mercancía que registrar.
      expect(await contexto.prisma.ingreso.count()).toBe(0);
      expect(await contexto.prisma.movimientoInventario.count()).toBe(totalMovimientosAntes);

      // El producto dado de baja se actualizó, pero NO se reactivó (la importación no toca `estado`).
      const inactivo = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'CAT-EXPORT-003' } });
      expect(inactivo.estado).toBe('INACTIVO');
    },
  );

  it(
    'editar el archivo descargado aplica los cambios de catálogo por SKU, sin duplicar ni mover ' +
      'stock (el ciclo real: descargar → editar en Excel → volver a subir)',
    async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);
      const stockAntes = await stockPorSku();

      const descarga = await pedirBinario(servidor(), '/api/productos/catalogo-importacion').set('Cookie', cookie);
      const editado = await editarFilaDelCatalogo(descarga.body as Buffer, 'CAT-EXPORT-002', {
        descripcion: 'Descripción corregida desde Excel',
        categoria: 'Ferretería',
        ubicacion: 'Estante D-9',
        umbralStockBajo: 4,
      });

      const respuesta = await request(servidor())
        .post('/api/productos/importar')
        .set('Cookie', cookie)
        .attach('archivo', editado, 'catalogo-inventario-editado.xlsx');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({
        creados: 0,
        actualizados: CATALOGO_SEMBRADO.length,
        conStockInicial: 0,
        costosActualizados: 0, // solo se editaron columnas de catálogo, ningún precio (US12)
        errores: [],
      });

      const actualizado = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'CAT-EXPORT-002' } });
      expect(actualizado.descripcion).toBe('Descripción corregida desde Excel');
      expect(actualizado.categoria).toBe('Ferretería');
      expect(actualizado.ubicacion).toBe('Estante D-9');
      expect(actualizado.umbralStockBajo.toNumber()).toBe(4);

      expect(await contexto.prisma.producto.count()).toBe(CATALOGO_SEMBRADO.length); // sin duplicados
      expect(await stockPorSku()).toEqual(stockAntes); // editar catálogo NUNCA mueve stock
    },
  );

  it('con el catálogo vacío devuelve el archivo con solo los encabezados (sin fila de ejemplo)', async () => {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), admin.login, admin.password);

    const respuesta = await pedirBinario(servidor(), '/api/productos/catalogo-importacion').set('Cookie', cookie);

    expect(respuesta.status).toBe(200);
    const hoja = await hojaProductos(respuesta.body as Buffer);
    expect(hoja.rowCount).toBe(1);
  });

  it('rechaza con 403 a un OPERARIO — mismos roles que la plantilla vacía (A,G — FR-002/FR-003)', async () => {
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), operario.login, operario.password);

    const respuesta = await request(servidor()).get('/api/productos/catalogo-importacion').set('Cookie', cookie);

    expect(respuesta.status).toBe(403);
  });

  it('exige sesión (401 sin cookie)', async () => {
    const respuesta = await request(servidor()).get('/api/productos/catalogo-importacion');
    expect(respuesta.status).toBe(401);
  });

  /** Siembra `CATALOGO_SEMBRADO` DIRECTAMENTE con Prisma: `POST /api/productos` siempre nace con
   *  `stockActual`/`ultimoCosto` en 0, y esta suite necesita justo lo contrario — productos con
   *  stock y costo reales, para que "las columnas de stock viajan vacías" sea demostrable. */
  async function sembrarCatalogo(usuarioCreacionId: number): Promise<void> {
    for (const producto of CATALOGO_SEMBRADO) {
      await contexto.prisma.producto.create({
        data: {
          sku: producto.sku,
          descripcion: producto.descripcion,
          categoria: producto.categoria,
          ubicacion: producto.ubicacion,
          umbralStockBajo: producto.umbralStockBajo,
          stockActual: producto.stockActual,
          ultimoCosto: producto.ultimoCosto,
          estado: producto.estado ?? 'ACTIVO',
          usuarioCreacionId: BigInt(usuarioCreacionId),
        },
      });
    }
  }

  /** `sku → stockActual` de TODO el catálogo, para comparar el antes y el después con un solo
   *  `toEqual` (si algún producto cambiara de stock, la comparación lo señala por SKU). */
  async function stockPorSku(): Promise<Record<string, number>> {
    const productos = await contexto.prisma.producto.findMany({ orderBy: { id: 'asc' } });
    return Object.fromEntries(productos.map((producto) => [producto.sku, producto.stockActual.toNumber()]));
  }
});

/** Hoja "Productos" del `.xlsx` descargado — falla la prueba si el libro no la trae con ese
 *  nombre exacto (es el que busca `leerFilasImportacionProductos` al volver a subirlo). */
async function hojaProductos(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const libro = await cargarLibroXlsx(buffer);
  const hoja = libro.getWorksheet('Productos');
  if (!hoja) {
    throw new Error('El archivo descargado no tiene la hoja "Productos".');
  }
  return hoja;
}

/** Filas de datos indexadas por SKU (columna 1), para poder afirmar sobre un producto concreto
 *  sin depender del orden en que el repositorio los devuelva. */
function filasPorSku(hoja: ExcelJS.Worksheet): Map<string, unknown[]> {
  const filas = new Map<string, unknown[]>();
  for (let numeroFila = 2; numeroFila <= hoja.rowCount; numeroFila += 1) {
    const valores = valoresFila(hoja, numeroFila, TOTAL_COLUMNAS);
    filas.set(String(valores[COLUMNA_SKU]), valores);
  }
  return filas;
}

/**
 * Reescribe las 4 columnas editables de la fila cuyo SKU coincide, dejando el resto del archivo
 * intacto — simula al usuario abriendo el `.xlsx` descargado, corrigiendo datos y guardando.
 */
async function editarFilaDelCatalogo(
  buffer: Buffer,
  sku: string,
  cambios: { descripcion: string; categoria: string; ubicacion: string; umbralStockBajo: number },
): Promise<Buffer> {
  const libro = await cargarLibroXlsx(buffer);
  const hoja = libro.getWorksheet('Productos');
  if (!hoja) {
    throw new Error('El archivo descargado no tiene la hoja "Productos".');
  }

  for (let numeroFila = 2; numeroFila <= hoja.rowCount; numeroFila += 1) {
    const fila = hoja.getRow(numeroFila);
    if (String(fila.getCell(COLUMNA_SKU + 1).value) !== sku) continue;
    fila.getCell(COLUMNA_DESCRIPCION + 1).value = cambios.descripcion;
    fila.getCell(COLUMNA_CATEGORIA + 1).value = cambios.categoria;
    fila.getCell(COLUMNA_UBICACION + 1).value = cambios.ubicacion;
    fila.getCell(COLUMNA_UMBRAL + 1).value = cambios.umbralStockBajo;
    fila.commit();
    const bufferGenerado = await libro.xlsx.writeBuffer();
    return Buffer.from(bufferGenerado);
  }

  throw new Error(`El archivo descargado no trae ninguna fila con el SKU "${sku}".`);
}

/** Todo el texto de una hoja concatenado — para afirmar que las Instrucciones dicen lo que
 *  deben decir sin acoplar la prueba a la fila/celda exacta donde caiga cada frase. */
function textoDeLaHoja(hoja: ExcelJS.Worksheet): string {
  const partes: string[] = [];
  hoja.eachRow((fila) => {
    fila.eachCell((celda) => partes.push(String(celda.value ?? '')));
  });
  return partes.join('\n');
}

/**
 * Valores de las celdas 1..`cantidadColumnas` de una fila, en orden — mismo helper (y mismo
 * motivo) que `export.spec.ts`: tras releer un archivo con `Workbook#xlsx.load`,
 * `worksheet.columns` refleja las definiciones `<cols>` del XML, no la cantidad de columnas con
 * encabezado, así que la cantidad se pasa explícita.
 */
function valoresFila(hoja: ExcelJS.Worksheet, numeroFila: number, cantidadColumnas: number): unknown[] {
  const fila = hoja.getRow(numeroFila);
  const valores: unknown[] = [];
  for (let columna = 1; columna <= cantidadColumnas; columna += 1) {
    valores.push(fila.getCell(columna).value);
  }
  return valores;
}

/** `ExcelJS.Workbook#xlsx.load` con un `Buffer` real de Node — mismo cast (y mismo motivo:
 *  `exceljs/index.d.ts` declara su propia interfaz `Buffer extends ArrayBuffer`, que sombrea la
 *  de Node) que documenta `export.spec.ts#cargarLibroXlsx`. */
async function cargarLibroXlsx(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer as unknown as Parameters<typeof libro.xlsx.load>[0]);
  return libro;
}

/** Fecha de hoy `AAAA-MM-DD` — mismo criterio que `controlador-productos.ts#fechaHoyIso`,
 *  reproducido aquí para construir el nombre de archivo esperado en `Content-Disposition`. */
function fechaHoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `GET` con parser binario: `supertest`/`superagent` no parsean el `Content-Type` del `.xlsx`,
 *  así que `res.body` quedaría `{}` — mismo patrón que `export.spec.ts#pedirBinario`. */
function pedirBinario(servidorHttp: ReturnType<AppDePrueba['app']['getHttpServer']>, ruta: string) {
  return request(servidorHttp)
    .get(ruta)
    .buffer(true)
    .parse((respuesta, callback) => {
      const trozos: Buffer[] = [];
      respuesta.on('data', (trozo: Buffer) => trozos.push(trozo));
      respuesta.on('end', () => callback(null, Buffer.concat(trozos)));
      respuesta.on('error', callback);
    });
}

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
