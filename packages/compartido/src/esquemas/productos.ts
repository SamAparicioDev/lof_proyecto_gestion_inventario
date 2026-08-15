/**
 * Esquemas de productos del catálogo — alta rápida (también reutilizada desde el
 * formulario de ingresos), edición (FR-010…FR-012) y fila de carga masiva (US8).
 *
 * Implementa: FR-010 (alta con SKU/descripción/ubicación/umbral de stock bajo), FR-011
 * (el mismo esquema de alta sirve para el dialog de "alta rápida" desde ingresos — un
 * producto nuevo se crea con los mismos campos sin importar desde dónde), FR-016/FR-047
 * (mensajes de validación en español que indican el campo y la corrección esperada) y
 * FR-086 (`categoriaId`: referencia al catálogo desde el alta/edición manual; la carga masiva
 * la sigue escribiendo por nombre, FR-090). Los límites de longitud replican los `VARCHAR` de
 * `data-model.md` para que la validación de UX (frontend) y la autoritativa (backend)
 * coincidan exactamente con lo que la BD acepta.
 *
 * Sigue el patrón de esquemas/autenticacion.ts (archivo ejemplar).
 */
import { z } from 'zod';

/** Body de `POST /api/productos` (contracts/api-rest.md). */
export const esquemaCrearProducto = z.object({
  sku: z
    .string({ required_error: 'El SKU es obligatorio' })
    .trim()
    .min(1, 'El SKU es obligatorio')
    .max(50, 'El SKU no puede superar 50 caracteres'),
  descripcion: z
    .string({ required_error: 'La descripción es obligatoria' })
    .trim()
    .min(1, 'La descripción es obligatoria')
    .max(300, 'La descripción no puede superar 300 caracteres'),
  /** US15 (FR-086): la categoría dejó de escribirse y pasó a elegirse del catálogo. `null`
   *  desclasifica un producto ya clasificado; omitirlo lo deja como está. */
  categoriaId: z
    .number({ invalid_type_error: 'La categoría no es válida' })
    .int('La categoría no es válida')
    .positive('La categoría no es válida')
    .nullable()
    .optional(),
  ubicacion: z.string().trim().max(100, 'La ubicación no puede superar 100 caracteres').optional(),
  umbralStockBajo: z
    .number({ invalid_type_error: 'El umbral de stock bajo debe ser un número' })
    .min(0, 'El umbral de stock bajo no puede ser negativo')
    .optional()
    .default(0),
});
export type DatosCrearProducto = z.infer<typeof esquemaCrearProducto>;

/**
 * Body de `PUT /api/productos/:id` — el SKU queda fuera: es el identificador de negocio
 * del producto y no se edita tras el alta (data-model.md no lo contempla como editable).
 *
 * `ultimoCosto` se agrega en US12 (FR-071): el costo de referencia del producto SÍ es
 * corregible desde la edición manual. Es OPCIONAL a propósito — un cliente que no lo envíe
 * (o una edición que solo cambie la descripción) deja el costo intacto, sin registrar nada
 * en el historial (FR-074: solo se registra un cambio REAL). Cuando llega y difiere del
 * actual, el backend lo actualiza y registra el cambio con `origen: EDICION_MANUAL` en la
 * MISMA transacción (contracts/api-rest.md § Historial de costos del producto).
 */
export const esquemaActualizarProducto = z.object({
  descripcion: esquemaCrearProducto.shape.descripcion,
  categoriaId: esquemaCrearProducto.shape.categoriaId,
  ubicacion: esquemaCrearProducto.shape.ubicacion,
  umbralStockBajo: esquemaCrearProducto.shape.umbralStockBajo,
  ultimoCosto: z
    .number({ invalid_type_error: 'El costo unitario debe ser un número' })
    .min(0, 'El costo unitario no puede ser negativo')
    .optional(),
});
export type DatosActualizarProducto = z.infer<typeof esquemaActualizarProducto>;

