/**
 * Puerto `RepositorioProveedores` — persistencia del catálogo de proveedores vista desde el
 * dominio (patrón Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-proveedores.prisma.ts`.
 *
 * Alcance: exactamente los cinco endpoints que la sección "Proveedores" de
 * contracts/api-rest.md documenta para `/api/proveedores`, más dos consultas que los casos de
 * uso necesitan para decidir sin bajar a SQL: `buscarPorNombreNormalizado` (duplicados y la
 * resolución del proveedor del sistema en la carga masiva, FR-093) y `contarIngresos` (por qué
 * NO se puede eliminar).
 *
 * Implementa: FR-091 (catálogo administrable con las mismas reglas que categorías), FR-093 (el
 * proveedor del sistema se localiza por nombre).
 */
import type { EstadoProveedor, Proveedor, ProveedorConUso } from '../entidades/proveedor';

/** Datos de alta/edición — auditoría incluida (FR-045: quién lo creó o lo modificó). */
export interface DatosProveedor {
  readonly nombre: string;
  readonly nit: string | null;
  readonly telefono: string | null;
  readonly email: string | null;
}

export interface FiltrosListarProveedores {
  readonly buscar?: string;
  readonly estado?: EstadoProveedor;
}

export interface RepositorioProveedores {
  /** Listado ordenado por nombre. Sin `estado` devuelve AMBOS: la pantalla de administración
   *  necesita ver los inactivos para poder reactivarlos. */
  listar(filtros: FiltrosListarProveedores): Promise<ProveedorConUso[]>;

  buscarPorId(id: number): Promise<Proveedor | null>;

  /**
   * Busca por nombre NORMALIZADO (FR-091 → FR-085). Tiene dos consumidores distintos:
   * el alta/edición, para responder "ya existe un proveedor así" con el nombre tal como se
   * escribió la primera vez, y la carga masiva, que localiza así su proveedor del sistema
   * (FR-093) en vez de escribir el texto como hacía hasta US15.
   */
  buscarPorNombreNormalizado(nombreNormalizado: string): Promise<Proveedor | null>;

  crear(datos: DatosProveedor, usuarioId: number): Promise<number>;

  actualizar(id: number, datos: DatosProveedor, usuarioId: number): Promise<void>;

  cambiarEstado(id: number, estado: EstadoProveedor, usuarioId: number): Promise<void>;

  /** Cuántos ingresos lo referencian. El caso de uso lo consulta ANTES de intentar el borrado
   *  para poder decir cuántos son, en vez de traducir un error de clave foránea. */
  contarIngresos(id: number): Promise<number>;

  /** Solo debe llamarse cuando `contarIngresos` devolvió 0; la FK `RESTRICT` es la red final. */
  eliminar(id: number): Promise<void>;
}

export const REPOSITORIO_PROVEEDORES = 'RepositorioProveedores';
