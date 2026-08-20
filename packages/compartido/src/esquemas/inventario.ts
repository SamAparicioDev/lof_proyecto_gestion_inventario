/**
 * Esquemas de la consulta de inventario, de solo lectura (`/api/inventario` —
 * FR-020…FR-024). Sigue el patrón de `esquemas/salidas.ts` (filtros + paginación común de
 * `esquemas/comunes.ts`) — la diferencia es que aquí no hay body de escritura, solo query de
 * listados: el listado general de inventario (`esquemaFiltroInventario`) y el historial de
 * movimientos de un producto (`esquemaFiltroMovimientos`).
 *
 * Implementa: FR-020 (cifras de stock/comprometido/disponible), FR-022 (filtro de stock
 * bajo contra el umbral por producto — el CÁLCULO vive en el backend,
 * `dominio/entidades/producto.ts#esStockBajo`, este esquema solo valida la FORMA del query),
 * FR-023 (búsqueda por SKU/descripción) y FR-024 (historial de movimientos por producto).
 */
import { z } from 'zod';
import { MENSAJE_CANTIDAD_ENTERA, esquemaCantidadFiltro, esquemaPaginacion, esquemaTextoFiltro } from './comunes';

/**
 * Coerciona un query param booleano opcional: llega como string (`?soloStockBajo=true`) o
 * ausente. Cualquier valor distinto de `true`/`"true"` (incluido `undefined`, `"false"` o
 * texto arbitrario) se interpreta como `false` — mismo criterio permisivo que `esquemaPaginacion`
 * usa para números de query string, adaptado a booleanos (Zod no ofrece `z.coerce.boolean()`
 * seguro para esto: coerciona CUALQUIER string no vacío, incluido `"false"`, a `true`).
 */
const esquemaBooleanoOpcionalDeQuery = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((valor) => valor === true || valor === 'true');

/** Fecha (solo día) en texto ISO `YYYY-MM-DD`, opcional — mismo criterio que `esquemaFiltroSalidas`. */
function esquemaFechaOpcional(mensajeInvalida: string) {
  return z
    .string()
    .optional()
    .refine((valor) => valor === undefined || !Number.isNaN(Date.parse(valor)), mensajeInvalida);
}

/**
 * Query de `GET /api/inventario` (contracts/api-rest.md § Inventario).
 *
 * Filtros agregados en US13 (FR-075…FR-077), todos opcionales y combinables entre sí:
 * - `ubicacion`: igualdad EXACTA, no subcadena. Es texto libre sin catálogo propio, así que el
 *   usuario no puede adivinar cómo se escribió: la pantalla lo ofrece
 *   como selección de lo que EXISTE (`GET /api/inventario/opciones-filtro`, FR-076) y con
 *   valores tomados de ahí la igualdad es lo correcto — una subcadena haría que "Bodega 1"
 *   arrastrara "Bodega 10".
 * - `estado`: OMITIRLO sigue devolviendo activos e inactivos, que es lo que esta pantalla hace
 *   desde T111 (FR-012: un producto dado de baja conserva su historial y se ve con su etiqueta).
 * - `disponibleMin`/`disponibleMax`: rango sobre `disponible` (= stock − comprometido), NUNCA
 *   sobre el stock crudo (FR-077). Aquí solo se valida la FORMA; el cálculo y el recorte viven
 *   en `ListarInventarioCasoUso`, porque `comprometido` exige un JOIN que el repositorio de
 *   productos no puede resolver solo. Se llaman distinto que el `cantidadMin`/`cantidadMax` del
 *   reporte (FR-041) a propósito: allí hay UNA cifra de cantidad, aquí hay tres en pantalla.
 */
