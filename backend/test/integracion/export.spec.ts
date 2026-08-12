/**
 * Pruebas de integración de EXPORTACIÓN de reportes (T074, FR-043) — API completa +
 * PostgreSQL REAL, contra el harness de `./setup.ts`. Complementa `reportes-consumo.spec.ts`
 * (T073, que verifica los TOTALES de los endpoints de datos): esta suite verifica la
 * exportación en sí — `GET /api/reportes/{consumo-cliente,consumo-proyecto}/export`.
 *
 * La prueba REAL de SC-007 ("exportar = lo que se ve en pantalla, siempre, sin excepción")
 * no se da por sentada solo porque el controlador reutiliza el mismo caso de uso: cada
 * `it` de xlsx llama PRIMERO al endpoint de DATOS (`GET .../consumo-cliente`, sin `/export`)
 * con los MISMOS filtros por HTTP, y usa ESA respuesta (no una recalculada a mano) como la
 * fuente de verdad para las filas/totales que debe contener el archivo — así un bug donde
 * `/export` reciba/aplique los filtros distinto de su ruta hermana SÍ haría fallar la
 * prueba, aunque ambas rutas "digan" invocar el mismo caso de uso.
 *
 * El xlsx se relee con `exceljs` (`ExcelJS.Workbook().xlsx.load(buffer)` — el mismo paquete
 * que usa `ExportadorExcel`, pero en un `Workbook` nuevo, nunca importando el adaptador de
 * producción) para inspeccionar sus celdas. El PDF (`pdfmake`) no se parsea: alcanza con
 * `Content-Type application/pdf`, tamaño > 0 y la firma binaria `%PDF-` (criterio explícito
 * de la tarea — "no hace falta parsear el PDF").
 *
 * T084 (US7, Tanda 9) agrega el ÚLTIMO `it` de este archivo: el mismo criterio de "caso vacío"
 * ya probado arriba para consumo-cliente/consumo-proyecto, extendido a los dos reportes nuevos
 * (`inventario`/`movimientos`) — un filtro sin ninguna fila que matchee exporta igual un xlsx
 * con encabezados y 0 filas de datos y un PDF no vacío, nunca un error.
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
  crearClienteDePrueba,
  crearProductoDePrueba,
  crearProyectoDePrueba,
  crearSalidaDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Forma del `GET /api/reportes/consumo-cliente` (ver `ReporteConsumoCliente`). */
interface ReporteConsumoClienteBody {
  cliente: { id: number; nombre: string; nit: string };
  filtros: { desde: string | null; hasta: string | null };
  proyectos: {
    proyecto: { id: number; nombre: string; estado: string };
    productos: { productoId: number; nombre: string; cantidad: number; valorTotal: number }[];
    totalProyecto: number;
  }[];
  totalCliente: number;
}

/** Forma del `GET /api/reportes/consumo-proyecto` (ver `ReporteConsumoProyecto`). */
interface ReporteConsumoProyectoBody {
  proyecto: { id: number; nombre: string; estado: string };
  cliente: { id: number; nombre: string };
  filtros: { desde: string | null; hasta: string | null };
  lineas: {
    fecha: string;
    numeroSalida: number;
    producto: string;
    cantidad: number;
    valorUnitario: number;
    valorTotal: number;
  }[];
  totalConsumo: number;
  presupuestoEstimado: number | null;
  margen: number | null;
  serie: { producto: string; valor: number }[];
}

/** Forma del `GET /api/reportes/inventario` (ver `ReporteInventarioActual`, T083/US7). */
interface ReporteInventarioBody {
  productos: unknown[];
  valorTotalInventario: number;
  cantidadBajoUmbral: number;
  filtros: { buscar: string | null; cantidadMin: number | null; cantidadMax: number | null };
}

/** Forma del `GET /api/reportes/movimientos` (ver `ReporteMovimientos`, T083/US7). */
interface ReporteMovimientosBody {
  movimientos: unknown[];
  filtros: {
    desde: string | null;
    hasta: string | null;
    tipo: string | null;
    usuarioId: number | null;
    clienteId: number | null;
    proyectoId: number | null;
  };
}

