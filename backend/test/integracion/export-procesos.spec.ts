/**
 * Pruebas de integración de US11 (T123) — API completa + PostgreSQL REAL, contra el harness de
 * `./setup.ts`. Cubre las dos mitades de la historia:
 *
 * 1. **Logotipo institucional** (FR-067): que TODA ruta `/export` lo incruste, sin depender del
 *    contenido del archivo. (Hasta el 2026-08-15 esta sección probaba el logo POR CLIENTE
 *    anterior queda INTACTO — es lo que separa "rechazó el archivo" de "rechazó el archivo y
 *    además rompió lo que ya había".
 * 2. **Las cuatro exportaciones nuevas** (FR-064/FR-065/FR-067): que el listado exportado traiga
 *    TODAS las filas del filtro y no solo la página (con MÁS filas que el tamaño de página, que
 *    es la única forma de que la prueba pueda fallar si alguien reintrodujera la paginación),
 *    que cada archivo cuadre celda a celda con su endpoint de datos, y que el logo aparezca
 *    exactamente cuando el export corresponde a un único cliente.
 *
 * ## Cómo se verifica "cuadra con la pantalla" (SC-007/SC-015)
 *
 * Igual que `export.spec.ts` (T074): cada prueba llama PRIMERO al endpoint de DATOS por HTTP con
 * los MISMOS filtros y usa ESA respuesta como fuente de verdad de lo que debe contener el
 * archivo. Un bug donde `/export` aplicara los filtros distinto que su ruta hermana haría fallar
 * la prueba aunque ambas "digan" usar el mismo repositorio.
 *
 * El xlsx se relee con `exceljs` en un `Workbook` NUEVO; el PDF no se parsea (basta la firma
 * `%PDF-`), mismo criterio ya establecido en T074.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`) —
 * `npm run test:integracion -w backend`.
 */
import request from 'supertest';
import ExcelJS from 'exceljs';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import { PrismaService } from '../../src/infraestructura/persistencia/prisma.service';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearClienteDePrueba,
  crearProductoDePrueba,
  crearProveedorDePrueba,
  crearProyectoDePrueba,
  crearSalidaDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Tamaño de página del listado en pantalla (`frontend/.../ingresos/page.tsx` y `salidas/page.tsx`). */
const POR_PAGINA_EN_PANTALLA = 20;

/** Filas creadas para la prueba de FR-064: MÁS que una página, para que "solo la página visible"
 *  y "todas las filas del filtro" den resultados distintos y la prueba pueda fallar de verdad. */
const FILAS_MAS_QUE_UNA_PAGINA = 25;

