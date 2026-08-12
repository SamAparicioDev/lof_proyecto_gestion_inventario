/**
 * Puerto `RepositorioClientes` — acceso a la persistencia de clientes visto desde el
 * dominio (patrón Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-clientes.prisma.ts`.
 *
 * Implementa: FR-034 (alta/edición de cliente), FR-035 (NIT único, reforzado por la BD y
 * traducido a `Duplicado('nit', ...)` en el adaptador) y FR-037 (lectura de detalle, base
 * del resumen de salidas del cliente — el agregado de salidas en sí es responsabilidad del
 * puerto de salidas, US3, no de este).
 */
import type { Cliente, EstadoCliente, LogoCliente, TipoMimeLogo } from '../entidades/cliente';

/** Datos de alta/edición de un cliente — mismo shape que `esquemaCrearCliente` (FR-034). */
export interface DatosCliente {
  readonly nombre: string;
  readonly nit: string;
  readonly telefono: string | null;
  readonly email: string | null;
  readonly direccion: string | null;
  readonly ciudad: string | null;
}

/** Filtros del listado de clientes (`GET /api/clientes?buscar=&estado=&ciudad=`) — paginación
 *  siempre obligatoria (Principio V, rendimiento). */
export interface FiltrosListarClientes {
  readonly buscar?: string;
  readonly estado?: EstadoCliente;
  /**
   * Ciudad EXACTA (US13, FR-075/FR-076) — no subcadena: el valor sale del selector que alimenta
   * `ciudades()`, mismo criterio que `categoria`/`ubicacion` en el catálogo de productos.
   */
  readonly ciudad?: string;
  readonly pagina: number;
  readonly porPagina: number;
}

/** Página de clientes (mismo shape que `Paginado<T>` de `@trazo/compartido`, sin
 *  importarlo: el dominio no depende de ningún paquete externo — docs/arquitectura.md §2). */
export interface PaginaClientes {
  readonly datos: Cliente[];
  readonly total: number;
}

export interface RepositorioClientes {
  /** Busca un cliente por id. `null` si no existe. */
  buscarPorId(id: number): Promise<Cliente | null>;

  /** Listado paginado con filtros de búsqueda (nombre/NIT), estado y ciudad (FR-034/FR-075). */
  listar(filtros: FiltrosListarClientes): Promise<PaginaClientes>;

  /**
   * Ciudades DISTINTAS presentes hoy entre los clientes, ordenadas y sin nulos (US13, FR-076) —
   * alimenta el selector de filtro de `/clientes`. Mismo criterio que
   * `RepositorioProductos.valoresDeClasificacion`: el universo de valores no depende del filtro
   * vigente, o filtrar por una ciudad dejaría de ofrecer las demás.
   */
  ciudades(): Promise<string[]>;

  /**
   * Da de alta un cliente (FR-034). El adaptador traduce la violación `UNIQUE(nit)` de
   * PostgreSQL a `Duplicado('nit', ...)` (FR-035).
   */
  crear(datos: DatosCliente, usuarioId: number): Promise<Cliente>;

  /** Actualiza los datos editables de un cliente existente (FR-034). */
  actualizar(id: number, datos: DatosCliente, usuarioId: number): Promise<void>;

  /** Cambia el estado (activa/desactiva) de un cliente — nunca DELETE (Principio II/III). */
  cambiarEstado(id: number, estado: EstadoCliente, usuarioId: number): Promise<void>;

  /**
   * Bytes del logo del cliente y su tipo MIME (US11, FR-066/FR-067). `null` si el cliente no
   * existe O si no tiene logo cargado: los DOS casos significan lo mismo para quien pregunta
   * ("no hay logo que mostrar"), y ninguno es un error — la exportación de un cliente sin logo
   * se genera igual, sin logo (FR-068).
   *
   * Es un método APARTE de `buscarPorId` a propósito: la entidad `Cliente` solo lleva
   * `tieneLogo` (booleano) porque viaja en cada fila de cada listado; los bytes se leen solo
   * cuando de verdad se van a usar.
   */
  obtenerLogo(id: number): Promise<LogoCliente | null>;

  /**
   * Guarda (o REEMPLAZA) el logo del cliente (FR-066). `tipoMime` ya viene decidido por
   * `detectarTipoDeImagenLogo` a partir de los BYTES — este puerto no re-valida el formato,
   * pero la BD sí lo acota con el CHECK `clientes_logo_tipo_mime_admitido` como red final.
   * Escribe SIEMPRE las dos columnas juntas (CHECK `clientes_logo_consistente`) y puebla la
   * auditoría de modificación del cliente (FR-045). `NoEncontrado` si el cliente no existe.
   */
  guardarLogo(id: number, logo: { contenido: Uint8Array; tipoMime: TipoMimeLogo }, usuarioId: number): Promise<void>;

  /**
   * Quita el logo del cliente dejando ambas columnas en `NULL` (FR-066). Es IDEMPOTENTE: si el
   * cliente ya estaba sin logo, no es un error (semántica estándar de `DELETE` — el estado
   * final pedido ya se cumple). `NoEncontrado` únicamente si el CLIENTE no existe.
   */
  eliminarLogo(id: number, usuarioId: number): Promise<void>;
}

/** Token de inyección de NestJS para el puerto `RepositorioClientes`. */
export const REPOSITORIO_CLIENTES = 'RepositorioClientes';