describe('Exportación de reportes — /api/reportes/*/export (T074)', () => {
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
    'xlsx: consumo-cliente y consumo-proyecto exportados contienen EXACTAMENTE las filas y totales que ' +
      'devuelve el endpoint de DATOS para los MISMOS filtros (SC-007)',
    async () => {
      const productoCemento = await crearProductoDePrueba(contexto.prisma, { sku: 'CEM-EXP-001' });
      const productoVarilla = await crearProductoDePrueba(contexto.prisma, { sku: 'VAR-EXP-001' });
      const cliente = await crearClienteDePrueba(contexto.prisma, { nombre: 'Cliente Export Jumbo' });
      const proyectoConPresupuesto = await crearProyectoDePrueba(contexto.prisma, cliente.id, {
        nombre: 'Remodelación Bodega Export',
        presupuestoEstimado: 10_000_000,
      });
      const proyectoSinPresupuesto = await crearProyectoDePrueba(contexto.prisma, cliente.id, {
        nombre: 'Instalación Bodega Export',
        presupuestoEstimado: null,
      });

      // Consumo real (CONFIRMADA/COMPLETADA) del proyecto CON presupuesto.
      await crearSalidaDePrueba(contexto.prisma, {
        proyectoId: proyectoConPresupuesto.id,
        estado: 'CONFIRMADA',
        lineas: [{ productoId: productoCemento.id, cantidad: 100, precioUnitario: 25_000 }],
      });
      await crearSalidaDePrueba(contexto.prisma, {
        proyectoId: proyectoConPresupuesto.id,
        estado: 'COMPLETADA',
        lineas: [{ productoId: productoCemento.id, cantidad: 60, precioUnitario: 25_000 }],
      });
      // PENDIENTE y ANULADA: NUNCA cuentan como consumo (FR-044) — si el export las incluyera,
      // esta prueba fallaría porque el endpoint de datos (fuente de verdad) tampoco las cuenta.
      await crearSalidaDePrueba(contexto.prisma, {
        proyectoId: proyectoConPresupuesto.id,
        estado: 'PENDIENTE',
        lineas: [{ productoId: productoCemento.id, cantidad: 20, precioUnitario: 25_000 }],
      });
      await crearSalidaDePrueba(contexto.prisma, {
        proyectoId: proyectoConPresupuesto.id,
        estado: 'ANULADA',
        lineas: [{ productoId: productoCemento.id, cantidad: 10, precioUnitario: 25_000 }],
      });

      // Consumo real del proyecto SIN presupuesto (margen debe salir null).
      await crearSalidaDePrueba(contexto.prisma, {
        proyectoId: proyectoSinPresupuesto.id,
        estado: 'CONFIRMADA',
        lineas: [{ productoId: productoVarilla.id, cantidad: 50, precioUnitario: 18_000 }],
      });

      const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

      // --- consumo-cliente ---
      const datosCliente = await request(servidor())
        .get('/api/reportes/consumo-cliente')
        .query({ clienteId: cliente.id })
        .set('Cookie', cookie);
      expect(datosCliente.status).toBe(200);
      const reporteCliente = datosCliente.body as ReporteConsumoClienteBody;
      // Verificación independiente de los números conocidos (documentados también en seed.ts).
      expect(reporteCliente.totalCliente).toBe(4_900_000);

      const exportCliente = await pedirBinario(servidor(), '/api/reportes/consumo-cliente/export', {
        clienteId: cliente.id,
        formato: 'xlsx',
      }).set('Cookie', cookie);
      expect(exportCliente.status).toBe(200);
      expect(exportCliente.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(exportCliente.headers['content-disposition']).toBe(
        `attachment; filename="consumo-cliente-${fechaHoyIso()}.xlsx"`,
      );

      await verificarXlsxConsumoCliente(exportCliente.body as Buffer, reporteCliente);

      // --- consumo-proyecto (CON presupuesto: margen numérico) ---
      const datosProyectoA = await request(servidor())
        .get('/api/reportes/consumo-proyecto')
        .query({ proyectoId: proyectoConPresupuesto.id })
        .set('Cookie', cookie);
      expect(datosProyectoA.status).toBe(200);
      const reporteProyectoA = datosProyectoA.body as ReporteConsumoProyectoBody;
      expect(reporteProyectoA.totalConsumo).toBe(4_000_000);
      expect(reporteProyectoA.margen).toBeCloseTo(0.4);

      const exportProyectoA = await pedirBinario(servidor(), '/api/reportes/consumo-proyecto/export', {
        proyectoId: proyectoConPresupuesto.id,
        formato: 'xlsx',
      }).set('Cookie', cookie);
      expect(exportProyectoA.status).toBe(200);
      expect(exportProyectoA.headers['content-disposition']).toBe(
        `attachment; filename="consumo-proyecto-${fechaHoyIso()}.xlsx"`,
      );
      await verificarXlsxConsumoProyecto(exportProyectoA.body as Buffer, reporteProyectoA);

      // --- consumo-proyecto (SIN presupuesto: margen debe quedar "Sin presupuesto asignado") ---
      const datosProyectoB = await request(servidor())
        .get('/api/reportes/consumo-proyecto')
        .query({ proyectoId: proyectoSinPresupuesto.id })
        .set('Cookie', cookie);
      expect(datosProyectoB.status).toBe(200);
      const reporteProyectoB = datosProyectoB.body as ReporteConsumoProyectoBody;
      expect(reporteProyectoB.totalConsumo).toBe(900_000);
      expect(reporteProyectoB.margen).toBeNull();

      const exportProyectoB = await pedirBinario(servidor(), '/api/reportes/consumo-proyecto/export', {
        proyectoId: proyectoSinPresupuesto.id,
        formato: 'xlsx',
      }).set('Cookie', cookie);
      expect(exportProyectoB.status).toBe(200);
      await verificarXlsxConsumoProyecto(exportProyectoB.body as Buffer, reporteProyectoB);
    },
  );

  it('pdf: ambos reportes generan un PDF no vacío, con Content-Type application/pdf y los filtros del contrato en el nombre del archivo', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma);
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id, { presupuestoEstimado: 1_000_000 });
    await crearSalidaDePrueba(contexto.prisma, {
      proyectoId: proyecto.id,
      estado: 'CONFIRMADA',
      lineas: [{ productoId: producto.id, cantidad: 5, precioUnitario: 10_000 }],
    });

    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const exportClientePdf = await pedirBinario(servidor(), '/api/reportes/consumo-cliente/export', {
      clienteId: cliente.id,
      formato: 'pdf',
    }).set('Cookie', cookie);
    expect(exportClientePdf.status).toBe(200);
    expect(exportClientePdf.headers['content-type']).toBe('application/pdf');
    expect(exportClientePdf.headers['content-disposition']).toBe(
      `attachment; filename="consumo-cliente-${fechaHoyIso()}.pdf"`,
    );
    verificarPdfValido(exportClientePdf.body as Buffer);

    const exportProyectoPdf = await pedirBinario(servidor(), '/api/reportes/consumo-proyecto/export', {
      proyectoId: proyecto.id,
      formato: 'pdf',
    }).set('Cookie', cookie);
    expect(exportProyectoPdf.status).toBe(200);
    expect(exportProyectoPdf.headers['content-type']).toBe('application/pdf');
    expect(exportProyectoPdf.headers['content-disposition']).toBe(
      `attachment; filename="consumo-proyecto-${fechaHoyIso()}.pdf"`,
    );
    verificarPdfValido(exportProyectoPdf.body as Buffer);
  });

  it(
    'caso vacío (FR-043): un cliente y un proyecto SIN ninguna salida de consumo en el rango exportan igual ' +
      'un archivo válido (xlsx con encabezados y 0 filas de datos, PDF no vacío) — nunca un error',
    async () => {
      const producto = await crearProductoDePrueba(contexto.prisma);
      const cliente = await crearClienteDePrueba(contexto.prisma, { nombre: 'Cliente Sin Consumo' });
      const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id, {
        nombre: 'Proyecto Sin Consumo',
        presupuestoEstimado: 500_000,
      });
      // Una salida CONFIRMADA real, pero FUERA del rango de fechas filtrado más abajo — el
      // reporte debe verse vacío igual, ejercitando el filtro de fechas, no solo "sin salidas".
      await crearSalidaDePrueba(contexto.prisma, {
        proyectoId: proyecto.id,
        estado: 'CONFIRMADA',
        fechaSalida: new Date('2020-01-15'),
        lineas: [{ productoId: producto.id, cantidad: 3, precioUnitario: 1_000 }],
      });

      const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);
      const filtroSinConsumo = { desde: '2030-01-01', hasta: '2030-12-31' };

      // --- consumo-cliente vacío ---
      const datosCliente = await request(servidor())
        .get('/api/reportes/consumo-cliente')
        .query({ clienteId: cliente.id, ...filtroSinConsumo })
        .set('Cookie', cookie);
      expect(datosCliente.status).toBe(200);
      const reporteCliente = datosCliente.body as ReporteConsumoClienteBody;
      expect(reporteCliente.totalCliente).toBe(0);
      // El proyecto SIGUE apareciendo con estado vacío (US4-AS4) — nunca se omite del array.
      expect(reporteCliente.proyectos).toHaveLength(1);
      expect(reporteCliente.proyectos[0]?.productos).toEqual([]);
      expect(reporteCliente.proyectos[0]?.totalProyecto).toBe(0);

      const exportClienteXlsx = await pedirBinario(servidor(), '/api/reportes/consumo-cliente/export', {
        clienteId: cliente.id,
        formato: 'xlsx',
        ...filtroSinConsumo,
      }).set('Cookie', cookie);
      expect(exportClienteXlsx.status).toBe(200);
      await verificarXlsxConsumoCliente(exportClienteXlsx.body as Buffer, reporteCliente);
      const libroCliente = await cargarLibroXlsx(exportClienteXlsx.body as Buffer);
      const hojaCliente = libroCliente.worksheets[0];
      expect(hojaCliente).toBeDefined();
      // Encabezado + 0 filas de datos + fila(s) de totales (proyecto vacío con $0 + total cliente).
      expect(hojaCliente!.rowCount).toBe(1 + 0 + 2);

      const exportClientePdf = await pedirBinario(servidor(), '/api/reportes/consumo-cliente/export', {
        clienteId: cliente.id,
        formato: 'pdf',
        ...filtroSinConsumo,
      }).set('Cookie', cookie);
      expect(exportClientePdf.status).toBe(200);
      verificarPdfValido(exportClientePdf.body as Buffer);

      // --- consumo-proyecto vacío ---
      const datosProyecto = await request(servidor())
        .get('/api/reportes/consumo-proyecto')
        .query({ proyectoId: proyecto.id, ...filtroSinConsumo })
        .set('Cookie', cookie);
      expect(datosProyecto.status).toBe(200);
      const reporteProyecto = datosProyecto.body as ReporteConsumoProyectoBody;
      expect(reporteProyecto.lineas).toEqual([]);
      expect(reporteProyecto.totalConsumo).toBe(0);

      const exportProyectoXlsx = await pedirBinario(servidor(), '/api/reportes/consumo-proyecto/export', {
        proyectoId: proyecto.id,
        formato: 'xlsx',
        ...filtroSinConsumo,
      }).set('Cookie', cookie);
      expect(exportProyectoXlsx.status).toBe(200);
      await verificarXlsxConsumoProyecto(exportProyectoXlsx.body as Buffer, reporteProyecto);
      const libroProyecto = await cargarLibroXlsx(exportProyectoXlsx.body as Buffer);
      const hojaProyecto = libroProyecto.worksheets[0];
      expect(hojaProyecto).toBeDefined();
      // Encabezado + 0 filas de datos + 3 filas de totales (total/presupuesto/margen).
      expect(hojaProyecto!.rowCount).toBe(1 + 0 + 3);

      const exportProyectoPdf = await pedirBinario(servidor(), '/api/reportes/consumo-proyecto/export', {
        proyectoId: proyecto.id,
        formato: 'pdf',
        ...filtroSinConsumo,
      }).set('Cookie', cookie);
      expect(exportProyectoPdf.status).toBe(200);
      verificarPdfValido(exportProyectoPdf.body as Buffer);
    },
  );

  it(
    'caso vacío (T084, US7, FR-043): los reportes de inventario y movimientos SIN ninguna fila que matchee el ' +
      'filtro exportan igual un archivo válido (xlsx con encabezados y 0 filas de datos, PDF no vacío) — nunca un error',
    async () => {
      const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

      // --- inventario vacío: un producto real que NO matchea el filtro `buscar` ---
      await crearProductoDePrueba(contexto.prisma, { sku: 'INV-EXP-EXISTE-001', stockActual: 50, umbralStockBajo: 5 });
      const filtroInventarioSinMatch = { buscar: 'NOEXISTE-XYZ-9999' };

      const datosInventario = await request(servidor())
        .get('/api/reportes/inventario')
        .query(filtroInventarioSinMatch)
        .set('Cookie', cookie);
      expect(datosInventario.status).toBe(200);
      const reporteInventario = datosInventario.body as ReporteInventarioBody;
      expect(reporteInventario.productos).toEqual([]);
      expect(reporteInventario.valorTotalInventario).toBe(0);
      expect(reporteInventario.cantidadBajoUmbral).toBe(0);

      const exportInventarioXlsx = await pedirBinario(servidor(), '/api/reportes/inventario/export', {
        ...filtroInventarioSinMatch,
        formato: 'xlsx',
      }).set('Cookie', cookie);
      expect(exportInventarioXlsx.status).toBe(200);
      expect(exportInventarioXlsx.headers['content-disposition']).toBe(
        `attachment; filename="inventario-${fechaHoyIso()}.xlsx"`,
      );
      const libroInventario = await cargarLibroXlsx(exportInventarioXlsx.body as Buffer);
      const hojaInventario = libroInventario.worksheets[0];
      expect(hojaInventario).toBeDefined();
      expect(valoresFila(hojaInventario!, 1, 9)).toEqual([
        'SKU',
        'Descripción',
        'Categoría',
        'Ubicación',
        'Stock',
        'Comprometido',
        'Disponible',
        'Bajo umbral',
        'Valor',
      ]);
      // Encabezado + 0 filas de datos + 2 filas de totales (valor total del inventario + productos bajo umbral).
      expect(hojaInventario!.rowCount).toBe(1 + 0 + 2);

      const exportInventarioPdf = await pedirBinario(servidor(), '/api/reportes/inventario/export', {
        ...filtroInventarioSinMatch,
        formato: 'pdf',
      }).set('Cookie', cookie);
      expect(exportInventarioPdf.status).toBe(200);
      verificarPdfValido(exportInventarioPdf.body as Buffer);

      // --- movimientos vacío: un movimiento ENTRADA real, FUERA del rango de fechas filtrado ---
      const productoMovimiento = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });
      const crearIngreso = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie)
        .send({
          numeroFactura: 'FAC-EXP-VACIO-0001',
          fechaFactura: '2026-01-05',
          proveedor: 'Proveedor Export Vacío',
          fechaRecepcion: '2026-01-05',
          lineas: [{ productoId: productoMovimiento.id, cantidad: 10, precioUnitario: 1_000 }],
        });
      expect(crearIngreso.status).toBe(201);
      const recibir = await request(servidor())
        .post(`/api/ingresos/${crearIngreso.body.id}/recibir`)
        .set('Cookie', cookie);
      expect(recibir.status).toBe(204);

      const dentroDeDosDias = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const filtroMovimientosSinMatch = { desde: dentroDeDosDias };

      const datosMovimientos = await request(servidor())
        .get('/api/reportes/movimientos')
        .query(filtroMovimientosSinMatch)
        .set('Cookie', cookie);
      expect(datosMovimientos.status).toBe(200);
      const reporteMovimientos = datosMovimientos.body as ReporteMovimientosBody;
      expect(reporteMovimientos.movimientos).toEqual([]);

      const exportMovimientosXlsx = await pedirBinario(servidor(), '/api/reportes/movimientos/export', {
        ...filtroMovimientosSinMatch,
        formato: 'xlsx',
      }).set('Cookie', cookie);
      expect(exportMovimientosXlsx.status).toBe(200);
      expect(exportMovimientosXlsx.headers['content-disposition']).toBe(
        `attachment; filename="movimientos-${fechaHoyIso()}.xlsx"`,
      );
      const libroMovimientos = await cargarLibroXlsx(exportMovimientosXlsx.body as Buffer);
      const hojaMovimientos = libroMovimientos.worksheets[0];
      expect(hojaMovimientos).toBeDefined();
      expect(valoresFila(hojaMovimientos!, 1, 9)).toEqual([
        'Fecha',
        'Tipo',
        'Documento',
        'SKU',
        'Producto',
        'Cantidad',
        'Usuario',
        'Cliente',
        'Proyecto',
      ]);
      // Encabezado + 0 filas de datos, SIN fila de totales (el reporte de movimientos no declara `totales`).
      expect(hojaMovimientos!.rowCount).toBe(1 + 0);

      const exportMovimientosPdf = await pedirBinario(servidor(), '/api/reportes/movimientos/export', {
        ...filtroMovimientosSinMatch,
        formato: 'pdf',
      }).set('Cookie', cookie);
      expect(exportMovimientosPdf.status).toBe(200);
      verificarPdfValido(exportMovimientosPdf.body as Buffer);
    },
  );
});