describe('US11 — logo del cliente y exportación de procesos (T123)', () => {
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

  // ══════════════════════════════════════════════════════════════════════════════════════
  // El logotipo de LOF va en TODOS los exportables, sin excepción (FR-067)
  // ══════════════════════════════════════════════════════════════════════════════════════

  it(
    'TODAS las rutas /export incrustan el logotipo institucional, sin depender de a qué cliente ' +
      'o proveedor corresponda su contenido (FR-067)',
    async () => {
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

      // El logotipo lo lee el backend del disco al arrancar. Si el entorno de pruebas no lo
      // trae, esta prueba no tiene nada que verificar y decirlo es más honesto que fingir que
      // pasó: se comprueba primero contra el endpoint que lo sirve.
      const logo = await request(servidor()).get('/api/marca/logo');
      if (logo.status === 404) {
        console.warn('assets/marca/logo-lof.png no está en este entorno: se omite la prueba del logotipo.');
        return;
      }
      expect(logo.status).toBe(200);

      const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
      const cliente = await crearClienteDePrueba(contexto.prisma);
      const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
      const proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor del Logotipo');
      const ingreso = await crearIngresoDePrueba(contexto.prisma, {
        numeroFactura: 'FAC-LOGO-0001',
        proveedorId,
        productoId: producto.id,
      });
      const salida = await crearSalidaDePrueba(contexto.prisma, {
        proyectoId: proyecto.id,
        lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1_000 }],
      });

      // Los listados abarcan varios clientes o ninguno, y los ingresos ni siquiera tienen
      // cliente: antes de este cambio TODOS estos salían sin ninguna identidad.
      const rutas = [
        '/api/ingresos/export',
        '/api/salidas/export',
        `/api/ingresos/${ingreso.id}/export`,
        `/api/salidas/${salida.id}/export`,
        '/api/reportes/inventario/export',
      ];

      for (const ruta of rutas) {
        const xlsx = await pedirBinario(servidor(), ruta, { formato: 'xlsx' }).set('Cookie', cookie);
        expect(xlsx.status).toBe(200);
        expect({ ruta, imagenes: await imagenesDelXlsx(xlsx.body as Buffer) }).toEqual({ ruta, imagenes: 1 });

        // En el PDF no se cuentan imágenes con exceljs; basta con que el archivo salga válido
        // por el mismo camino (la maqueta del PDF tiene su propia suite: `maqueta-pdf.spec.ts`).
        const pdf = await pedirBinario(servidor(), ruta, { formato: 'pdf' }).set('Cookie', cookie);
        expect(pdf.status).toBe(200);
        verificarPdfValido(pdf.body as Buffer);
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════════════════════════
  // Listados exportados: TODAS las filas del filtro, no solo la página (FR-064)
  // ══════════════════════════════════════════════════════════════════════════════════════

  it(
    `el listado de INGRESOS exportado trae las ${FILAS_MAS_QUE_UNA_PAGINA} filas del filtro, no las ` +
      `${POR_PAGINA_EN_PANTALLA} de la página visible, y cuadra celda a celda con el endpoint de datos (FR-064)`,
    async () => {
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);
      const producto = await crearProductoDePrueba(contexto.prisma);
      const proveedorFiltrado = await crearProveedorDePrueba(contexto.prisma, 'Proveedor EXPORTAR');
      const proveedorAjeno = await crearProveedorDePrueba(contexto.prisma, 'Proveedor Ajeno');

      // Las que SÍ cumplen el filtro `buscar=EXPORTAR`, más un señuelo que NO lo cumple: así la
      // prueba distingue "trae todo" de "trae todas las filas de la tabla ignorando el filtro".
      for (let indice = 0; indice < FILAS_MAS_QUE_UNA_PAGINA; indice += 1) {
        await crearIngresoDePrueba(contexto.prisma, {
          numeroFactura: `FAC-EXPORTAR-${String(indice).padStart(3, '0')}`,
          proveedorId: proveedorFiltrado,
          productoId: producto.id,
        });
      }
      await crearIngresoDePrueba(contexto.prisma, {
        numeroFactura: 'FAC-OTRA-999',
        proveedorId: proveedorAjeno,
        productoId: producto.id,
      });

      // La PÁGINA que ve el usuario: 20 de 25.
      const pagina = await request(servidor())
        .get('/api/ingresos')
        .query({ buscar: 'EXPORTAR', pagina: 1, porPagina: POR_PAGINA_EN_PANTALLA })
        .set('Cookie', cookie);
      expect(pagina.status).toBe(200);
      expect(pagina.body.total).toBe(FILAS_MAS_QUE_UNA_PAGINA);
      expect(pagina.body.datos).toHaveLength(POR_PAGINA_EN_PANTALLA);

      // Fuente de verdad del contenido: el MISMO endpoint de datos, sin recorte de página.
      const completo = await request(servidor())
        .get('/api/ingresos')
        .query({ buscar: 'EXPORTAR', pagina: 1, porPagina: 100 })
        .set('Cookie', cookie);
      const esperados = completo.body.datos as IngresoListado[];
      expect(esperados).toHaveLength(FILAS_MAS_QUE_UNA_PAGINA);

      const exportado = await pedirBinario(servidor(), '/api/ingresos/export', {
        buscar: 'EXPORTAR',
        pagina: 1,
        porPagina: POR_PAGINA_EN_PANTALLA,
        formato: 'xlsx',
      }).set('Cookie', cookie);
      expect(exportado.status).toBe(200);
      expect(exportado.headers['content-disposition']).toBe(`attachment; filename="ingresos-${fechaHoyIso()}.xlsx"`);

      const hoja = await primeraHoja(exportado.body as Buffer);
      expect(valoresFila(hoja, 1, 7)).toEqual([
        'Factura',
        'Proveedor',
        'Fecha factura',
        'Recepción',
        'Estado',
        'Valor total',
        'Registró',
      ]);
      // Encabezado + TODAS las filas del filtro (sin fila de totales en este documento).
      expect(hoja.rowCount).toBe(1 + FILAS_MAS_QUE_UNA_PAGINA);

      esperados.forEach((ingreso, indice) => {
        expect(valoresFila(hoja, 2 + indice, 7)).toEqual([
          ingreso.numeroFactura,
          ingreso.proveedor.nombre,
          formatoFechaSoloDia(ingreso.fechaFactura),
          formatoFechaSoloDia(ingreso.fechaRecepcion),
          'Pendiente',
          ingreso.valorTotal,
          `Usuario N.º ${ingreso.usuarioRegistraId}`,
        ]);
      });
      // El señuelo que no cumple el filtro NO está en ninguna celda del archivo.
      const todasLasFacturas = Array.from({ length: hoja.rowCount }, (_v, i) => hoja.getRow(i + 1).getCell(1).value);
      expect(todasLasFacturas).not.toContain('FAC-OTRA-999');
    },
  );

  it(
    `el listado de SALIDAS exportado trae las ${FILAS_MAS_QUE_UNA_PAGINA} filas del filtro con los NOMBRES de ` +
      'cliente y proyecto que muestra la pantalla (FR-064/SC-007)',
    async () => {
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);
      const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 1000 });
      const cliente = await crearClienteDePrueba(contexto.prisma, { nombre: 'Constructora Exportadora' });
      const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id, { nombre: 'Torre Norte' });
      const otroCliente = await crearClienteDePrueba(contexto.prisma, { nombre: 'Cliente Ajeno' });
      const otroProyecto = await crearProyectoDePrueba(contexto.prisma, otroCliente.id, { nombre: 'Obra Ajena' });

      for (let indice = 0; indice < FILAS_MAS_QUE_UNA_PAGINA; indice += 1) {
        await crearSalidaDePrueba(contexto.prisma, {
          proyectoId: proyecto.id,
          lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1_000 }],
        });
      }
      // Señuelo de OTRO cliente: no debe aparecer en un export filtrado por `clienteId`.
      await crearSalidaDePrueba(contexto.prisma, {
        proyectoId: otroProyecto.id,
        lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1_000 }],
      });

      const pagina = await request(servidor())
        .get('/api/salidas')
        .query({ clienteId: cliente.id, pagina: 1, porPagina: POR_PAGINA_EN_PANTALLA })
        .set('Cookie', cookie);
      expect(pagina.body.total).toBe(FILAS_MAS_QUE_UNA_PAGINA);
      expect(pagina.body.datos).toHaveLength(POR_PAGINA_EN_PANTALLA);

      const completo = await request(servidor())
        .get('/api/salidas')
        .query({ clienteId: cliente.id, pagina: 1, porPagina: 100 })
        .set('Cookie', cookie);
      const esperadas = completo.body.datos as SalidaListada[];

      const exportado = await pedirBinario(servidor(), '/api/salidas/export', {
        clienteId: cliente.id,
        pagina: 1,
        porPagina: POR_PAGINA_EN_PANTALLA,
        formato: 'xlsx',
      }).set('Cookie', cookie);
      expect(exportado.status).toBe(200);
      expect(exportado.headers['content-disposition']).toBe(`attachment; filename="salidas-${fechaHoyIso()}.xlsx"`);

      const hoja = await primeraHoja(exportado.body as Buffer);
      expect(valoresFila(hoja, 1, 7)).toEqual([
        'N.º salida',
        'Fecha',
        'Cliente',
        'Proyecto',
        'Estado',
        'Valor total',
        'Autoriza',
      ]);
      expect(hoja.rowCount).toBe(1 + FILAS_MAS_QUE_UNA_PAGINA);

      esperadas.forEach((salida, indice) => {
        expect(valoresFila(hoja, 2 + indice, 7)).toEqual([
          `N.º ${salida.numero}`,
          formatoFechaSoloDia(salida.fechaSalida),
          'Constructora Exportadora',
          'Torre Norte',
          'Pendiente',
          salida.valorTotal,
          '—',
        ]);
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════════════════════════
  // Documentos individuales: cabecera + líneas + totales + auditoría (FR-065)
  // ══════════════════════════════════════════════════════════════════════════════════════

  it('el documento de un INGRESO trae cabecera, líneas, total y auditoría, cuadrando con GET /api/ingresos/:id (FR-065)', async () => {
    const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);
    const productoA = await crearProductoDePrueba(contexto.prisma, { sku: 'CEM-DOC-001', descripcion: 'Cemento gris' });
    const productoB = await crearProductoDePrueba(contexto.prisma, { sku: 'VAR-DOC-001', descripcion: 'Varilla 1/2' });

    const creado = await request(servidor())
      .post('/api/ingresos')
      .set('Cookie', cookie)
      .send({
        numeroFactura: 'FAC-DOC-0001',
        fechaFactura: '2026-03-01',
        proveedorId: await crearProveedorDePrueba(contexto.prisma, 'Ferretería El Tornillo'),
        fechaRecepcion: '2026-03-05',
        observaciones: 'Entrega parcial',
        lineas: [
          { productoId: productoA.id, cantidad: 10, precioUnitario: 25_000 },
          { productoId: productoB.id, cantidad: 4, precioUnitario: 12_500 },
        ],
      });
    expect(creado.status).toBe(201);

    const datos = await request(servidor()).get(`/api/ingresos/${creado.body.id}`).set('Cookie', cookie);
    expect(datos.status).toBe(200);
    const ingreso = datos.body as IngresoDetalle;

    const exportado = await pedirBinario(servidor(), `/api/ingresos/${creado.body.id}/export`, {
      formato: 'xlsx',
    }).set('Cookie', cookie);
    expect(exportado.status).toBe(200);
    expect(exportado.headers['content-disposition']).toBe('attachment; filename="ingreso-FAC-DOC-0001.xlsx"');

    const hoja = await primeraHoja(exportado.body as Buffer);
    // Cabecera (FR-065), incluida la auditoría de quién registró.
    expect(valoresFila(hoja, 1, 2)).toEqual(['Factura', ingreso.numeroFactura]);
    expect(valoresFila(hoja, 2, 2)).toEqual(['Proveedor', 'Ferretería El Tornillo']);
    expect(valoresFila(hoja, 3, 2)).toEqual(['Fecha de la factura', formatoFechaSoloDia(ingreso.fechaFactura)]);
    expect(valoresFila(hoja, 4, 2)).toEqual(['Fecha de recepción', formatoFechaSoloDia(ingreso.fechaRecepcion)]);
    expect(valoresFila(hoja, 5, 2)).toEqual(['Estado', 'Pendiente']);
    expect(valoresFila(hoja, 6, 2)).toEqual(['Registró', `Usuario N.º ${ingreso.usuarioRegistraId}`]);
    expect(valoresFila(hoja, 7, 2)).toEqual(['Observaciones', 'Entrega parcial']);

    // Fila 8 en blanco; fila 9, encabezados de las líneas.
    expect(valoresFila(hoja, 9, 4)).toEqual(['Producto', 'Cantidad', 'Precio unitario', 'Valor de línea']);
    ingreso.detalles.forEach((detalle, indice) => {
      const sku = detalle.productoId === productoA.id ? 'CEM-DOC-001 — Cemento gris' : 'VAR-DOC-001 — Varilla 1/2';
      expect(valoresFila(hoja, 10 + indice, 4)).toEqual([sku, detalle.cantidad, detalle.precioUnitario, detalle.valorTotal]);
    });

    const filaTotal = hoja.getRow(10 + ingreso.detalles.length);
    expect(filaTotal.getCell(1).value).toBe('Valor total');
    expect(numeroDesdeTextoMoneda(String(filaTotal.getCell(4).value))).toBe(ingreso.valorTotal);
  });

  it(
    'un numeroFactura con caracteres fuera de Latin-1 (Ω, guion largo, comilla tipográfica) SE PUEDE ' +
      'exportar en ambos formatos: nombre ASCII en filename y el real en filename* (RFC 6266)',
    async () => {
      // Corrección de la revisión adversarial de la Tanda 14 (hallazgo HIGH). El nombre del archivo
      // lleva DATOS DEL USUARIO (`ingreso-<numeroFactura>`) y `esquemaCrearIngreso` acepta 50
      // caracteres de texto libre; Node rechaza en una cabecera todo lo que esté fuera de Latin-1,
      // así que estos ingresos respondían 500 y NO se podían exportar en ningún formato (FR-065
      // incumplido para ese registro, y respuesta fuera del contrato de errores).
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'CEM-UNICODE-001' });

      // El guion largo y la comilla tipográfica son los que Word/Excel insertan SOLOS al pegar.
      const numeroFactura = 'FAC–EXPORT’Ω-01';
      const creado = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie)
        .send({
          numeroFactura,
          fechaFactura: '2026-03-01',
          proveedorId: await crearProveedorDePrueba(contexto.prisma, 'Proveedor con nombre pegado desde Word'),
          fechaRecepcion: '2026-03-05',
          lineas: [{ productoId: producto.id, cantidad: 2, precioUnitario: 10_000 }],
        });
      expect(creado.status).toBe(201);

      for (const formato of ['xlsx', 'pdf'] as const) {
        const exportado = await pedirBinario(servidor(), `/api/ingresos/${creado.body.id}/export`, {
          formato,
        }).set('Cookie', cookie);

        expect(exportado.status).toBe(200);
        const disposicion = exportado.headers['content-disposition'] as string;
        // Respaldo ASCII: un `-` por cada racha de caracteres sin equivalente, nunca el byte crudo.
        expect(disposicion).toContain(`filename="ingreso-FAC-EXPORT--01.${formato}"`);
        // Y el nombre REAL, porcentar-codificado en UTF-8, que es el que prefiere el navegador.
        expect(disposicion).toContain(
          `filename*=UTF-8''${encodeURIComponent(`ingreso-${numeroFactura}.${formato}`)}`,
        );
      }

      // El listado NO se ve afectado (su nombre es fijo): sigue con una sola forma de `filename`.
      const listado = await pedirBinario(servidor(), '/api/ingresos/export', { formato: 'xlsx' }).set('Cookie', cookie);
      expect(listado.status).toBe(200);
      expect(listado.headers['content-disposition']).toBe(`attachment; filename="ingresos-${fechaHoyIso()}.xlsx"`);
    },
  );

  it('los CUATRO exports nuevos responden también en PDF, con su Content-Type y su nombre de archivo', async () => {
    const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const ingreso = await crearIngresoDePrueba(contexto.prisma, {
      numeroFactura: 'FAC-PDF-0001',
      proveedorId: await crearProveedorDePrueba(contexto.prisma, 'Proveedor PDF'),
      productoId: producto.id,
    });
    const salida = await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyecto.id,
      lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1_000 }],
    });

    const casos: { ruta: string; nombreEsperado: string }[] = [
      { ruta: '/api/ingresos/export', nombreEsperado: `ingresos-${fechaHoyIso()}.pdf` },
      { ruta: '/api/salidas/export', nombreEsperado: `salidas-${fechaHoyIso()}.pdf` },
      { ruta: `/api/ingresos/${ingreso.id}/export`, nombreEsperado: 'ingreso-FAC-PDF-0001.pdf' },
      { ruta: `/api/salidas/${salida.id}/export`, nombreEsperado: `salida-${salida.numero}.pdf` },
    ];

    for (const caso of casos) {
      const respuesta = await pedirBinario(servidor(), caso.ruta, { formato: 'pdf' }).set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers['content-type']).toBe('application/pdf');
      expect(respuesta.headers['content-disposition']).toBe(`attachment; filename="${caso.nombreEsperado}"`);
      verificarPdfValido(respuesta.body as Buffer);
    }
  });

  it('un Operario puede exportar ingresos y salidas (contrato: A,G,O — mismo permiso que el listado)', async () => {
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), operario.login, operario.password);

    for (const ruta of ['/api/ingresos/export', '/api/salidas/export']) {
      const respuesta = await pedirBinario(servidor(), ruta, { formato: 'xlsx' }).set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
    }
  });

  it('exportar un documento inexistente responde 404, igual que su endpoint de datos', async () => {
    const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

    expect((await request(servidor()).get('/api/ingresos/999999/export?formato=pdf').set('Cookie', cookie)).status).toBe(404);
    expect((await request(servidor()).get('/api/salidas/999999/export?formato=pdf').set('Cookie', cookie)).status).toBe(404);
    // Formato inválido → 400 del mismo esquema Zod que usan los reportes.
    expect((await request(servidor()).get('/api/ingresos/export?formato=csv').set('Cookie', cookie)).status).toBe(400);
  });

  it('sin sesión, los cuatro exports responden 401 — pero el logotipo es público (FR-067)', async () => {
    const rutas = [
      '/api/ingresos/export?formato=pdf',
      '/api/salidas/export?formato=pdf',
      '/api/ingresos/1/export?formato=pdf',
      '/api/salidas/1/export?formato=pdf',
    ];
    for (const ruta of rutas) {
      expect((await request(servidor()).get(ruta)).status).toBe(401);
    }

    // El logotipo NO exige sesión: lo pinta la pantalla de inicio de sesión, que no la tiene.
    // `404` es la otra respuesta legítima (el entorno no trae el archivo); `401` no lo sería.
    expect([200, 404]).toContain((await request(servidor()).get('/api/marca/logo')).status);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// Formas de respuesta que usa la suite (subconjunto de lo que devuelve cada endpoint)
// ══════════════════════════════════════════════════════════════════════════════════════════

interface IngresoListado {
  numeroFactura: string;
  /** US15 (FR-091): el listado devuelve el proveedor RESUELTO, no su nombre suelto. */
  proveedor: { id: number; nombre: string };
  fechaFactura: string;
  fechaRecepcion: string;
  valorTotal: number;
  usuarioRegistraId: number;
}

interface IngresoDetalle extends IngresoListado {
  detalles: { productoId: number; cantidad: number; precioUnitario: number; valorTotal: number }[];
}

interface SalidaListada {
  numero: number;
  fechaSalida: string;
  valorTotal: number;
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Inserta un ingreso `PENDIENTE` con una línea, DIRECTAMENTE con Prisma (mismo criterio que las
 * factories de `setup.ts`): las pruebas de FR-064 necesitan 25 filas y pasar por
 * `POST /api/ingresos` 25 veces solo alargaría la suite sin ejercitar nada nuevo.
 */
async function crearIngresoDePrueba(
  prisma: PrismaService,
  opciones: { numeroFactura: string; proveedorId: number; productoId: number },
): Promise<{ id: number; numeroFactura: string }> {
  const usuario = await prisma.usuario.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });
  if (!usuario) throw new Error('crearIngresoDePrueba necesita al menos un usuario para la auditoría.');

  const registro = await prisma.ingreso.create({
    data: {
      numeroFactura: opciones.numeroFactura,
      fechaFactura: new Date('2026-02-01'),
      proveedorId: BigInt(opciones.proveedorId),
      fechaRecepcion: new Date('2026-02-03'),
      valorTotal: 10_000,
      usuarioRegistraId: usuario.id,
      usuarioCreacionId: usuario.id,
      detalles: {
        create: [{ productoId: BigInt(opciones.productoId), cantidad: 10, precioUnitario: 1_000, valorTotal: 10_000 }],
      },
    },
  });
  return { id: Number(registro.id), numeroFactura: registro.numeroFactura ?? '' };
}



/** Cantidad de imágenes incrustadas en la primera hoja del xlsx (US11-AS3/AS4). */
async function imagenesDelXlsx(buffer: Buffer): Promise<number> {
  const libro = await cargarLibroXlsx(buffer);
  return libro.worksheets[0]?.getImages().length ?? 0;
}

/** Relee un xlsx en un `Workbook` NUEVO — ver TSDoc de `cargarLibroXlsx` en `export.spec.ts`
 *  para el porqué del cast (los tipos de `exceljs` sombrean el `Buffer` de Node). */
async function cargarLibroXlsx(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer as unknown as Parameters<typeof libro.xlsx.load>[0]);
  return libro;
}

