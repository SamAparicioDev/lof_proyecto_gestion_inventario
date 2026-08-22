/**
 * Prueba de integración del BUZÓN DE SOLICITUDES (T282, US36) — la ruta real contra la aplicación
 * montada y PostgreSQL de verdad.
 *
 * Lo que SOLO se puede ver aquí, y que las unitarias no cubren:
 *
 * 1. **Que un Administrador con la matriz de permisos COMPLETA recibe 403 en los seis endpoints**
 *    (FR-148, SC-019). Es la garantía central del módulo y no se puede probar con dobles: hay que
 *    atravesar los tres guards globales en su orden real. La prueba le concede al rol TODOS los
 *    permisos del catálogo antes de llamar, precisamente para demostrar que ningún permiso —ni
 *    todos juntos— abre esta puerta.
 * 2. **Que el buzón funciona ENTERO con el modelo apagado** (FR-155). La suite retira las
 *    variables del proveedor antes de construir la aplicación, igual que `asistente.spec.ts`: sin
 *    eso, el escenario lo decidiría el entorno de la máquina, y una prueba cuyo escenario decide
 *    el entorno no prueba nada.
 * 3. **Que refinar con el servicio caído responde 200 con aviso, nunca 500**, y deja la solicitud
 *    intacta.
 *
 * REQUIERE ENTORNO LOCAL con PostgreSQL vivo (`DATABASE_URL_TEST` en `backend/.env`, ver
 * `jest.setup.ts`) — `npm run test:integracion -w backend` (NUNCA contra `trazo`).
 */
import request from 'supertest';
import { NOMBRE_COOKIE_SESION } from '../../src/infraestructura/seguridad/cookie-sesion';
import {
  cerrarAppDePrueba,
  crearAppDePrueba,
  crearUsuarioDePrueba,
  truncarTablas,
  type AppDePrueba,
} from './setup';