/**
 * Relee el xlsx de `consumo-cliente` con `exceljs` y verifica que sus filas y totales
 * coinciden EXACTAMENTE, celda a celda, con `reporte` (la respuesta YA obtenida del endpoint
 * de datos, `GET /api/reportes/consumo-cliente`, para los MISMOS filtros — SC-007).
 */
async function verificarXlsxConsumoCliente(buffer: Buffer, reporte: ReporteConsumoClienteBody): Promise<void> {
  const libro = await cargarLibroXlsx(buffer);
  const hoja = libro.worksheets[0];
  expect(hoja).toBeDefined();
  if (!hoja) return;

  expect(valoresFila(hoja, 1, 4)).toEqual(['Proyecto', 'Producto', 'Cantidad', 'Valor total']);

  const filasEsperadas = reporte.proyectos.flatMap((proyecto) =>
    proyecto.productos.map((producto) => [proyecto.proyecto.nombre, producto.nombre, producto.cantidad, producto.valorTotal]),
  );
  filasEsperadas.forEach((filaEsperada, indice) => {
    expect(valoresFila(hoja, 2 + indice, 4)).toEqual(filaEsperada);
  });

  const totalesEsperados = [
    ...reporte.proyectos.map((proyecto) => ({
      etiqueta: `Total ${proyecto.proyecto.nombre} (${proyecto.proyecto.estado})`,
      valorNumero: proyecto.totalProyecto,
    })),
    { etiqueta: 'Total cliente', valorNumero: reporte.totalCliente },
  ];
  const filaBaseDeTotales = 2 + filasEsperadas.length;
  totalesEsperados.forEach((totalEsperado, indice) => {
    const fila = hoja.getRow(filaBaseDeTotales + indice);
    expect(fila.getCell(1).value).toBe(totalEsperado.etiqueta);
    expect(fila.font?.bold).toBe(true);
    expect(numeroDesdeTextoMoneda(String(fila.getCell(4).value))).toBe(totalEsperado.valorNumero);
  });
  // Ninguna fila extra después de la última fila de totales.
  expect(hoja.rowCount).toBe(filaBaseDeTotales + totalesEsperados.length - 1);
}

