/**
 * Pruebas de integración de ROLES Y PERMISOS (T109, US9 — FR-054…FR-059) — API completa +
 * PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Qué se prueba aquí y no en unitarias (docs/arquitectura.md §8): el control de acceso de
 * extremo a extremo. Un rol es una fila con una matriz de permisos, el guard los resuelve en
 * cada petición desde esa matriz, y los invariantes de FR-057 dependen de conteos reales
 * (cuántos usuarios tiene un rol, cuántos roles activos conceden un permiso). Con mocks se
 * probaría el mock, no la autorización.
 *
 * Cubre:
 * - **SC-012**: un rol nuevo con un subconjunto de permisos concede EXACTAMENTE eso y la API
 *   responde 403 al resto (no basta ocultar la opción en la interfaz — FR-003/US9-AS2).
 * - **US9-AS3**: quitarle un permiso a un rol rige en la SIGUIENTE petición del usuario, con
 *   la misma sesión, sin volver a iniciar sesión.
 * - **FR-057**, los tres invariantes anti-bloqueo: no se elimina un rol del sistema; no se
 *   elimina un rol con usuarios (el mensaje dice cuántos); no se le quita `roles.gestionar` al
 *   último rol activo que lo tiene (ni por edición, ni desactivándolo, ni eliminándolo).
 * - El catálogo de permisos de solo lectura agrupado por módulo, el CRUD de `/api/roles` y su
 *   propia matriz de autorización (401 sin sesión, 403 sin `roles.gestionar`).
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend` (NUNCA contra `trazo`, ver
 * `truncarTablas()` en `./setup.ts`).
 */
import request from 'supertest';
import { PERMISO_GESTION_ROLES } from '../../src/dominio/entidades/permiso';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearProductoDePrueba,
  crearRolDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Nombre en BD del rol Administrador (lo siembra la migración — FR-059). */
const ROL_ADMINISTRADOR = 'Administrador';

/**
 * Permisos del rol "Bodeguero" de US9-AS1: registra ingresos y consulta inventario, nada más.
 * El resto del catálogo debe responder 403 (SC-012).
 */
const PERMISOS_BODEGUERO = ['inventario.ver', 'ingresos.ver', 'ingresos.crear'] as const;

