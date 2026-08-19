/**
 * Pruebas de integración de los REPORTES DE INVENTARIO Y MOVIMIENTOS (T083, US7, Tanda 9,
 * FR-041/FR-042) — API completa + PostgreSQL REAL, contra el harness de `./setup.ts`.
 * Complementa `reportes-consumo.spec.ts` (T073, US4) con los dos reportes nuevos que agrega
 * esta historia: `GET /api/reportes/inventario` y `GET /api/reportes/movimientos`.
 *
 * Diferencia clave con `reportes-consumo.spec.ts` al armar el escenario: los reportes de
 * consumo leen directamente la tabla `salidas` (que `crearSalidaDePrueba` puede poblar
 * insertando DIRECTO con Prisma), pero el reporte de movimientos lee `movimientos_inventario`
 * — una tabla INMUTABLE cuyos únicos `INSERT` ocurren DENTRO de las transacciones atómicas de
 * `POST /api/ingresos/:id/recibir` y `POST /api/salidas/:id/confirmar` (ver TSDoc de
 * `dominio/puertos/repositorio-movimientos.ts`). No hay atajo de factory: el escenario de
 * movimientos de esta suite pasa SIEMPRE por esos dos endpoints reales (mismo patrón que
 * `inventario.spec.ts` usa para el historial de un producto, T064).
 *
 * El reporte de inventario sí puede seguir insertando productos DIRECTO con Prisma (mismo
 * patrón que `inventario.spec.ts`), salvo `ultimoCosto`: no hay endpoint para fijarlo sin
 * pasar por un ingreso completo, así que esta suite lo fija con un `UPDATE` directo tras crear
 * el producto — el reporte solo lee `producto.stockActual * producto.ultimoCosto`, sin que
 * importe cómo llegó ese costo a la fila.
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
  crearProyectoDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Fila de `GET /api/reportes/inventario` (ver `FilaReporteInventario`). */
interface FilaReporteInventarioBody {
  producto: {
    id: number;
    sku: string;
    descripcion: string;
    categoria: string | null;
    ubicacion: string | null;
    umbralStockBajo: number;
    estado: string;
    fechaUltimoMovimiento: string | null;
  };
  stock: number;
  comprometido: number;
  disponible: number;
  stockBajo: boolean;
  valorLinea: number;
}

/** Forma de `GET /api/reportes/inventario` (ver `ReporteInventarioActual`). */
interface ReporteInventarioBody {
  productos: FilaReporteInventarioBody[];
  valorTotalInventario: number;
  cantidadBajoUmbral: number;
  filtros: { buscar: string | null; cantidadMin: number | null; cantidadMax: number | null };
}

/** Fila de `GET /api/reportes/movimientos` (ver `FilaReporteMovimiento`). */
interface FilaReporteMovimientoBody {
  id: number;
  fecha: string;
  tipo: 'ENTRADA' | 'SALIDA' | 'AJUSTE_ENTRADA' | 'AJUSTE_SALIDA';
  cantidad: number;
  documento: { tipo: 'INGRESO' | 'SALIDA'; numero: string };
  producto: { sku: string; descripcion: string };
  usuario: string;
  cliente: string | null;
  proyecto: string | null;
}

/** Forma de `GET /api/reportes/movimientos` (ver `ReporteMovimientos`). */
interface ReporteMovimientosBody {
  movimientos: FilaReporteMovimientoBody[];
  filtros: {
    desde: string | null;
    hasta: string | null;
    tipo: string | null;
    usuarioId: number | null;
    clienteId: number | null;
    proyectoId: number | null;
  };
}

