/**
 * Adaptador `RepositorioRolesPrisma` — implementa el puerto `RepositorioRoles` del dominio
 * con Prisma (patrón Repository/Adapter, docs/arquitectura.md §3). Único punto del backend
 * donde las tablas `roles`/`roles_permisos` se traducen a la entidad `Rol` del dominio.
 *
 * Decisiones que este archivo concentra:
 * - **Una sola traducción fila→entidad**: `aRolDominio` (y su `include` `CON_PERMISOS`) se
 *   EXPORTAN porque `repositorio-usuarios.prisma.ts` necesita exactamente la misma para
 *   resolver el rol y sus permisos del usuario autenticado en cada petición. Dos copias
 *   podrían desincronizarse, y una discrepancia en la lista de permisos es un fallo de
 *   control de acceso, no un detalle cosmético (Principio III).
 * - **`actualizar` reemplaza la matriz completa dentro de UNA transacción**: borrar los
 *   `roles_permisos` del rol y volver a crearlos en dos operaciones sueltas dejaría una
 *   ventana en la que el rol no concede nada, y los permisos se resuelven en CADA petición
 *   (US9-AS3) — cualquier usuario con ese rol recibiría 403 en esa ventana.
 * - **Errores técnicos traducidos a errores de dominio** (docs/arquitectura.md §2): `P2002`
 *   (UNIQUE de `roles.nombre`) → `Duplicado('nombre', ...)`; `P2003` (FK) → según la
 *   operación, un permiso inexistente al escribir la matriz (`400`) o un rol todavía
 *   referenciado por usuarios al eliminar (`409`); `P2025` → `NoEncontrado`.
 *
 * Implementa: FR-054 (permisos como datos), FR-055 (CRUD de roles y su matriz), FR-057
 * (conteos que sostienen los invariantes anti-bloqueo, verificados en el caso de uso — T105)
 * y FR-058 (los permisos efectivos que la autorización consulta salen de estas tablas).
 */