/** Mismo criterio que `verificarXlsxConsumoCliente`, para `consumo-proyecto` (SC-007). */
async function verificarXlsxConsumoProyecto(buffer: Buffer, reporte: ReporteConsumoProyectoBody): Promise<void> {
  const libro = await cargarLibroXlsx(buffer);
  const hoja = libro.worksheets[0];
  expect(hoja).toBeDefined();
  if (!hoja) return;

  expect(valoresFila(hoja, 1, 6)).toEqual([
    'Fecha',
    'N.º salida',
    'Producto',
    'Cantidad',
    'Valor unitario',
    'Valor total',
  ]);

  reporte.lineas.forEach((linea, indice) => {
    const fila = hoja.getRow(2 + indice);
    expect(fila.getCell(1).value).toBe(formatoFechaSoloDia(linea.fecha));
    expect(fila.getCell(2).value).toBe(linea.numeroSalida);
    expect(fila.getCell(3).value).toBe(linea.producto);
    expect(fila.getCell(4).value).toBe(linea.cantidad);
    expect(fila.getCell(5).value).toBe(linea.valorUnitario);
    expect(fila.getCell(6).value).toBe(linea.valorTotal);
  });

  const filaBaseDeTotales = 2 + reporte.lineas.length;
  const filaTotal = hoja.getRow(filaBaseDeTotales);
  expect(filaTotal.getCell(1).value).toBe('Total consumo');
  expect(filaTotal.font?.bold).toBe(true);
  expect(numeroDesdeTextoMoneda(String(filaTotal.getCell(6).value))).toBe(reporte.totalConsumo);

  const filaPresupuesto = hoja.getRow(filaBaseDeTotales + 1);
  expect(filaPresupuesto.getCell(1).value).toBe('Presupuesto estimado');
  if (reporte.presupuestoEstimado === null) {
    expect(filaPresupuesto.getCell(6).value).toBe('Sin presupuesto asignado');
  } else {
    expect(numeroDesdeTextoMoneda(String(filaPresupuesto.getCell(6).value))).toBe(reporte.presupuestoEstimado);
  }

  const filaMargen = hoja.getRow(filaBaseDeTotales + 2);
  expect(filaMargen.getCell(1).value).toBe('Margen consumo/presupuesto');
  if (reporte.margen === null) {
    expect(filaMargen.getCell(6).value).toBe('Sin presupuesto asignado');
  } else {
    expect(filaMargen.getCell(6).value).toBe(`${Math.round(reporte.margen * 100)}%`);
  }

  expect(hoja.rowCount).toBe(filaBaseDeTotales + 2);
}

