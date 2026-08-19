/**
 * Pruebas de integración del CATÁLOGO DE PROVEEDORES (T163, US15, FR-091…FR-093) — API completa
 * + PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Cubre lo que SOLO se puede verificar contra la base real (docs/arquitectura.md §8):
 *
 *  - **El duplicado lo decide el índice funcional `lower(btrim(nombre))`**, no el código: por eso
 *    la prueba lo ataca con mayúsculas y espacios, y comprueba además que las TILDES no se
 *    normalizan (decisión consciente de FR-085, heredada por FR-091 — con `unaccent` sería otra
 *    cosa, y una prueba que lo diera por hecho ocultaría el día que cambie).
 *  - **La FK `RESTRICT` desde `ingresos`**: un proveedor en uso no se elimina, y el mensaje dice
 *    cuántos ingresos lo usan.
 *  - **La protección del proveedor del sistema** (FR-093): ni se renombra ni se borra, porque la
 *    carga masiva lo resuelve por nombre.
 *  - **La migración conserva el proveedor de los ingresos previos** (FR-092) — se verifica sobre
 *    el resultado de la migración ya aplicada a esta base, no simulándola.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend`.
 */
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearProductoDePrueba,
  crearProveedorDelSistemaDePrueba,
  crearProveedorDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  NOMBRE_PROVEEDOR_DEL_SISTEMA,
  type AppDePrueba,
} from './setup';

interface ProveedorBody {
  id: number;
  nombre: string;
  nit: string | null;
  telefono: string | null;
  email: string | null;
  estado: 'ACTIVO' | 'INACTIVO';
  esSistema: boolean;
  cantidadIngresos: number;
}

interface CuerpoError {
  error: { mensaje: string; campos?: Record<string, string> };
}

