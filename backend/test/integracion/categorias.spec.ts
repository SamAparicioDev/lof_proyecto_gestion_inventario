/**
 * Pruebas de integración del CATÁLOGO DE CATEGORÍAS (T156, US15, FR-084…FR-089) — API completa
 * + PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Cubre lo que SOLO se puede verificar contra la base real (docs/arquitectura.md §8):
 *
 *  - **El duplicado lo decide el índice funcional `lower(btrim(nombre))`**, no el código.
 *  - **La FK `RESTRICT` desde `productos`**: una categoría en uso no se elimina (FR-087), y el
 *    mensaje dice cuántos productos la usan.
 *  - **Desactivar no desclasifica** (FR-086): la categoría deja de ofrecerse para clasificar,
 *    pero el producto que ya la tenía la conserva, y el filtro del inventario la sigue
 *    ofreciendo mientras algún producto la use (FR-088) — si no, un listado filtrado por una
 *    categoría dada de baja dejaría de ser reproducible.
 *  - **La migración conserva la clasificación existente** (FR-089).
 *
 * El filtro `?categoriaId=` del inventario y `opciones-filtro` tienen su prueba en
 * `filtros-listados.spec.ts` (US13/T132, actualizada por US15): aquí solo se comprueba lo que
 * esa suite no mira, que es el ciclo de vida del catálogo.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend`.
 */
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearCategoriaDePrueba,
  crearProductoDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

interface CategoriaBody {
  id: number;
  nombre: string;
  descripcion: string | null;
  estado: 'ACTIVA' | 'INACTIVA';
  cantidadProductos: number;
}

interface CuerpoError {
  error: { mensaje: string; campos?: Record<string, string> };
}

