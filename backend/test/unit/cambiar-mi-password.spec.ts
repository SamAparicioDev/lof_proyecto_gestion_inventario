/**
 * Prueba UNITARIA de `CambiarMiPasswordCasoUso` (FR-004) — sin NestJS, sin Prisma, sin
 * bcrypt real: inyecta implementaciones FALSAS en memoria de los puertos `Hasheador` y
 * `RepositorioUsuarios`. Es la prueba que demuestra el beneficio de la arquitectura
 * hexagonal (research R10, docs/arquitectura.md §8): la regla de negocio se verifica en
 * aislamiento total, sin levantar PostgreSQL.
 *
 * Nota: el caso de uso rechaza la contraseña actual incorrecta con `EstadoInvalido` (no
 * `ErrorValidacionDominio`) — así lo mapea `contracts/api-rest.md` (`PUT /api/auth/password`
 * → `409` "password actual incorrecta") y así lo traduce `FiltroErroresDominio`
 * (`EstadoInvalido` → 409). Esta prueba verifica ese comportamiento real.
 */
import { CambiarMiPasswordCasoUso } from '../../src/aplicacion/usuarios/cambiar-mi-password.caso-uso';
import { EstadoInvalido } from '../../src/dominio/comunes/errores';
import type { ClavePermiso } from '../../src/dominio/entidades/permiso';
import type { Usuario } from '../../src/dominio/entidades/usuario';
import type { Hasheador } from '../../src/dominio/puertos/hasheador';
import type {
  DatosActualizarUsuario,
  DatosNuevoUsuario,
  FiltrosListarUsuarios,
  GuardiaCapacidadAdministrativa,
  PaginaUsuarios,
  RepositorioUsuarios,
  TitularDePermiso,
  UsuarioAutenticable,
} from '../../src/dominio/puertos/repositorio-usuarios';

/** Prefijo reconocible que distingue un "hash" falso de la contraseña en texto plano. */
const PREFIJO_HASH_FALSO = 'hash-falso::';

/** `Hasheador` falso: hash reversible y determinista, suficiente para comparar en memoria. */
class HasheadorFalso implements Hasheador {
  async hash(password: string): Promise<string> {
    return `${PREFIJO_HASH_FALSO}${password}`;
  }

  async comparar(password: string, hash: string): Promise<boolean> {
    return hash === `${PREFIJO_HASH_FALSO}${password}`;
  }
}

/**
 * `RepositorioUsuarios` falso en memoria: solo implementa lo que este caso de uso necesita,
 * y registra la última llamada a `actualizarPassword` para poder verificarla (patrón spy
 * manual, sin librería de mocking — Principio V).
 */
class RepositorioUsuariosFalso implements RepositorioUsuarios {
  private readonly usuarios = new Map<number, UsuarioAutenticable>();
  llamadaActualizarPassword: { id: number; passwordHash: string; debeCambiarPassword: boolean } | null = null;

  constructor(usuarioInicial: UsuarioAutenticable) {
    this.usuarios.set(usuarioInicial.id, usuarioInicial);
  }

  async buscarPorLogin(login: string): Promise<UsuarioAutenticable | null> {
    return [...this.usuarios.values()].find((usuario) => usuario.login === login) ?? null;
  }

  async buscarPorId(id: number): Promise<Usuario | null> {
    return this.usuarios.get(id) ?? null;
  }

  async buscarConCredencialesPorId(id: number): Promise<UsuarioAutenticable | null> {
    return this.usuarios.get(id) ?? null;
  }

  async actualizarPassword(id: number, passwordHash: string, debeCambiarPassword: boolean): Promise<void> {
    this.llamadaActualizarPassword = { id, passwordHash, debeCambiarPassword };
    const usuario = this.usuarios.get(id);
    if (usuario) {
      this.usuarios.set(id, { ...usuario, passwordHash, debeCambiarPassword });
    }
  }

