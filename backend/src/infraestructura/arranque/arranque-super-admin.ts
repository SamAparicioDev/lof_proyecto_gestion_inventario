/**
 * Crea el usuario SUPER ADMINISTRADOR al arrancar, si no existe (US30, FR-129).
 *
 * ## Por qué al arrancar y no en una migración ni en el seed
 *
 * - **No en una migración**: crear el usuario exige un hash bcrypt, y una contraseña dentro de un
 *   archivo de migración es una contraseña dentro del repositorio para siempre — en el historial
 *   de git aunque después se cambie.
 * - **No en el seed**: `prisma/seed.ts` NO se ejecuta en producción, precisamente porque crearía
 *   usuarios con contraseñas conocidas. Un respaldo que solo existe en la máquina de desarrollo
 *   no sirve para nada: el bloqueo que motivó esta historia ocurrió en producción.
 *
 * El arranque del contenedor es el único momento que cumple las tres condiciones: corre en
 * producción, corre después de `prisma migrate deploy` (ver el `CMD` del Dockerfile, que las
 * encadena) y tiene acceso a las variables de entorno del servidor, donde la contraseña sí puede
 * vivir sin quedar versionada.
 *
 * ## Reglas
 *
 * - **Si el usuario ya existe, NO se toca**: ni su contraseña, ni su rol, ni su estado. Un
 *   reinicio del contenedor no puede revertir un cambio deliberado.
 * - **Si faltan las variables, la aplicación arranca igual** y lo deja anotado. Negarse a
 *   arrancar por no poder crear una llave de repuesto sería peor que no tenerla: dejaría el
 *   sistema entero caído por una precaución.
 * - **La contraseña nunca se registra en el log**, ni siquiera parcialmente.
 *
 * El usuario nace con `debe_cambiar_password = true` (el defecto de la tabla): quien entre con la
 * contraseña del entorno la cambia en ese momento. La contraseña del entorno es, por tanto, la
 * llave para ABRIR la primera vez; si después se pierde la definitiva, la vía de recuperación es
 * la misma que la de asignación del rol — la base de datos.
 *
 * Implementa: FR-129.
 */
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { HASHEADOR, type Hasheador } from '../../dominio/puertos/hasheador';
import { REPOSITORIO_ROLES, type RepositorioRoles } from '../../dominio/puertos/repositorio-roles';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';

/** Nombres de las variables de entorno, juntos para que el mensaje del log las nombre igual que
 *  la documentación de despliegue. */
const VARIABLES = {
  login: 'SUPERADMIN_LOGIN',
  email: 'SUPERADMIN_EMAIL',
  password: 'SUPERADMIN_PASSWORD',
  nombre: 'SUPERADMIN_NOMBRE',
} as const;

@Injectable()
export class ArranqueSuperAdmin implements OnApplicationBootstrap {
  private readonly logger = new Logger(ArranqueSuperAdmin.name);

  constructor(
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
    @Inject(REPOSITORIO_ROLES) private readonly repositorioRoles: RepositorioRoles,
    @Inject(HASHEADOR) private readonly hasheador: Hasheador,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const login = process.env[VARIABLES.login]?.trim();
    const password = process.env[VARIABLES.password];
    const email = process.env[VARIABLES.email]?.trim();

    if (!login || !password || !email) {
      this.logger.warn(
        `Sin usuario de respaldo: faltan ${VARIABLES.login}, ${VARIABLES.email} o ${VARIABLES.password}. ` +
          'La aplicación funciona igual, pero no habrá una llave de repuesto si un cambio de permisos ' +
          'deja al sistema sin quién lo administre (FR-129).',
      );
      return;
    }

    const rol = await this.repositorioRoles.buscarRolDeRespaldo();
    if (!rol) {
      // No debería ocurrir: la migración `20260819090000_super_administrador` lo crea y el
      // Dockerfile aplica las migraciones antes de arrancar. Si falta, es un despliegue a medias
      // y decirlo claro vale más que un fallo silencioso.
      this.logger.error('No existe el rol de respaldo en la base de datos: revisa que las migraciones se aplicaran.');
      return;
    }

    const existente = await this.repositorioUsuarios.buscarPorLogin(login);
    if (existente) {
      this.logger.log(`El usuario de respaldo "${login}" ya existe: no se modifica nada.`);
      return;
    }

    await this.repositorioUsuarios.crear({
      nombreCompleto: process.env[VARIABLES.nombre]?.trim() || 'Super administrador',
      email,
      login,
      passwordHash: await this.hasheador.hash(password),
      rolId: rol.id,
    });
    this.logger.log(`Usuario de respaldo "${login}" creado con el rol "${rol.nombre}".`);
  }
}