describe('Reportes de inventario y movimientos — /api/reportes (T083, US7, FR-041/FR-042)', () => {
  let contexto: AppDePrueba;
  /** US15 (FR-091): el proveedor de un ingreso es una FK obligatoria — cada prueba necesita
   *  una fila del catálogo, creada tras truncar (el TRUNCATE también vacía `proveedores`). */
  let proveedorId: number;

  beforeAll(async () => {
    contexto = await crearAppDePrueba();
  });

  afterAll(async () => {
    await cerrarAppDePrueba(contexto.app);
  });

  beforeEach(async () => {
    await truncarTablas(contexto.prisma);
    proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor de Prueba de Reportes');
  });

  const servidor = (): ReturnType<AppDePrueba['app']['getHttpServer']> => contexto.app.getHttpServer();

  /** Cuerpo mínimo válido de `POST /api/ingresos` (esquemaCrearIngreso) — mismo patrón que `inventario.spec.ts`. */
  function cuerpoIngreso(
    numeroFactura: string,
    lineas: { productoId: number; cantidad: number; precioUnitario: number }[],
  ): Record<string, unknown> {
    return {
      numeroFactura,
      fechaFactura: '2026-01-05',
      proveedorId,
      fechaRecepcion: '2026-01-05',
      lineas,
    };
  }

  /** Cuerpo mínimo válido de `POST /api/salidas` (esquemaCrearSalida) — mismo patrón que `inventario.spec.ts`. */
  function cuerpoSalida(
    destino: { clienteId: number; proyectoId?: number },
    lineas: { productoId: number; cantidad: number; precioUnitario: number }[],
  ): Record<string, unknown> {
    // US28 (FR-124): el destino obligatorio es el cliente.
    return { ...destino, fechaSalida: '2026-01-10', lineas };
  }

  describe('GET /api/reportes/inventario (FR-041)', () => {
    /**
     * Tres productos con cifras conocidas: `productoBajo` con `disponible` EXACTAMENTE en su
     * umbral (límite inclusive de `esStockBajo` — debe salir `stockBajo: true`), `productoAlto`
     * con una salida `PENDIENTE` REAL que compromete parte de su stock (disponible por debajo
     * del stock físico pero por encima de su umbral) y `productoMedio` sin ninguna salida.
     * `ultimoCosto` se fija con un `UPDATE` directo (ver TSDoc de cabecera).
     */
    async function crearEscenarioInventario(): Promise<{
      productoBajo: { id: number; sku: string };
      productoAlto: { id: number; sku: string };
      productoMedio: { id: number; sku: string };
    }> {
      const productoBajo = await crearProductoDePrueba(contexto.prisma, {
        sku: 'STK-BAJO-001',
        stockActual: 30,
        umbralStockBajo: 30, // disponible (30) == umbral -> esStockBajo() es TRUE (límite inclusive)
      });
      await contexto.prisma.producto.update({ where: { id: BigInt(productoBajo.id) }, data: { ultimoCosto: 1_000 } });

      const productoAlto = await crearProductoDePrueba(contexto.prisma, {
        sku: 'STK-ALTO-001',
        stockActual: 100,
        umbralStockBajo: 20,
      });
      await contexto.prisma.producto.update({ where: { id: BigInt(productoAlto.id) }, data: { ultimoCosto: 5_000 } });

      const productoMedio = await crearProductoDePrueba(contexto.prisma, {
        sku: 'STK-MEDIO-001',
        stockActual: 50,
        umbralStockBajo: 10,
      });
      await contexto.prisma.producto.update({ where: { id: BigInt(productoMedio.id) }, data: { ultimoCosto: 2_000 } });

      // Salida PENDIENTE real de 30 sobre productoAlto: compromete 30 SIN tocar stockActual
      // (PENDIENTE nunca descuenta stock físico, US3) -> disponible = 100 - 30 = 70.
      const cliente = await crearClienteDePrueba(contexto.prisma, { nombre: 'Cliente Reporte Inventario' });
      const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id, { nombre: 'Proyecto Reporte Inventario' });
      const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const cookieOperario = await iniciarSesion(servidor(), operario.login, operario.password);
      const respuestaSalida = await request(servidor())
        .post('/api/salidas')
        .set('Cookie', cookieOperario)
        .send(cuerpoSalida({ clienteId: cliente.id, proyectoId: proyecto.id }, [{ productoId: productoAlto.id, cantidad: 30, precioUnitario: 100 }]));
      expect(respuestaSalida.status).toBe(201);

      return {
        productoBajo: { id: productoBajo.id, sku: productoBajo.sku },
        productoAlto: { id: productoAlto.id, sku: productoAlto.sku },
        productoMedio: { id: productoMedio.id, sku: productoMedio.sku },
      };
    }

    it('valor total del inventario y productos bajo umbral son correctos contra datos conocidos', async () => {
      const escenario = await crearEscenarioInventario();
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

      const respuesta = await request(servidor()).get('/api/reportes/inventario').set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      const cuerpo = respuesta.body as ReporteInventarioBody;
      expect(cuerpo.productos).toHaveLength(3);

      const filaBajo = cuerpo.productos.find((f) => f.producto.sku === escenario.productoBajo.sku);
      expect(filaBajo?.stock).toBe(30);
      expect(filaBajo?.comprometido).toBe(0);
      expect(filaBajo?.disponible).toBe(30);
      expect(filaBajo?.stockBajo).toBe(true); // disponible == umbral, límite inclusive
      expect(filaBajo?.valorLinea).toBe(30_000); // 30 x 1.000

      const filaAlto = cuerpo.productos.find((f) => f.producto.sku === escenario.productoAlto.sku);
      expect(filaAlto?.stock).toBe(100);
      expect(filaAlto?.comprometido).toBe(30);
      expect(filaAlto?.disponible).toBe(70);
      expect(filaAlto?.stockBajo).toBe(false);
      expect(filaAlto?.valorLinea).toBe(500_000); // 100 x 5.000

      const filaMedio = cuerpo.productos.find((f) => f.producto.sku === escenario.productoMedio.sku);
      expect(filaMedio?.stock).toBe(50);
      expect(filaMedio?.comprometido).toBe(0);
      expect(filaMedio?.disponible).toBe(50);
      expect(filaMedio?.stockBajo).toBe(false);
      expect(filaMedio?.valorLinea).toBe(100_000); // 50 x 2.000

      // 30.000 + 500.000 + 100.000 — suma EXACTA de los 3 valorLinea, ninguno recalculado aparte.
      expect(cuerpo.valorTotalInventario).toBe(630_000);
      expect(cuerpo.cantidadBajoUmbral).toBe(1); // solo productoBajo
      // `categoria: null` desde US24 (FR-120): sin filtro de categoría, el reporte cubre el
      // catálogo entero, que es como se comportaba antes de esa historia.
      expect(cuerpo.filtros).toEqual({ buscar: null, categoria: null, cantidadMin: null, cantidadMax: null });
    });

    it('cantidadMin/cantidadMax filtran sobre DISPONIBLE (nunca stockActual crudo) y los totales reflejan el conjunto YA FILTRADO', async () => {
      const escenario = await crearEscenarioInventario();
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

      // Disponibles: productoBajo=30, productoAlto=70, productoMedio=50 — [60,80] deja SOLO
      // productoAlto. Si el filtro comparara contra stockActual crudo (100/100/50), el
      // resultado sería distinto: la prueba ejercita la diferencia real entre ambos criterios.
      const respuesta = await request(servidor())
        .get('/api/reportes/inventario')
        .query({ cantidadMin: 60, cantidadMax: 80 })
        .set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      const cuerpo = respuesta.body as ReporteInventarioBody;
      expect(cuerpo.productos).toHaveLength(1);
      expect(cuerpo.productos[0]?.producto.sku).toBe(escenario.productoAlto.sku);
      expect(cuerpo.valorTotalInventario).toBe(500_000); // solo el valorLinea de productoAlto
      expect(cuerpo.cantidadBajoUmbral).toBe(0); // productoAlto no está bajo umbral
      expect(cuerpo.filtros).toEqual({ buscar: null, categoria: null, cantidadMin: 60, cantidadMax: 80 });
    });

    it('buscar filtra por SKU (parcial, insensible a mayúsculas — mismo criterio que FR-023)', async () => {
      const escenario = await crearEscenarioInventario();
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

      const respuesta = await request(servidor())
        .get('/api/reportes/inventario')
        .query({ buscar: 'alto' }) // minúsculas, parcial — solo coincide con STK-ALTO-001
        .set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      const cuerpo = respuesta.body as ReporteInventarioBody;
      expect(cuerpo.productos).toHaveLength(1);
      expect(cuerpo.productos[0]?.producto.sku).toBe(escenario.productoAlto.sku);
      expect(cuerpo.filtros.buscar).toBe('alto');
    });
  });

  describe('GET /api/reportes/movimientos (FR-042)', () => {
    /**
     * Escenario con 1 ENTRADA (ingreso recibido, sin cliente/proyecto) y 3 SALIDAS confirmadas
     * repartidas en 2 clientes / 3 proyectos / 2 usuarios — TODO vía los endpoints HTTP reales
     * (ver TSDoc de cabecera: `movimientos_inventario` no admite atajo de factory).
     */
    async function crearEscenarioMovimientos(): Promise<{
      producto: { id: number; sku: string };
      clienteA: { id: number; nombre: string };
      proyectoA1: { id: number; nombre: string };
      proyectoA2: { id: number; nombre: string };
      clienteB: { id: number; nombre: string };
      proyectoB1: { id: number; nombre: string };
      usuario1: { id: number; nombreCompleto: string };
      usuario2: { id: number; nombreCompleto: string };
      salidaA1Numero: number;
      salidaA2Numero: number;
      salidaB1Numero: number;
    }> {
      const clienteA = await crearClienteDePrueba(contexto.prisma, { nombre: 'Cliente Movimientos A' });
      const proyectoA1 = await crearProyectoDePrueba(contexto.prisma, clienteA.id, { nombre: 'Proyecto Movimientos A1' });
      const proyectoA2 = await crearProyectoDePrueba(contexto.prisma, clienteA.id, { nombre: 'Proyecto Movimientos A2' });
      const clienteB = await crearClienteDePrueba(contexto.prisma, { nombre: 'Cliente Movimientos B' });
      const proyectoB1 = await crearProyectoDePrueba(contexto.prisma, clienteB.id, { nombre: 'Proyecto Movimientos B1' });
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'MOV-PRUEBA-001', stockActual: 0 });

      const usuario1Login = await crearUsuarioDePrueba(contexto, {
        rol: 'OPERARIO',
        nombreCompleto: 'Operario Movimientos Uno',
      });
      const usuario2Login = await crearUsuarioDePrueba(contexto, {
        rol: 'OPERARIO',
        nombreCompleto: 'Operario Movimientos Dos',
      });
      const cookie1 = await iniciarSesion(servidor(), usuario1Login.login, usuario1Login.password);
      const cookie2 = await iniciarSesion(servidor(), usuario2Login.login, usuario2Login.password);

      // 1) ENTRADA (usuario1): ingreso de 200, sin cliente/proyecto asociado.
      const crearIngreso = await request(servidor())
        .post('/api/ingresos')
        .set('Cookie', cookie1)
        .send(cuerpoIngreso('FAC-MOV-0001', [{ productoId: producto.id, cantidad: 200, precioUnitario: 1_000 }]));
      expect(crearIngreso.status).toBe(201);
      const recibir = await request(servidor())
        .post(`/api/ingresos/${crearIngreso.body.id}/recibir`)
        .set('Cookie', cookie1);
      expect(recibir.status).toBe(204);

      // 2) SALIDA A1 (usuario1, clienteA/proyectoA1): 40.
      const crearSalidaA1 = await request(servidor())
        .post('/api/salidas')
        .set('Cookie', cookie1)
        .send(cuerpoSalida({ clienteId: clienteA.id, proyectoId: proyectoA1.id }, [{ productoId: producto.id, cantidad: 40, precioUnitario: 1_000 }]));
      expect(crearSalidaA1.status).toBe(201);
      const confirmarA1 = await request(servidor())
        .post(`/api/salidas/${crearSalidaA1.body.id}/confirmar`)
        .set('Cookie', cookie1);
      expect(confirmarA1.status).toBe(204);

      // 3) SALIDA A2 (usuario1, clienteA/proyectoA2 — MISMO cliente, otro proyecto): 15.
      const crearSalidaA2 = await request(servidor())
        .post('/api/salidas')
        .set('Cookie', cookie1)
        .send(cuerpoSalida({ clienteId: clienteA.id, proyectoId: proyectoA2.id }, [{ productoId: producto.id, cantidad: 15, precioUnitario: 1_000 }]));
      expect(crearSalidaA2.status).toBe(201);
      const confirmarA2 = await request(servidor())
        .post(`/api/salidas/${crearSalidaA2.body.id}/confirmar`)
        .set('Cookie', cookie1);
      expect(confirmarA2.status).toBe(204);

      // 4) SALIDA B1 (usuario2, clienteB/proyectoB1): 25.
      const crearSalidaB1 = await request(servidor())
        .post('/api/salidas')
        .set('Cookie', cookie2)
        .send(cuerpoSalida({ clienteId: clienteB.id, proyectoId: proyectoB1.id }, [{ productoId: producto.id, cantidad: 25, precioUnitario: 1_000 }]));
      expect(crearSalidaB1.status).toBe(201);
      const confirmarB1 = await request(servidor())
        .post(`/api/salidas/${crearSalidaB1.body.id}/confirmar`)
        .set('Cookie', cookie2);
      expect(confirmarB1.status).toBe(204);

      return {
        producto: { id: producto.id, sku: producto.sku },
        clienteA: { id: clienteA.id, nombre: clienteA.nombre },
        proyectoA1: { id: proyectoA1.id, nombre: proyectoA1.nombre },
        proyectoA2: { id: proyectoA2.id, nombre: proyectoA2.nombre },
        clienteB: { id: clienteB.id, nombre: clienteB.nombre },
        proyectoB1: { id: proyectoB1.id, nombre: proyectoB1.nombre },
        usuario1: { id: usuario1Login.id, nombreCompleto: 'Operario Movimientos Uno' },
        usuario2: { id: usuario2Login.id, nombreCompleto: 'Operario Movimientos Dos' },
        salidaA1Numero: crearSalidaA1.body.numero,
        salidaA2Numero: crearSalidaA2.body.numero,
        salidaB1Numero: crearSalidaB1.body.numero,
      };
    }

    it('sin filtros devuelve los 4 movimientos (1 ENTRADA + 3 SALIDA) con documento/producto/usuario/cliente/proyecto resueltos', async () => {
      const escenario = await crearEscenarioMovimientos();
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

      const respuesta = await request(servidor()).get('/api/reportes/movimientos').set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      const cuerpo = respuesta.body as ReporteMovimientosBody;
      expect(cuerpo.movimientos).toHaveLength(4);

      const entrada = cuerpo.movimientos.find((m) => m.tipo === 'ENTRADA');
      expect(entrada?.documento).toEqual({ tipo: 'INGRESO', numero: 'FAC-MOV-0001' }); // número de factura, no el id
      expect(entrada?.producto.sku).toBe(escenario.producto.sku);
      expect(entrada?.cantidad).toBe(200);
      expect(entrada?.usuario).toBe(escenario.usuario1.nombreCompleto);
      expect(entrada?.cliente).toBeNull(); // ENTRADA nunca tiene proyecto/cliente (FR-042)
      expect(entrada?.proyecto).toBeNull();

      const salidaA1 = cuerpo.movimientos.find(
        (m) => m.documento.tipo === 'SALIDA' && m.documento.numero === String(escenario.salidaA1Numero),
      );
      expect(salidaA1?.tipo).toBe('SALIDA');
      expect(salidaA1?.cantidad).toBe(40);
      expect(salidaA1?.usuario).toBe(escenario.usuario1.nombreCompleto);
      expect(salidaA1?.cliente).toBe(escenario.clienteA.nombre);
      expect(salidaA1?.proyecto).toBe(escenario.proyectoA1.nombre);

      const salidaB1 = cuerpo.movimientos.find(
        (m) => m.documento.tipo === 'SALIDA' && m.documento.numero === String(escenario.salidaB1Numero),
      );
      expect(salidaB1?.cantidad).toBe(25);
      expect(salidaB1?.usuario).toBe(escenario.usuario2.nombreCompleto);
      expect(salidaB1?.cliente).toBe(escenario.clienteB.nombre);
      expect(salidaB1?.proyecto).toBe(escenario.proyectoB1.nombre);
    });

    it('tipo=SALIDA excluye la ENTRADA', async () => {
      await crearEscenarioMovimientos();
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

      const respuesta = await request(servidor())
        .get('/api/reportes/movimientos')
        .query({ tipo: 'SALIDA' })
        .set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      const cuerpo = respuesta.body as ReporteMovimientosBody;
      expect(cuerpo.movimientos).toHaveLength(3);
      expect(cuerpo.movimientos.every((m) => m.tipo === 'SALIDA')).toBe(true);
    });

    it('tipo=SALIDA combinado con usuarioId filtra EXACTAMENTE las salidas de ese usuario (US7-AS2)', async () => {
      const escenario = await crearEscenarioMovimientos();
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

      const respuesta = await request(servidor())
        .get('/api/reportes/movimientos')
        .query({ tipo: 'SALIDA', usuarioId: escenario.usuario1.id })
        .set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      const cuerpo = respuesta.body as ReporteMovimientosBody;
      expect(cuerpo.movimientos).toHaveLength(2); // A1 + A2 — nunca la B1 (usuario2)
      expect(cuerpo.movimientos.every((m) => m.usuario === escenario.usuario1.nombreCompleto)).toBe(true);
      const numeros = cuerpo.movimientos.map((m) => m.documento.numero).sort();
      expect(numeros).toEqual([String(escenario.salidaA1Numero), String(escenario.salidaA2Numero)].sort());
    });

    it('clienteId filtra vía el JOIN proyecto.clienteId (ambos proyectos del cliente) y NUNCA matchea la ENTRADA sin proyecto', async () => {
      const escenario = await crearEscenarioMovimientos();
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

      const respuesta = await request(servidor())
        .get('/api/reportes/movimientos')
        .query({ clienteId: escenario.clienteA.id })
        .set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      const cuerpo = respuesta.body as ReporteMovimientosBody;
      expect(cuerpo.movimientos).toHaveLength(2); // A1 + A2, nunca la ENTRADA ni la salida de B
      expect(cuerpo.movimientos.every((m) => m.cliente === escenario.clienteA.nombre)).toBe(true);
    });

    it('proyectoId filtra a un solo proyecto', async () => {
      const escenario = await crearEscenarioMovimientos();
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

      const respuesta = await request(servidor())
        .get('/api/reportes/movimientos')
        .query({ proyectoId: escenario.proyectoA2.id })
        .set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      const cuerpo = respuesta.body as ReporteMovimientosBody;
      expect(cuerpo.movimientos).toHaveLength(1);
      expect(cuerpo.movimientos[0]?.proyecto).toBe(escenario.proyectoA2.nombre);
      expect(cuerpo.movimientos[0]?.cantidad).toBe(15);
    });

    it('desde/hasta filtra por la fecha_hora REAL de cada movimiento (asignada al recibir/confirmar, no la fecha del documento)', async () => {
      await crearEscenarioMovimientos();
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

      const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const manana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const respuestaDentro = await request(servidor())
        .get('/api/reportes/movimientos')
        .query({ desde: ayer, hasta: manana })
        .set('Cookie', cookie);
      expect(respuestaDentro.status).toBe(200);
      expect((respuestaDentro.body as ReporteMovimientosBody).movimientos).toHaveLength(4);

      const pasadoManana = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const respuestaFuera = await request(servidor())
        .get('/api/reportes/movimientos')
        .query({ desde: pasadoManana })
        .set('Cookie', cookie);
      expect(respuestaFuera.status).toBe(200);
      expect((respuestaFuera.body as ReporteMovimientosBody).movimientos).toEqual([]);
    });

    it('hasta=HOY (fecha-solo-día en hora de Bogotá) incluye los movimientos de HOY, no solo hasta la medianoche UTC (corrección hallazgo HIGH revisión adversarial)', async () => {
      await crearEscenarioMovimientos();
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);

      // "Hoy" en hora de Bogotá (UTC-5, spec.md § Moneda y localización), NO el día UTC: se
      // resta el offset fijo ANTES de tomar el día, igual que tendría que hacerlo un usuario
      // real que escribe "hoy" en un <input type="date"> mientras trabaja en Bogotá. Los 4
      // movimientos del escenario se crearon segundos atrás (fecha_hora real = ahora), así que
      // caen DENTRO de este día en Bogotá sin importar la hora UTC en la que corra la prueba.
      const ahora = new Date();
      const hoyBogota = new Date(ahora.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const respuesta = await request(servidor())
        .get('/api/reportes/movimientos')
        .query({ hasta: hoyBogota })
        .set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      // Antes de la corrección, `hasta: hoyBogota` se interpretaba como medianoche UTC de esa
      // fecha — un instante SIEMPRE anterior al momento real en que se crearon los movimientos
      // (medianoche de Bogotá cae a las 05:00 UTC, 5 horas DESPUÉS de la medianoche UTC del
      // mismo texto de fecha) — así que el reporte los excluía a los 4. Con la corrección,
      // `hasta` se ancla al fin de ese día en hora de Bogotá y los 4 vuelven a aparecer.
      expect((respuesta.body as ReporteMovimientosBody).movimientos).toHaveLength(4);
    });
  });

  describe('control de acceso en los 4 endpoints nuevos (FR-002/FR-003)', () => {
    it('un OPERARIO recibe 403 en inventario/movimientos y sus /export (reportes son solo Administrador/Gerente)', async () => {
      const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
      const cookie = await iniciarSesion(servidor(), operario.login, operario.password);

      const respuestaInventario = await request(servidor()).get('/api/reportes/inventario').set('Cookie', cookie);
      expect(respuestaInventario.status).toBe(403);

      const respuestaInventarioExport = await request(servidor())
        .get('/api/reportes/inventario/export')
        .query({ formato: 'xlsx' })
        .set('Cookie', cookie);
      expect(respuestaInventarioExport.status).toBe(403);

      const respuestaMovimientos = await request(servidor()).get('/api/reportes/movimientos').set('Cookie', cookie);
      expect(respuestaMovimientos.status).toBe(403);

      const respuestaMovimientosExport = await request(servidor())
        .get('/api/reportes/movimientos/export')
        .query({ formato: 'pdf' })
        .set('Cookie', cookie);
      expect(respuestaMovimientosExport.status).toBe(403);
    });

    it('sin cookie de sesión, los 4 endpoints (inventario/movimientos, datos y exportación) responden 401', async () => {
      const respuestaInventario = await request(servidor()).get('/api/reportes/inventario');
      expect(respuestaInventario.status).toBe(401);

      const respuestaInventarioExport = await request(servidor())
        .get('/api/reportes/inventario/export')
        .query({ formato: 'xlsx' });
      expect(respuestaInventarioExport.status).toBe(401);

      const respuestaMovimientos = await request(servidor()).get('/api/reportes/movimientos');
      expect(respuestaMovimientos.status).toBe(401);

      const respuestaMovimientosExport = await request(servidor())
        .get('/api/reportes/movimientos/export')
        .query({ formato: 'pdf' });
      expect(respuestaMovimientosExport.status).toBe(401);
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
