/**
 * Pruebas de integración del COSTO EDITABLE CON HISTORIAL (T129, US12 — FR-070…FR-074) — API
 * completa + PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Lo que se juega aquí (y por qué no sirve un mock): US12 permite corregir precios A ESCALA.
 * La única forma de confiar en eso es demostrar contra la base real las dos mitades del trato:
 *
 *   1. Los precios se corrigen y queda rastro — quién, cuándo, de cuánto a cuánto y por qué
 *      camino (FR-072), en los TRES orígenes: carga masiva, edición manual y recepción de
 *      ingreso (este último, un hueco que existía desde US1: ya reescribía `ultimo_costo` sin
 *      registrar nada).
 *   2. El INVENTARIO NO SE MUEVE. Un cambio de costo no es un movimiento (FR-073), así que
 *      cada prueba de este archivo verifica además que `stock_actual` sigue igual y que se
 *      mantiene el invariante 2 de data-model.md: `stock_actual(p) = Σ movimientos(p)` — el
 *      mismo que sostiene la prueba de conciliación. Si un cambio de costo escribiera un
 *      movimiento, esa suma dejaría de cuadrar y el inventario perdería su base de confianza.
 *
 * El ciclo de la carga masiva es el REAL: se descarga el catálogo del endpoint (que desde
 * FR-070 trae el costo actual en "Valor unitario"), se editan DOS precios en el `.xlsx` como
 * lo haría el usuario en Excel, y se vuelve a subir por `POST /api/productos/importar`. Un
 * archivo fabricado por la prueba no demostraría que el ciclo que usa el dueño del proyecto
 * funciona.
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
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Posición (1-based) de las columnas de la hoja "Productos" que esta suite lee o escribe. */
const COLUMNA_SKU = 1;
const COLUMNA_VALOR_UNITARIO = 7;

/** Catálogo de partida: tres productos con stock y costo REALES (no ceros de una BD recién
 *  truncada), para que "el stock no cambió" y "solo cambiaron 2 precios" sean afirmaciones con
 *  contenido. */
const CATALOGO = [
  { sku: 'COSTO-001', descripcion: 'Cemento gris 50 kg', stockActual: 42, ultimoCosto: 28500 },
  { sku: 'COSTO-002', descripcion: 'Varilla 3/8 x 6 m', stockActual: 18, ultimoCosto: 15000 },
  { sku: 'COSTO-003', descripcion: 'Alambre negro por kg', stockActual: 7.5, ultimoCosto: 9900 },
] as const;

/** `ResumenImportacion` de `POST /api/productos/importar` (contracts/api-rest.md § Carga masiva)
 *  — solo lo que esta suite afirma sobre el resultado de resubir el catálogo. */
interface ResumenImportacionBody {
  actualizados: number;
  costosActualizados: number;
  errores: { fila: number; mensaje: string }[];
}

/** Fila de `GET /api/inventario/:productoId/historial-costos` (contracts/api-rest.md). */
interface CambioCostoBody {
  id: number;
  fechaHora: string;
  costoAnterior: number;
  costoNuevo: number;
  origen: 'IMPORTACION' | 'EDICION_MANUAL' | 'RECEPCION_INGRESO';
  documentoId: number | null;
  usuarioId: number;
  usuarioNombre: string;
}