describe('Roles y permisos — /api/roles y /api/permisos (T109)', () => {
  let contexto: AppDePrueba;

  beforeAll(async () => {
    contexto = await crearAppDePrueba();
  });

  afterAll(async () => {
    // Deja la base como se encontró: el bloque de FR-057 le quita `roles.gestionar` al rol
    // Administrador para poder construir el escenario "último rol activo que lo tiene".
    await restaurarGestionDeRolesDelAdministrador();
    await cerrarAppDePrueba(contexto.app);
  });

  beforeEach(async () => {
    await truncarTablas(contexto.prisma);
    // Auto-reparación: garantiza el MISMO punto de partida para cada prueba aunque una
    // anterior haya fallado a mitad de camino con la matriz del Administrador alterada
    // (`truncarTablas` no toca los roles del sistema, a propósito — ver su TSDoc).
    await restaurarGestionDeRolesDelAdministrador();
  });

  const servidor = (): ReturnType<AppDePrueba['app']['getHttpServer']> => contexto.app.getHttpServer();

  /** Vuelve a conceder `roles.gestionar` al rol Administrador si le falta (idempotente). */
  async function restaurarGestionDeRolesDelAdministrador(): Promise<void> {
    const rol = await contexto.prisma.rol.findUniqueOrThrow({ where: { nombre: ROL_ADMINISTRADOR } });
    const permiso = await contexto.prisma.permiso.findUniqueOrThrow({ where: { clave: PERMISO_GESTION_ROLES } });
    await contexto.prisma.rolPermiso.createMany({
      data: [{ rolId: rol.id, permisoId: permiso.id }],
      skipDuplicates: true,
    });
  }

  /** Le quita `roles.gestionar` al rol Administrador, dejando al rol propio indicado como el
   *  ÚNICO rol activo que lo concede — el escenario que arma los invariantes de FR-057. */
  async function dejarSoloEsteRolConGestionDeRoles(rolId: number): Promise<void> {
    const administrador = await contexto.prisma.rol.findUniqueOrThrow({ where: { nombre: ROL_ADMINISTRADOR } });
    const permiso = await contexto.prisma.permiso.findUniqueOrThrow({ where: { clave: PERMISO_GESTION_ROLES } });
    await contexto.prisma.rolPermiso.deleteMany({ where: { rolId: administrador.id, permisoId: permiso.id } });

    // Control del escenario: si no queda EXACTAMENTE este rol, la prueba de abajo no estaría
    // probando lo que cree (un segundo rol activo con el permiso desactivaría el invariante).
    const activosConGestion = await contexto.prisma.rol.findMany({
      where: { estado: 'ACTIVO', permisos: { some: { permiso: { clave: PERMISO_GESTION_ROLES } } } },
      select: { id: true },
    });
    expect(activosConGestion.map((fila) => Number(fila.id))).toEqual([rolId]);
  }

  /** Ids del catálogo para las claves indicadas — el cuerpo de `/api/roles` viaja por id. */
  async function idsDePermisos(claves: readonly string[]): Promise<number[]> {
    const filas = await contexto.prisma.permiso.findMany({
      where: { clave: { in: [...claves] } },
      select: { id: true },
    });
    return filas.map((fila) => Number(fila.id));
  }

  /** Id del rol Administrador, que varias pruebas usan como "rol del sistema". */
  async function idDelRolAdministrador(): Promise<number> {
    const rol = await contexto.prisma.rol.findUniqueOrThrow({ where: { nombre: ROL_ADMINISTRADOR } });
    return Number(rol.id);
  }

  /** Administrador autenticado listo para operar `/api/roles`. */
  async function sesionDeAdministrador(): Promise<string> {
    const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    return iniciarSesion(servidor(), admin.login, admin.password);
  }

  describe('SC-012 — un rol propio concede EXACTAMENTE sus permisos', () => {
    it(
      'un usuario con el rol "Bodeguero" (inventario + ingresos) hace lo concedido y recibe 403 en ' +
        'todo lo demás, incluida la confirmación de salidas (US9-AS1/US9-AS2)',
      async () => {
        const bodeguero = await crearRolDePrueba(contexto.prisma, PERMISOS_BODEGUERO, 'Bodeguero');
        const usuario = await crearUsuarioDePrueba(contexto, { rolId: bodeguero.id });
        const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);
        const producto = await crearProductoDePrueba(contexto.prisma, { stockActual: 0 });

        // Lo CONCEDIDO funciona de verdad (no basta con no dar 403: la operación se ejecuta).
        const respuestaInventario = await request(servidor()).get('/api/inventario').set('Cookie', cookie);
        expect(respuestaInventario.status).toBe(200);

        const respuestaListarIngresos = await request(servidor()).get('/api/ingresos').set('Cookie', cookie);
        expect(respuestaListarIngresos.status).toBe(200);

        const respuestaCrearIngreso = await request(servidor())
          .post('/api/ingresos')
          .set('Cookie', cookie)
          .send({
            numeroFactura: `FAC-ROLES-${Date.now()}`,
            fechaFactura: '2026-01-05',
            proveedor: 'Proveedor de Prueba de Roles',
            fechaRecepcion: '2026-01-05',
            lineas: [{ productoId: producto.id, cantidad: 5, precioUnitario: 1000 }],
          });
        expect(respuestaCrearIngreso.status).toBe(201);
        const ingresoId: number = respuestaCrearIngreso.body.id;

        // Todo lo NO concedido responde 403 — una por cada permiso ausente del subconjunto,
        // repartidas por los 9 módulos del catálogo.
        const noConcedidas: Array<{ descripcion: string; peticion: () => request.Test }> = [
          { descripcion: 'ingresos.verificar', peticion: () => request(servidor()).post(`/api/ingresos/${ingresoId}/verificar`) },
          { descripcion: 'ingresos.anular', peticion: () => request(servidor()).post(`/api/ingresos/${ingresoId}/anular`).send({ motivo: 'x' }) },
          { descripcion: 'salidas.ver', peticion: () => request(servidor()).get('/api/salidas') },
          { descripcion: 'salidas.confirmar', peticion: () => request(servidor()).post('/api/salidas/1/confirmar') },
          { descripcion: 'clientes.ver', peticion: () => request(servidor()).get('/api/clientes') },
          { descripcion: 'productos.ver', peticion: () => request(servidor()).get('/api/productos') },
          { descripcion: 'productos.importar', peticion: () => request(servidor()).get('/api/productos/plantilla-importacion') },
          { descripcion: 'proyectos.editar', peticion: () => request(servidor()).put('/api/proyectos/1').send({ nombre: 'x' }) },
          { descripcion: 'reportes.ver', peticion: () => request(servidor()).get('/api/reportes/inventario') },
          { descripcion: 'usuarios.gestionar', peticion: () => request(servidor()).get('/api/usuarios') },
          { descripcion: 'roles.gestionar', peticion: () => request(servidor()).get('/api/roles') },
        ];

        for (const { descripcion, peticion } of noConcedidas) {
          const respuesta = await peticion().set('Cookie', cookie);
          expect({ permiso: descripcion, status: respuesta.status }).toEqual({ permiso: descripcion, status: 403 });
        }

        // El rol quedó con exactamente los 3 permisos marcados, ni uno más.
        const cookieAdmin = await sesionDeAdministrador();
        const respuestaRol = await request(servidor()).get(`/api/roles/${bodeguero.id}`).set('Cookie', cookieAdmin);
        expect(respuestaRol.status).toBe(200);
        expect(respuestaRol.body).toMatchObject({ nombre: 'Bodeguero', esSistema: false, estado: 'ACTIVO' });
        expect([...respuestaRol.body.permisos].sort()).toEqual([...PERMISOS_BODEGUERO].sort());
      },
    );
  });

  describe('US9-AS3 — un cambio de permisos rige en la siguiente petición, sin re-login', () => {
    it('quitarle un permiso al rol hace que la MISMA sesión reciba 403 en la petición siguiente', async () => {
      const rol = await crearRolDePrueba(contexto.prisma, ['inventario.ver'], 'Consulta de inventario');
      const usuario = await crearUsuarioDePrueba(contexto, { rolId: rol.id });
      const cookieUsuario = await iniciarSesion(servidor(), usuario.login, usuario.password);
      const cookieAdmin = await sesionDeAdministrador();

      const antes = await request(servidor()).get('/api/inventario').set('Cookie', cookieUsuario);
      expect(antes.status).toBe(200);

      // El Administrador reemplaza la matriz del rol por otra que ya no incluye inventario.ver.
      const respuestaEdicion = await request(servidor())
        .put(`/api/roles/${rol.id}`)
        .set('Cookie', cookieAdmin)
        .send({ nombre: rol.nombre, permisoIds: await idsDePermisos(['clientes.ver']) });
      expect(respuestaEdicion.status).toBe(204);

      // MISMA cookie, sin volver a iniciar sesión: el cambio ya rige.
      const despues = await request(servidor()).get('/api/inventario').set('Cookie', cookieUsuario);
      expect(despues.status).toBe(403);

      // Y lo que se le concedió en el mismo cambio funciona de inmediato, con esa misma sesión.
      const nuevoPermiso = await request(servidor()).get('/api/clientes').set('Cookie', cookieUsuario);
      expect(nuevoPermiso.status).toBe(200);
    });
  });

  describe('FR-057 — invariantes que impiden dejar al sistema sin quién lo administre', () => {
    it('no se puede eliminar un rol del sistema (409) y el rol sigue existiendo', async () => {
      const cookieAdmin = await sesionDeAdministrador();
      const administradorId = await idDelRolAdministrador();

      const respuesta = await request(servidor()).delete(`/api/roles/${administradorId}`).set('Cookie', cookieAdmin);

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error.mensaje).toContain('rol del sistema');
      expect(await contexto.prisma.rol.count({ where: { id: BigInt(administradorId) } })).toBe(1);
    });

    it('no se puede eliminar un rol con usuarios asignados, y el mensaje dice cuántos son (US9-AS5)', async () => {
      const cookieAdmin = await sesionDeAdministrador();
      const rol = await crearRolDePrueba(contexto.prisma, ['inventario.ver'], 'Rol con gente');
      await crearUsuarioDePrueba(contexto, { rolId: rol.id });
      await crearUsuarioDePrueba(contexto, { rolId: rol.id });

      const respuesta = await request(servidor()).delete(`/api/roles/${rol.id}`).set('Cookie', cookieAdmin);

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error.mensaje).toContain('2 usuarios');
      // Ni el rol ni sus usuarios se tocaron.
      expect(await contexto.prisma.rol.count({ where: { id: BigInt(rol.id) } })).toBe(1);
      expect(await contexto.prisma.usuario.count({ where: { rolId: BigInt(rol.id) } })).toBe(2);
    });

    it(
      'no se puede quitar el permiso de gestión de roles al ÚLTIMO rol activo que lo tiene: la edición ' +
        'se rechaza con 409 y la matriz del rol queda intacta',
      async () => {
        const cookieAdmin = await sesionDeAdministrador();
        const administradorId = await idDelRolAdministrador();
        const permisosAntes = await contexto.prisma.rolPermiso.count({ where: { rolId: BigInt(administradorId) } });

        // El Administrador desmarca la casilla "gestionar roles" en el rol Administrador: envía
        // toda su matriz MENOS ese permiso (con su mismo nombre: renombrarlo es otro 409).
        const todasLasClaves = (await contexto.prisma.permiso.findMany({ select: { clave: true } })).map((f) => f.clave);
        const sinGestionDeRoles = await idsDePermisos(todasLasClaves.filter((clave) => clave !== PERMISO_GESTION_ROLES));

        const respuesta = await request(servidor())
          .put(`/api/roles/${administradorId}`)
          .set('Cookie', cookieAdmin)
          .send({ nombre: ROL_ADMINISTRADOR, permisoIds: sinGestionDeRoles });

        expect(respuesta.status).toBe(409);
        expect(respuesta.body.error.mensaje).toContain('último rol activo');
        // Nada se aplicó: la matriz completa sigue ahí (no un rol a medio actualizar).
        expect(await contexto.prisma.rolPermiso.count({ where: { rolId: BigInt(administradorId) } })).toBe(permisosAntes);
        // Y el Administrador sigue pudiendo administrar roles con esa misma sesión.
        expect((await request(servidor()).get('/api/roles').set('Cookie', cookieAdmin)).status).toBe(200);
      },
    );

    it('sí se puede quitar ese permiso cuando OTRO rol activo también lo concede (el invariante no es un bloqueo ciego)', async () => {
      const cookieAdmin = await sesionDeAdministrador();
      const copia = await crearRolDePrueba(contexto.prisma, [PERMISO_GESTION_ROLES], 'Gestión delegada');

      const respuesta = await request(servidor())
        .put(`/api/roles/${copia.id}`)
        .set('Cookie', cookieAdmin)
        .send({ nombre: copia.nombre, permisoIds: await idsDePermisos(['inventario.ver']) });

      expect(respuesta.status).toBe(204);
      const rolActualizado = await request(servidor()).get(`/api/roles/${copia.id}`).set('Cookie', cookieAdmin);
      expect(rolActualizado.body.permisos).toEqual(['inventario.ver']);
    });

    it(
      'no se puede DESACTIVAR al último rol activo con el permiso de gestión de roles: el único rol ' +
        'que puede administrar roles no puede retirarse a sí mismo',
      async () => {
        // El permiso se movió del Administrador a un rol propio, que queda como el ÚNICO activo
        // que lo concede. Quien opera es un usuario de ESE rol: es el único que ya puede entrar a
        // `/api/roles`, y por eso también el único capaz de dejar al sistema sin administración.
        const unico = await crearRolDePrueba(contexto.prisma, [PERMISO_GESTION_ROLES], 'Gestión exclusiva');
        await dejarSoloEsteRolConGestionDeRoles(unico.id);
        const gestor = await crearUsuarioDePrueba(contexto, { rolId: unico.id });
        const cookieGestor = await iniciarSesion(servidor(), gestor.login, gestor.password);

        const respuesta = await request(servidor())
          .put(`/api/roles/${unico.id}/estado`)
          .set('Cookie', cookieGestor)
          .send({ estado: 'INACTIVO' });

        expect(respuesta.status).toBe(409);
        expect(respuesta.body.error.mensaje).toContain('último rol activo');
        // Sigue ACTIVO: la operación no se aplicó a medias, y el gestor sigue pudiendo entrar.
        const registro = await contexto.prisma.rol.findUniqueOrThrow({ where: { id: BigInt(unico.id) } });
        expect(registro.estado).toBe('ACTIVO');
        expect((await request(servidor()).get('/api/roles').set('Cookie', cookieGestor)).status).toBe(200);
      },
    );

    it('no se puede ELIMINAR al último rol activo con el permiso de gestión de roles (409)', async () => {
      // Este caso solo es alcanzable con el rol del solicitante DESACTIVADO, y por eso el
      // escenario se ve raro: un rol con usuarios nunca se elimina (invariante anterior), así
      // que el rol objetivo no puede ser el del propio solicitante; y si el rol del solicitante
      // estuviera ACTIVO y concediera el permiso, el objetivo no sería "el último activo".
      // Desactivar un rol NO le retira los permisos a sus usuarios (decisión documentada en
      // `CambiarEstadoRolCasoUso`), así que ese solicitante sí puede operar — y esta prueba
      // fija de paso esa semántica.
      const objetivo = await crearRolDePrueba(contexto.prisma, [PERMISO_GESTION_ROLES], 'Gestión que sobra');
      const rolDelGestor = await crearRolDePrueba(contexto.prisma, [PERMISO_GESTION_ROLES], 'Gestión desactivada');
      await contexto.prisma.rol.update({ where: { id: BigInt(rolDelGestor.id) }, data: { estado: 'INACTIVO' } });
      await dejarSoloEsteRolConGestionDeRoles(objetivo.id);
      const gestor = await crearUsuarioDePrueba(contexto, { rolId: rolDelGestor.id });
      const cookieGestor = await iniciarSesion(servidor(), gestor.login, gestor.password);

      const respuesta = await request(servidor()).delete(`/api/roles/${objetivo.id}`).set('Cookie', cookieGestor);

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error.mensaje).toContain('último rol activo');
      expect(await contexto.prisma.rol.count({ where: { id: BigInt(objetivo.id) } })).toBe(1);
    });

    it('un rol del sistema no se renombra ni se desactiva (409), aunque sus permisos sí se puedan ajustar', async () => {
      const cookieAdmin = await sesionDeAdministrador();
      const administradorId = await idDelRolAdministrador();

      const respuestaRenombrar = await request(servidor())
        .put(`/api/roles/${administradorId}`)
        .set('Cookie', cookieAdmin)
        .send({ nombre: 'Superadministrador', permisoIds: await idsDePermisos([PERMISO_GESTION_ROLES]) });
      expect(respuestaRenombrar.status).toBe(409);
      expect(respuestaRenombrar.body.error.mensaje).toContain('rol del sistema');

      const respuestaDesactivar = await request(servidor())
        .put(`/api/roles/${administradorId}/estado`)
        .set('Cookie', cookieAdmin)
        .send({ estado: 'INACTIVO' });
      expect(respuestaDesactivar.status).toBe(409);

      const registro = await contexto.prisma.rol.findUniqueOrThrow({ where: { id: BigInt(administradorId) } });
      expect(registro).toMatchObject({ nombre: ROL_ADMINISTRADOR, estado: 'ACTIVO' });
    });
  });

  describe('CRUD de /api/roles y catálogo de /api/permisos', () => {
    it('crea un rol propio, lo lista con su conteo de usuarios y lo elimina cuando nadie lo tiene', async () => {
      const cookieAdmin = await sesionDeAdministrador();
      const permisoIds = await idsDePermisos(['inventario.ver', 'ingresos.ver']);

      const respuestaCrear = await request(servidor())
        .post('/api/roles')
        .set('Cookie', cookieAdmin)
        .send({ nombre: 'Auditor', descripcion: 'Solo consulta', permisoIds });
      expect(respuestaCrear.status).toBe(201);
      const rolId: number = respuestaCrear.body.id;

      const respuestaListar = await request(servidor()).get('/api/roles').set('Cookie', cookieAdmin);
      expect(respuestaListar.status).toBe(200);
      const auditor = respuestaListar.body.datos.find((rol: { id: number }) => rol.id === rolId);
      expect(auditor).toMatchObject({
        nombre: 'Auditor',
        descripcion: 'Solo consulta',
        esSistema: false,
        estado: 'ACTIVO',
        cantidadUsuarios: 0,
      });
      expect([...auditor.permisos].sort()).toEqual(['ingresos.ver', 'inventario.ver']);
      // Los tres roles del sistema siguen ahí, con su conteo de usuarios real.
      const administrador = respuestaListar.body.datos.find((rol: { nombre: string }) => rol.nombre === ROL_ADMINISTRADOR);
      expect(administrador).toMatchObject({ esSistema: true, cantidadUsuarios: 1 });

      const respuestaEliminar = await request(servidor()).delete(`/api/roles/${rolId}`).set('Cookie', cookieAdmin);
      expect(respuestaEliminar.status).toBe(204);
      expect(await contexto.prisma.rol.count({ where: { id: BigInt(rolId) } })).toBe(0);
      // La matriz del rol se fue con él (ON DELETE CASCADE), sin dejar filas huérfanas.
      expect(await contexto.prisma.rolPermiso.count({ where: { rolId: BigInt(rolId) } })).toBe(0);
    });

    it('rechaza con 400 un nombre de rol duplicado y un permiso inexistente, sin crear nada', async () => {
      const cookieAdmin = await sesionDeAdministrador();
      const permisoIds = await idsDePermisos(['inventario.ver']);
      const rolesAntes = await contexto.prisma.rol.count();

      const primera = await request(servidor())
        .post('/api/roles')
        .set('Cookie', cookieAdmin)
        .send({ nombre: 'Repetido', permisoIds });
      expect(primera.status).toBe(201);

      const duplicada = await request(servidor())
        .post('/api/roles')
        .set('Cookie', cookieAdmin)
        .send({ nombre: 'Repetido', permisoIds });
      expect(duplicada.status).toBe(400);
      expect(duplicada.body.error.campos).toEqual({ nombre: expect.stringContaining('rol') });

      const permisoInexistente = await request(servidor())
        .post('/api/roles')
        .set('Cookie', cookieAdmin)
        .send({ nombre: 'Con permiso fantasma', permisoIds: [999999] });
      expect(permisoInexistente.status).toBe(400);
      expect(permisoInexistente.body.error.campos).toEqual({ permisoIds: expect.stringContaining('permisos') });

      // Solo se creó el primero: ni el duplicado ni el del permiso fantasma dejaron rastro.
      expect(await contexto.prisma.rol.count()).toBe(rolesAntes + 1);
    });

    it('desactiva un rol propio sin tocar a sus usuarios: la baja es lógica y no les retira permisos', async () => {
      const cookieAdmin = await sesionDeAdministrador();
      const rol = await crearRolDePrueba(contexto.prisma, ['inventario.ver'], 'Rol a desactivar');
      const usuario = await crearUsuarioDePrueba(contexto, { rolId: rol.id });
      const cookieUsuario = await iniciarSesion(servidor(), usuario.login, usuario.password);

      const respuesta = await request(servidor())
        .put(`/api/roles/${rol.id}/estado`)
        .set('Cookie', cookieAdmin)
        .send({ estado: 'INACTIVO' });
      expect(respuesta.status).toBe(204);

      const registro = await contexto.prisma.rol.findUniqueOrThrow({ where: { id: BigInt(rol.id) } });
      expect(registro.estado).toBe('INACTIVO');
      // Decisión documentada en `CambiarEstadoRolCasoUso`: desactivar un rol significa "ya no se
      // ofrece para asignar", NO "sus usuarios pierden el acceso" (para eso está la baja del
      // usuario, FR-008). Si esto cambiara alguna vez, sería un despido masivo silencioso.
      expect((await request(servidor()).get('/api/inventario').set('Cookie', cookieUsuario)).status).toBe(200);
    });

    it('GET /api/permisos devuelve el catálogo agrupado por módulo, sin repetir el módulo en cada permiso', async () => {
      const cookieAdmin = await sesionDeAdministrador();

      const respuesta = await request(servidor()).get('/api/permisos').set('Cookie', cookieAdmin);

      expect(respuesta.status).toBe(200);
      const grupos: Array<{ modulo: string; permisos: Array<{ id: number; clave: string; descripcion: string }> }> =
        respuesta.body;
      // Un grupo por módulo, sin repetirse, y todos los permisos del catálogo repartidos en ellos.
      const modulos = grupos.map((grupo) => grupo.modulo);
      expect(new Set(modulos).size).toBe(modulos.length);
      expect([...modulos].sort()).toEqual(modulos);
      const totalPublicado = grupos.reduce((suma, grupo) => suma + grupo.permisos.length, 0);
      expect(totalPublicado).toBe(await contexto.prisma.permiso.count());
      // Cada permiso trae exactamente {id, clave, descripcion}: `modulo` ya lo lleva el grupo.
      const gestionDeRoles = grupos
        .flatMap((grupo) => grupo.permisos)
        .find((permiso) => permiso.clave === PERMISO_GESTION_ROLES);
      expect(Object.keys(gestionDeRoles ?? {}).sort()).toEqual(['clave', 'descripcion', 'id']);
    });
  });

  describe('control de acceso de la propia sección (FR-003/FR-058)', () => {
    /** Las 7 rutas de la sección "Roles y permisos" del contrato, sin ejecutar todavía. */
    function peticionesDeRolesYPermisos(rolId: number): Array<() => request.Test> {
      return [
        () => request(servidor()).get('/api/permisos'),
        () => request(servidor()).get('/api/roles'),
        () => request(servidor()).get(`/api/roles/${rolId}`),
        () => request(servidor()).post('/api/roles').send({ nombre: 'Intruso', permisoIds: [] }),
        () => request(servidor()).put(`/api/roles/${rolId}`).send({ nombre: 'Intruso', permisoIds: [] }),
        () => request(servidor()).put(`/api/roles/${rolId}/estado`).send({ estado: 'INACTIVO' }),
        () => request(servidor()).delete(`/api/roles/${rolId}`),
      ];
    }

    it('GERENTE y OPERARIO reciben 403 en las 7 rutas: solo quien tiene roles.gestionar administra roles', async () => {
      const rol = await crearRolDePrueba(contexto.prisma, ['inventario.ver'], 'Rol observado');

      for (const rolDelUsuario of ['GERENTE', 'OPERARIO'] as const) {
        const usuario = await crearUsuarioDePrueba(contexto, { rol: rolDelUsuario });
        const cookie = await iniciarSesion(servidor(), usuario.login, usuario.password);

        for (const construirPeticion of peticionesDeRolesYPermisos(rol.id)) {
          const respuesta = await construirPeticion().set('Cookie', cookie);
          expect(respuesta.status).toBe(403);
        }
      }

      // Ninguna de las peticiones rechazadas creó, cambió ni borró nada.
      const registro = await contexto.prisma.rol.findUniqueOrThrow({ where: { id: BigInt(rol.id) } });
      expect(registro).toMatchObject({ nombre: 'Rol observado', estado: 'ACTIVO' });
      expect(await contexto.prisma.rol.count({ where: { nombre: 'Intruso' } })).toBe(0);
    });

    it('las 7 rutas exigen sesión (401 sin cookie)', async () => {
      const rol = await crearRolDePrueba(contexto.prisma, ['inventario.ver'], 'Rol sin sesión');

      for (const construirPeticion of peticionesDeRolesYPermisos(rol.id)) {
        const respuesta = await construirPeticion();
        expect(respuesta.status).toBe(401);
      }
    });
  });

  /**
   * Regla anti-escalada del CRUD de roles (`comunes/proteccion-escalada-permisos.ts`): nadie
   * concede, a través de un rol, permisos que su propio rol no tiene.
   *
   * Cierra un hallazgo de la verificación final de la Tanda 13: la propia US9 estableció esa
   * regla para `/api/usuarios` pero NO para `/api/roles`, y esa asimetría dejaba
   * `roles.gestionar` como un permiso AUTO-ESCALABLE — un rol con ese único permiso podía
   * concederse los 30 del catálogo en una sola petición y sin re-login, así que marcar esa
   * casilla equivalía en la práctica a conceder administración total en silencio.
   */
  describe('Anti-escalada: nadie concede permisos que su propio rol no tiene', () => {
    it('un gestor de roles NO puede ampliarse a sí mismo con permisos que no tiene (400) y sus permisos no cambian', async () => {
      const soloGestion = await crearRolDePrueba(contexto.prisma, [PERMISO_GESTION_ROLES], 'Gestión acotada');
      const gestor = await crearUsuarioDePrueba(contexto, { rolId: soloGestion.id });
      const cookieGestor = await iniciarSesion(servidor(), gestor.login, gestor.password);

      // Control previo: hoy NO puede ver inventario.
      expect((await request(servidor()).get('/api/inventario').set('Cookie', cookieGestor)).status).toBe(403);

      const respuesta = await request(servidor())
        .put(`/api/roles/${soloGestion.id}`)
        .set('Cookie', cookieGestor)
        .send({
          nombre: soloGestion.nombre,
          permisoIds: await idsDePermisos([PERMISO_GESTION_ROLES, 'inventario.ver']),
        });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.campos?.permisoIds).toContain('inventario.ver');

      // La escalada NO ocurrió: sigue sin poder ver inventario con la MISMA cookie (los permisos
      // se resuelven en cada petición, así que un cambio aplicado se notaría de inmediato).
      expect((await request(servidor()).get('/api/inventario').set('Cookie', cookieGestor)).status).toBe(403);
    });

    it('tampoco puede crear un rol nuevo con permisos que no tiene (400) — la escalada en dos pasos', async () => {
      const soloGestion = await crearRolDePrueba(contexto.prisma, [PERMISO_GESTION_ROLES], 'Gestión acotada 2');
      const gestor = await crearUsuarioDePrueba(contexto, { rolId: soloGestion.id });
      const cookieGestor = await iniciarSesion(servidor(), gestor.login, gestor.password);

      const respuesta = await request(servidor())
        .post('/api/roles')
        .set('Cookie', cookieGestor)
        .send({ nombre: 'Rol escalado', permisoIds: await idsDePermisos(['usuarios.gestionar']) });

      expect(respuesta.status).toBe(400);
      expect(await contexto.prisma.rol.count({ where: { nombre: 'Rol escalado' } })).toBe(0);
    });

    it('el Administrador SÍ puede conceder cualquier permiso (la regla no es un bloqueo ciego)', async () => {
      const cookieAdmin = await sesionDeAdministrador();

      const respuesta = await request(servidor())
        .post('/api/roles')
        .set('Cookie', cookieAdmin)
        .send({ nombre: 'Bodeguero acotado', permisoIds: await idsDePermisos(['inventario.ver', 'ingresos.ver']) });

      expect(respuesta.status).toBe(201);
    });
  });
});

/** Hace login por HTTP y devuelve la cookie de sesión lista para `.set('Cookie', …)` — mismo
 *  patrón local que el resto de suites de integración (cada una define el suyo). */
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
