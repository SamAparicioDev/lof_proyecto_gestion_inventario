/**
 * Pruebas de integración de la CAPACIDAD DE ADMINISTRACIÓN del sistema (FR-057) — API completa
 * + PostgreSQL REAL, contra el harness de `./setup.ts`.
 *
 * Por qué existe esta suite aparte de `roles.spec.ts`: aquella cubre los tres invariantes
 * enumerados en FR-057 tal como se escribieron en T105 (rol del sistema, rol con usuarios,
 * último rol activo con `roles.gestionar`). La revisión adversarial de la Tanda 13 demostró
 * —contra la API viva— que esos tres dejaban abiertos otros cinco caminos hacia exactamente el
 * estado que FR-057 prohíbe ("dejar a la organización sin capacidad de administrar roles o
 * usuarios"), o hacia su contrario (repartir esa capacidad sin control). Cada `it` de este
 * archivo REPRODUCE uno de esos caminos y exige que hoy termine en `409`/`400` en vez de en
 * `204`. Ninguna aserción de las suites existentes se tocó (SC-013).
 *
 * Los cinco caminos, y el `it` que los cubre:
 * 1. HIGH  — escalada: `usuarios.gestionar` se autoasignaba el rol Administrador (`PUT
 *            /api/usuarios/:id`), o creaba un usuario Administrador, o le restablecía la
 *            contraseña al Administrador y entraba con ella.
 * 2. CRIT  — camino indirecto por usuarios: degradar al último usuario capaz de administrar
 *            (`PUT /api/usuarios/:id`) dejaba el sistema irrecuperable por HTTP.
 * 3. CRIT  — rol huérfano: un rol con `roles.gestionar` y CERO usuarios satisfacía el conteo
 *            de "roles activos que lo conceden", así que `POST /api/roles` + `PUT
 *            /api/roles/:id` dejaba el sistema sin nadie que pudiera administrarlo.
 * 4. HIGH  — `usuarios.gestionar` no estaba protegido por ningún invariante: quitárselo al
 *            único rol que lo tenía respondía `204`.
 * 5. HIGH  — desactivación mutua: dos administradores desactivándose a la vez llegaban a CERO
 *            administradores activos (la regla de auto-desactivación de US6 no lo impide).
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend` (NUNCA contra `trazo`, ver
 * `truncarTablas()` en `./setup.ts`).
 */
import request from 'supertest';
import { PERMISO_GESTION_ROLES, PERMISO_GESTION_USUARIOS } from '../../src/dominio/entidades/permiso';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearRolDePrueba,
  crearUsuarioDePrueba,
  obtenerRolDelSistemaId,
  truncarTablas,
  type AppDePrueba,
} from './setup';

/** Nombre en BD del rol Administrador (lo siembra la migración — FR-059). */
const ROL_ADMINISTRADOR = 'Administrador';