import { Injectable } from '@nestjs/common';
import { Prisma, type EstadoRol as EstadoRolPrisma } from '@prisma/client';
import { Duplicado, ErrorValidacionDominio, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import type { ClavePermiso } from '../../dominio/entidades/permiso';
import type { EstadoRol, Rol } from '../../dominio/entidades/rol';
import type {
  DatosRol,
  FiltrosListarRoles,
  PaginaRoles,
  RepositorioRoles,
  RolConUsuarios,
} from '../../dominio/puertos/repositorio-roles';
import { PrismaService } from './prisma.service';

/**
 * `include` que trae el rol con sus permisos resueltos. Se exporta para que TODA lectura de
 * un rol del sistema —aquí y en `repositorio-usuarios.prisma.ts`— produzca la misma forma y
 * pueda traducirse con `aRolDominio`.
 */
export const INCLUIR_PERMISOS_DEL_ROL = { permisos: { include: { permiso: true } } } as const;

/** Fila de `roles` con su matriz de permisos resuelta — lo que `aRolDominio` sabe traducir. */
export type RolConPermisos = Prisma.RolGetPayload<{ include: typeof INCLUIR_PERMISOS_DEL_ROL }>;

/** Igual que `INCLUIR_PERMISOS_DEL_ROL`, más el conteo de usuarios que exige el listado. */
const INCLUIR_PERMISOS_Y_CONTEO = {
  ...INCLUIR_PERMISOS_DEL_ROL,
  _count: { select: { usuarios: true } },
} as const;

type RolConPermisosYConteo = Prisma.RolGetPayload<{ include: typeof INCLUIR_PERMISOS_Y_CONTEO }>;

@Injectable()
export class RepositorioRolesPrisma implements RepositorioRoles {
  constructor(private readonly prisma: PrismaService) {}

  async listar(filtros: FiltrosListarRoles): Promise<PaginaRoles> {
    const where = construirWhereListarRoles(filtros);
    const [registros, total] = await this.prisma.$transaction([
      this.prisma.rol.findMany({
        where,
        include: INCLUIR_PERMISOS_Y_CONTEO,
        orderBy: { nombre: 'asc' },
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
      }),
      this.prisma.rol.count({ where }),
    ]);
    return { datos: registros.map(aRolConUsuarios), total };
  }

  async buscarPorId(id: number): Promise<Rol | null> {
    const registro = await this.prisma.rol.findUnique({
      where: { id: BigInt(id) },
      include: INCLUIR_PERMISOS_DEL_ROL,
    });
    return registro ? aRolDominio(registro) : null;
  }

  async crear(datos: DatosRol): Promise<Rol> {
    try {
      const registro = await this.prisma.rol.create({
        data: {
          nombre: datos.nombre,
          descripcion: datos.descripcion,
          permisos: { create: filasMatriz(datos.permisoIds) },
        },
        include: INCLUIR_PERMISOS_DEL_ROL,
      });
      return aRolDominio(registro);
    } catch (error) {
      throw traducirErrorEscrituraRol(error);
    }
  }

  async actualizar(id: number, datos: DatosRol): Promise<void> {
    const rolId = BigInt(id);
    try {
      // Una sola transacción: el rol nunca queda visible sin permisos entre el borrado y el
      // alta de su nueva matriz (ver TSDoc de la clase). `update` es lo que falla con `P2025`
      // si el rol no existe, y al ir en la misma transacción revierte también el `deleteMany`.
      await this.prisma.$transaction([
        this.prisma.rolPermiso.deleteMany({ where: { rolId } }),
        this.prisma.rol.update({
          where: { id: rolId },
          data: {
            nombre: datos.nombre,
            descripcion: datos.descripcion,
            permisos: { create: filasMatriz(datos.permisoIds) },
          },
        }),
      ]);
    } catch (error) {
      throw traducirErrorEscrituraRol(error);
    }
  }

  async cambiarEstado(id: number, estado: EstadoRol): Promise<void> {
    try {
      await this.prisma.rol.update({
        where: { id: BigInt(id) },
        data: { estado: mapearEstadoAPrisma(estado) },
      });
    } catch (error) {
      throw traducirErrorEscrituraRol(error);
    }
  }

  async eliminar(id: number): Promise<void> {
    try {
      // Los `roles_permisos` del rol se van con él (`onDelete: Cascade`); los usuarios NO
      // (`ON DELETE RESTRICT`): esa FK es la última línea de defensa de FR-057.
      await this.prisma.rol.delete({ where: { id: BigInt(id) } });
    } catch (error) {
      throw traducirErrorEliminacionRol(error);
    }
  }

  async contarUsuarios(rolId: number): Promise<number> {
    return this.prisma.usuario.count({ where: { rolId: BigInt(rolId) } });
  }

  async contarRolesActivosConPermiso(permiso: ClavePermiso): Promise<number> {
    return this.prisma.rol.count({
      where: { estado: 'ACTIVO', permisos: { some: { permiso: { clave: permiso } } } },
    });
  }
}

/** Filtro de estado del listado (`GET /api/roles?estado=`) — mismo patrón que usuarios. */
function construirWhereListarRoles(filtros: FiltrosListarRoles): Prisma.RolWhereInput {
  return filtros.estado ? { estado: mapearEstadoAPrisma(filtros.estado) } : {};
}

/**
 * Filas de `roles_permisos` a crear para el conjunto de permisos recibido.
 *
 * Deduplica porque los permisos de un rol son un CONJUNTO: `roles_permisos` tiene PK compuesta
 * `(rol_id, permiso_id)`, así que un id repetido en el cuerpo de la petición (`[7, 7]`) la
 * violaría y llegaría como `P2002` — que `traducirErrorEscrituraRol` interpretaría, con razón
 * en cualquier otro caso, como el `UNIQUE` de `roles.nombre`, respondiendo "Ya existe un rol
 * con ese nombre" a quien nunca repitió un nombre. Enviar el mismo permiso dos veces no es un
 * error del usuario: describe el mismo conjunto.
 */
function filasMatriz(permisoIds: readonly number[]): { permisoId: bigint }[] {
  return [...new Set(permisoIds)].map((permisoId) => ({ permisoId: BigInt(permisoId) }));
}

/**
 * Traduce una fila de `roles` (con su matriz resuelta) a la entidad de dominio. El dominio
 * recibe CLAVES de permiso, no ids: la clave (`modulo.accion`) es el identificador estable
 * que compara `PermisosGuard` y que viaja al frontend, mientras que el id depende del orden
 * de siembra de cada instalación (ver `dominio/entidades/permiso.ts`).
 *
 * Se exporta para `repositorio-usuarios.prisma.ts` (ver TSDoc de la clase): una sola
 * traducción para el rol, se lea desde `/api/roles` o desde el usuario autenticado.
 */
export function aRolDominio(registro: RolConPermisos): Rol {
  return {
    id: Number(registro.id),
    nombre: registro.nombre,
    descripcion: registro.descripcion,
    esSistema: registro.esSistema,
    estado: mapearEstado(registro.estado),
    permisos: registro.permisos.map((fila) => fila.permiso.clave),
  };
}

/** Igual que `aRolDominio`, más el conteo de usuarios que muestra el listado (FR-057). */
function aRolConUsuarios(registro: RolConPermisosYConteo): RolConUsuarios {
  return { ...aRolDominio(registro), cantidadUsuarios: registro._count.usuarios };
}

/**
 * `P2002` (UNIQUE de `roles.nombre`) → `Duplicado('nombre', ...)`; `P2003` (FK) al escribir la
 * matriz solo puede venir de un `permisoId` que no existe en el catálogo — el contrato lo
 * define como `400` con error de campo, no como un fallo técnico; `P2025` → `NoEncontrado`.
 * Cualquier otro error se propaga sin traducir (lo maneja el filtro global).
 */
function traducirErrorEscrituraRol(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new Duplicado('nombre', 'Ya existe un rol con ese nombre');
    }
    if (error.code === 'P2003') {
      return new ErrorValidacionDominio('Uno o más permisos seleccionados no existen', {
        permisoIds: 'Uno o más permisos seleccionados no existen',
      });
    }
    if (error.code === 'P2025') {
      return new NoEncontrado('El rol');
    }
  }
  return error;
}

