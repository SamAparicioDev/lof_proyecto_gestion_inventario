/**
 * Pruebas de integración del CATÁLOGO DE UNIDADES DE MEDIDA (T185, US17, FR-101…FR-105) — API
 * completa + PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Cubre lo que SOLO se puede verificar contra la base real (docs/arquitectura.md §8):
 *
 *  - **Las DOS unicidades son índices funcionales independientes** (`lower(btrim(nombre))` y
 *    `lower(btrim(abreviatura))`): cada duplicado tiene que señalar SU campo, porque mandar al
 *    usuario a corregir el nombre cuando lo que chocó fue la abreviatura es peor que no decirle
 *    nada. Y las TILDES no se normalizan, decisión heredada de FR-085.
 *  - **La FK `RESTRICT` desde `productos`**: una unidad en uso no se elimina.
 *  - **La obligatoriedad del campo en el producto** (FR-102/FR-103), que es lo que de verdad
 *    justifica la historia: no se da de alta un producto sin unidad, y un producto ANTERIOR a
 *    US17 —que existe con la columna en `NULL`— no se puede guardar tras editarlo sin
 *    completarla. Ese "producto antiguo" no se simula: `crearProductoDePrueba` lo siembra
 *    exactamente como quedaron los suyos, con la columna nula.
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
  crearUnidadMedidaDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

interface UnidadBody {
  id: number;
  nombre: string;
  abreviatura: string;
  estado: 'ACTIVA' | 'INACTIVA';
  cantidadProductos: number;
}

interface CuerpoError {
  error: { mensaje: string; campos?: Record<string, string> };
}

describe('Unidades de medida — /api/unidades-medida (T185, US17)', () => {
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

  /** Sesión de un Gerente, que tiene `unidades_medida.gestionar` (ver la matriz del seed). */
  async function sesionGestora(): Promise<string> {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    return iniciarSesion(servidor(), usuario.login, usuario.password);
  }

  describe('las dos unicidades (FR-101)', () => {
    it('rechaza un duplicado de NOMBRE que solo difiere en mayúsculas y espacios, señalando `nombre`', async () => {
      const cookie = await sesionGestora();

      const primero = await request(servidor())
        .post('/api/unidades-medida')
        .set('Cookie', cookie)
        .send({ nombre: 'Kilogramo', abreviatura: 'kg' });
      expect(primero.status).toBe(201);

      const duplicado = await request(servidor())
        .post('/api/unidades-medida')
        .set('Cookie', cookie)
        .send({ nombre: '  kilogramo ', abreviatura: 'kgm' });

      expect(duplicado.status).toBe(400);
      const cuerpo = duplicado.body as CuerpoError;
      expect(cuerpo.error.campos?.nombre).toContain('Kilogramo');
      expect(cuerpo.error.campos?.abreviatura).toBeUndefined();
    });

    /**
     * El caso que hace falta que exista este catálogo con DOS textos: el nombre está libre y el
     * choque es solo de abreviatura. Si el error se anclara a `nombre`, el usuario cambiaría lo
     * único que ya tenía bien.
     */
    it('rechaza un duplicado de ABREVIATURA con el nombre libre, señalando `abreviatura`', async () => {
      const cookie = await sesionGestora();

      await request(servidor())
        .post('/api/unidades-medida')
        .set('Cookie', cookie)
        .send({ nombre: 'Kilogramo', abreviatura: 'kg' });

      const duplicado = await request(servidor())
        .post('/api/unidades-medida')
        .set('Cookie', cookie)
        .send({ nombre: 'Kilo Gramo Fuerza', abreviatura: 'KG ' });

      expect(duplicado.status).toBe(400);
      const cuerpo = duplicado.body as CuerpoError;
      // El mensaje nombra la unidad EXISTENTE que ya usa esa abreviatura: es lo que le falta al
      // usuario para entender por qué se le rechaza algo que él ve distinto.
      expect(cuerpo.error.campos?.abreviatura).toContain('Kilogramo');
      expect(cuerpo.error.campos?.nombre).toBeUndefined();
    });

    /** Las tildes NO se normalizan (FR-085, heredada por FR-101): el índice es `lower(btrim(x))`
     *  a secas. Esta prueba fija la decisión — si algún día entra `unaccent`, falla aquí. */
    it('trata "Metro cubico" y "Metro cúbico" como unidades DISTINTAS', async () => {
      const cookie = await sesionGestora();

      const sinTilde = await request(servidor())
        .post('/api/unidades-medida')
        .set('Cookie', cookie)
        .send({ nombre: 'Metro cubico', abreviatura: 'm3' });
      const conTilde = await request(servidor())
        .post('/api/unidades-medida')
        .set('Cookie', cookie)
        .send({ nombre: 'Metro cúbico', abreviatura: 'm³' });

      expect(sinTilde.status).toBe(201);
      expect(conTilde.status).toBe(201);
    });

    it('permite corregir solo las mayúsculas de una unidad: editarla no choca consigo misma', async () => {
      const cookie = await sesionGestora();
      const creada = await request(servidor())
        .post('/api/unidades-medida')
        .set('Cookie', cookie)
        .send({ nombre: 'kilogramo', abreviatura: 'kg' });

      const corregida = await request(servidor())
        .put(`/api/unidades-medida/${creada.body.id}`)
        .set('Cookie', cookie)
        .send({ nombre: 'Kilogramo', abreviatura: 'kg' });

      expect(corregida.status).toBe(204);
    });
  });

  it('no elimina una unidad usada por productos y dice cuántos la usan; desactivarla sí funciona', async () => {
    const cookie = await sesionGestora();
    const unidadId = await crearUnidadMedidaDePrueba(contexto.prisma, 'Bulto', 'bulto');
    await crearProductoDePrueba(contexto.prisma, { unidadMedidaId: unidadId });

    const borrado = await request(servidor()).delete(`/api/unidades-medida/${unidadId}`).set('Cookie', cookie);
    expect(borrado.status).toBe(409);
    expect((borrado.body as CuerpoError).error.mensaje).toContain('1 producto');

    // La vía correcta es la baja lógica, y el producto conserva su unidad (FR-101 → FR-086).
    const desactivada = await request(servidor())
      .put(`/api/unidades-medida/${unidadId}/estado`)
      .set('Cookie', cookie)
      .send({ estado: 'INACTIVA' });
    expect(desactivada.status).toBe(204);

    const listado = await request(servidor()).get('/api/unidades-medida').set('Cookie', cookie);
    const bulto = (listado.body as UnidadBody[]).find((unidad) => unidad.id === unidadId);
    expect(bulto).toMatchObject({ estado: 'INACTIVA', cantidadProductos: 1 });
  });

  it('elimina de verdad una unidad que ningún producto usa (creada por error)', async () => {
    const cookie = await sesionGestora();
    const unidadId = await crearUnidadMedidaDePrueba(contexto.prisma, 'Kilogramoo', 'kgg');

    const borrado = await request(servidor()).delete(`/api/unidades-medida/${unidadId}`).set('Cookie', cookie);
    expect(borrado.status).toBe(204);

    const quedan = await contexto.prisma.unidadMedida.count({ where: { id: BigInt(unidadId) } });
    expect(quedan).toBe(0);
  });

  describe('la unidad en el producto (FR-102/FR-103)', () => {
    it('no da de alta un producto sin unidad, y sí con una activa', async () => {
      const cookie = await sesionGestora();
      const unidadId = await crearUnidadMedidaDePrueba(contexto.prisma, 'Unidad', 'und');

      const sinUnidad = await request(servidor())
        .post('/api/productos')
        .set('Cookie', cookie)
        .send({ sku: 'PROD-SIN-UNIDAD', descripcion: 'Producto sin unidad', umbralStockBajo: 0 });
      expect(sinUnidad.status).toBe(400);
      expect((sinUnidad.body as CuerpoError).error.campos?.unidadMedidaId).toBeDefined();

      const conUnidad = await request(servidor())
        .post('/api/productos')
        .set('Cookie', cookie)
        .send({
          sku: 'PROD-CON-UNIDAD',
          descripcion: 'Producto con unidad',
          unidadMedidaId: unidadId,
          umbralStockBajo: 0,
        });
      expect(conUnidad.status).toBe(201);

      const ficha = await request(servidor()).get(`/api/inventario/${conUnidad.body.id}`).set('Cookie', cookie);
      expect(ficha.body.producto.unidadMedida).toEqual({ id: unidadId, nombre: 'Unidad', abreviatura: 'und' });
    });

    it('rechaza dar de alta un producto con una unidad INACTIVA, nombrándola', async () => {
      const cookie = await sesionGestora();
      const unidadId = await crearUnidadMedidaDePrueba(contexto.prisma, 'Arroba', '@');
      await request(servidor())
        .put(`/api/unidades-medida/${unidadId}/estado`)
        .set('Cookie', cookie)
        .send({ estado: 'INACTIVA' });

      const intento = await request(servidor())
        .post('/api/productos')
        .set('Cookie', cookie)
        .send({
          sku: 'PROD-UNIDAD-INACTIVA',
          descripcion: 'Producto con unidad retirada',
          unidadMedidaId: unidadId,
          umbralStockBajo: 0,
        });

      expect(intento.status).toBe(400);
      expect((intento.body as CuerpoError).error.campos?.unidadMedidaId).toContain('Arroba');
    });

    /**
     * US17-AS3, el corazón de FR-103: el producto ANTIGUO se consulta y se mueve con
     * normalidad, pero no se guarda tras editarlo sin decidir su unidad. Es la ocasión en la que
     * alguien la decide, y por eso la limpieza ocurre con el uso.
     */
    it('un producto ANTERIOR a US17 se lee con `unidadMedida: null` pero no se guarda sin completarla', async () => {
      const cookie = await sesionGestora();
      const antiguo = await crearProductoDePrueba(contexto.prisma, { descripcion: 'Producto de antes' });

      const ficha = await request(servidor()).get(`/api/inventario/${antiguo.id}`).set('Cookie', cookie);
      expect(ficha.status).toBe(200);
      expect(ficha.body.producto.unidadMedida).toBeNull();

      const sinCompletar = await request(servidor())
        .put(`/api/productos/${antiguo.id}`)
        .set('Cookie', cookie)
        .send({ descripcion: 'Descripción corregida', umbralStockBajo: 0 });
      expect(sinCompletar.status).toBe(400);
      expect((sinCompletar.body as CuerpoError).error.campos?.unidadMedidaId).toBeDefined();

      // Y no se guardó NADA: rechazar la edición no puede dejar a medias el resto de campos.
      const intacto = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(antiguo.id) } });
      expect(intacto.descripcion).toBe('Producto de antes');

      const unidadId = await crearUnidadMedidaDePrueba(contexto.prisma, 'Galón', 'gal');
      const completado = await request(servidor())
        .put(`/api/productos/${antiguo.id}`)
        .set('Cookie', cookie)
        .send({ descripcion: 'Descripción corregida', unidadMedidaId: unidadId, umbralStockBajo: 0 });
      expect(completado.status).toBe(204);
    });

    /**
     * Desactivar una unidad impide ASIGNARLA, no bloquea al producto que ya la referencia (mismo
     * principio que FR-086 para categorías). Sin esta excepción bastaría con retirar "Bulto" del
     * catálogo para que ningún producto medido en bultos pudiera volver a editarse: corregir su
     * descripción exigiría cambiarle la unidad, que es otro dato y que nadie pidió tocar.
     */
    it('deja editar un producto cuya unidad fue desactivada, si reenvía esa misma unidad', async () => {
      const cookie = await sesionGestora();
      const unidadId = await crearUnidadMedidaDePrueba(contexto.prisma, 'Bulto', 'bulto');
      const producto = await crearProductoDePrueba(contexto.prisma, { unidadMedidaId: unidadId });

      await request(servidor())
        .put(`/api/unidades-medida/${unidadId}/estado`)
        .set('Cookie', cookie)
        .send({ estado: 'INACTIVA' });

      const editado = await request(servidor())
        .put(`/api/productos/${producto.id}`)
        .set('Cookie', cookie)
        .send({ descripcion: 'Otra descripción', unidadMedidaId: unidadId, umbralStockBajo: 0 });
      expect(editado.status).toBe(204);

      // Pero CAMBIARLA a otra inactiva sigue prohibido: la excepción es solo para la suya.
      const otraInactiva = await crearUnidadMedidaDePrueba(contexto.prisma, 'Tonelada', 't');
      await request(servidor())
        .put(`/api/unidades-medida/${otraInactiva}/estado`)
        .set('Cookie', cookie)
        .send({ estado: 'INACTIVA' });

      const cambio = await request(servidor())
        .put(`/api/productos/${producto.id}`)
        .set('Cookie', cookie)
        .send({ descripcion: 'Otra descripción', unidadMedidaId: otraInactiva, umbralStockBajo: 0 });
      expect(cambio.status).toBe(400);
      expect((cambio.body as CuerpoError).error.campos?.unidadMedidaId).toContain('Tonelada');
    });
  });

  it('el Operario puede LEER el catálogo (lo necesita para dar de alta productos) pero no administrarlo', async () => {
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), operario.login, operario.password);

    const lectura = await request(servidor()).get('/api/unidades-medida').set('Cookie', cookie);
    expect(lectura.status).toBe(200);

    const alta = await request(servidor())
      .post('/api/unidades-medida')
      .set('Cookie', cookie)
      .send({ nombre: 'Unidad del operario', abreviatura: 'uop' });
    expect(alta.status).toBe(403);
  });

  it('el filtro `estado=ACTIVA` es el que alimenta el selector: no devuelve las retiradas', async () => {
    const cookie = await sesionGestora();
    const activa = await crearUnidadMedidaDePrueba(contexto.prisma, 'Metro', 'm');
    const retirada = await crearUnidadMedidaDePrueba(contexto.prisma, 'Vara', 'vr');
    await request(servidor())
      .put(`/api/unidades-medida/${retirada}/estado`)
      .set('Cookie', cookie)
      .send({ estado: 'INACTIVA' });

    const soloActivas = await request(servidor()).get('/api/unidades-medida?estado=ACTIVA').set('Cookie', cookie);
    const ids = (soloActivas.body as UnidadBody[]).map((unidad) => unidad.id);

    expect(ids).toContain(activa);
    expect(ids).not.toContain(retirada);

    // Sin filtro salen las dos: la pantalla de administración necesita ver las inactivas para
    // poder reactivarlas.
    const todas = await request(servidor()).get('/api/unidades-medida').set('Cookie', cookie);
    expect((todas.body as UnidadBody[]).map((unidad) => unidad.id)).toEqual(expect.arrayContaining([activa, retirada]));
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