/**
 * Fila de la plantilla de carga masiva de inventario (US8, T092) —
 * `infraestructura/importacion/leer-filas-importacion-productos.ts` mapea cada fila del
 * Excel a través de este esquema antes de que el caso de uso decida crear/actualizar el
 * producto. `sku`/`descripcion` son obligatorios con los mismos límites que
 * `esquemaCrearProducto` (misma autoridad de validación que el alta manual — FR-049).
 * `categoria`/`ubicacion`/`umbralStockBajo` son opcionales con el mismo criterio que el
 * alta manual (FR-052). `cantidadInicial` es opcional (si se omite o es 0, la fila solo
 * afecta el catálogo, no el stock); cuando SÍ trae una cantidad inicial mayor a cero, el
 * `valorUnitario` pasa de ignorarse a ser obligatorio y mayor a 0 — sin él no hay costo con
 * el que registrar la entrada de inventario sintética (FR-050, `superRefine` porque es una
 * regla que cruza dos campos, imposible de expresar con validadores independientes).
 */
export const esquemaFilaImportacionProducto = z
  .object({
    sku: esquemaCrearProducto.shape.sku,
    descripcion: esquemaCrearProducto.shape.descripcion,
    /** En el Excel la categoría se escribe por NOMBRE y el backend la resuelve contra el
     *  catálogo ignorando mayúsculas y espacios (FR-090): pedirle un id a quien llena una hoja
     *  de cálculo no tendría sentido. Una categoría desconocida invalida esa fila. */
    categoria: z.string().trim().max(100, 'La categoría no puede superar 100 caracteres').optional(),
    ubicacion: esquemaCrearProducto.shape.ubicacion,
    umbralStockBajo: esquemaCrearProducto.shape.umbralStockBajo,
    cantidadInicial: z
      .number({ invalid_type_error: 'La cantidad inicial debe ser un número' })
      .min(0, 'La cantidad inicial no puede ser negativa')
      .optional(),
    valorUnitario: z
      .number({ invalid_type_error: 'El valor unitario debe ser un número' })
      .min(0, 'El valor unitario no puede ser negativo')
      .optional(),
  })
  .superRefine((datos, contexto) => {
    if (datos.cantidadInicial && datos.cantidadInicial > 0 && !(datos.valorUnitario && datos.valorUnitario > 0)) {
      contexto.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valorUnitario'],
        message: 'La cantidad inicial requiere un valor unitario mayor a 0',
      });
    }
  });
export type FilaImportacionProducto = z.infer<typeof esquemaFilaImportacionProducto>;

/**
 * Query de `GET /api/productos?buscar=` (extensión T035 del contrato — ver TSDoc de
 * `controlador-productos.ts`): listado simple SIN paginar, solo para poblar selectores
 * (combobox de líneas del formulario de ingresos). `buscar` es opcional a propósito: sin
 * término, el selector parte con el catálogo completo (hasta el límite del controlador).
 */
export const esquemaListarProductos = z.object({
  buscar: z.string().trim().optional(),
});
export type FiltroProductos = z.infer<typeof esquemaListarProductos>;

/**
 * Body de `PUT /api/productos/:id/estado` (contracts/api-rest.md) — baja lógica de un
 * producto del catálogo (FR-012: nunca DELETE, mismo patrón que `esquemaCambiarEstadoCliente`
 * de `esquemas/clientes.ts`). Un producto `INACTIVO` deja de poder recibirse/despacharse en
 * documentos nuevos, pero conserva su historial de movimientos (Principio II).
 */
export const esquemaCambiarEstadoProducto = z.object({
  estado: z.enum(['ACTIVO', 'INACTIVO'], { errorMap: () => ({ message: 'El estado no es válido' }) }),
});
export type DatosCambiarEstadoProducto = z.infer<typeof esquemaCambiarEstadoProducto>;
