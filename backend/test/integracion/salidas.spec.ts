/**
 * Pruebas de integración de SALIDAS (T057, FR-025…FR-033) — API completa + PostgreSQL REAL,
 * contra el harness de `./setup.ts`. Complementa `salidas-stock.spec.ts` (T056, el invariante
 * de stock bajo concurrencia): esta suite cubre el resto del ciclo de vida — correlativos
 * únicos bajo concurrencia, validación de destino obligatorio, el compromiso de
 * disponibilidad de una salida `PENDIENTE`, y las dos formas de "deshacer" (`cancelar` sin
 * tocar stock, `anular` con reversa `AJUSTE_ENTRADA`).
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
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Fila del catálogo `GET /api/productos` (ver `ListarResumenProductosCasoUso`). */
interface ProductoResumenBody {
  id: number;
  sku: string;
  descripcion: string;
  ultimoCosto: number;
  disponible: number;
}

describe('Salidas — /api/salidas (T057)', () => {
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

  /** Cuerpo mínimo válido de `POST /api/salidas` (esquemaCrearSalida) — solo varía el
   *  proyecto y las líneas, que es lo que cada prueba necesita controlar. */
  function cuerpoSalida(
    proyectoId: number,
    lineas: { productoId: number; cantidad: number; precioUnitario: number }[],
  ): Record<string, unknown> {
    return { proyectoId, fechaSalida: '2026-01-10', lineas };
  }

  async function disponibleDelProducto(cookie: string, productoId: number): Promise<number> {
    const respuesta = await request(servidor()).get('/api/productos').set('Cookie', cookie);
    const productos = respuesta.body as ProductoResumenBody[];
    const producto = productos.find((p) => p.id === productoId);
    if (!producto) {
      throw new Error(`Producto ${productoId} no aparece en GET /api/productos`);
    }
    return producto.disponible;
  }

  it('correlativos únicos bajo concurrencia: N POST /api/salidas en paralelo obtienen números distintos y consecutivos (research R5)', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 1000 });
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const CANTIDAD_SALIDAS = 10;
    const respuestas = await Promise.all(
      Array.from({ length: CANTIDAD_SALIDAS }, () =>
        request(servidor())
          .post('/api/salidas')
          .set('Cookie', cookie)
          .send(cuerpoSalida(proyecto.id, [{ productoId: producto.id, cantidad: 1, precioUnitario: 100 }])),
      ),
    );

    for (const respuesta of respuestas) {
      expect(respuesta.status).toBe(201);
    }

    const numerosDeLaApi = respuestas.map((respuesta) => respuesta.body.numero as number);
    expect(new Set(numerosDeLaApi).size).toBe(CANTIDAD_SALIDAS); // sin duplicados en las respuestas HTTP

    // Verificación consultando la BD directamente (no solo confiar en las respuestas HTTP):
    // el UNIQUE(numero) + el UPDATE...RETURNING dentro de la transacción de creación deben
    // haber insertado exactamente CANTIDAD_SALIDAS filas con números todos distintos.
    const salidasEnBd = await contexto.prisma.salida.findMany({ select: { numero: true } });
    expect(salidasEnBd).toHaveLength(CANTIDAD_SALIDAS);
    const numerosEnBd = salidasEnBd.map((salida) => Number(salida.numero));
    expect(new Set(numerosEnBd).size).toBe(CANTIDAD_SALIDAS);

    // Consecutivos: 10 números distintos que arrancan en 1 (contador reseteado por
    // truncarTablas) deben cubrir exactamente el rango [1..10], sin huecos.
    expect(numerosEnBd.sort((a, b) => a - b)).toEqual(Array.from({ length: CANTIDAD_SALIDAS }, (_, i) => i + 1));
  });

  it('POST /api/salidas sin proyectoId responde 400 con el mensaje "El cliente/proyecto es obligatorio" (FR-027, US3-AS3)', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 10 });
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const respuesta = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookie)
      .send({
        fechaSalida: '2026-01-10',
        lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 100 }],
      });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.campos).toEqual(
      expect.objectContaining({ proyectoId: 'El cliente/proyecto es obligatorio' }),
    );

    const totalSalidas = await contexto.prisma.salida.count();
    expect(totalSalidas).toBe(0);
  });

  it('una salida PENDIENTE compromete disponibilidad: 30 de 100 comprometidos deja "disponible" en 70 en GET /api/productos (research R4, FR-020/FR-028)', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    expect(await disponibleDelProducto(cookie, producto.id)).toBe(100); // punto de partida

    const respuestaCrear = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookie)
      .send(cuerpoSalida(proyecto.id, [{ productoId: producto.id, cantidad: 30, precioUnitario: 100 }]));
    expect(respuestaCrear.status).toBe(201);

    expect(await disponibleDelProducto(cookie, producto.id)).toBe(70); // 100 - 30 comprometido

    // El stock físico NO cambió — PENDIENTE solo compromete, no descuenta (research R4).
    const productoEnBd = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(producto.id) } });
    expect(productoEnBd.stockActual.toNumber()).toBe(100);
  });

  it('confirmar y luego anular una salida revierte el stock con un movimiento AJUSTE_ENTRADA y el motivo auditado (FR-032)', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookieOperario = await iniciarSesion(servidor(), operario.login, operario.password);
    const cookieGerente = await iniciarSesion(servidor(), gerente.login, gerente.password);

    const respuestaCrear = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookieOperario)
      .send(cuerpoSalida(proyecto.id, [{ productoId: producto.id, cantidad: 20, precioUnitario: 1500 }]));
    expect(respuestaCrear.status).toBe(201);
    const salidaId: number = respuestaCrear.body.id;

    const respuestaConfirmar = await request(servidor())
      .post(`/api/salidas/${salidaId}/confirmar`)
      .set('Cookie', cookieOperario);
    expect(respuestaConfirmar.status).toBe(204);

    const productoTrasConfirmar = await contexto.prisma.producto.findUniqueOrThrow({
      where: { id: BigInt(producto.id) },
    });
    expect(productoTrasConfirmar.stockActual.toNumber()).toBe(80); // 100 - 20, punto de partida de la anulación

    const respuestaAnular = await request(servidor())
      .post(`/api/salidas/${salidaId}/anular`)
      .set('Cookie', cookieGerente)
      .send({ motivo: 'Devolución del cliente por error de despacho' });
    expect(respuestaAnular.status).toBe(204);

    const productoTrasAnular = await contexto.prisma.producto.findUniqueOrThrow({
      where: { id: BigInt(producto.id) },
    });
    expect(productoTrasAnular.stockActual.toNumber()).toBe(100); // vuelve exactamente al valor original

    const movimientosAjuste = await contexto.prisma.movimientoInventario.findMany({
      where: { documentoTipo: 'SALIDA', documentoId: BigInt(salidaId), tipo: 'AJUSTE_ENTRADA' },
    });
    expect(movimientosAjuste).toHaveLength(1);
    const [movimientoAjuste] = movimientosAjuste;
    expect(movimientoAjuste?.cantidad.toNumber()).toBe(20);
    expect(movimientoAjuste?.stockResultante.toNumber()).toBe(100);
    expect(movimientoAjuste?.motivo).toBe('Devolución del cliente por error de despacho');
    expect(Number(movimientoAjuste?.usuarioId)).toBe(gerente.id);
    expect(Number(movimientoAjuste?.proyectoId)).toBe(proyecto.id); // los movimientos de salida sí llevan proyecto (FR-042)

    const salidaEnBd = await contexto.prisma.salida.findUniqueOrThrow({ where: { id: BigInt(salidaId) } });
    expect(salidaEnBd.estado).toBe('ANULADA');
    expect(salidaEnBd.motivoAnulacion).toBe('Devolución del cliente por error de despacho');

    // El disponible del producto vuelve a mostrar el valor original: una salida ANULADA no
    // sigue PENDIENTE, así que deja de contar en el agregado de comprometido.
    expect(await disponibleDelProducto(cookieOperario, producto.id)).toBe(100);
  });

  it('cancelar una salida PENDIENTE libera el compromiso inmediatamente (el disponible sube sin tocar stock físico)', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const respuestaCrear = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookie)
      .send(cuerpoSalida(proyecto.id, [{ productoId: producto.id, cantidad: 40, precioUnitario: 100 }]));
    const salidaId: number = respuestaCrear.body.id;

    expect(await disponibleDelProducto(cookie, producto.id)).toBe(60); // 100 - 40 comprometido

    const respuestaCancelar = await request(servidor())
      .post(`/api/salidas/${salidaId}/cancelar`)
      .set('Cookie', cookie)
      .send({ motivo: 'El cliente canceló el pedido' });
    expect(respuestaCancelar.status).toBe(204);

    expect(await disponibleDelProducto(cookie, producto.id)).toBe(100); // el compromiso desapareció

    const salidaEnBd = await contexto.prisma.salida.findUniqueOrThrow({ where: { id: BigInt(salidaId) } });
    expect(salidaEnBd.estado).toBe('ANULADA');
    expect(salidaEnBd.motivoAnulacion).toBe('El cliente canceló el pedido');

    // `cancelar` es PENDIENTE→ANULADA SIN tocar stock físico (a diferencia de `anular`, que
    // parte de CONFIRMADA y sí revierte con AJUSTE_ENTRADA) — el stock nunca cambió.
    const productoEnBd = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(producto.id) } });
    expect(productoEnBd.stockActual.toNumber()).toBe(100);
    const totalMovimientos = await contexto.prisma.movimientoInventario.count({
      where: { documentoTipo: 'SALIDA', documentoId: BigInt(salidaId) },
    });
    expect(totalMovimientos).toBe(0);
  });

  it('PUT /api/salidas/:id excluye el compromiso propio al revalidar disponibilidad (hallazgo de revisión adversarial, no había cobertura previa)', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    // La propia salida ya compromete 90 de 100 (disponible baja a 10).
    const respuestaCrear = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookie)
      .send(cuerpoSalida(proyecto.id, [{ productoId: producto.id, cantidad: 90, precioUnitario: 100 }]));
    expect(respuestaCrear.status).toBe(201);
    const salidaId: number = respuestaCrear.body.id;
    expect(await disponibleDelProducto(cookie, producto.id)).toBe(10);

    // Subir a 95 (más que el "disponible" de 10 si NO se excluyera el compromiso propio,
    // pero perfectamente válido contra el stock real de 100) — prueba que
    // "excluirSalidaId" realmente excluye la propia salida al editar, no solo de nombre.
    const respuestaEditar = await request(servidor())
      .put(`/api/salidas/${salidaId}`)
      .set('Cookie', cookie)
      .send(cuerpoSalida(proyecto.id, [{ productoId: producto.id, cantidad: 95, precioUnitario: 100 }]));
    expect(respuestaEditar.status).toBe(204);
    expect(await disponibleDelProducto(cookie, producto.id)).toBe(5); // 100 - 95

    // Pero el techo real (stock físico) se sigue respetando: pedir más de lo que existe
    // en total, aunque sea la única salida pendiente del producto, se rechaza.
    const respuestaExcede = await request(servidor())
      .put(`/api/salidas/${salidaId}`)
      .set('Cookie', cookie)
      .send(cuerpoSalida(proyecto.id, [{ productoId: producto.id, cantidad: 101, precioUnitario: 100 }]));
    expect(respuestaExcede.status).toBe(409);
  });

  it('PUT /api/salidas/:id sobre una salida ya CONFIRMADA responde 409 "estado no editable" (US1-AS5 aplicado a salidas, US3-AS4)', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 100 });
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const respuestaCrear = await request(servidor())
      .post('/api/salidas')
      .set('Cookie', cookie)
      .send(cuerpoSalida(proyecto.id, [{ productoId: producto.id, cantidad: 10, precioUnitario: 100 }]));
    const salidaId: number = respuestaCrear.body.id;

    const respuestaConfirmar = await request(servidor())
      .post(`/api/salidas/${salidaId}/confirmar`)
      .set('Cookie', cookie);
    expect(respuestaConfirmar.status).toBe(204);

    const respuestaEditar = await request(servidor())
      .put(`/api/salidas/${salidaId}`)
      .set('Cookie', cookie)
      .send(cuerpoSalida(proyecto.id, [{ productoId: producto.id, cantidad: 20, precioUnitario: 100 }]));
    expect(respuestaEditar.status).toBe(409);

    // La salida no cambió: sigue con su línea original de 10.
    const detalles = await contexto.prisma.detalleSalida.findMany({ where: { salidaId: BigInt(salidaId) } });
    expect(detalles).toHaveLength(1);
    expect(detalles[0]?.cantidad.toNumber()).toBe(10);
  });

  /**
   * Regresión de un defecto REAL encontrado en verificación final (tanda 14): el listado
   * ordenaba solo por `fecha_salida`, que es una columna `DATE` y se repite muchísimo. Sin un
   * segundo criterio ÚNICO el orden es inestable, y al recorrer las páginas con `skip`/`take`
   * unas salidas salían DOS veces y otras no salían NUNCA (medido: 18 filas leídas, 15 salidas
   * distintas). Para un sistema cuyo principio no negociable es la trazabilidad total, una
   * salida confirmada invisible en el listado es el peor modo de fallo posible.
   *
   * LIMITACIÓN, DICHA DE FRENTE PARA QUE NADIE SE CONFÍE: esta prueba **no falla** si se quita
   * el desempate. Lo comprobé quitándolo a propósito, con 7 y con 24 filas, y ambas
   * aserciones siguieron pasando. El motivo es que el desorden depende del PLAN DE CONSULTA de
   * PostgreSQL: con el volumen de una prueba resuelve el `ORDER BY` con un sort que, de hecho,
   * devuelve las filas empatadas en un orden que coincide con el esperado. El defecto se
   * observó con datos reales (18 salidas → 15 distintas, 3 duplicadas y 3 invisibles), no en
   * este harness.
   *
   * Entonces, ¿para qué queda? Fija el CONTRATO —recorrido completo, sin repetidos, y orden
   * total determinista por (fecha, id)— y falla si el día de mañana alguien cambia el orden
   * por uno que rompa esas propiedades de forma consistente. Lo que NO hace es demostrar por
   * sí sola la corrección del desempate; eso lo sostiene el razonamiento sobre SQL: sin un
   * criterio único, `ORDER BY` no define un orden total y `skip`/`take` sobre él es incorrecto
   * por definición, aunque un plan concreto lo disimule.
   *
   * Todas las salidas comparten `fechaSalida` A PROPÓSITO: con fechas distintas el orden sería
   * único por sí solo y la prueba no ejercitaría el desempate.
   */
  it('paginar el listado recorre TODAS las salidas exactamente una vez, aunque compartan la misma fecha', async () => {
    const cliente = await crearClienteDePrueba(contexto.prisma);
    const proyecto = await crearProyectoDePrueba(contexto.prisma, cliente.id);
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 1000 });
    const mismaFecha = new Date('2026-03-10');

    const idsCreados: number[] = [];
    for (let i = 0; i < 24; i += 1) {
      const salida = await crearSalidaDePrueba(contexto.prisma, {
        proyectoId: proyecto.id,
        lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1000 }],
        fechaSalida: mismaFecha,
      });
      idsCreados.push(salida.id);
    }

    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

    const porPagina = 2;
    const idsVistos: number[] = [];
    const totalPaginas = Math.ceil(idsCreados.length / porPagina);
    for (let pagina = 1; pagina <= totalPaginas; pagina += 1) {
      const respuesta = await request(servidor())
        .get('/api/salidas')
        .query({ pagina, porPagina })
        .set('Cookie', cookie);
      expect(respuesta.status).toBe(200);
      idsVistos.push(...(respuesta.body as { datos: { id: number }[] }).datos.map((fila) => fila.id));
    }

    // (1) Ni una repetida (el `Set` tendría menos elementos) ni una perdida.
    expect(new Set(idsVistos).size).toBe(idsCreados.length);
    expect([...idsVistos].sort((a, b) => a - b)).toEqual([...idsCreados].sort((a, b) => a - b));

    // (2) Orden total determinista: con la fecha empatada en TODAS las filas, el recorrido
    // completo debe salir estrictamente por id descendente. Es lo que garantiza el desempate
    // y lo que vuelve exacta la paginación.
    expect(idsVistos).toEqual([...idsCreados].sort((a, b) => b - a));
  });
});

/** Hace login por HTTP y devuelve la cookie de sesión lista para `.set('Cookie', …)` — mismo
 *  patrón local que el resto de suites de integración (cada una define su propio helper). */
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