describe('Capacidad de administración del sistema — FR-057 (revisión adversarial Tanda 13)', () => {
  let contexto: AppDePrueba;
  let rolAdministradorId: number;
  let rolOperarioId: number;

  beforeAll(async () => {
    contexto = await crearAppDePrueba();
    rolAdministradorId = await obtenerRolDelSistemaId(contexto.prisma, 'ADMINISTRADOR');
    rolOperarioId = await obtenerRolDelSistemaId(contexto.prisma, 'OPERARIO');
  });

  afterAll(async () => {
    await restaurarMatrizCompletaDelAdministrador();
    await cerrarAppDePrueba(contexto.app);
  });

  beforeEach(async () => {
    await truncarTablas(contexto.prisma);
    // Auto-reparación (mismo criterio que `roles.spec.ts`): estas pruebas exigen `409` en las
    // ediciones de la matriz del Administrador, así que NO deberían cambiarla nunca — pero si
    // una fallara a mitad de camino, la siguiente debe partir del mismo estado de fábrica.
    await restaurarMatrizCompletaDelAdministrador();
  });

  const servidor = (): ReturnType<AppDePrueba['app']['getHttpServer']> => contexto.app.getHttpServer();

  /** Devuelve al rol Administrador los 30 permisos del catálogo (idempotente, FR-059). */
  async function restaurarMatrizCompletaDelAdministrador(): Promise<void> {
    const rol = await contexto.prisma.rol.findUniqueOrThrow({ where: { nombre: ROL_ADMINISTRADOR } });
    const permisos = await contexto.prisma.permiso.findMany({ select: { id: true } });
    await contexto.prisma.rolPermiso.createMany({
      data: permisos.map((permiso) => ({ rolId: rol.id, permisoId: permiso.id })),
      skipDuplicates: true,
    });
  }

  /** Ids del catálogo para las claves indicadas — el cuerpo de `/api/roles` viaja por id. */
  /**
   * Sesión del SUPER ADMINISTRADOR (US30). Desde US32 (FR-132) `roles.gestionar` es un permiso
   * RESERVADO: un Administrador ya no puede concederlo ni retirarlo, así que los escenarios de
   * FR-057 que giran alrededor de ESA casilla solo se pueden montar desde este rol. Los que giran
   * alrededor de `usuarios.gestionar` siguen siendo cosa del Administrador, y así se quedan.
   *
   * El rol lo siembra la migración; asignarlo con un UPDATE directo es la única vía que el sistema
   * admite (FR-128), y por eso es también la que usa la prueba.
   */
  async function sesionDeSuperAdministrador(): Promise<string> {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    const respaldo = await contexto.prisma.rol.findFirstOrThrow({ where: { esSuperAdmin: true } });
    await contexto.prisma.usuario.update({ where: { id: BigInt(usuario.id) }, data: { rolId: respaldo.id } });
    return iniciarSesion(servidor(), usuario.login, usuario.password);
  }

  async function idsDePermisos(claves: readonly string[]): Promise<number[]> {
    const filas = await contexto.prisma.permiso.findMany({
      where: { clave: { in: [...claves] } },
      select: { id: true },
    });
    return filas.map((fila) => Number(fila.id));
  }

  /** Todas las claves del catálogo MENOS las indicadas — para armar un `PUT /api/roles/:id`
   *  que desmarque exactamente esas casillas y conserve el resto. */
  async function idsDelCatalogoSalvo(clavesExcluidas: readonly string[]): Promise<number[]> {
    const filas = await contexto.prisma.permiso.findMany({
      where: { clave: { notIn: [...clavesExcluidas] } },
      select: { id: true },
    });
    return filas.map((fila) => Number(fila.id));
  }

  /** Cuántos permisos tiene hoy el rol Administrador (para probar que un `409` no aplicó nada). */
  async function permisosDelAdministrador(): Promise<number> {
    return contexto.prisma.rolPermiso.count({ where: { rolId: BigInt(rolAdministradorId) } });
  }

  /** Cuerpo mínimo válido de `POST /api/usuarios` (esquemaCrearUsuario). */
  function cuerpoCrearUsuario(rolId: number): Record<string, unknown> {
    const sufijo = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    return {
      nombreCompleto: 'Usuario De Prueba FR057',
      email: `fr057.${sufijo}@pruebas.trazo.local`,
      login: `fr057.${sufijo}`,
      passwordTemporal: 'ClaveTemp#123',
      rolId,
    };
  }

  describe('1. Escalada de privilegios: `usuarios.gestionar` no puede convertirse en Administrador', () => {
    it(
      'un rol propio con SOLO `usuarios.gestionar` no puede autoasignarse el rol Administrador: ' +
        'la edición se rechaza con 400 y sus permisos efectivos no cambian',
      async () => {
        const soloUsuarios = await crearRolDePrueba(contexto.prisma, [PERMISO_GESTION_USUARIOS], 'Solo usuarios');
        const gestor = await crearUsuarioDePrueba(contexto, { rolId: soloUsuarios.id, email: 'gestor.fr057@pruebas.trazo.local' });
        const cookie = await iniciarSesion(servidor(), gestor.login, gestor.password);

        // Punto de partida: administra usuarios, y NADA más (ni roles ni reportes).
        expect((await request(servidor()).get('/api/usuarios').set('Cookie', cookie)).status).toBe(200);
        expect((await request(servidor()).get('/api/roles').set('Cookie', cookie)).status).toBe(403);

        const respuesta = await request(servidor())
          .put(`/api/usuarios/${gestor.id}`)
          .set('Cookie', cookie)
          .send({ nombreCompleto: 'Gestor Escalado', email: 'gestor.fr057@pruebas.trazo.local', rolId: rolAdministradorId });

        expect(respuesta.status).toBe(400);
        expect(respuesta.body.error.campos).toEqual({ rolId: expect.stringContaining('permisos que tu propio rol no tiene') });
        // MISMA cookie, sin re-login (los permisos se resuelven en cada petición — US9-AS3):
        // sigue sin poder administrar roles ni ver reportes.
        expect((await request(servidor()).get('/api/roles').set('Cookie', cookie)).status).toBe(403);
        expect((await request(servidor()).get('/api/permisos').set('Cookie', cookie)).status).toBe(403);
        expect((await request(servidor()).get('/api/reportes/inventario').set('Cookie', cookie)).status).toBe(403);
        // Y la fila no se tocó.
        const registro = await contexto.prisma.usuario.findUniqueOrThrow({ where: { id: BigInt(gestor.id) } });
        expect(Number(registro.rolId)).toBe(soloUsuarios.id);
      },
    );

    it('tampoco puede CREAR un usuario con un rol que concede más permisos que el suyo (400, sin insertar nada)', async () => {
      const soloUsuarios = await crearRolDePrueba(contexto.prisma, [PERMISO_GESTION_USUARIOS], 'Solo usuarios alta');
      const gestor = await crearUsuarioDePrueba(contexto, { rolId: soloUsuarios.id });
      const cookie = await iniciarSesion(servidor(), gestor.login, gestor.password);
      const usuariosAntes = await contexto.prisma.usuario.count();

      const respuesta = await request(servidor())
        .post('/api/usuarios')
        .set('Cookie', cookie)
        .send(cuerpoCrearUsuario(rolAdministradorId));

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.campos).toEqual({ rolId: expect.stringContaining('permisos que tu propio rol no tiene') });
      expect(await contexto.prisma.usuario.count()).toBe(usuariosAntes);

      // Un rol que NO excede el suyo sí se puede asignar: el bloqueo no es ciego.
      const soloVerInventario = await crearRolDePrueba(contexto.prisma, [], 'Sin permisos');
      const permitida = await request(servidor())
        .post('/api/usuarios')
        .set('Cookie', cookie)
        .send(cuerpoCrearUsuario(soloVerInventario.id));
      expect(permitida.status).toBe(201);
    });

    it('tampoco puede restablecerle la contraseña al Administrador para entrar con ella (400; su contraseña sigue sirviendo)', async () => {
      const soloUsuarios = await crearRolDePrueba(contexto.prisma, [PERMISO_GESTION_USUARIOS], 'Solo usuarios reset');
      const gestor = await crearUsuarioDePrueba(contexto, { rolId: soloUsuarios.id });
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), gestor.login, gestor.password);

      const respuesta = await request(servidor())
        .put(`/api/usuarios/${admin.id}/restablecer-password`)
        .set('Cookie', cookie)
        .send({ passwordTemporal: 'ClaveRobada#123' });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.mensaje).toContain('permisos que tu propio rol no tiene');
      // La contraseña del Administrador no cambió: la temporal no sirve y la suya sí.
      const conRobada = await request(servidor()).post('/api/auth/login').send({ login: admin.login, password: 'ClaveRobada#123' });
      expect(conRobada.status).toBe(401);
      const conLaSuya = await request(servidor()).post('/api/auth/login').send({ login: admin.login, password: admin.password });
      expect(conLaSuya.status).toBe(204);
    });
  });

  describe('2. Camino indirecto por /api/usuarios: no se degrada al último que puede administrar', () => {
    it(
      'el ÚNICO Administrador no puede degradarse a sí mismo a Operario (409) y conserva su rol y su acceso ' +
        'con la misma sesión',
      async () => {
        const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR', email: 'unico.admin@pruebas.trazo.local' });
        const cookie = await iniciarSesion(servidor(), admin.login, admin.password);

        const respuesta = await request(servidor())
          .put(`/api/usuarios/${admin.id}`)
          .set('Cookie', cookie)
          .send({ nombreCompleto: 'Admin Degradado', email: 'unico.admin@pruebas.trazo.local', rolId: rolOperarioId });

        expect(respuesta.status).toBe(409);
        expect(respuesta.body.error.mensaje).toContain('sin ningún usuario activo que pueda administrar');
        // La transacción se revirtió ENTERA: ni el rol ni el nombre se aplicaron a medias.
        const registro = await contexto.prisma.usuario.findUniqueOrThrow({ where: { id: BigInt(admin.id) } });
        expect(Number(registro.rolId)).toBe(rolAdministradorId);
        expect(registro.nombreCompleto).not.toBe('Admin Degradado');
        // Y sigue administrando el sistema con esa misma sesión.
        expect((await request(servidor()).get('/api/roles').set('Cookie', cookie)).status).toBe(200);
        expect((await request(servidor()).get('/api/usuarios').set('Cookie', cookie)).status).toBe(200);
      },
    );

    it('con DOS administradores sí se puede degradar a uno (204) pero ya no al que queda (409) — el invariante no es un bloqueo ciego', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const otro = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR', email: 'otro.admin@pruebas.trazo.local' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);

      const primera = await request(servidor())
        .put(`/api/usuarios/${otro.id}`)
        .set('Cookie', cookie)
        .send({ nombreCompleto: 'Otro Ya Operario', email: 'otro.admin@pruebas.trazo.local', rolId: rolOperarioId });
      expect(primera.status).toBe(204);

      const segunda = await request(servidor())
        .put(`/api/usuarios/${admin.id}`)
        .set('Cookie', cookie)
        .send({ nombreCompleto: 'Admin', email: `${admin.login}@pruebas.trazo.local`, rolId: rolOperarioId });
      expect(segunda.status).toBe(409);
      expect(Number((await contexto.prisma.usuario.findUniqueOrThrow({ where: { id: BigInt(admin.id) } })).rolId)).toBe(
        rolAdministradorId,
      );
    });
  });

  describe('3. Rol huérfano: un rol con el permiso y CERO usuarios no cuenta como suplente', () => {
    it(
      'crear un rol con `roles.gestionar` y sin usuarios NO habilita quitarle ese permiso al rol que sí tiene gente ' +
        '(409, matriz intacta)',
      async () => {
        // US32 (FR-132): crear un rol CON `roles.gestionar` y quitárselo al Administrador son las
        // dos operaciones reservadas. Se ejercen desde el super administrador para que lo que la
        // prueba comprueba siga siendo el hallazgo de FR-057 —que un rol sin usuarios no cuenta
        // como suplente— y no la reserva, que ya tiene sus propias pruebas.
        const cookie = await sesionDeSuperAdministrador();
        // El escenario original tenía un Administrador ACTIVO encima del rol Administrador: es lo
        // que hace del rol huérfano un suplente FALSO y no simplemente el único que queda. Se
        // conserva tal cual; lo único que cambió es quién ejecuta la edición reservada.
        await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
        const permisosAntes = await permisosDelAdministrador();

        // PASO 1 del hallazgo: un rol activo más que concede el permiso… pero sin nadie encima.
        const huerfano = await request(servidor())
          .post('/api/roles')
          .set('Cookie', cookie)
          .send({ nombre: 'Gestión huérfana', permisoIds: await idsDePermisos([PERMISO_GESTION_ROLES]) });
        expect(huerfano.status).toBe(201);
        expect(await contexto.prisma.rol.count({ where: { estado: 'ACTIVO', permisos: { some: { permiso: { clave: PERMISO_GESTION_ROLES } } } } })).toBe(2);

        // PASO 2 del hallazgo: con 2 roles activos concediéndolo, el conteo de ROLES daba vía
        // libre. El conteo de USUARIOS —que es lo que FR-057 protege— no.
        const respuesta = await request(servidor())
          .put(`/api/roles/${rolAdministradorId}`)
          .set('Cookie', cookie)
          .send({ nombre: ROL_ADMINISTRADOR, permisoIds: await idsDelCatalogoSalvo([PERMISO_GESTION_ROLES, PERMISO_GESTION_USUARIOS]) });

        expect(respuesta.status).toBe(409);
        expect(respuesta.body.error.mensaje).toContain('administrar roles y permisos');
        expect(await permisosDelAdministrador()).toBe(permisosAntes);
        // Sigue habiendo quien administre, con la misma sesión.
        expect((await request(servidor()).get('/api/roles').set('Cookie', cookie)).status).toBe(200);
        expect((await request(servidor()).get('/api/usuarios').set('Cookie', cookie)).status).toBe(200);
      },
    );

    it('con el rol suplente YA ASIGNADO a un usuario activo, la misma edición sí se permite (204)', async () => {
      // Misma razón que arriba: quitarle `roles.gestionar` al Administrador es mover una casilla
      // reservada (US32). El rol suplente se crea con `crearRolDePrueba` (directo en la base), que
      // no pasa por la API y por tanto no toca la reserva.
      const cookie = await sesionDeSuperAdministrador();
      const suplente = await crearRolDePrueba(contexto.prisma, [PERMISO_GESTION_ROLES, PERMISO_GESTION_USUARIOS], 'Gestión delegada real');
      await crearUsuarioDePrueba(contexto, { rolId: suplente.id });

      const respuesta = await request(servidor())
        .put(`/api/roles/${rolAdministradorId}`)
        .set('Cookie', cookie)
        .send({ nombre: ROL_ADMINISTRADOR, permisoIds: await idsDelCatalogoSalvo([PERMISO_GESTION_ROLES]) });

      expect(respuesta.status).toBe(204);
    });
  });

  describe('4. `usuarios.gestionar` está protegido por el mismo invariante que `roles.gestionar`', () => {
    it('no se le puede quitar `usuarios.gestionar` al único rol activo que lo concede (409, y `/api/usuarios` sigue accesible)', async () => {
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), admin.login, admin.password);
      const permisosAntes = await permisosDelAdministrador();

      const respuesta = await request(servidor())
        .put(`/api/roles/${rolAdministradorId}`)
        .set('Cookie', cookie)
        .send({ nombre: ROL_ADMINISTRADOR, permisoIds: await idsDelCatalogoSalvo([PERMISO_GESTION_USUARIOS]) });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error.mensaje).toContain('administrar usuarios');
      expect(await permisosDelAdministrador()).toBe(permisosAntes);
      expect((await request(servidor()).get('/api/usuarios').set('Cookie', cookie)).status).toBe(200);
    });
  });

  describe('5. Desactivación mutua: dos administradores no pueden dejarse a cero entre los dos', () => {
    it(
      'dos peticiones SIMULTÁNEAS de desactivación cruzada dejan exactamente un administrador activo, ' +
        'que además sigue pudiendo iniciar sesión',
      async () => {
        const uno = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR', email: 'mutuo.uno@pruebas.trazo.local' });
        const dos = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR', email: 'mutuo.dos@pruebas.trazo.local' });
        const cookieUno = await iniciarSesion(servidor(), uno.login, uno.password);
        const cookieDos = await iniciarSesion(servidor(), dos.login, dos.password);

        const [respuestaUno, respuestaDos] = await Promise.all([
          request(servidor()).put(`/api/usuarios/${dos.id}/estado`).set('Cookie', cookieUno).send({ estado: 'INACTIVO' }),
          request(servidor()).put(`/api/usuarios/${uno.id}/estado`).set('Cookie', cookieDos).send({ estado: 'INACTIVO' }),
        ]);

        // Una de las dos gana; la otra recibe 409 (o 401, si su sesión murió al desactivarse
        // su usuario antes de que el guard la revalidara — ambas son respuestas correctas).
        const estados = [respuestaUno.status, respuestaDos.status].sort();
        expect(estados[0]).toBe(204);
        expect([401, 409]).toContain(estados[1]);

        const administradoresActivos = await contexto.prisma.usuario.count({
          where: { estado: 'ACTIVO', rol: { permisos: { some: { permiso: { clave: PERMISO_GESTION_ROLES } } } } },
        });
        expect(administradoresActivos).toBe(1);

        // El que quedó puede entrar y administrar: el sistema NO quedó bloqueado.
        const sobreviviente = (await contexto.prisma.usuario.findFirstOrThrow({
          where: { estado: 'ACTIVO', rol: { permisos: { some: { permiso: { clave: PERMISO_GESTION_ROLES } } } } },
        })).login;
        const password = sobreviviente === uno.login ? uno.password : dos.password;
        const cookieSobreviviente = await iniciarSesion(servidor(), sobreviviente, password);
        expect((await request(servidor()).get('/api/roles').set('Cookie', cookieSobreviviente)).status).toBe(200);
      },
    );

    it(
      'dos gestores distintos desactivando SIMULTÁNEAMENTE a los dos únicos administradores: solo uno lo ' +
        'consigue (la garantía es la transacción, no la suerte del orden de llegada)',
      async () => {
        // Variante determinista de la anterior. Allí los actores SON los objetivos, así que la
        // segunda petición puede morir con 401 (su propia sesión se invalidó) antes de llegar
        // al invariante: el sistema queda a salvo, pero por el guard de sesión, no por FR-057.
        // Aquí los actores no se tocan a sí mismos —solo tienen `usuarios.gestionar`—, así que
        // sus dos peticiones llegan enteras hasta la transacción y es ESA la que decide.
        const soloUsuarios = await crearRolDePrueba(contexto.prisma, [PERMISO_GESTION_USUARIOS], 'Gestores de baja');
        const gestorUno = await crearUsuarioDePrueba(contexto, { rolId: soloUsuarios.id, email: 'gestor.uno@pruebas.trazo.local' });
        const gestorDos = await crearUsuarioDePrueba(contexto, { rolId: soloUsuarios.id, email: 'gestor.dos@pruebas.trazo.local' });
        const adminUno = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR', email: 'admin.uno@pruebas.trazo.local' });
        const adminDos = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR', email: 'admin.dos@pruebas.trazo.local' });
        const cookieUno = await iniciarSesion(servidor(), gestorUno.login, gestorUno.password);
        const cookieDos = await iniciarSesion(servidor(), gestorDos.login, gestorDos.password);

        const [respuestaUno, respuestaDos] = await Promise.all([
          request(servidor()).put(`/api/usuarios/${adminUno.id}/estado`).set('Cookie', cookieUno).send({ estado: 'INACTIVO' }),
          request(servidor()).put(`/api/usuarios/${adminDos.id}/estado`).set('Cookie', cookieDos).send({ estado: 'INACTIVO' }),
        ]);

        expect([respuestaUno.status, respuestaDos.status].sort()).toEqual([204, 409]);
        const administradoresActivos = await contexto.prisma.usuario.count({
          where: { estado: 'ACTIVO', rol: { permisos: { some: { permiso: { clave: PERMISO_GESTION_ROLES } } } } },
        });
        expect(administradoresActivos).toBe(1);
      },
    );

    it('un administrador tampoco puede desactivar al ÚLTIMO que puede administrar, aunque no sea él mismo (409)', async () => {
      // El actor tiene `usuarios.gestionar` pero NO `roles.gestionar`; el objetivo es el único
      // que puede administrar roles. Desactivarlo dejaría el sistema sin nadie que lo pudiera
      // hacer, y la regla de auto-desactivación de US6 no lo detecta (son usuarios distintos).
      const soloUsuarios = await crearRolDePrueba(contexto.prisma, [PERMISO_GESTION_USUARIOS], 'Solo usuarios baja');
      const gestor = await crearUsuarioDePrueba(contexto, { rolId: soloUsuarios.id });
      const admin = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
      const cookie = await iniciarSesion(servidor(), gestor.login, gestor.password);

      const respuesta = await request(servidor())
        .put(`/api/usuarios/${admin.id}/estado`)
        .set('Cookie', cookie)
        .send({ estado: 'INACTIVO' });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error.mensaje).toContain('administrar roles y permisos');
      const registro = await contexto.prisma.usuario.findUniqueOrThrow({ where: { id: BigInt(admin.id) } });
      expect(registro.estado).toBe('ACTIVO');
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
