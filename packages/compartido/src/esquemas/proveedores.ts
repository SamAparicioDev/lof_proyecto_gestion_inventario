/**
 * Esquemas del catálogo de proveedores (US15, FR-091…FR-093).
 *
 * FR-091 extiende a proveedores, íntegras, las reglas que FR-084…FR-088 escribieron para
 * categorías: el proveedor se escribía a mano en cada factura y por eso "Formex", "formex " y
 * "FORMEX" convivían como tres proveedores para el sistema y uno solo para quien los tecleó.
 * La solución es deliberadamente la misma —mismo criterio de unicidad, misma baja lógica,
 * mismos filtros alimentados del catálogo— porque es el mismo problema, y dos comportamientos
 * distintos serían dos cosas que el usuario tendría que recordar por separado.
 *
 * Dos diferencias propias de esta mitad de la historia:
 *
 *  - **El proveedor de un ingreso es OBLIGATORIO** (a diferencia de la categoría de un
 *    producto): una factura sin saber a quién se le compró no es trazable. Eso se ve en
 *    `esquemas/ingresos.ts`, donde `proveedorId` no admite `null`.
 *  - **El proveedor de la carga masiva es del sistema** (FR-093): la importación lo resuelve
 *    POR NOMBRE, así que renombrarlo o borrarlo rompería un proceso automático. Ese bloqueo NO
 *    vive aquí sino en el caso de uso —es una regla sobre el ESTADO de un registro concreto, no
 *    sobre la forma de lo que se envía—, pero el listado expone `esSistema` para que la pantalla
 *    pueda deshabilitar los controles en vez de dejar que el usuario lo descubra al guardar.
 *
 * Los límites replican los `VARCHAR` de data-model.md, para que la validación de UX (frontend) y
 * la autoritativa (backend) coincidan exactamente con lo que la base de datos acepta.
 */
import { z } from 'zod';

/** Estados posibles de un proveedor — en masculino, igual que el enum de la base de datos. */
export const ESTADOS_PROVEEDOR = ['ACTIVO', 'INACTIVO'] as const;

/** Campo de contacto OPCIONAL: un `''` que llega de un formulario vacío significa "sin dato",
 *  no una cadena vacía guardada en la base. */
function esquemaContactoOpcional(maximo: number, mensajeLargo: string) {
  return z
    .string()
    .trim()
    .max(maximo, mensajeLargo)
    .optional()
    .transform((valor) => (valor === '' ? undefined : valor));
}

export const esquemaCrearProveedor = z.object({
  nombre: z
    .string({ required_error: 'El nombre es obligatorio' })
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(150, 'El nombre no puede superar 150 caracteres'),
  nit: esquemaContactoOpcional(20, 'El NIT no puede superar 20 caracteres'),
  telefono: esquemaContactoOpcional(30, 'El teléfono no puede superar 30 caracteres'),
  /** Se valida la FORMA de correo solo si viene con contenido: el campo es opcional y un
   *  proveedor sin email es perfectamente válido. */
  email: z
    .string()
    .trim()
    .max(150, 'El correo no puede superar 150 caracteres')
    .email('El correo no es válido')
    .optional()
    .or(z.literal(''))
    .transform((valor) => (valor === '' ? undefined : valor)),
});

/** Editar usa exactamente los mismos campos y reglas que crear (igual que en categorías): no
 *  hay nada que solo se pueda fijar al dar de alta. */
export const esquemaActualizarProveedor = esquemaCrearProveedor;

export const esquemaEstadoProveedor = z.object({
  estado: z.enum(ESTADOS_PROVEEDOR, { errorMap: () => ({ message: 'El estado no es válido' }) }),
});

/**
 * Query de `GET /api/proveedores`. `estado` omitido devuelve AMBOS: la pantalla de
 * administración necesita ver los desactivados para poder reactivarlos, y el selector del
 * formulario de ingreso pide explícitamente `ACTIVO`.
 */
export const esquemaListarProveedores = z.object({
  buscar: z.string().trim().optional(),
  estado: z.enum(ESTADOS_PROVEEDOR, { errorMap: () => ({ message: 'El estado no es válido' }) }).optional(),
});

export type DatosCrearProveedor = z.infer<typeof esquemaCrearProveedor>;
export type DatosEstadoProveedor = z.infer<typeof esquemaEstadoProveedor>;
export type FiltroListarProveedores = z.infer<typeof esquemaListarProveedores>;
export type EstadoProveedor = (typeof ESTADOS_PROVEEDOR)[number];

/**
 * Forma normalizada con la que se COMPARAN dos nombres de proveedor (FR-091 → FR-085).
 *
 * Idéntica a `nombreCategoriaNormalizado` y por el mismo motivo: debe coincidir con el índice
 * funcional `lower(btrim(nombre))` de la base de datos, que es la autoridad final porque aplica
 * aunque alguien inserte por SQL. **No normaliza tildes**: "Ferreteria" y "Ferretería" siguen
 * siendo dos proveedores distintos — quitar las tildes exigiría `unaccent` en PostgreSQL para
 * que el índice pudiera hacer lo mismo, y una normalización que la BD no pueda replicar sería
 * peor que ninguna (la aplicación aceptaría lo que el índice rechaza).
 *
 * Se declara aparte en vez de reutilizar la de categorías a propósito: son dos reglas de dos
 * catálogos distintos que hoy coinciden, y compartir la función haría que relajar una relajara
 * la otra sin que nadie lo decidiera.
 */
export function nombreProveedorNormalizado(nombre: string): string {
  return nombre.trim().toLocaleLowerCase('es');
}