describe('Costo editable con historial — US12 (T129)', () => {
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

  describe('Carga masiva: resubir el catálogo con precios editados (FR-070/FR-071/FR-074)', () => {
    it(
      'cambia EXACTAMENTE los 2 precios editados, registra 2 entradas con el usuario correcto y ' +
        'deja el stock intacto — la fila con el MISMO costo no genera registro (FR-074)',
      async () => {
        const gerente = await crearUsuarioDePrueba(contexto, {
          rol: 'GERENTE',
          nombreCompleto: 'Gerente de Compras',
        });
        const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);
        await sembrarCatalogo(gerente.id);

        const stockAntes = await stockPorSku();
        const movimientosAntes = await contexto.prisma.movimientoInventario.count();

        // Ciclo real: descargar el catálogo (trae el costo actual, FR-070), editar DOS precios
        // en el `.xlsx` y volver a subirlo. COSTO-003 se deja EXACTAMENTE como vino.
        const descarga = await pedirBinario(servidor(), '/api/productos/catalogo-importacion').set('Cookie', cookie);
        expect(descarga.status).toBe(200);
        const editado = await editarPrecios(descarga.body as Buffer, {
          'COSTO-001': 31000,
          'COSTO-002': 14200,
        });

        const respuesta = await request(servidor())
          .post('/api/productos/importar')
          .set('Cookie', cookie)
          .attach('archivo', editado, 'catalogo-precios.xlsx');

        expect(respuesta.status).toBe(200);
        expect(respuesta.body).toEqual({
          creados: 0,
          actualizados: CATALOGO.length,
          conStockInicial: 0,
          costosActualizados: 2, // los DOS editados; el tercero llegó con el mismo costo
          errores: [],
        });

        // Los costos vigentes: exactamente los dos editados, el tercero intacto.
        expect(await costoPorSku()).toEqual({
          'COSTO-001': 31000,
          'COSTO-002': 14200,
          'COSTO-003': 9900,
        });

        // DOS entradas de historial, ninguna para el producto cuyo precio no cambió (FR-074).
        const historial = await contexto.prisma.historialCostoProducto.findMany({ orderBy: { id: 'asc' } });
        expect(historial).toHaveLength(2);
        for (const registro of historial) {
          expect(registro.origen).toBe('IMPORTACION');
          expect(Number(registro.usuarioId)).toBe(gerente.id); // quien SUBIÓ el archivo
          expect(registro.documentoId).toBeNull(); // una importación no es un documento de inventario
        }
        expect(await historialPorSku()).toEqual({
          'COSTO-001': [{ costoAnterior: 28500, costoNuevo: 31000, origen: 'IMPORTACION' }],
          'COSTO-002': [{ costoAnterior: 15000, costoNuevo: 14200, origen: 'IMPORTACION' }],
        });

        // EL INVARIANTE DE FR-073: corregir precios no mueve inventario. Ni el stock de un solo
        // producto, ni un movimiento nuevo, ni el ingreso sintético de la carga masiva.
        expect(await stockPorSku()).toEqual(stockAntes);
        expect(await contexto.prisma.movimientoInventario.count()).toBe(movimientosAntes);
        expect(await contexto.prisma.ingreso.count()).toBe(0);
        await esperarStockIgualASumaDeMovimientos();
      },
    );

    it(
      'un precio escrito como TEXTO con separador de miles ("22.500") NO se aplica dividido por mil: ' +
        'la fila se rechaza con su motivo y el costo queda intacto, sin historial que lo blanquee',
      async () => {
        // Corrección de la revisión adversarial de la Tanda 14 (hallazgo HIGH). `Number("22.500")`
        // vale 22,5: antes, ese texto —el separador de miles de es-CO, el que el dueño del proyecto
        // escribiría— se guardaba como costo mil veces menor, con `errores: []` y una fila de
        // `historial_costos_producto` que lo presentaba como una corrección querida (FR-072).
        const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
        const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);
        await sembrarCatalogo(gerente.id);
        const costoAntes = await costoPorSku();

        const descarga = await pedirBinario(servidor(), '/api/productos/catalogo-importacion').set('Cookie', cookie);
        const editado = await editarPrecios(descarga.body as Buffer, { 'COSTO-001': '22.500' });

        const respuesta = await request(servidor())
          .post('/api/productos/importar')
          .set('Cookie', cookie)
          .attach('archivo', editado, 'catalogo-precio-como-texto.xlsx');

        expect(respuesta.status).toBe(200);
        const resumen = respuesta.body as ResumenImportacionBody;
        expect(resumen.costosActualizados).toBe(0);
        // El rechazo es de UNA fila: las otras dos del catálogo se procesan igual (FR-051).
        expect(resumen.actualizados).toBe(CATALOGO.length - 1);
        expect(resumen.errores).toHaveLength(1);
        expect(resumen.errores[0]?.mensaje).toContain('"22.500"');
        expect(resumen.errores[0]?.mensaje).toContain('Valor unitario');

        expect(await costoPorSku()).toEqual(costoAntes);
        expect(await contexto.prisma.historialCostoProducto.count()).toBe(0);
      },
    );

    it('resubir el catálogo SIN tocar ningún precio no registra nada (FR-074) y deja el stock igual', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);
      const stockAntes = await stockPorSku();
      const costoAntes = await costoPorSku();

      const descarga = await pedirBinario(servidor(), '/api/productos/catalogo-importacion').set('Cookie', cookie);
      const respuesta = await request(servidor())
        .post('/api/productos/importar')
        .set('Cookie', cookie)
        .attach('archivo', descarga.body as Buffer, 'catalogo-sin-cambios.xlsx');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.costosActualizados).toBe(0);
      expect(await contexto.prisma.historialCostoProducto.count()).toBe(0);
      expect(await costoPorSku()).toEqual(costoAntes);
      expect(await stockPorSku()).toEqual(stockAntes);
      await esperarStockIgualASumaDeMovimientos();
    });
  });

  describe('Edición manual: PUT /api/productos/:id (FR-071/FR-072)', () => {
    it('corregir el costo desde la ficha lo actualiza y lo registra con origen EDICION_MANUAL, sin tocar el stock', async () => {
      const admin = await crearUsuarioDePrueba(contexto, {
        rol: 'ADMINISTRADOR',
        nombreCompleto: 'Administradora Principal',
      });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);
      const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'COSTO-001' } });
      const stockAntes = await stockPorSku();

      const respuesta = await request(servidor())
        .put(`/api/productos/${producto.id}`)
        .set('Cookie', cookie)
        .send({
          descripcion: 'Cemento gris 50 kg',
          umbralStockBajo: 10,
          ultimoCosto: 30000,
        });

      expect(respuesta.status).toBe(204);

      const actualizado = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
      expect(actualizado.ultimoCosto.toNumber()).toBe(30000);
      expect(actualizado.stockActual.toNumber()).toBe(stockAntes['COSTO-001']); // el stock ni se rozó

      const historial = await contexto.prisma.historialCostoProducto.findMany();
      expect(historial).toHaveLength(1);
      expect(historial[0]).toMatchObject({ origen: 'EDICION_MANUAL', documentoId: null });
      expect(historial[0]?.costoAnterior.toNumber()).toBe(28500);
      expect(historial[0]?.costoNuevo.toNumber()).toBe(30000);
      expect(Number(historial[0]?.usuarioId)).toBe(admin.id);

      expect(await stockPorSku()).toEqual(stockAntes);
      await esperarStockIgualASumaDeMovimientos();
    });

    it('una edición que NO envía el costo lo deja intacto y no registra nada (FR-074)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);
      const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'COSTO-002' } });

      const respuesta = await request(servidor())
        .put(`/api/productos/${producto.id}`)
        .set('Cookie', cookie)
        .send({ descripcion: 'Varilla 3/8 x 6 m — descripción corregida', umbralStockBajo: 3 });

      expect(respuesta.status).toBe(204);
      const actualizado = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
      expect(actualizado.descripcion).toBe('Varilla 3/8 x 6 m — descripción corregida');
      expect(actualizado.ultimoCosto.toNumber()).toBe(15000); // intacto
      expect(await contexto.prisma.historialCostoProducto.count()).toBe(0);
    });

    it('reenviar el MISMO costo no genera un registro duplicado (FR-074)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);
      const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'COSTO-003' } });

      const cuerpo = { descripcion: 'Alambre negro por kg', umbralStockBajo: 0, ultimoCosto: 9900 };
      const respuesta = await request(servidor()).put(`/api/productos/${producto.id}`).set('Cookie', cookie).send(cuerpo);

      expect(respuesta.status).toBe(204);
      expect(await contexto.prisma.historialCostoProducto.count()).toBe(0);
    });

    it('rechaza un costo negativo con 400 y mensaje en español, sin tocar el costo vigente', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);
      const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'COSTO-001' } });

      const respuesta = await request(servidor())
        .put(`/api/productos/${producto.id}`)
        .set('Cookie', cookie)
        .send({ descripcion: 'Cemento gris 50 kg', umbralStockBajo: 10, ultimoCosto: -5 });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.campos?.ultimoCosto).toContain('no puede ser negativo');
      const sinCambios = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
      expect(sinCambios.ultimoCosto.toNumber()).toBe(28500);
      expect(await contexto.prisma.historialCostoProducto.count()).toBe(0);
    });
  });

  describe('Recepción de ingreso: el hueco preexistente que US12 cierra (FR-072)', () => {
    it(
      'recibir mercancía a un precio distinto registra el cambio con origen RECEPCION_INGRESO y el ' +
        'id del ingreso — y el stock sigue siendo la suma de sus movimientos',
      async () => {
        const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR', nombreCompleto: 'Jefe de Bodega' });
        const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
        await sembrarCatalogo(admin.id);
        const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'COSTO-001' } });

        const creacion = await request(servidor())
          .post('/api/ingresos')
          .set('Cookie', cookie)
          .send({
            numeroFactura: 'FC-COSTO-001',
            fechaFactura: '2026-08-01',
            proveedor: 'Proveedor de prueba',
            fechaRecepcion: '2026-08-02',
            lineas: [{ productoId: Number(producto.id), cantidad: 10, precioUnitario: 32000 }],
          });
        expect(creacion.status).toBe(201);
        const ingresoId = creacion.body.id as number;

        const recepcion = await request(servidor()).post(`/api/ingresos/${ingresoId}/recibir`).set('Cookie', cookie);
        expect(recepcion.status).toBe(204);

        const historial = await contexto.prisma.historialCostoProducto.findMany();
        expect(historial).toHaveLength(1);
        expect(historial[0]).toMatchObject({ origen: 'RECEPCION_INGRESO' });
        expect(Number(historial[0]?.documentoId)).toBe(ingresoId);
        expect(historial[0]?.costoAnterior.toNumber()).toBe(28500);
        expect(historial[0]?.costoNuevo.toNumber()).toBe(32000);
        expect(Number(historial[0]?.usuarioId)).toBe(admin.id);

        // Recibir SÍ mueve stock (eso es un ingreso): lo que US12 agrega es el rastro del
        // PRECIO. El invariante de conciliación se mantiene con el stock ya movido.
        const actualizado = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
        expect(actualizado.stockActual.toNumber()).toBe(52); // 42 + 10
        expect(actualizado.ultimoCosto.toNumber()).toBe(32000);
        await esperarStockIgualASumaDeMovimientos();
      },
    );

    it('recibir al MISMO precio que ya tenía el producto no genera registro (FR-074)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);
      const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'COSTO-002' } });

      const creacion = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie)
        .send({
          numeroFactura: 'FC-COSTO-002',
          fechaFactura: '2026-08-01',
          proveedor: 'Proveedor de prueba',
          fechaRecepcion: '2026-08-02',
          lineas: [{ productoId: Number(producto.id), cantidad: 5, precioUnitario: 15000 }],
        });
      const recepcion = await request(servidor())
        .post(`/api/ingresos/${creacion.body.id}/recibir`)
        .set('Cookie', cookie);

      expect(recepcion.status).toBe(204);
      expect(await contexto.prisma.historialCostoProducto.count()).toBe(0);
      const actualizado = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
      expect(actualizado.stockActual.toNumber()).toBe(23); // el stock SÍ se movió: 18 + 5
      expect(actualizado.ultimoCosto.toNumber()).toBe(15000);
      await esperarStockIgualASumaDeMovimientos();
    });
  });

  describe('GET /api/inventario/:productoId/historial-costos (FR-072, contrato + autorización)', () => {
    it('devuelve los cambios MÁS RECIENTE PRIMERO, con el nombre de quien los hizo y paginación', async () => {
      const admin = await crearUsuarioDePrueba(contexto, {
        rol: 'ADMINISTRADOR',
        nombreCompleto: 'Administradora Principal',
      });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);
      const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'COSTO-001' } });

      await editarCosto(cookie, Number(producto.id), 30000);
      await editarCosto(cookie, Number(producto.id), 31500);

      const respuesta = await request(servidor())
        .get(`/api/inventario/${producto.id}/historial-costos`)
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.total).toBe(2);
      expect(respuesta.body.pagina).toBe(1);
      const datos = respuesta.body.datos as CambioCostoBody[];
      // Más reciente primero: la segunda corrección encabeza la lista.
      expect(datos.map((cambio) => [cambio.costoAnterior, cambio.costoNuevo])).toEqual([
        [30000, 31500],
        [28500, 30000],
      ]);
      expect(datos.every((cambio) => cambio.origen === 'EDICION_MANUAL')).toBe(true);
      expect(datos.every((cambio) => cambio.usuarioNombre === 'Administradora Principal')).toBe(true);
    });

    it('un producto sin cambios de costo devuelve una página vacía, no un 404', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);
      const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'COSTO-003' } });

      const respuesta = await request(servidor())
        .get(`/api/inventario/${producto.id}/historial-costos`)
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toMatchObject({ datos: [], total: 0 });
    });

    it('el GERENTE también puede consultarlo (A,G — contracts/api-rest.md)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      await sembrarCatalogo(admin.id);
      const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'COSTO-001' } });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

      const respuesta = await request(servidor())
        .get(`/api/inventario/${producto.id}/historial-costos`)
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(200);
    });

    it(
      'rechaza con 403 a un OPERARIO — que SÍ puede ver el inventario y el historial de MOVIMIENTOS: ' +
        'la evolución del precio es información de valorización, con su propio permiso',
      async () => {
        const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
        const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
        await sembrarCatalogo(admin.id);
        const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'COSTO-001' } });
        const cookie = await iniciarSesion(servidor(), operario.login, operario.password);

        const costos = await request(servidor())
          .get(`/api/inventario/${producto.id}/historial-costos`)
          .set('Cookie', cookie);
        expect(costos.status).toBe(403);

        // Control: su acceso al inventario y al historial de movimientos no cambió (SC-013).
        const movimientos = await request(servidor())
          .get(`/api/inventario/${producto.id}/movimientos`)
          .set('Cookie', cookie);
        expect(movimientos.status).toBe(200);
      },
    );

    it('exige sesión (401 sin cookie)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      await sembrarCatalogo(admin.id);
      const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'COSTO-001' } });

      const respuesta = await request(servidor()).get(`/api/inventario/${producto.id}/historial-costos`);

      expect(respuesta.status).toBe(401);
    });
  });

  describe('Inmutabilidad del historial (Principio II)', () => {
    it('la base de datos rechaza UPDATE y DELETE sobre historial_costos_producto', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);
      const producto = await contexto.prisma.producto.findUniqueOrThrow({ where: { sku: 'COSTO-001' } });
      await editarCosto(cookie, Number(producto.id), 30000);

      await expect(
        contexto.prisma.$executeRaw`UPDATE historial_costos_producto SET costo_nuevo = 1 WHERE producto_id = ${producto.id}`,
      ).rejects.toThrow(/inmutable/);
      await expect(
        contexto.prisma.$executeRaw`DELETE FROM historial_costos_producto WHERE producto_id = ${producto.id}`,
      ).rejects.toThrow(/inmutable/);

      expect(await contexto.prisma.historialCostoProducto.count()).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------
  // Helpers de la suite
  // ---------------------------------------------------------------------------------------

  /** Siembra `CATALOGO` DIRECTAMENTE con Prisma: `POST /api/productos` nace siempre con
   *  `stockActual`/`ultimoCosto` en 0, y esta suite necesita justo lo contrario. */
  async function sembrarCatalogo(usuarioCreacionId: number): Promise<void> {
    for (const producto of CATALOGO) {
      await contexto.prisma.producto.create({
        data: {
          sku: producto.sku,
          descripcion: producto.descripcion,
          stockActual: producto.stockActual,
          ultimoCosto: producto.ultimoCosto,
          usuarioCreacionId: BigInt(usuarioCreacionId),
        },
      });
    }
  }

  /** `PUT /api/productos/:id` enviando solo el costo nuevo (más la descripción obligatoria). */
  async function editarCosto(cookie: string, productoId: number, ultimoCosto: number): Promise<void> {
    const respuesta = await request(servidor())
      .put(`/api/productos/${productoId}`)
      .set('Cookie', cookie)
      .send({ descripcion: 'Cemento gris 50 kg', umbralStockBajo: 10, ultimoCosto });
    expect(respuesta.status).toBe(204);
  }

  /** `sku → stockActual` de todo el catálogo: un solo `toEqual` señala por SKU cualquier
   *  producto cuyo stock se hubiera movido. */
  async function stockPorSku(): Promise<Record<string, number>> {
    const productos = await contexto.prisma.producto.findMany({ orderBy: { id: 'asc' } });
    return Object.fromEntries(productos.map((producto) => [producto.sku, producto.stockActual.toNumber()]));
  }

  /** `sku → ultimoCosto` de todo el catálogo. */
  async function costoPorSku(): Promise<Record<string, number>> {
    const productos = await contexto.prisma.producto.findMany({ orderBy: { id: 'asc' } });
    return Object.fromEntries(productos.map((producto) => [producto.sku, producto.ultimoCosto.toNumber()]));
  }

  /** `sku → [{costoAnterior, costoNuevo, origen}]` — solo los productos CON historial, para
   *  poder afirmar de una vez "estos dos cambiaron, y solo estos". */
  async function historialPorSku(): Promise<Record<string, Array<Record<string, unknown>>>> {
    const registros = await contexto.prisma.historialCostoProducto.findMany({
      orderBy: { id: 'asc' },
      include: { producto: { select: { sku: true } } },
    });
    const porSku: Record<string, Array<Record<string, unknown>>> = {};
    for (const registro of registros) {
      const fila = {
        costoAnterior: registro.costoAnterior.toNumber(),
        costoNuevo: registro.costoNuevo.toNumber(),
        origen: registro.origen as string,
      };
      porSku[registro.producto.sku] = [...(porSku[registro.producto.sku] ?? []), fila];
    }
    return porSku;
  }

  /**
   * INVARIANTE 2 de data-model.md: `stock_actual(p) = Σ movimientos(p)` para TODO producto.
   *
   * Es la razón por la que un cambio de costo vive en su propia tabla y no en
   * `movimientos_inventario` (FR-073): si se registrara como movimiento, esta suma dejaría de
   * cuadrar y la conciliación del inventario —y con ella la confianza en las cifras— se
   * rompería. Se verifica con la MISMA aritmética de signos que `conciliacion.spec.ts`:
   * ENTRADA/AJUSTE_ENTRADA suman, SALIDA/AJUSTE_SALIDA restan.
   */
  async function esperarStockIgualASumaDeMovimientos(): Promise<void> {
    const productos = await contexto.prisma.producto.findMany({ orderBy: { id: 'asc' } });
    const movimientos = await contexto.prisma.movimientoInventario.findMany();

    const sumaPorProducto = new Map<number, number>();
    for (const movimiento of movimientos) {
      const signo = movimiento.tipo === 'ENTRADA' || movimiento.tipo === 'AJUSTE_ENTRADA' ? 1 : -1;
      const productoId = Number(movimiento.productoId);
      sumaPorProducto.set(productoId, (sumaPorProducto.get(productoId) ?? 0) + signo * movimiento.cantidad.toNumber());
    }

    for (const producto of productos) {
      const sembrado = CATALOGO.find((fila) => fila.sku === producto.sku);
      // El stock inicial se sembró por fuera de un documento (no tiene movimientos que lo
      // expliquen), así que el invariante se comprueba sobre lo que SÍ movió la aplicación:
      // stock final − stock sembrado = Σ movimientos del producto.
      const stockSembrado = sembrado?.stockActual ?? 0;
      const sumaMovimientos = sumaPorProducto.get(Number(producto.id)) ?? 0;
      expect(producto.stockActual.toNumber() - stockSembrado).toBeCloseTo(sumaMovimientos, 2);
    }
  }
});

