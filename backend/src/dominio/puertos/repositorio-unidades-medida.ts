/**
 * Puerto `RepositorioUnidadesMedida` — persistencia del catálogo de unidades de medida vista
 * desde el dominio (patrón Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-unidades-medida.prisma.ts`.
 *
 * Alcance: los cinco endpoints que la sección "Unidades de medida" de contracts/api-rest.md
 * documenta, más las consultas que los casos de uso necesitan para decidir sin bajar a SQL.
 *
 * `buscarPorTexto` es la diferencia con los otros dos catálogos: aquí una unidad se identifica
 * por su nombre O por su abreviatura, indistintamente. Lo necesitan dos consumidores con
 * motivos distintos — el alta, para detectar los duplicados de CUALQUIERA de los dos campos, y
 * la carga masiva, porque quien llena un Excel escribe "kg" y no "Kilogramo" (FR-104).
 *
 * Implementa: FR-101 (catálogo administrable con dos unicidades), FR-104 (resolución por nombre
 * o abreviatura).
 */
import type { EstadoUnidadMedida, UnidadMedida, UnidadMedidaConUso } from '../entidades/unidad-medida';

/** Datos de alta/edición — auditoría incluida (FR-045: quién la creó o la modificó). */
export interface DatosUnidadMedida {
  readonly nombre: string;
  readonly abreviatura: string;
}

export interface FiltrosListarUnidadesMedida {
  readonly buscar?: string;
  readonly estado?: EstadoUnidadMedida;
}

/** Con cuál de los dos campos únicos chocó una búsqueda — lo que permite anclar el error de
 *  duplicado al campo correcto del formulario en vez de a un mensaje genérico. */
export interface CoincidenciaUnidadMedida {
  readonly unidad: UnidadMedida;
  readonly campo: 'nombre' | 'abreviatura';
}

export interface RepositorioUnidadesMedida {
  /** Listado ordenado por nombre. Sin `estado` devuelve AMBAS: la pantalla de administración
   *  necesita ver las inactivas para poder reactivarlas. */
  listar(filtros: FiltrosListarUnidadesMedida): Promise<UnidadMedidaConUso[]>;

  buscarPorId(id: number): Promise<UnidadMedida | null>;

  /**
   * Busca por nombre O abreviatura NORMALIZADOS, y dice con cuál coincidió.
   *
   * Los dos textos se consultan de una vez porque el alta necesita saber si CUALQUIERA de los
   * dos choca, y hacerlo en dos viajes daría un mensaje distinto según el orden en que se
   * comprobaran. El `campo` devuelto es lo que permite decir "ya existe una unidad con esa
   * abreviatura" en lugar de un genérico.
   */
  buscarPorTexto(nombreNormalizado: string, abreviaturaNormalizada: string): Promise<CoincidenciaUnidadMedida | null>;

  crear(datos: DatosUnidadMedida, usuarioId: number): Promise<number>;

  actualizar(id: number, datos: DatosUnidadMedida, usuarioId: number): Promise<void>;

  cambiarEstado(id: number, estado: EstadoUnidadMedida, usuarioId: number): Promise<void>;

  /** Cuántos productos la usan. El caso de uso lo consulta ANTES de intentar el borrado para
   *  poder decir cuántos son, en vez de traducir un error de clave foránea. */
  contarProductos(id: number): Promise<number>;

  /** Solo debe llamarse cuando `contarProductos` devolvió 0; la FK `RESTRICT` es la red final. */
  eliminar(id: number): Promise<void>;
}

export const REPOSITORIO_UNIDADES_MEDIDA = 'RepositorioUnidadesMedida';