/**
 * Valores de las celdas 1..`cantidadColumnas` de una fila, en orden — ayuda de lectura para
 * `exceljs`. Recibe la cantidad de columnas EXPLÍCITA (en vez de derivarla de
 * `hoja.columns.length`): tras releer un archivo ya escrito con `Workbook#xlsx.load`,
 * `worksheet.columns` refleja las definiciones `<cols>` del XML (anchos/estilos), no
 * necesariamente la cantidad de columnas con encabezado — usar un número fijo, conocido de
 * antemano por el propio contrato de columnas del reporte, evita ese acoplamiento frágil.
 */
function valoresFila(hoja: ExcelJS.Worksheet, numeroFila: number, cantidadColumnas: number): unknown[] {
  const fila = hoja.getRow(numeroFila);
  const valores: unknown[] = [];
  for (let columna = 1; columna <= cantidadColumnas; columna += 1) {
    valores.push(fila.getCell(columna).value);
  }
  return valores;
}

/** `"$ 4.000.000"` (o cualquier variante de agrupación/espaciado de `Intl`) → `4000000`
 *  — evita acoplar la prueba al espaciado/símbolo exacto que produzca `Intl.NumberFormat`
 *  en este entorno, mientras sigue verificando el NÚMERO real detrás del texto formateado. */