describe('Categorías — /api/categorias (T156, US15)', () => {
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

  /** Sesión de un Gerente, que tiene `categorias.gestionar` (ver la matriz del seed). */
  async function sesionGestora(): Promise<string> {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    return iniciarSesion(servidor(), usuario.login, usuario.password);
  }

  it('rechaza un duplicado que solo difiere en mayúsculas y espacios, señalando el campo nombre', async () => {
    const cookie = await sesionGestora();

    const primera = await request(servidor())
      .post('/api/categorias')
      .set('Cookie', cookie)
      .send({ nombre: 'Ferretería' });
    expect(primera.status).toBe(201);

    const duplicada = await request(servidor())
      .post('/api/categorias')
      .set('Cookie', cookie)
      .send({ nombre: '  FERRETERÍA ' });

    expect(duplicada.status).toBe(400);
    expect((duplicada.body as CuerpoError).error.campos?.nombre).toContain('Ferretería');
  });

  it('trata "Ferreteria" y "Ferretería" como categorías DISTINTAS: las tildes sí distinguen (FR-085)', async () => {
    const cookie = await sesionGestora();

    const sinTilde = await request(servidor()).post('/api/categorias').set('Cookie', cookie).send({ nombre: 'Ferreteria' });
    const conTilde = await request(servidor()).post('/api/categorias').set('Cookie', cookie).send({ nombre: 'Ferretería' });

    // Decisión consciente: el índice es `lower(btrim(nombre))` a secas, sin `unaccent`. Si algún
    // día se agrega, esta prueba falla — que es exactamente donde debe discutirse el cambio.
    expect(sinTilde.status).toBe(201);
    expect(conTilde.status).toBe(201);
  });

  it('no elimina una categoría en uso y dice cuántos productos la usan (FR-087)', async () => {
    const cookie = await sesionGestora();
    const usuarioTecnico = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const categoriaId = await crearCategoriaDePrueba(contexto.prisma, 'Cementos', usuarioTecnico.id);
    await crearProductoDePrueba(contexto.prisma, { categoriaId, usuarioCreacionId: usuarioTecnico.id });
    await crearProductoDePrueba(contexto.prisma, { categoriaId, usuarioCreacionId: usuarioTecnico.id });

    const borrado = await request(servidor()).delete(`/api/categorias/${categoriaId}`).set('Cookie', cookie);

    expect(borrado.status).toBe(409);
    expect((borrado.body as CuerpoError).error.mensaje).toContain('2 productos');
  });

  it('elimina de verdad una categoría que nadie usa: es la excepción deliberada a "nada se borra"', async () => {
    const cookie = await sesionGestora();

    const creada = await request(servidor())
      .post('/api/categorias')
      .set('Cookie', cookie)
      .send({ nombre: 'Creada por error' });
    expect(creada.status).toBe(201);

    const borrado = await request(servidor()).delete(`/api/categorias/${creada.body.id}`).set('Cookie', cookie);
    expect(borrado.status).toBe(204);

    const listado = await request(servidor()).get('/api/categorias').set('Cookie', cookie);
    expect((listado.body as CategoriaBody[]).map((categoria) => categoria.id)).not.toContain(creada.body.id);
  });

  it('desactivar deja de ofrecerla para clasificar, pero el producto la conserva y el filtro la sigue mostrando', async () => {
    const cookie = await sesionGestora();
    const usuarioTecnico = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
    const categoriaId = await crearCategoriaDePrueba(contexto.prisma, 'Descontinuados', usuarioTecnico.id);
    const producto = await crearProductoDePrueba(contexto.prisma, {
      categoriaId,
      usuarioCreacionId: usuarioTecnico.id,
    });

    const desactivada = await request(servidor())
      .put(`/api/categorias/${categoriaId}/estado`)
      .set('Cookie', cookie)
      .send({ estado: 'INACTIVA' });
    expect(desactivada.status).toBe(204);

    // 1) Ya no se ofrece para clasificar: el selector pide `?estado=ACTIVA` (FR-086).
    const activas = await request(servidor()).get('/api/categorias?estado=ACTIVA').set('Cookie', cookie);
    expect((activas.body as CategoriaBody[]).map((c) => c.id)).not.toContain(categoriaId);

    // 2) El producto NO pierde su clasificación.
    const ficha = await request(servidor()).get(`/api/inventario/${producto.id}`).set('Cookie', cookie);
    expect(ficha.status).toBe(200);
    expect(ficha.body.producto.categoria).toEqual({ id: categoriaId, nombre: 'Descontinuados' });

    // 3) Y el filtro del inventario la sigue ofreciendo mientras algún producto la use (FR-088):
    //    de lo contrario, un listado filtrado por ella dejaría de poder reproducirse.
    const opciones = await request(servidor()).get('/api/inventario/opciones-filtro').set('Cookie', cookie);
    expect(opciones.status).toBe(200);
    expect((opciones.body.categorias as { id: number }[]).map((c) => c.id)).toContain(categoriaId);
  });

  it('renombrar una categoría para corregir su tipografía no se considera duplicado', async () => {
    const cookie = await sesionGestora();

    const creada = await request(servidor()).post('/api/categorias').set('Cookie', cookie).send({ nombre: 'ferreteria' });
    const renombrada = await request(servidor())
      .put(`/api/categorias/${creada.body.id}`)
      .set('Cookie', cookie)
      .send({ nombre: 'Ferretería' });

    // Compararse contra sí misma no es chocar: es justo lo que la historia quiere permitir.
    expect(renombrada.status).toBe(204);
  });

  /**
   * FR-089 — la migración `20260814235000_categorias_como_catalogo` NO pierde la clasificación.
   *
   * Se verifica sobre el resultado YA aplicado a esta base: lo que importa es que la estructura
   * resultante sea la del catálogo (FK opcional hacia `categorias`) y que no quede rastro de la
   * columna de texto que podría reintroducir variantes tipográficas.
   */
  it('la migración dejó `productos.categoria_id` (opcional) y retiró la columna de texto', async () => {
    const columnas = await contexto.prisma.$queryRaw<Array<{ column_name: string; is_nullable: string }>>`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'productos' AND column_name IN ('categoria', 'categoria_id')
    `;

    const porNombre = new Map(columnas.map((columna) => [columna.column_name, columna.is_nullable]));
    expect(porNombre.get('categoria_id')).toBe('YES'); // la categoría sigue siendo OPCIONAL (FR-086)
    expect(porNombre.has('categoria')).toBe(false); // el texto libre se retiró (FR-089)
  });

  it('el Operario puede LEER el catálogo (lo necesita para clasificar y filtrar) pero no administrarlo', async () => {
    const operario = await crearUsuarioDePrueba(contexto, { rol: 'OPERARIO' });
    const cookie = await iniciarSesion(servidor(), operario.login, operario.password);

    const lectura = await request(servidor()).get('/api/categorias').set('Cookie', cookie);
    expect(lectura.status).toBe(200);

    const alta = await request(servidor())
      .post('/api/categorias')
      .set('Cookie', cookie)
      .send({ nombre: 'Categoría del Operario' });
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