describe('Buzón de solicitudes — /api/solicitudes (T282, US36)', () => {
  let contexto: AppDePrueba;

  /** Las tres variables que el adaptador consulta para decidir si hay servicio configurado. */
  const VARIABLES_DEL_PROVEEDOR = ['API_KEY_GOOGLE_AI_STUDIO', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'] as const;
  const valoresOriginales = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const nombre of VARIABLES_DEL_PROVEEDOR) {
      valoresOriginales.set(nombre, process.env[nombre]);
      // Vacías, no borradas: `ConfigModule.forRoot()` recarga `backend/.env` al construir la
      // aplicación y dotenv repone toda clave que no exista ya (misma lección que asistente.spec).
      process.env[nombre] = '';
    }
    contexto = await crearAppDePrueba();
  });

  afterAll(async () => {
    await cerrarAppDePrueba(contexto.app);
    for (const [nombre, valor] of valoresOriginales) {
      if (valor === undefined) delete process.env[nombre];
      else process.env[nombre] = valor;
    }
  });

  beforeEach(async () => {
    await truncarTablas(contexto.prisma);
  });

  const servidor = (): ReturnType<AppDePrueba['app']['getHttpServer']> => contexto.app.getHttpServer();

  /** El id del rol de respaldo, que la migración siembra con `es_super_admin = true` (US30). */
  async function idRolDeRespaldo(): Promise<number> {
    const rol = await contexto.prisma.rol.findFirstOrThrow({ where: { esSuperAdmin: true } });
    return Number(rol.id);
  }

  /** Usuario con el rol de respaldo, asignado DIRECTAMENTE en la base — la única vía que el
   *  sistema admite (FR-128), y el mismo camino que usa un operador real. */
  async function crearSuperAdmin(): Promise<{ login: string; password: string }> {
    const usuario = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });
    await contexto.prisma.usuario.update({
      where: { id: BigInt(usuario.id) },
      data: { rolId: BigInt(await idRolDeRespaldo()) },
    });
    return { login: usuario.login, password: usuario.password };
  }

  async function cookieDeSuperAdmin(): Promise<string> {
    const superAdmin = await crearSuperAdmin();
    return iniciarSesion(servidor(), superAdmin.login, superAdmin.password);
  }

  it('sin sesión responde 401, como toda ruta de negocio', async () => {
    expect((await request(servidor()).get('/api/solicitudes')).status).toBe(401);
  });

  it('un Administrador con TODOS los permisos del catálogo recibe 403 en los seis endpoints (FR-148, SC-019)', async () => {
    const administrador = await crearUsuarioDePrueba(contexto, { rol: 'ADMINISTRADOR' });

    // Se le concede al rol Administrador el catálogo ENTERO: si algún permiso —o la suma de
    // todos— pudiera abrir este módulo, aquí se vería. Ese es el punto de la prueba.
    const rol = await contexto.prisma.rol.findFirstOrThrow({ where: { nombre: 'Administrador' } });
    const permisos = await contexto.prisma.permiso.findMany();
    await contexto.prisma.rolPermiso.createMany({
      data: permisos.map((permiso) => ({ rolId: rol.id, permisoId: permiso.id })),
      skipDuplicates: true,
    });

    const cookie = await iniciarSesion(servidor(), administrador.login, administrador.password);
    const servidorHttp = servidor();

    const respuestas = await Promise.all([
      request(servidorHttp).get('/api/solicitudes').set('Cookie', cookie),
      request(servidorHttp).post('/api/solicitudes').set('Cookie', cookie).send({
        titulo: 'Un intento',
        descripcion: 'Una descripción suficientemente larga para pasar el esquema.',
      }),
      request(servidorHttp).get('/api/solicitudes/1').set('Cookie', cookie),
      request(servidorHttp).patch('/api/solicitudes/1').set('Cookie', cookie).send({
        titulo: 'Otro intento',
        descripcion: 'Otra descripción suficientemente larga para pasar el esquema.',
      }),
      request(servidorHttp).patch('/api/solicitudes/1/estado').set('Cookie', cookie).send({ estado: 'COMPLETADA' }),
      request(servidorHttp).post('/api/solicitudes/1/refinar').set('Cookie', cookie),
    ]);

    for (const respuesta of respuestas) {
      expect(respuesta.status).toBe(403);
    }
    // Y nada se escribió por el camino.
    expect(await contexto.prisma.solicitudFuncionalidad.count()).toBe(0);
  });

  it('el super administrador anota una solicitud y nace PENDIENTE con su autor (FR-149, FR-150)', async () => {
    const cookie = await cookieDeSuperAdmin();

    const alta = await request(servidor()).post('/api/solicitudes').set('Cookie', cookie).send({
      titulo: 'Filtrar el consumo por proveedor',
      descripcion: 'Hoy toca exportar a Excel y filtrar a mano cuando reviso el consumo de un cliente.',
    });

    expect(alta.status).toBe(201);
    expect(alta.body.estado).toBe('PENDIENTE');
    expect(alta.body.promptRefinado).toBeNull();
    expect(alta.body.creadaPor.nombreCompleto).toBeTruthy();
    expect(alta.body.estadoCambiadoPor).toBeNull();
  });

  it('filtra por estado y el contador de pendientes NO se mueve con el filtro (FR-157)', async () => {
    const cookie = await cookieDeSuperAdmin();
    const servidorHttp = servidor();

    for (const titulo of ['Primera', 'Segunda', 'Tercera']) {
      await request(servidorHttp)
        .post('/api/solicitudes')
        .set('Cookie', cookie)
        .send({ titulo, descripcion: `Descripción de ${titulo}, con largo suficiente para el esquema.` })
        .expect(201);
    }

    const todas = await request(servidorHttp).get('/api/solicitudes').set('Cookie', cookie);
    expect(todas.body.total).toBe(3);
    expect(todas.body.pendientes).toBe(3);

    const primera = todas.body.datos[0];
    await request(servidorHttp)
      .patch(`/api/solicitudes/${primera.id}/estado`)
      .set('Cookie', cookie)
      .send({ estado: 'COMPLETADA' })
      .expect(200);

    // Mirando SOLO las completadas, `total` es 1 pero `pendientes` sigue diciendo 2: responde
    // "cuánto trabajo espera", y eso no cambia porque se haya cambiado de pestaña.
    const completadas = await request(servidorHttp)
      .get('/api/solicitudes?estado=COMPLETADA')
      .set('Cookie', cookie);
    expect(completadas.body.total).toBe(1);
    expect(completadas.body.pendientes).toBe(2);
  });

  it('el cambio de estado deja auditoría y se puede REABRIR lo completado (FR-154, FR-045)', async () => {
    const cookie = await cookieDeSuperAdmin();
    const servidorHttp = servidor();

    const alta = await request(servidorHttp).post('/api/solicitudes').set('Cookie', cookie).send({
      titulo: 'Algo que vuelve a hacer falta',
      descripcion: 'Una descripción con largo suficiente para pasar el esquema compartido.',
    });

    const completada = await request(servidorHttp)
      .patch(`/api/solicitudes/${alta.body.id}/estado`)
      .set('Cookie', cookie)
      .send({ estado: 'COMPLETADA' });
    expect(completada.status).toBe(200);
    expect(completada.body.estado).toBe('COMPLETADA');
    expect(completada.body.estadoCambiadoPor).not.toBeNull();
    expect(completada.body.estadoCambiadoEn).toBeTruthy();

    const reabierta = await request(servidorHttp)
      .patch(`/api/solicitudes/${alta.body.id}/estado`)
      .set('Cookie', cookie)
      .send({ estado: 'PENDIENTE' });
    expect(reabierta.status).toBe(200);
    expect(reabierta.body.estado).toBe('PENDIENTE');
  });

  it('editar el texto NO borra ni altera el prompt guardado (FR-152)', async () => {
    const cookie = await cookieDeSuperAdmin();
    const servidorHttp = servidor();

    const alta = await request(servidorHttp).post('/api/solicitudes').set('Cookie', cookie).send({
      titulo: 'Título original',
      descripcion: 'Descripción original, con largo suficiente para el esquema compartido.',
    });

    // Se siembra un prompt directamente en BD: el escenario que importa es "ya había uno", y
    // generarlo de verdad exigiría el modelo real, que esta suite tiene apagado a propósito.
    await contexto.prisma.solicitudFuncionalidad.update({
      where: { id: BigInt(alta.body.id) },
      data: { promptRefinado: '## Qué se pide\nUn prompt previo.', refinadoEn: new Date() },
    });

    const editada = await request(servidorHttp).patch(`/api/solicitudes/${alta.body.id}`).set('Cookie', cookie).send({
      titulo: 'Título corregido',
      descripcion: 'Descripción corregida, también con largo suficiente para el esquema.',
    });

    expect(editada.status).toBe(200);
    expect(editada.body.titulo).toBe('Título corregido');
    expect(editada.body.promptRefinado).toBe('## Qué se pide\nUn prompt previo.');
  });

  it('con el modelo APAGADO, refinar responde 200 con aviso y el resto del buzón sigue entero (FR-155)', async () => {
    for (const nombre of VARIABLES_DEL_PROVEEDOR) {
      expect(process.env[nombre] ?? '').toBe('');
    }

    const cookie = await cookieDeSuperAdmin();
    const servidorHttp = servidor();

    const alta = await request(servidorHttp).post('/api/solicitudes').set('Cookie', cookie).send({
      titulo: 'Con el modelo caído',
      descripcion: 'Una descripción con largo suficiente para pasar el esquema compartido.',
    });
    expect(alta.status).toBe(201);

    const refinado = await request(servidorHttp)
      .post(`/api/solicitudes/${alta.body.id}/refinar`)
      .set('Cookie', cookie);

    expect(refinado.status).toBe(200);
    expect(refinado.body.disponible).toBe(false);
    expect(refinado.body.prompt).toBeNull();
    expect(refinado.body.aviso).toContain('no está configurado');

    // La solicitud sigue intacta y el resto del módulo responde con normalidad.
    const despues = await request(servidorHttp).get(`/api/solicitudes/${alta.body.id}`).set('Cookie', cookie);
    expect(despues.status).toBe(200);
    expect(despues.body.promptRefinado).toBeNull();
    expect(despues.body.descripcion).toContain('largo suficiente');

    const listado = await request(servidorHttp).get('/api/solicitudes').set('Cookie', cookie);
    expect(listado.status).toBe(200);
    expect(listado.body.pendientes).toBe(1);
  });

  it('valida el cuerpo con el esquema compartido, con mensajes en español (FR-047)', async () => {
    const cookie = await cookieDeSuperAdmin();
    const servidorHttp = servidor();

    const corta = await request(servidorHttp)
      .post('/api/solicitudes')
      .set('Cookie', cookie)
      .send({ titulo: 'ok', descripcion: 'corta' });
    expect(corta.status).toBe(400);
    expect(corta.body.error.campos.titulo).toContain('título');
    expect(corta.body.error.campos.descripcion).toContain('descripción');

    const alta = await request(servidorHttp).post('/api/solicitudes').set('Cookie', cookie).send({
      titulo: 'Un título válido',
      descripcion: 'Una descripción con largo suficiente para pasar el esquema compartido.',
    });
    const estadoInvalido = await request(servidorHttp)
      .patch(`/api/solicitudes/${alta.body.id}/estado`)
      .set('Cookie', cookie)
      .send({ estado: 'EN_PROGRESO' });
    expect(estadoInvalido.status).toBe(400);
    expect(estadoInvalido.body.error.campos.estado).toContain('PENDIENTE');
  });

  it('un id inexistente responde 404, no 500', async () => {
    const cookie = await cookieDeSuperAdmin();
    expect((await request(servidor()).get('/api/solicitudes/999999').set('Cookie', cookie)).status).toBe(404);
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
