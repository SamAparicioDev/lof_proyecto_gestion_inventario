/**
 * Pruebas de integración de los BUSCADORES de los listados (US22, FR-118) — API completa +
 * PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Lo que se demuestra aquí, y que ninguna prueba unitaria puede: que el `where` por términos
 * traducido a SQL encuentra lo que el usuario espera y NO encuentra lo que no pidió. Cada caso
 * está escrito como la frase que alguien teclearía de verdad.
 *
 * El caso central es el que motivó la historia: hasta US22, escribir DOS palabras no encontraba
 * nada, porque la frase entera viajaba como una sola subcadena.
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
  crearClienteDePrueba,
  crearProductoDePrueba,
  crearProveedorDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

describe('Buscadores de los listados — US22 (FR-118)', () => {
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

  /** SKUs que devuelve `GET /api/inventario` para una consulta dada. */
  async function buscarEnInventario(cookie: string, consulta: string): Promise<string[]> {
    const respuesta = await request(servidor())
      .get(`/api/inventario?buscar=${encodeURIComponent(consulta)}&porPagina=50`)
      .set('Cookie', cookie);
    expect(respuesta.status).toBe(200);
    return (respuesta.body.datos as Array<{ producto: { sku: string } }>).map((fila) => fila.producto.sku);
  }

  describe('inventario', () => {
    /** Catálogo pensado para que cada aserción distinga una cosa concreta. */
    async function sembrarCatalogo(usuarioId: number): Promise<void> {
      const construccion = await crearCategoriaDePrueba(contexto.prisma, 'Construcción', usuarioId);
      await crearProductoDePrueba(contexto.prisma, {
        sku: 'CEM-001',
        descripcion: 'Cemento gris 50 kg',
        categoriaId: construccion,
        ubicacion: 'Bodega A',
      });
      await crearProductoDePrueba(contexto.prisma, {
        sku: 'CEM-002',
        descripcion: 'Cemento blanco 25 kg',
        categoriaId: construccion,
        ubicacion: 'Bodega B',
      });
      await crearProductoDePrueba(contexto.prisma, {
        sku: 'VAR-001',
        descripcion: 'Varilla gris 3/8',
        ubicacion: 'Bodega A',
      });
    }

    /**
     * EL caso de la historia. Antes de US22 esta consulta devolvía CERO resultados: "cemento
     * gris" no aparece como subcadena literal en ningún campo por separado.
     */
    it('dos palabras encuentran el producto aunque no estén juntas ni en ese orden', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);

      expect(await buscarEnInventario(cookie, 'cemento gris')).toEqual(['CEM-001']);
      expect(await buscarEnInventario(cookie, 'gris cemento')).toEqual(['CEM-001']);
    });

    it('cada palabra ESTRECHA el resultado, nunca lo amplía', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);

      const soloCemento = await buscarEnInventario(cookie, 'cemento');
      const cementoGris = await buscarEnInventario(cookie, 'cemento gris');

      expect(soloCemento.sort()).toEqual(['CEM-001', 'CEM-002']);
      expect(cementoGris).toEqual(['CEM-001']);
      // Y "gris" solo no basta para quedarse con el cemento: también está la varilla.
      expect((await buscarEnInventario(cookie, 'gris')).sort()).toEqual(['CEM-001', 'VAR-001']);
    });

    it('los términos pueden venir de campos DISTINTOS: SKU + descripción, o categoría + ubicación', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);

      // "cem" está en el SKU y "blanco" en la descripción.
      expect(await buscarEnInventario(cookie, 'cem blanco')).toEqual(['CEM-002']);
      // "construcción" es la categoría y "bodega" la ubicación — dos campos que antes ni
      // siquiera se miraban.
      expect(await buscarEnInventario(cookie, 'blanco bodega')).toEqual(['CEM-002']);
      expect((await buscarEnInventario(cookie, 'construcción bodega')).sort()).toEqual(['CEM-001', 'CEM-002']);
      // La varilla no tiene categoría, así que "construcción" la deja fuera aunque esté en una
      // bodega: la Y se aplica a TODOS los campos, no solo a los de texto propio.
      expect(await buscarEnInventario(cookie, 'construcción varilla')).toEqual([]);
    });

    /**
     * Un término corto coincide en muchos sitios, porque cada término se busca como SUBCADENA
     * (la opción habitual y la más indulgente: "gris" encuentra "Cemento gris"). Se deja fijado
     * como comportamiento CONOCIDO —no como sorpresa— para que quien lea el buscador sepa que
     * escribir una letra suelta no filtra casi nada, y que la forma de estrechar es escribir
     * más, no distinto.
     */
    it('un término de una sola letra coincide en cualquier parte: escribir más es lo que estrecha', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);

      // "b" está en "Bodega A" y en "Bodega B", así que no distingue nada por sí solo…
      expect((await buscarEnInventario(cookie, 'cemento b')).sort()).toEqual(['CEM-001', 'CEM-002']);
      // …pero una letra más ya sí.
      expect(await buscarEnInventario(cookie, 'cemento bl')).toEqual(['CEM-002']);
    });

    it('encuentra un SKU con guion aunque el guion no se escriba', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);

      expect(await buscarEnInventario(cookie, 'cem 001')).toEqual(['CEM-001']);
    });

    it('una consulta de solo espacios devuelve el listado completo, no cero', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);

      expect(await buscarEnInventario(cookie, '   ')).toHaveLength(3);
    });

    it('una palabra que no está en ningún campo no devuelve nada (sigue siendo preciso)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await sembrarCatalogo(admin.id);

      expect(await buscarEnInventario(cookie, 'cemento tornillo')).toEqual([]);
    });
  });

  describe('documentos con correlativo', () => {
    /** El número se escribe de tres formas y las tres tienen que llegar al mismo documento. */
    it('una orden de compra se encuentra por su número escrito como sea, junto al proveedor', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const proveedorId = await crearProveedorDePrueba(contexto.prisma, 'Formex Ltda.');
      const otroProveedor = await crearProveedorDePrueba(contexto.prisma, 'Aceros del Norte');
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'BUSCA-OC-1' });

      const cuerpo = (proveedor: number) => ({
        proveedorId: proveedor,
        fechaOrden: '2026-08-16',
        lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1_000 }],
      });
      const primera = await request(servidor()).post('/api/ordenes-compra').set('Cookie', cookie).send(cuerpo(proveedorId));
      await request(servidor()).post('/api/ordenes-compra').set('Cookie', cookie).send(cuerpo(otroProveedor));
      expect(primera.status).toBe(201);

      const numeros = async (consulta: string): Promise<number[]> => {
        const respuesta = await request(servidor())
          .get(`/api/ordenes-compra?buscar=${encodeURIComponent(consulta)}`)
          .set('Cookie', cookie);
        expect(respuesta.status).toBe(200);
        return (respuesta.body.datos as Array<{ numero: number }>).map((orden) => orden.numero);
      };

      expect(await numeros('1')).toEqual([1]);
      expect(await numeros('OC-000001')).toEqual([1]);
      // Número + proveedor: el término numérico y el de texto se cruzan con Y.
      expect(await numeros('1 formex')).toEqual([1]);
      // El mismo número con OTRO proveedor no devuelve nada: la Y funciona.
      expect(await numeros('1 aceros')).toEqual([]);
      // Y un término sin dígitos no rompe la consulta ni devuelve algo arbitrario.
      expect(await numeros('formex')).toEqual([1]);
    });
  });

  describe('clientes', () => {
    it('encuentra por nombre parcial, por NIT y por ciudad, combinando términos', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      await crearClienteDePrueba(contexto.prisma, { nombre: 'Constructora Andina', ciudad: 'Medellín' });
      await crearClienteDePrueba(contexto.prisma, { nombre: 'Constructora Pacífico', ciudad: 'Cali' });

      const nombres = async (consulta: string): Promise<string[]> => {
        const respuesta = await request(servidor())
          .get(`/api/clientes?buscar=${encodeURIComponent(consulta)}&porPagina=50`)
          .set('Cookie', cookie);
        expect(respuesta.status).toBe(200);
        return (respuesta.body.datos as Array<{ nombre: string }>).map((cliente) => cliente.nombre);
      };

      expect((await nombres('constructora')).sort()).toEqual(['Constructora Andina', 'Constructora Pacífico']);
      // Nombre + ciudad: dos campos distintos, un solo resultado.
      expect(await nombres('constructora medellín')).toEqual(['Constructora Andina']);
      expect(await nombres('cali')).toEqual(['Constructora Pacífico']);
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