/**
 * SQLSTATE `restrict_violation` de PostgreSQL. Lo lanza un `DELETE` bloqueado por una FK
 * declarada `ON DELETE RESTRICT` — que NO es el mismo error que `foreign_key_violation`
 * (`23503`, el de insertar una FK inexistente), y Prisma no lo mapea a ningún código `P####`:
 * lo entrega como `PrismaClientUnknownRequestError` con el SQLSTATE dentro del mensaje.
 *
 * Verificado empíricamente contra PostgreSQL (2026-08-12) borrando un rol con un usuario
 * asignado: sin esta rama, el `RESTRICT` de `usuarios_rol_id_fkey` escapaba sin traducir y el
 * filtro global respondía `500` en vez del `409` que exige el contrato para "rol con usuarios
 * asignados" (FR-057).
 */
const SQLSTATE_RESTRICT_VIOLATION = '23001';

/**
 * Traducción específica de `eliminar`: aquí una violación de FK significa lo contrario que al
 * escribir la matriz — es la FK `usuarios.rol_id ON DELETE RESTRICT` impidiendo borrar un rol
 * que todavía tiene usuarios (FR-057). El caso de uso (T105) lo verifica antes con
 * `contarUsuarios` para poder decir CUÁNTOS; esto es la red de seguridad si la asignación
 * ocurre entre la verificación y el borrado — una carrera que debe terminar en `409`, nunca en
 * un `500` con el error de Postgres en el log.
 *
 * Se cubren las DOS formas en que puede llegar: `P2003` (mapeo conocido de Prisma para
 * violaciones de clave foránea) y el `PrismaClientUnknownRequestError` que trae el SQLSTATE
 * `23001` — que es lo que ocurre hoy con `ON DELETE RESTRICT` (ver constante).
 */
function traducirErrorEliminacionRol(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2003') {
      return new EstadoInvalido('No se puede eliminar un rol que tiene usuarios asignados');
    }
    if (error.code === 'P2025') {
      return new NoEncontrado('El rol');
    }
  }
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes(SQLSTATE_RESTRICT_VIOLATION)
  ) {
    return new EstadoInvalido('No se puede eliminar un rol que tiene usuarios asignados');
  }
  return error;
}

function mapearEstado(estado: EstadoRolPrisma): EstadoRol {
  switch (estado) {
    case 'ACTIVO':
      return 'ACTIVO';
    case 'INACTIVO':
      return 'INACTIVO';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de rol de Prisma sin mapeo al dominio: ${String(valorInesperado)}`);
    }
  }
}

/** Dirección inversa de `mapearEstado` — dominio → Prisma. */
function mapearEstadoAPrisma(estado: EstadoRol): EstadoRolPrisma {
  switch (estado) {
    case 'ACTIVO':
      return 'ACTIVO';
    case 'INACTIVO':
      return 'INACTIVO';
    default: {
      const valorInesperado: never = estado;
      throw new Error(`Estado de rol de dominio sin mapeo a Prisma: ${String(valorInesperado)}`);
    }
  }
}
