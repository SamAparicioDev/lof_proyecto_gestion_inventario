/**
 * Pruebas de integración de las cuatro historias del 2026-08-18 (T236, US26…US29) — API
 * completa + PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Lo que solo se puede verificar aquí, con la base de verdad:
 *
 *  - **US26 (FR-122)**: que la cantidad decimal se rechaza en el servidor Y que el `CHECK ...
 *    NOT VALID` no invalidó el histórico. Lo segundo es la mitad que un test unitario no puede
 *    tocar: la garantía es que PostgreSQL exige la regla a lo NUEVO sin revisar lo viejo.
 *  - **US27 (FR-123)**: que el PDF/Excel generado NO contiene las cifras cuando se pide sin
 *    valores. Un mapeador puede devolver la forma correcta y el exportador seguir escribiendo
 *    el importe en el archivo — lo que importa es lo que queda dentro del archivo.
 *  - **US28 (FR-124/FR-125)**: que una salida sin proyecto se crea, se confirma, descuenta
 *    stock y aparece en el consumo del cliente bajo "Sin proyecto". Cruza esquema, validación
 *    de destino, transacción de stock y reporte.
 *  - **US29 (FR-126)**: que un ajuste se guarda sin factura ni proveedor, recibe su correlativo
 *    y deja movimientos `AJUSTE_ENTRADA`. El CHECK de la base es la red final de esa forma.
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
  crearProveedorDePrueba,
  crearProyectoDePrueba,
  crearSalidaDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

describe('Entradas y salidas flexibles — US26…US29 (T236)', () => {
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

  // ==========================================================================================
  // US26 — cantidades enteras (FR-122)
  // ==========================================================================================
  describe('cantidades enteras (US26, FR-122)', () => {
    it('rechaza una cantidad decimal en la línea de una salida, nombrando el campo', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const cliente = await crearClienteDePrueba(contexto.prisma, { usuarioCreacionId: admin.id });
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'ENT-1', stockActual: 100 });

      const respuesta = await request(servidor())
        .post('/api/salidas')
        .set('Cookie', cookie)
        .send({
          clienteId: cliente.id,
          fechaSalida: '2026-08-18',
          lineas: [{ productoId: producto.id, cantidad: 2.5, precioUnitario: 1_000 }],
        });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.campos['lineas.0.cantidad']).toContain('entero');
    });

    /**
     * La mitad que justifica el `NOT VALID`: un movimiento anterior a la regla, con decimales,
     * se sigue leyendo y sumando. Se inserta por SQL a propósito — pasar por la API sería
     * imposible ahora, que es exactamente el punto.
     */
    it('no invalida los movimientos históricos con decimales', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'ENT-2', stockActual: 10 });

      // `movimientos_inventario` es INSERT-only y su CHECK es NOT VALID: acepta lo que ya estaba,
      // no lo que llega nuevo. Aquí se comprueba que la fila con decimales entra y se lee.
      await contexto.prisma.$executeRaw`
        ALTER TABLE movimientos_inventario DROP CONSTRAINT movimientos_inventario_cantidad_entera_check
      `;
      await contexto.prisma.movimientoInventario.create({
        data: {
          tipo: 'ENTRADA',
          productoId: BigInt(producto.id),
          cantidad: 2.5,
          stockResultante: 10,
          documentoTipo: 'INGRESO',
          documentoId: BigInt(1),
          usuarioId: BigInt(admin.id),
        },
      });
      await contexto.prisma.$executeRaw`
        ALTER TABLE movimientos_inventario
          ADD CONSTRAINT movimientos_inventario_cantidad_entera_check
          CHECK (cantidad = trunc(cantidad)) NOT VALID
      `;

      const movimientos = await contexto.prisma.movimientoInventario.findMany();
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0]?.cantidad.toNumber()).toBe(2.5);

      // Y la regla sí rige para lo que entra AHORA, con la restricción ya puesta.
      await expect(
        contexto.prisma.movimientoInventario.create({
          data: {
            tipo: 'ENTRADA',
            productoId: BigInt(producto.id),
            cantidad: 1.5,
            stockResultante: 11,
            documentoTipo: 'INGRESO',
            documentoId: BigInt(2),
            usuarioId: BigInt(admin.id),
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ==========================================================================================
  // US28 — salida sin proyecto (FR-124/FR-125)
  // ==========================================================================================
  describe('salida a un cliente sin proyecto (US28, FR-124/FR-125)', () => {
    it('se crea, se confirma, descuenta stock y suma en el consumo del cliente bajo "Sin proyecto"', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const cliente = await crearClienteDePrueba(contexto.prisma, {
        nombre: 'Ferretería Norte',
        usuarioCreacionId: admin.id,
      });
      const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id, {
        nombre: 'Obra Sur',
        usuarioCreacionId: admin.id,
      });
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'SP-1', stockActual: 100 });

      // Una entrega SIN proyecto y otra CON, para que el reporte tenga que separarlas.
      const sinProyecto = await request(servidor())
        .post('/api/salidas')
        .set('Cookie', cookie)
        .send({
          clienteId: cliente.id,
          fechaSalida: '2026-08-18',
          lineas: [{ productoId: producto.id, cantidad: 10, precioUnitario: 1_000 }],
        });
      expect(sinProyecto.status).toBe(201);

      const conProyecto = await request(servidor())
        .post('/api/salidas')
        .set('Cookie', cookie)
        .send({
          clienteId: cliente.id,
          proyectoId: proyecto.id,
          fechaSalida: '2026-08-18',
          lineas: [{ productoId: producto.id, cantidad: 4, precioUnitario: 1_000 }],
        });
      expect(conProyecto.status).toBe(201);

      for (const id of [sinProyecto.body.id, conProyecto.body.id]) {
        const confirmacion = await request(servidor()).post(`/api/salidas/${id}/confirmar`).set('Cookie', cookie);
        expect(confirmacion.status).toBe(204);
      }

      const productoTrasSalidas = await contexto.prisma.producto.findUniqueOrThrow({
        where: { id: BigInt(producto.id) },
      });
      expect(productoTrasSalidas.stockActual.toNumber()).toBe(86);

      const reporte = await request(servidor())
        .get(`/api/reportes/consumo-cliente?clienteId=${cliente.id}`)
        .set('Cookie', cookie);
      expect(reporte.status).toBe(200);

      const grupos = reporte.body.proyectos as Array<{
        proyecto: { id: number | null; nombre: string; estado: string | null };
        totalProyecto: number;
      }>;
      // El grupo sin proyecto va al FINAL y sin estado: no es un proyecto del catálogo.
      expect(grupos.map((grupo) => grupo.proyecto.nombre)).toEqual(['Obra Sur', 'Sin proyecto']);
      expect(grupos[1]?.proyecto).toEqual({ id: null, nombre: 'Sin proyecto', estado: null });
      expect(grupos[1]?.totalProyecto).toBe(10_000);
      // Y suma en el total del cliente: lo entregado sin obra no desaparece del reporte.
      expect(reporte.body.totalCliente).toBe(14_000);
    });

    it('el filtro por cliente del listado alcanza a las salidas sin proyecto', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const cliente = await crearClienteDePrueba(contexto.prisma, { usuarioCreacionId: admin.id });
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'SP-2', stockActual: 50 });
      await crearSalidaDePrueba(contexto.prisma, {
        clienteId: cliente.id,
        lineas: [{ productoId: producto.id, cantidad: 3 }],
      });

      // Con el JOIN contra `proyectos` que había hasta US28, esta consulta habría devuelto cero.
      const respuesta = await request(servidor())
        .get(`/api/salidas?clienteId=${cliente.id}`)
        .set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.datos).toHaveLength(1);
      expect(respuesta.body.datos[0].proyectoId).toBeNull();
      expect(respuesta.body.datos[0].clienteId).toBe(cliente.id);
    });

    it('rechaza un proyecto que no es del cliente indicado', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const cliente = await crearClienteDePrueba(contexto.prisma, {
        nombre: 'Uno',
        nit: 'NIT-UNO',
        usuarioCreacionId: admin.id,
      });
      const otro = await crearClienteDePrueba(contexto.prisma, {
        nombre: 'Dos',
        nit: 'NIT-DOS',
        usuarioCreacionId: admin.id,
      });
      const proyectoAjeno = await crearProyectoDePrueba(contexto.prisma, otro.id, { usuarioCreacionId: admin.id });
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'SP-3', stockActual: 20 });

      const respuesta = await request(servidor())
        .post('/api/salidas')
        .set('Cookie', cookie)
        .send({
          clienteId: cliente.id,
          proyectoId: proyectoAjeno.id,
          fechaSalida: '2026-08-18',
          lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 100 }],
        });

      // Hasta US28 esto era imposible de expresar: el cliente se deducía del proyecto.
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.campos.proyectoId).toContain('no pertenece');
    });
  });

  // ==========================================================================================
  // US29 — ajuste de inventario (FR-126)
  // ==========================================================================================
  describe('ajuste de inventario (US29, FR-126)', () => {
    it('se registra sin factura ni proveedor, se numera solo y deja movimientos AJUSTE_ENTRADA', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'AJU-1', stockActual: 5 });

      const creado = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie)
        .send({
          tipo: 'AJUSTE',
          fechaRecepcion: '2026-08-18',
          observaciones: 'Conteo físico de agosto: aparecieron 7 unidades más',
          lineas: [{ productoId: producto.id, cantidad: 7, precioUnitario: 1_200 }],
        });
      expect(creado.status).toBe(201);

      const detalle = await request(servidor()).get(`/api/ingresos/${creado.body.id}`).set('Cookie', cookie);
      expect(detalle.status).toBe(200);
      expect(detalle.body.tipo).toBe('AJUSTE');
      expect(detalle.body.numeroFactura).toBeNull();
      expect(detalle.body.proveedor).toBeNull();
      // El correlativo lo pone el SERVIDOR (nunca el cliente) y viaja como número, igual que el
      // de órdenes y cotizaciones: `AJU-000001` es cómo se LEE, y ese formato lo aplica quien
      // pinta con `formatoNumeroAjuste` de `@trazo/compartido`. Vale 1 porque el truncado de
      // `setup.ts` reinicia también `contadores['ajuste']`.
      expect(detalle.body.numeroAjuste).toBe(1);

      const recibido = await request(servidor())
        .post(`/api/ingresos/${creado.body.id}/recibir`)
        .set('Cookie', cookie);
      expect(recibido.status).toBe(204);

      const productoTrasAjuste = await contexto.prisma.producto.findUniqueOrThrow({
        where: { id: BigInt(producto.id) },
      });
      expect(productoTrasAjuste.stockActual.toNumber()).toBe(12);

      // Lo que distingue una compra de una corrección en el historial (FR-126).
      const movimientos = await contexto.prisma.movimientoInventario.findMany();
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0]?.tipo).toBe('AJUSTE_ENTRADA');
    });

    it('rechaza un ajuste sin motivo y uno que traiga proveedor', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const proveedor = await crearProveedorDePrueba(contexto.prisma, 'Cementos', admin.id);
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'AJU-2', stockActual: 1 });
      const linea = [{ productoId: producto.id, cantidad: 1, precioUnitario: 100 }];

      const sinMotivo = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie)
        .send({ tipo: 'AJUSTE', fechaRecepcion: '2026-08-18', lineas: linea });
      expect(sinMotivo.status).toBe(400);
      expect(sinMotivo.body.error.campos.observaciones).toContain('motivo');

      const conProveedor = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie)
        .send({
          tipo: 'AJUSTE',
          proveedorId: proveedor,
          fechaRecepcion: '2026-08-18',
          observaciones: 'Devolución del cliente',
          lineas: linea,
        });
      // Se rechaza en vez de ignorarlo: quien lo envía cree estar guardando algo (FR-126).
      expect(conProveedor.status).toBe(400);
      expect(conProveedor.body.error.campos.proveedorId).toContain('no lleva proveedor');
    });

    it('un ingreso de FACTURA sigue exigiendo número, fecha y proveedor', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'AJU-3', stockActual: 1 });

      const respuesta = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie)
        .send({
          fechaRecepcion: '2026-08-18',
          lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 100 }],
        });

      // Sin `tipo` el defecto es FACTURA: un cliente anterior a US29 se comporta igual que antes.
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.campos.numeroFactura).toBe('El número de factura es obligatorio');
      expect(respuesta.body.error.campos.proveedorId).toBe('El proveedor es obligatorio');
    });
  });

  // ==========================================================================================
  // US27 — documento de la salida con o sin valores, siempre firmado (FR-123)
  // ==========================================================================================
  describe('documento de la salida (US27, FR-123)', () => {
    async function salidaDePrueba(usuarioId: number): Promise<number> {
      const cliente = await crearClienteDePrueba(contexto.prisma, { nombre: 'Constructora Sol', usuarioCreacionId: usuarioId });
      const producto = await crearProductoDePrueba(contexto.prisma, {
        sku: 'DOC-1',
        descripcion: 'Cemento gris',
        stockActual: 100,
      });
      const salida = await crearSalidaDePrueba(contexto.prisma, {
        clienteId: cliente.id,
        lineas: [{ productoId: producto.id, cantidad: 3, precioUnitario: 25_000 }],
      });
      return salida.id;
    }

    it('la variante SIN valores no deja ninguna cifra de dinero dentro del archivo', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const salidaId = await salidaDePrueba(admin.id);

      // Excel y no PDF: releerlo con `exceljs` permite afirmar que el importe NO ESTÁ en el
      // archivo. "No se ve al abrirlo" sería una afirmación mucho más débil — y falsa: el fallo
      // que esta prueba vigila es justamente el de un dato presente pero no pintado.
      const conValores = await pedirBinario(servidor(), `/api/salidas/${salidaId}/export`, {
        formato: 'xlsx',
        valores: 'con',
        recibe: 'Juan Pérez',
      }).set('Cookie', cookie);
      expect(conValores.status).toBe(200);
      const textoConValores = await textoDelXlsx(conValores.body as Buffer);
      expect(textoConValores).toContain('Precio unitario');
      expect(textoConValores).toContain('25000');

      const sinValores = await pedirBinario(servidor(), `/api/salidas/${salidaId}/export`, {
        formato: 'xlsx',
        valores: 'sin',
        recibe: 'Juan Pérez',
      }).set('Cookie', cookie);
      expect(sinValores.status).toBe(200);

      const texto = await textoDelXlsx(sinValores.body as Buffer);
      expect(texto).not.toContain('Precio unitario');
      expect(texto).not.toContain('Valor de línea');
      expect(texto).not.toContain('25000');
      expect(texto).not.toContain('75000');
      // Lo que SÍ tiene que estar en las dos variantes: producto, cantidad y la firma.
      expect(texto).toContain('Cemento gris');
      expect(texto).toContain('Juan Pérez');
      expect(texto).toContain('Recibe la mercancía');
    });

    it('sin el nombre de quien recibe no se genera nada', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const salidaId = await salidaDePrueba(admin.id);

      const respuesta = await request(servidor())
        .get(`/api/salidas/${salidaId}/export?formato=pdf&valores=con`)
        .set('Cookie', cookie);
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.campos.recibe).toContain('obligatorio');
    });
  });
});

/**
 * Todo el texto de la primera hoja de un xlsx, en una sola cadena.
 *
 * Se relee con `exceljs` —el mismo paquete que lo escribió, igual que hace `export.spec.ts`— en
 * vez de hurgar en el zip a mano: lo que interesa es el CONTENIDO de las celdas, y así la
 * afirmación "este importe no está" no depende de cómo se comprimió el archivo.
 */
async function textoDelXlsx(archivo: Buffer): Promise<string> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(archivo as unknown as Parameters<typeof libro.xlsx.load>[0]);
  const hoja = libro.worksheets[0];
  if (!hoja) throw new Error('El xlsx exportado no trae ninguna hoja.');

  const textos: string[] = [];
  hoja.eachRow((fila) => {
    fila.eachCell({ includeEmpty: false }, (celda) => {
      textos.push(String(celda.value ?? ''));
    });
  });
  return textos.join(' | ');
}

/** Descarga binaria — mismo helper local que usa `export.spec.ts` (supertest necesita que se le
 *  diga cómo acumular un cuerpo que no es JSON). */
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
