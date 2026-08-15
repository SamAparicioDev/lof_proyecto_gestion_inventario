/**
 * Puerto `RepositorioCategorias` — persistencia del catálogo de categorías vista desde el
 * dominio (patrón Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-categorias.prisma.ts`.
 *
 * Alcance: exactamente los cinco endpoints que la sección "Categorías" de
 * contracts/api-rest.md documenta para `/api/categorias`, más dos consultas que los casos de
 * uso necesitan para decidir sin bajar a SQL: `buscarPorNombreNormalizado` (duplicados,
 * FR-085) y `contarProductos` (por qué NO se puede eliminar, FR-087).
 *
 * Implementa: FR-084 (catálogo administrable), FR-085 (unicidad ignorando mayúsculas y
 * espacios), FR-086 (solo las activas se ofrecen para clasificar), FR-087 (baja lógica cuando
 * está en uso), FR-088 (los filtros se alimentan de aquí, no de un DISTINCT sobre productos).
 */
import type { Categoria, CategoriaConUso, EstadoCategoria } from '../entidades/categoria';

/** Datos de alta/edición — auditoría incluida (FR-045: quién la creó o la modificó). */
export interface DatosCategoria {
  readonly nombre: string;
  readonly descripcion: string | null;
}

export interface FiltrosListarCategorias {
  readonly buscar?: string;
  readonly estado?: EstadoCategoria;
}

export interface RepositorioCategorias {
  /** Listado ordenado por nombre. Sin `estado` devuelve AMBOS: la pantalla de administración
   *  necesita ver las inactivas para poder reactivarlas. */
  listar(filtros: FiltrosListarCategorias): Promise<CategoriaConUso[]>;

  buscarPorId(id: number): Promise<Categoria | null>;

  /**
   * Busca por nombre NORMALIZADO (FR-085) — es lo que permite responder "ya existe una
   * categoría así" con el nombre tal como se escribió la primera vez, en lugar de un error
   * técnico de índice único.
   */
  buscarPorNombreNormalizado(nombreNormalizado: string): Promise<Categoria | null>;

  crear(datos: DatosCategoria, usuarioId: number): Promise<number>;

  actualizar(id: number, datos: DatosCategoria, usuarioId: number): Promise<void>;

  cambiarEstado(id: number, estado: EstadoCategoria, usuarioId: number): Promise<void>;

  /** Cuántos productos la usan. El caso de uso lo consulta ANTES de intentar el borrado para
   *  poder decir cuántos son (FR-087), en vez de traducir un error de clave foránea. */
  contarProductos(id: number): Promise<number>;

  /** Solo debe llamarse cuando `contarProductos` devolvió 0; la FK `RESTRICT` es la red final. */
  eliminar(id: number): Promise<void>;
}

export const REPOSITORIO_CATEGORIAS = 'RepositorioCategorias';