function numeroDesdeTextoMoneda(texto: string): number {
  const soloDigitos = texto.replace(/[^0-9]/g, '');
  return soloDigitos === '' ? NaN : Number(soloDigitos);
}

/** Mismo criterio de formato que `mapeadores-documento-reporte.ts#formatoFechaSoloDia`
 *  (fecha SOLO DÍA en huso UTC — las columnas `DATE` de Postgres serializan como medianoche
 *  UTC) — se reproduce aquí, en la prueba, para comparar contra la celda ya formateada del
 *  xlsx sin importar una función privada (no exportada) del módulo de producción. */
const FORMATEADOR_FECHA = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
function formatoFechaSoloDia(fecha: string): string {
  return FORMATEADOR_FECHA.format(new Date(fecha));
}

/** Fecha de hoy `AAAA-MM-DD` — mismo criterio que `controlador-reportes.ts#fechaHoyIso`,
 *  reproducido aquí para construir el nombre de archivo esperado en `Content-Disposition`. */
function fechaHoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `ExcelJS.Workbook#xlsx.load` con un Node `Buffer` real — `exceljs/index.d.ts` declara SU
 * PROPIA interfaz local `Buffer extends ArrayBuffer` (para poder tipar sin depender de
 * `@types/node`, pensando también en el navegador), que SOMBREA el `Buffer` ambiental de
 * Node dentro de ese archivo de tipos. El resultado: el parámetro de `load()` no es
 * estructuralmente el `Buffer` de Node (que extiende `Uint8Array`, no `ArrayBuffer`), y TS
 * rechaza pasar un `Buffer` real de Node ahí (`Buffer<ArrayBufferLike>` vs `Buffer` con
 * `slice()` de firma distinta) aunque en tiempo de ejecución sea exactamente lo que
 * `exceljs` necesita (lo usa así internamente). Este helper concentra el único punto de la
 * suite que necesita el cast `unknown` para atravesar esa discrepancia de tipos de terceros.
 */
async function cargarLibroXlsx(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer as unknown as Parameters<typeof libro.xlsx.load>[0]);
  return libro;
}

/** Verifica que el buffer es un PDF válido y no vacío: firma binaria `%PDF-` al inicio
 *  (criterio explícito de la tarea — no hace falta parsear el contenido del PDF). */
function verificarPdfValido(buffer: Buffer): void {
  expect(buffer.length).toBeGreaterThan(0);
  expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
}

/**
 * `GET` con parser binario: los `Content-Type` de los reportes exportados
 * (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/pdf`)
 * no son texto ni JSON, así que `supertest`/`superagent` no los parsea por defecto —
 * `res.body` quedaría `{}`. Este parser fuerza la lectura binaria completa a un `Buffer` en
 * `respuesta.body`, patrón estándar de `supertest` para descargas binarias.
 */
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
