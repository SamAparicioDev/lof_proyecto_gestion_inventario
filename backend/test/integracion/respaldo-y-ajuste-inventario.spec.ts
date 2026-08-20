/**
 * Pruebas de integración de US30 (super administrador) y US31 (corregir la cantidad desde el
 * inventario) — T247, FR-127…FR-131. API completa + PostgreSQL REAL.
 *
 * Lo que SOLO se puede verificar aquí (docs/arquitectura.md §8):
 *
 *  - **El respaldo sobrevive a la matriz vaciada**: la prueba borra TODAS las filas de
 *    `roles_permisos` —el accidente que motivó la historia, reproducido en la base real— y
 *    comprueba que el super administrador sigue operando. Con dobles en memoria esto no
 *    probaría nada: el punto es justamente que la autorización no dependa de esas filas.
 *  - **Las cuatro puertas cerradas** (editar, desactivar, eliminar y asignar el rol) más la
 *    quinta, que es la que se olvida: restablecerle la contraseña a quien ya lo tiene.
 *  - **La corrección de cantidad es atómica y deja rastro**: stock y movimiento se comprueban
 *    contra las tablas, no contra la respuesta del endpoint.
 *  - **La reserva de los dos permisos** (FR-131/FR-132) sobre `PUT /api/roles/:id` y
 *    `POST /api/roles`, incluido lo que un Administrador SÍ sigue pudiendo hacer — una reserva
 *    que de paso rompiera la operación diaria sería peor que la ausencia de reserva.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`).
 */
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearProductoDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

interface CuerpoError {
  error: { mensaje: string; campos?: Record<string, string> | null };
}