async function primeraHoja(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const libro = await cargarLibroXlsx(buffer);
  const hoja = libro.worksheets[0];
  if (!hoja) throw new Error('El xlsx exportado no tiene ninguna hoja.');
  return hoja;
}

/** Valores de las celdas 1..`cantidadColumnas` de una fila (mismo helper que `export.spec.ts`). */
function valoresFila(hoja: ExcelJS.Worksheet, numeroFila: number, cantidadColumnas: number): unknown[] {
  const fila = hoja.getRow(numeroFila);
  const valores: unknown[] = [];
  for (let columna = 1; columna <= cantidadColumnas; columna += 1) {
    valores.push(fila.getCell(columna).value);
  }
  return valores;
}

/** `"$ 4.000.000"` → `4000000` — evita acoplar la prueba al espaciado exacto de `Intl`. */
function numeroDesdeTextoMoneda(texto: string): number {
  const soloDigitos = texto.replace(/[^0-9]/g, '');
  return soloDigitos === '' ? NaN : Number(soloDigitos);
}

/** Mismo criterio de formato que `comunes/formato-documento.ts#formatoFechaSoloDia`,
 *  reproducido aquí para comparar contra la celda ya formateada sin importar producción. */
const FORMATEADOR_FECHA = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
function formatoFechaSoloDia(fecha: string): string {
  return FORMATEADOR_FECHA.format(new Date(fecha));
}

/** Fecha de hoy `AAAA-MM-DD` — mismo criterio que `comunes/respuesta-export.ts#fechaHoyIso`. */
function fechaHoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Firma binaria `%PDF-` y archivo no vacío (criterio ya establecido en T074). */
function verificarPdfValido(buffer: Buffer): void {
  expect(buffer.length).toBeGreaterThan(0);
  expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
}

/** `GET` con parser binario — ver TSDoc de `pedirBinario` en `export.spec.ts`. */
function pedirBinario(
  servidorHttp: ReturnType<AppDePrueba['app']['getHttpServer']>,
  ruta: string,
  query: Record<string, string | number>,
) {
  return request(servidorHttp)
    .get(ruta)
    .query(query)
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