describe('Proveedores — /api/proveedores (T163, US15)', () => {
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

  /** Sesión de un Gerente, que tiene `proveedores.gestionar` (ver la matriz del seed). */
  async function sesionGestora(): Promise<string> {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    return iniciarSesion(servidor(), usuario.login, usuario.password);
  }

  it('rechaza un duplicado que solo difiere en mayúsculas y espacios, señalando el campo nombre', async () => {
    const cookie = await sesionGestora();

    const primero = await request(servidor())
      .post('/api/proveedores')
      .set('Cookie', cookie)
      .send({ nombre: 'Formex' });
    expect(primero.status).toBe(201);

    const duplicado = await request(servidor())
      .post('/api/proveedores')
      .set('Cookie', cookie)
      .send({ nombre: '  formex ' });

    expect(duplicado.status).toBe(400);
    const cuerpo = duplicado.body as CuerpoError;
    // El mensaje nombra al proveedor EXISTENTE tal como se escribió: es la información que le
    // falta al usuario para entender por qué se le rechaza algo que él ve distinto.
    expect(cuerpo.error.campos?.nombre).toContain('Formex');

    const listado = await request(servidor()).get('/api/proveedores').set('Cookie', cookie);
    expect((listado.body as ProveedorBody[]).filter((p) => p.nombre.trim().toLowerCase() === 'formex')).toHaveLength(1);
  });

  /**
   * Las tildes NO se normalizan (FR-085, heredada por FR-091): el índice funcional es
   * `lower(btrim(nombre))` a secas. Esta prueba fija esa decisión — si algún día se agrega
   * `unaccent`, fallará aquí, que es exactamente donde debe discutirse el cambio.
   */
  it('trata "Ferreteria" y "Ferretería" como proveedores DISTINTOS: las tildes sí distinguen', async () => {
    const cookie = await sesionGestora();

    const sinTilde = await request(servidor())
      .post('/api/proveedores')
      .set('Cookie', cookie)
      .send({ nombre: 'Ferreteria del Norte' });
    const conTilde = await request(servidor())
      .post('/api/proveedores')
      .set('Cookie', cookie)
      .send({ nombre: 'Ferretería del Norte' });

    expect(sinTilde.status).toBe(201);
    expect(conTilde.status).toBe(201);
  });

  it('no elimina un proveedor con ingresos y dice cuántos lo usan; desactivarlo sí funciona', async () => {
    const cookie = await sesionGestora();
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });
    const proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor Con Historial');

    const ingreso = await request(servidor())
      .post('/api/ingresos')
      .set('Cookie', cookie)
      .send({
        numeroFactura: 'FAC-PROV-0001',
        fechaFactura: '2026-03-01',
        proveedorId,
        fechaRecepcion: '2026-03-02',
        lineas: [{ productoId: producto.id, cantidad: 5, precioUnitario: 1_000 }],
      });
    expect(ingreso.status).toBe(201);

    const borrado = await request(servidor()).delete(`/api/proveedores/${proveedorId}`).set('Cookie', cookie);
    expect(borrado.status).toBe(409);
    expect((borrado.body as CuerpoError).error.mensaje).toContain('1 ingreso');

    // La vía correcta es la baja lógica, y el ingreso conserva su proveedor (FR-091 → FR-086).
    const desactivado = await request(servidor())
      .put(`/api/proveedores/${proveedorId}/estado`)
      .set('Cookie', cookie)
      .send({ estado: 'INACTIVO' });
    expect(desactivado.status).toBe(204);

    const detalle = await request(servidor()).get(`/api/ingresos/${ingreso.body.id}`).set('Cookie', cookie);
    expect(detalle.status).toBe(200);
    expect(detalle.body.proveedor).toEqual({ id: proveedorId, nombre: 'Proveedor Con Historial' });
  });

  it('rechaza asignar un proveedor INACTIVO a un ingreso nuevo, señalando el campo', async () => {
    const cookie = await sesionGestora();
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });
    const proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Proveedor Retirado');
    await request(servidor())
      .put(`/api/proveedores/${proveedorId}/estado`)
      .set('Cookie', cookie)
      .send({ estado: 'INACTIVO' });

    const intento = await request(servidor())
      .post('/api/ingresos')
      .set('Cookie', cookie)
      .send({
        numeroFactura: 'FAC-PROV-INACTIVO',
        fechaFactura: '2026-03-01',
        proveedorId,
        fechaRecepcion: '2026-03-02',
        lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1_000 }],
      });

    expect(intento.status).toBe(400);
    expect((intento.body as CuerpoError).error.campos?.proveedorId).toContain('inactivo');
  });

  describe('proveedor del sistema (FR-093)', () => {
    it('no se renombra ni se elimina, pero sus datos de contacto sí se corrigen', async () => {
      const cookie = await sesionGestora();
      const idSistema = await crearProveedorDelSistemaDePrueba(contexto.prisma);

      const renombrado = await request(servidor())
        .put(`/api/proveedores/${idSistema}`)
        .set('Cookie', cookie)
        .send({ nombre: 'Otro nombre cualquiera' });
      expect(renombrado.status).toBe(409);
      expect((renombrado.body as CuerpoError).error.mensaje).toContain('carga masiva');

      const borrado = await request(servidor()).delete(`/api/proveedores/${idSistema}`).set('Cookie', cookie);
      expect(borrado.status).toBe(409);

      // Mismo nombre + contacto nuevo: se acepta. Es lo que separa "protegido" de "congelado".
      const contacto = await request(servidor())
        .put(`/api/proveedores/${idSistema}`)
        .set('Cookie', cookie)
        .send({ nombre: NOMBRE_PROVEEDOR_DEL_SISTEMA, telefono: '601 555 0000' });
      expect(contacto.status).toBe(204);

      const listado = await request(servidor()).get('/api/proveedores').set('Cookie', cookie);
      const delSistema = (listado.body as ProveedorBody[]).find((p) => p.id === idSistema);
      expect(delSistema?.nombre).toBe(NOMBRE_PROVEEDOR_DEL_SISTEMA);
      expect(delSistema?.telefono).toBe('601 555 0000');
      expect(delSistema?.esSistema).toBe(true);
    });

    it('acepta corregir mayúsculas o espacios del nombre: eso no es renombrar', async () => {
      const cookie = await sesionGestora();
      const idSistema = await crearProveedorDelSistemaDePrueba(contexto.prisma);

      const corregido = await request(servidor())
        .put(`/api/proveedores/${idSistema}`)
        .set('Cookie', cookie)
        .send({ nombre: `  ${NOMBRE_PROVEEDOR_DEL_SISTEMA}  ` });

      // El nombre normalizado no cambia, así que la resolución por nombre de la importación
      // sigue funcionando y no hay motivo para rechazarlo.
      expect(corregido.status).toBe(204);
    });
  });

  /**
   * FR-092 — la migración `20260815010000_proveedores_como_catalogo` NO pierde ningún dato.
   *
   * Se verifica sobre el resultado YA aplicado a esta base, no simulando la migración: lo que
   * importa es que la estructura resultante haga IMPOSIBLE un ingreso sin proveedor, que es la
   * garantía que el `SET NOT NULL` posterior al relleno vino a dar.
   */
  it('la migración retiró la columna de texto y la exigencia de proveedor vive ahora en el CHECK por tipo', async () => {
    const columnas = await contexto.prisma.$queryRaw<Array<{ column_name: string; is_nullable: string }>>`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'ingresos' AND column_name IN ('proveedor', 'proveedor_id')
    `;

    const porNombre = new Map(columnas.map((columna) => [columna.column_name, columna.is_nullable]));
    expect(porNombre.has('proveedor')).toBe(false); // el texto libre se retiró (FR-092)

    // US29 (FR-126) cambió DÓNDE vive la garantía, no la garantía: la columna admite NULL porque
    // un AJUSTE de inventario no se le compra a nadie, y quien exige el proveedor en los ingresos
    // de FACTURA es `ingresos_tipo_check`. Antes esta prueba comprobaba el NOT NULL de la
    // columna; comprobarlo hoy sería exigir que un ajuste tuviera proveedor de relleno, que es
    // exactamente lo que la historia vino a quitar.
    expect(porNombre.get('proveedor_id')).toBe('YES');

    const restricciones = await contexto.prisma.$queryRaw<Array<{ definicion: string }>>`
      SELECT pg_get_constraintdef(oid) AS definicion
      FROM pg_constraint
      WHERE conrelid = 'ingresos'::regclass AND conname = 'ingresos_tipo_check'
    `;
    expect(restricciones).toHaveLength(1);
    expect(restricciones[0]?.definicion).toContain('proveedor_id');
    // La garantía de fondo la sigue demostrando la prueba de abajo, insertando el NULL a mano.
  });

  it('un ingreso no puede quedarse sin proveedor: la base rechaza el NULL', async () => {
    const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });

    await expect(
      contexto.prisma.$executeRaw`
        INSERT INTO ingresos (numero_factura, fecha_factura, proveedor_id, fecha_recepcion, usuario_registra_id, usuario_creacion_id)
        VALUES ('FAC-SIN-PROVEEDOR', DATE '2026-03-01', NULL, DATE '2026-03-02', ${usuario.id}::bigint, ${usuario.id}::bigint)
      `,
    ).rejects.toThrow();

    // El producto solo está para dejar constancia de que la prueba no dependió de líneas.
    expect(producto.id).toBeGreaterThan(0);
  });

  it('el Operario puede LEER el catálogo (lo necesita para registrar ingresos) pero no administrarlo', async () => {
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), operario.login, operario.password);

    const lectura = await request(servidor()).get('/api/proveedores').set('Cookie', cookie);
    expect(lectura.status).toBe(200);

    const alta = await request(servidor())
      .post('/api/proveedores')
      .set('Cookie', cookie)
      .send({ nombre: 'Proveedor Del Operario' });
    expect(alta.status).toBe(403);
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