  // Los siguientes 5 métodos (T075, administración de usuarios — US6; el último, la
  // protección de FR-057 de la Tanda 13) son ajenos a esta prueba de
  // `CambiarMiPasswordCasoUso` (FR-004): implementación mínima solo para satisfacer la
  // interfaz completa del puerto, sin usarse en ningún caso de esta suite.
  async listar(_filtros: FiltrosListarUsuarios): Promise<PaginaUsuarios> {
    return { datos: [...this.usuarios.values()], total: this.usuarios.size };
  }

  async crear(_datos: DatosNuevoUsuario): Promise<Usuario> {
    throw new Error('RepositorioUsuariosFalso.crear no está soportado en esta suite');
  }

  async actualizar(
    _id: number,
    _datos: DatosActualizarUsuario,
    _guardia: GuardiaCapacidadAdministrativa,
  ): Promise<void> {
    throw new Error('RepositorioUsuariosFalso.actualizar no está soportado en esta suite');
  }

  async cambiarEstado(
    _id: number,
    _estado: Usuario['estado'],
    _guardia: GuardiaCapacidadAdministrativa,
  ): Promise<void> {
    throw new Error('RepositorioUsuariosFalso.cambiarEstado no está soportado en esta suite');
  }

  async listarTitularesActivosDePermiso(_permiso: ClavePermiso): Promise<TitularDePermiso[]> {
    throw new Error('RepositorioUsuariosFalso.listarTitularesActivosDePermiso no está soportado en esta suite');
  }
}

/**
 * Usuario de prueba con la contraseña actual "ClaveVieja#1" ya hasheada por el falso.
 *
 * `rolAsignado` (US9/T101) es el rol completo con sus permisos efectivos: este caso de uso no
 * lo consulta —cambiar la propia contraseña no exige ningún permiso (FR-004)—, pero la
 * entidad `Usuario` lo declara desde que la autorización se resuelve contra permisos, así que
 * el usuario de prueba debe ser una entidad completa y no una a medias.
 */
function crearUsuarioDePrueba(): UsuarioAutenticable {
  return {
    id: 1,
    nombreCompleto: 'Usuaria de Prueba',
    email: 'prueba@trazo.local',
    login: 'usuaria.prueba',
    rolAsignado: {
      id: 3,
      nombre: 'Operario',
      descripcion: 'Registro de entradas/salidas y consultas',
      esSistema: true,
    esSuperAdmin: false,
      estado: 'ACTIVO',
      permisos: ['inventario.ver', 'ingresos.crear', 'salidas.crear'],
    },
    estado: 'ACTIVO',
    debeCambiarPassword: true,
    passwordHash: `${PREFIJO_HASH_FALSO}ClaveVieja#1`,
  };
}

describe('CambiarMiPasswordCasoUso', () => {
  it('rechaza con EstadoInvalido cuando la contraseña actual no coincide, y NO actualiza nada', async () => {
    const repositorio = new RepositorioUsuariosFalso(crearUsuarioDePrueba());
    const casoUso = new CambiarMiPasswordCasoUso(new HasheadorFalso(), repositorio);

    await expect(
      casoUso.ejecutar({ usuarioId: 1, passwordActual: 'clave-incorrecta', passwordNueva: 'ClaveNueva#2' }),
    ).rejects.toThrow(EstadoInvalido);

    expect(repositorio.llamadaActualizarPassword).toBeNull();
  });

  it('actualiza la password con el hash esperado y debeCambiarPassword=false cuando la actual es correcta', async () => {
    const repositorio = new RepositorioUsuariosFalso(crearUsuarioDePrueba());
    const casoUso = new CambiarMiPasswordCasoUso(new HasheadorFalso(), repositorio);

    await casoUso.ejecutar({ usuarioId: 1, passwordActual: 'ClaveVieja#1', passwordNueva: 'ClaveNueva#2' });

    expect(repositorio.llamadaActualizarPassword).toEqual({
      id: 1,
      passwordHash: `${PREFIJO_HASH_FALSO}ClaveNueva#2`,
      debeCambiarPassword: false,
    });
  });
});