/**
 * Reescribe la columna "Valor unitario" de las filas cuyo SKU aparezca en `preciosPorSku`,
 * dejando el resto del archivo EXACTAMENTE como se descargó — simula al usuario abriendo el
 * `.xlsx`, corrigiendo dos precios y guardando.
 *
 * El precio puede darse como `number` (lo que escribe Excel al teclear en una celda con formato
 * de número) o como `string` (lo que queda cuando la columna tiene formato de TEXTO o el valor se
 * pegó desde otro sitio) — esa segunda forma es la que la Tanda 14 tuvo que dejar de convertir a
 * ciegas, ver la prueba del texto "22.500".
 */
async function editarPrecios(buffer: Buffer, preciosPorSku: Record<string, number | string>): Promise<Buffer> {
  const libro = await cargarLibroXlsx(buffer);
  const hoja = libro.getWorksheet('Productos');
  if (!hoja) {
    throw new Error('El archivo descargado no tiene la hoja "Productos".');
  }

  const skusEditados = new Set<string>();
  for (let numeroFila = 2; numeroFila <= hoja.rowCount; numeroFila += 1) {
    const fila = hoja.getRow(numeroFila);
    const sku = String(fila.getCell(COLUMNA_SKU).value);
    const precioNuevo = preciosPorSku[sku];
    if (precioNuevo === undefined) continue;
    fila.getCell(COLUMNA_VALOR_UNITARIO).value = precioNuevo;
    fila.commit();
    skusEditados.add(sku);
  }

  const faltantes = Object.keys(preciosPorSku).filter((sku) => !skusEditados.has(sku));
  if (faltantes.length > 0) {
    throw new Error(`El catálogo descargado no trae filas para: ${faltantes.join(', ')}.`);
  }

  const bufferGenerado = await libro.xlsx.writeBuffer();
  return Buffer.from(bufferGenerado);
}

/** `ExcelJS.Workbook#xlsx.load` con un `Buffer` real de Node — mismo cast (y mismo motivo) que
 *  documenta `catalogo-importacion.spec.ts#cargarLibroXlsx`. */
async function cargarLibroXlsx(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer as unknown as Parameters<typeof libro.xlsx.load>[0]);
  return libro;
}

/** `GET` con parser binario para descargar el `.xlsx` — mismo patrón que `export.spec.ts`. */
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