export const esquemaFiltroInventario = z
  .object({
    buscar: z.string().trim().optional(),
    soloStockBajo: esquemaBooleanoOpcionalDeQuery,
    /** US15: se filtra por el id del catálogo, no por texto — así el problema de "cómo se
     *  escribió" desaparece de raíz (FR-088). */
    categoriaId: z.coerce
      .number({ invalid_type_error: 'La categoría no es válida' })
      .int('La categoría no es válida')
      .positive('La categoría no es válida')
      .optional(),
    ubicacion: esquemaTextoFiltro(),
    estado: z
      .enum(['ACTIVO', 'INACTIVO'], { errorMap: () => ({ message: 'El estado no es válido' }) })
      .optional(),
    disponibleMin: esquemaCantidadFiltro(
      'El disponible mínimo debe ser un número',
      'El disponible mínimo no puede ser negativo',
    ),
    disponibleMax: esquemaCantidadFiltro(
      'El disponible máximo debe ser un número',
      'El disponible máximo no puede ser negativo',
    ),
  })
  .merge(esquemaPaginacion);
export type FiltroInventario = z.infer<typeof esquemaFiltroInventario>;

/** Query de `GET /api/inventario/:productoId/movimientos` (contracts/api-rest.md § Inventario). */
export const esquemaFiltroMovimientos = z
  .object({
    desde: esquemaFechaOpcional('La fecha "desde" no es válida'),
    hasta: esquemaFechaOpcional('La fecha "hasta" no es válida'),
  })
  .merge(esquemaPaginacion);
export type FiltroMovimientos = z.infer<typeof esquemaFiltroMovimientos>;

/**
 * Query de `GET /api/inventario/:productoId/historial-costos` (US12, contracts/api-rest.md §
 * Historial de costos del producto): SOLO paginación, sin rango de fechas.
 *
 * A diferencia del historial de movimientos, este no filtra por fecha porque responde otra
 * pregunta —"¿cómo llegó este producto a valer lo que vale?"— cuya respuesta es la secuencia
 * COMPLETA de cambios, no un recorte temporal; un filtro que ocultara el tramo intermedio
 * mostraría saltos de costo sin explicación. Se agrega si algún requisito lo pide (Principio
 * V, YAGNI).
 */
export const esquemaFiltroHistorialCostos = z.object({}).merge(esquemaPaginacion);
export type FiltroHistorialCostos = z.infer<typeof esquemaFiltroHistorialCostos>;

/**
 * Body de `PUT /api/inventario/:productoId/cantidad` (US31, FR-130) — corregir el stock para
 * cuadrar con el conteo físico, sin documento de por medio.
 *
 * Se envía la cantidad CONTADA, no la diferencia: es lo que la persona tiene delante al terminar
 * de contar, y pedirle el delta es pedirle justo la resta en la que se equivoca. El servidor
 * calcula la diferencia y con su signo decide el tipo de movimiento.
 *
 * `motivo` es obligatorio y no un texto de cortesía: sin factura ni salida detrás, es lo único
 * que justifica el movimiento (Principio II — las correcciones se hacen con movimientos de ajuste
 * que TAMBIÉN quedan registrados). Los 300 caracteres son los de `motivo_anulacion`, por
 * coherencia con los demás motivos del sistema.
 */
export const esquemaCorregirCantidad = z.object({
  cantidad: z
    .number({ required_error: 'La cantidad es obligatoria', invalid_type_error: 'La cantidad debe ser un número' })
    // US26 (FR-122): entera, como toda cantidad del sistema.
    .int(MENSAJE_CANTIDAD_ENTERA)
    // A diferencia de las líneas de un documento, SÍ admite 0: "conté y no hay ninguno" es un
    // resultado legítimo del conteo, y prohibirlo obligaría a inventar una salida para vaciar.
    .min(0, 'La cantidad no puede ser negativa'),
  motivo: z
    .string({ required_error: 'El motivo es obligatorio' })
    .trim()
    .min(1, 'El motivo es obligatorio')
    .max(300, 'El motivo no puede superar 300 caracteres'),
});
export type DatosCorregirCantidad = z.infer<typeof esquemaCorregirCantidad>;