describe('Respaldo del sistema, corrección de inventario y permisos reservados (US30…US32)', () => {
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

  /** El rol de respaldo lo siembra la MIGRACIÓN (no el seed), así que existe en `trazo_test`
   *  desde el primer `migrate deploy` — igual que los tres roles del sistema. */
  async function idRolDeRespaldo(): Promise<number> {
    const rol = await contexto.prisma.rol.findFirstOrThrow({ where: { esSuperAdmin: true } });
    return Number(rol.id);
  }

  /** Usuario con el rol de respaldo — asignado DIRECTAMENTE en la base, que es la única vía que
   *  el sistema admite (FR-128). La prueba usa el mismo camino que un operador real. */
  async function crearSuperAdmin(): Promise<{ login: string; password: string; id: number }> {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    await contexto.prisma.usuario.update({
      where: { id: BigInt(usuario.id) },
      data: { rolId: BigInt(await idRolDeRespaldo()) },
    });
    return { login: usuario.login, password: usuario.password, id: usuario.id };
  }

  // ==========================================================================================
  // US30 — el respaldo (FR-127/FR-128)
  // ==========================================================================================
  describe('super administrador (US30)', () => {
    it('sigue operando aunque se borre la matriz de permisos ENTERA (FR-127, US30-AS2)', async () => {
      const superAdmin = await crearSuperAdmin();
      const cookie = await iniciarSesion(servidor(), superAdmin.login, superAdmin.password);

      // `truncarTablas` NO limpia `roles_permisos` a propósito (la siembra la migración y sin
      // ella ningún usuario creado después tendría permisos), así que es estado COMPARTIDO entre
      // suites. Esta prueba necesita vaciarla — es el accidente que reproduce — y por eso se la
      // guarda entera y la devuelve como estaba pase lo que pase.
      const matrizOriginal = await contexto.prisma.rolPermiso.findMany();
      try {
        await contexto.prisma.rolPermiso.deleteMany();
        expect(await contexto.prisma.rolPermiso.count()).toBe(0);

        // Endpoints de tres módulos distintos, con tres permisos distintos: si la autorización
        // saliera de la matriz, los tres responderían 403.
        expect((await request(servidor()).get('/api/inventario').set('Cookie', cookie)).status).toBe(200);
        expect((await request(servidor()).get('/api/usuarios').set('Cookie', cookie)).status).toBe(200);
        expect((await request(servidor()).get('/api/roles').set('Cookie', cookie)).status).toBe(200);

        // Y puede REHACER la matriz por la API, que es para lo que sirve la llave de repuesto.
        const roles = await request(servidor()).get('/api/roles').set('Cookie', cookie);
        const administrador = (roles.body.datos as { id: number; nombre: string }[]).find(
          (rol) => rol.nombre === 'Administrador',
        );
        const permisos = await contexto.prisma.permiso.findMany({ select: { id: true } });
        const restaurado = await request(servidor())
          .put(`/api/roles/${administrador?.id}`)
          .set('Cookie', cookie)
          .send({ nombre: 'Administrador', permisoIds: permisos.map((permiso) => Number(permiso.id)) });
        expect(restaurado.status).toBe(204);
        expect(await contexto.prisma.rolPermiso.count()).toBe(permisos.length);
      } finally {
        await contexto.prisma.rolPermiso.deleteMany();
        await contexto.prisma.rolPermiso.createMany({ data: matrizOriginal });
      }
    });

    it('su perfil reporta el catálogo completo aunque su rol no tenga filas en la matriz', async () => {
      const superAdmin = await crearSuperAdmin();
      const cookie = await iniciarSesion(servidor(), superAdmin.login, superAdmin.password);

      const perfil = await request(servidor()).get('/api/auth/perfil').set('Cookie', cookie);
      expect(perfil.status).toBe(200);
      expect(perfil.body.esSuperAdmin).toBe(true);
      // Sin esto la interfaz le ocultaría TODO justo a quien más puede, y la pantalla en blanco
      // parecería el bloqueo del que la historia protege.
      const totalPermisos = await contexto.prisma.permiso.count();
      expect(perfil.body.permisos).toHaveLength(totalPermisos);
      expect(await contexto.prisma.rolPermiso.count({ where: { rol: { esSuperAdmin: true } } })).toBe(0);
    });

    it('el panel de control le llega COMPLETO, no vacío (defecto reportado el 2026-08-19)', async () => {
      const superAdmin = await crearSuperAdmin();
      const cookie = await iniciarSesion(servidor(), superAdmin.login, superAdmin.password);

      const panel = await request(servidor()).get('/api/panel').set('Cookie', cookie);
      expect(panel.status).toBe(200);

      // El fallo real: `ResumenPanelCasoUso` recorta sus secciones leyendo `rolAsignado.permisos`,
      // y la del respaldo está vacía a propósito. El guard lo dejaba entrar y la pantalla le decía
      // "tu rol no incluye ninguna de las cifras de este panel" — que es exactamente el bloqueo
      // del que esta historia protege, con otra cara. Lo mismo le pasaría a cualquier consumidor
      // futuro que derive algo de esa lista, y por eso la resolución vive en el repositorio.
      expect(panel.body.inventario).toBeDefined();
      expect(panel.body.pendientes).toBeDefined();
      expect(panel.body.consumoMes).toBeDefined();
      expect(panel.body.movimientosRecientes).toBeDefined();
    });

    it('un Administrador no puede editar, desactivar ni eliminar el rol de respaldo (FR-128, US30-AS3)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const rolId = await idRolDeRespaldo();

      const editado = await request(servidor())
        .put(`/api/roles/${rolId}`)
        .set('Cookie', cookie)
        .send({ nombre: 'Otro nombre', permisoIds: [] });
      expect(editado.status).toBe(409);
      expect((editado.body as CuerpoError).error.mensaje).toContain('respaldo del sistema');

      const desactivado = await request(servidor())
        .put(`/api/roles/${rolId}/estado`)
        .set('Cookie', cookie)
        .send({ estado: 'INACTIVO' });
      expect(desactivado.status).toBe(409);

      expect((await request(servidor()).delete(`/api/roles/${rolId}`).set('Cookie', cookie)).status).toBe(409);

      // Nada cambió: sigue activo y con su nombre.
      const rol = await contexto.prisma.rol.findFirstOrThrow({ where: { esSuperAdmin: true } });
      expect(rol.estado).toBe('ACTIVO');
      expect(rol.nombre).toBe('Super administrador');
    });

    it('nadie puede ASIGNAR el rol de respaldo por la API, ni a otro ni a sí mismo (FR-128, US30-AS4)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const rolId = await idRolDeRespaldo();

      const alta = await request(servidor()).post('/api/usuarios').set('Cookie', cookie).send({
        nombreCompleto: 'Aspirante a respaldo',
        email: 'aspirante@trazo.local',
        login: 'aspirante',
        passwordTemporal: 'ClaveTemporal#123',
        rolId,
      });
      expect(alta.status).toBe(400);
      expect((alta.body as CuerpoError).error.campos?.rolId).toContain('base de datos');

      const autoascenso = await request(servidor())
        .put(`/api/usuarios/${admin.id}`)
        .set('Cookie', cookie)
        .send({ nombreCompleto: 'Administrador', email: 'admin.otro@trazo.local', rolId });
      expect(autoascenso.status).toBe(400);

      expect(await contexto.prisma.usuario.count({ where: { rol: { esSuperAdmin: true } } })).toBe(0);
    });

    it('un Administrador no puede restablecerle la contraseña ni desactivar al respaldo (FR-128, US30-AS5)', async () => {
      const superAdmin = await crearSuperAdmin();
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);

      // ESTA es la puerta que hay que cerrar: sin ella, el administrador le fija una contraseña
      // conocida y entra como él, y las otras cuatro protecciones no sirven de nada.
      const restablecido = await request(servidor())
        .put(`/api/usuarios/${superAdmin.id}/restablecer-password`)
        .set('Cookie', cookie)
        .send({ passwordTemporal: 'ClaveQueYoSe#123' });
      expect(restablecido.status).toBe(409);
      expect((restablecido.body as CuerpoError).error.mensaje).toContain('respaldo del sistema');

      const desactivado = await request(servidor())
        .put(`/api/usuarios/${superAdmin.id}/estado`)
        .set('Cookie', cookie)
        .send({ estado: 'INACTIVO' });
      expect(desactivado.status).toBe(409);

      // Y su contraseña original sigue funcionando.
      await expect(iniciarSesion(servidor(), superAdmin.login, superAdmin.password)).resolves.toBeTruthy();
    });
  });

  // ==========================================================================================
  // US31 — corregir la cantidad (FR-130/FR-131)
  // ==========================================================================================
  describe('corrección de cantidad (US31)', () => {
    it('corrige hacia arriba y hacia abajo, con el movimiento por la DIFERENCIA (US31-AS1/AS2)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'AJU-INV-1', stockActual: 40 });

      const subida = await request(servidor())
        .put(`/api/inventario/${producto.id}/cantidad`)
        .set('Cookie', cookie)
        .send({ cantidad: 47, motivo: 'Conteo físico de agosto' });
      expect(subida.status).toBe(204);

      const bajada = await request(servidor())
        .put(`/api/inventario/${producto.id}/cantidad`)
        .set('Cookie', cookie)
        .send({ cantidad: 33, motivo: 'Mercancía averiada' });
      expect(bajada.status).toBe(204);

      const tras = await contexto.prisma.producto.findUniqueOrThrow({ where: { id: BigInt(producto.id) } });
      expect(tras.stockActual.toNumber()).toBe(33);

      const movimientos = await contexto.prisma.movimientoInventario.findMany({ orderBy: { id: 'asc' } });
      expect(movimientos).toHaveLength(2);
      // 40 → 47 es una ENTRADA de 7; 47 → 33 es una SALIDA de 14. La cantidad es siempre
      // positiva: el signo lo lleva el tipo, como en el resto de la tabla.
      expect(movimientos[0]).toMatchObject({ tipo: 'AJUSTE_ENTRADA', documentoTipo: 'AJUSTE', documentoId: null });
      expect(movimientos[0]?.cantidad.toNumber()).toBe(7);
      expect(movimientos[0]?.stockResultante.toNumber()).toBe(47);
      expect(movimientos[0]?.motivo).toBe('Conteo físico de agosto');
      expect(movimientos[1]).toMatchObject({ tipo: 'AJUSTE_SALIDA', documentoTipo: 'AJUSTE', documentoId: null });
      expect(movimientos[1]?.cantidad.toNumber()).toBe(14);
      expect(movimientos[1]?.stockResultante.toNumber()).toBe(33);
    });

    it('rechaza corregir a la MISMA cantidad y sin motivo, sin dejar movimiento (US31-AS3/AS4)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'AJU-INV-2', stockActual: 10 });

      const igual = await request(servidor())
        .put(`/api/inventario/${producto.id}/cantidad`)
        .set('Cookie', cookie)
        .send({ cantidad: 10, motivo: 'Conteo' });
      expect(igual.status).toBe(400);
      expect((igual.body as CuerpoError).error.mensaje).toContain('nada que corregir');

      const sinMotivo = await request(servidor())
        .put(`/api/inventario/${producto.id}/cantidad`)
        .set('Cookie', cookie)
        .send({ cantidad: 12 });
      expect(sinMotivo.status).toBe(400);
      expect((sinMotivo.body as CuerpoError).error.campos?.motivo).toContain('obligatorio');

      const decimal = await request(servidor())
        .put(`/api/inventario/${producto.id}/cantidad`)
        .set('Cookie', cookie)
        .send({ cantidad: 12.5, motivo: 'Conteo' });
      expect(decimal.status).toBe(400);

      expect(await contexto.prisma.movimientoInventario.count()).toBe(0);
    });

    it('un Gerente NO puede corregir cantidades: el permiso nace solo en el Administrador (US31-AS5)', async () => {
      const gerente = await crearUsuarioDePrueba(contexto, { rol: 'GERENTE' });
      const cookie = await iniciarSesion(servidor(), gerente.login, gerente.password);
      const producto = await crearProductoDePrueba(contexto.prisma, { sku: 'AJU-INV-3', stockActual: 5 });

      const intento = await request(servidor())
        .put(`/api/inventario/${producto.id}/cantidad`)
        .set('Cookie', cookie)
        .send({ cantidad: 6, motivo: 'Conteo' });
      expect(intento.status).toBe(403);
      expect(await contexto.prisma.movimientoInventario.count()).toBe(0);
    });

    it('solo un super administrador concede o retira el permiso reservado (FR-131, US31-AS6)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookieAdmin = await iniciarSesion(servidor(), admin.login, admin.password);

      const rolGerente = await contexto.prisma.rol.findFirstOrThrow({ where: { nombre: 'Gerente' } });
      const permisosGerente = await contexto.prisma.rolPermiso.findMany({
        where: { rolId: rolGerente.id },
        select: { permisoId: true },
      });
      const permisoAjustar = await contexto.prisma.permiso.findFirstOrThrow({
        where: { clave: 'inventario.ajustar' },
      });
      const idsGerente = permisosGerente.map((fila) => Number(fila.permisoId));

      // El Administrador SÍ tiene el permiso, así que la regla anti-escalada no lo detendría:
      // lo que lo detiene es la reserva.
      const concedido = await request(servidor())
        .put(`/api/roles/${rolGerente.id}`)
        .set('Cookie', cookieAdmin)
        .send({ nombre: 'Gerente', permisoIds: [...idsGerente, Number(permisoAjustar.id)] });
      expect(concedido.status).toBe(409);
      expect((concedido.body as CuerpoError).error.mensaje).toContain('inventario.ajustar');

      // Editar el MISMO rol sin tocar la casilla reservada sigue funcionando: la reserva acota
      // quién mueve esa casilla, no impide administrar el rol.
      const otroCambio = await request(servidor())
        .put(`/api/roles/${rolGerente.id}`)
        .set('Cookie', cookieAdmin)
        .send({ nombre: 'Gerente', descripcion: rolGerente.descripcion ?? undefined, permisoIds: idsGerente });
      expect(otroCambio.status).toBe(204);

      // Y el super administrador sí puede concederlo. Se deshace al terminar: `roles_permisos`
      // es estado compartido entre suites (ver la prueba de la matriz vaciada), y dejarle el
      // permiso al Gerente haría fallar, en otra suite, justo la prueba de que no lo tiene.
      const superAdmin = await crearSuperAdmin();
      const cookieSuper = await iniciarSesion(servidor(), superAdmin.login, superAdmin.password);
      try {
        const concedidoPorSuper = await request(servidor())
          .put(`/api/roles/${rolGerente.id}`)
          .set('Cookie', cookieSuper)
          .send({ nombre: 'Gerente', permisoIds: [...idsGerente, Number(permisoAjustar.id)] });
        expect(concedidoPorSuper.status).toBe(204);
      } finally {
        await request(servidor())
          .put(`/api/roles/${rolGerente.id}`)
          .set('Cookie', cookieSuper)
          .send({ nombre: 'Gerente', permisoIds: idsGerente });
      }
    });
  });
  // ==========================================================================================
  // US32 — el permiso que reparte permisos (FR-132)
  // ==========================================================================================
  describe('permiso que reparte permisos (US32)', () => {
    /** Ids del catálogo por clave — el cuerpo del contrato viaja con ids, no con claves. */
    async function idsDePermisos(claves: readonly string[]): Promise<number[]> {
      const permisos = await contexto.prisma.permiso.findMany({ where: { clave: { in: [...claves] } } });
      return permisos.map((permiso) => Number(permiso.id));
    }

    it('un Administrador no puede CONCEDER `roles.gestionar` a otro rol (US32-AS1)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);

      const rolGerente = await contexto.prisma.rol.findFirstOrThrow({ where: { nombre: 'Gerente' } });
      const permisosGerente = await contexto.prisma.rolPermiso.findMany({
        where: { rolId: rolGerente.id },
        select: { permisoId: true },
      });
      const idsGerente = permisosGerente.map((fila) => Number(fila.permisoId));
      const [idGestionRoles] = await idsDePermisos(['roles.gestionar']);

      const intento = await request(servidor())
        .put(`/api/roles/${rolGerente.id}`)
        .set('Cookie', cookie)
        .send({ nombre: 'Gerente', permisoIds: [...idsGerente, idGestionRoles] });
      expect(intento.status).toBe(409);
      expect((intento.body as CuerpoError).error.mensaje).toContain('roles.gestionar');

      // Y nada se guardó: el Gerente sigue sin poder repartir permisos.
      const sigueSinTenerlo = await contexto.prisma.rolPermiso.count({
        where: { rolId: rolGerente.id, permisoId: BigInt(idGestionRoles as number) },
      });
      expect(sigueSinTenerlo).toBe(0);
    });

    it('tampoco puede RETIRÁRSELO a un rol que lo tiene (US32-AS1, el otro sentido)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);

      const rolAdministrador = await contexto.prisma.rol.findFirstOrThrow({ where: { nombre: 'Administrador' } });
      const permisos = await contexto.prisma.rolPermiso.findMany({
        where: { rolId: rolAdministrador.id },
        select: { permisoId: true },
      });
      const [idGestionRoles] = await idsDePermisos(['roles.gestionar']);
      const sinGestionRoles = permisos
        .map((fila) => Number(fila.permisoId))
        .filter((id) => id !== idGestionRoles);

      const intento = await request(servidor())
        .put(`/api/roles/${rolAdministrador.id}`)
        .set('Cookie', cookie)
        .send({ nombre: 'Administrador', permisoIds: sinGestionRoles });
      expect(intento.status).toBe(409);
      expect((intento.body as CuerpoError).error.mensaje).toContain('roles.gestionar');
    });

    it('no puede CREAR un rol que lo incluya — si no, bastaría con crearlo (US32-AS2)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const ids = await idsDePermisos(['roles.gestionar', 'inventario.ver']);

      const intento = await request(servidor())
        .post('/api/roles')
        .set('Cookie', cookie)
        .send({ nombre: 'Administrador paralelo', permisoIds: ids });
      expect(intento.status).toBe(409);
      expect(await contexto.prisma.rol.count({ where: { nombre: 'Administrador paralelo' } })).toBe(0);
    });

    it('lo que SÍ sigue pudiendo: crear roles, editarlos y gestionar usuarios (US32-AS3/AS4)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const idsNormales = await idsDePermisos(['inventario.ver', 'ingresos.ver', 'clientes.ver']);

      const creado = await request(servidor())
        .post('/api/roles')
        .set('Cookie', cookie)
        .send({ nombre: 'Consulta', descripcion: 'Solo mirar', permisoIds: idsNormales });
      expect(creado.status).toBe(201);

      const editado = await request(servidor())
        .put(`/api/roles/${creado.body.id}`)
        .set('Cookie', cookie)
        .send({ nombre: 'Consulta', permisoIds: await idsDePermisos(['inventario.ver']) });
      expect(editado.status).toBe(204);

      const usuario = await request(servidor()).post('/api/usuarios').set('Cookie', cookie).send({
        nombreCompleto: 'Persona de consulta',
        email: 'consulta@lof.local',
        login: 'consulta.us32',
        passwordTemporal: 'ClaveTemporal#123',
        rolId: creado.body.id,
      });
      expect(usuario.status).toBe(201);

      expect(
        (
          await request(servidor())
            .put(`/api/usuarios/${usuario.body.id}/estado`)
            .set('Cookie', cookie)
            .send({ estado: 'INACTIVO' })
        ).status,
      ).toBe(204);
    });

    it('el super administrador sí lo concede y lo retira (US32-AS5)', async () => {
      const superAdmin = await crearSuperAdmin();
      const cookie = await iniciarSesion(servidor(), superAdmin.login, superAdmin.password);

      const rolGerente = await contexto.prisma.rol.findFirstOrThrow({ where: { nombre: 'Gerente' } });
      const permisosGerente = await contexto.prisma.rolPermiso.findMany({
        where: { rolId: rolGerente.id },
        select: { permisoId: true },
      });
      const idsGerente = permisosGerente.map((fila) => Number(fila.permisoId));
      const [idGestionRoles] = await idsDePermisos(['roles.gestionar']);

      try {
        const concedido = await request(servidor())
          .put(`/api/roles/${rolGerente.id}`)
          .set('Cookie', cookie)
          .send({ nombre: 'Gerente', permisoIds: [...idsGerente, idGestionRoles] });
        expect(concedido.status).toBe(204);

        const retirado = await request(servidor())
          .put(`/api/roles/${rolGerente.id}`)
          .set('Cookie', cookie)
          .send({ nombre: 'Gerente', permisoIds: idsGerente });
        expect(retirado.status).toBe(204);
      } finally {
        // `roles_permisos` es estado compartido entre suites: se devuelve como estaba.
        await request(servidor())
          .put(`/api/roles/${rolGerente.id}`)
          .set('Cookie', cookie)
          .send({ nombre: 'Gerente', permisoIds: idsGerente });
      }
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
