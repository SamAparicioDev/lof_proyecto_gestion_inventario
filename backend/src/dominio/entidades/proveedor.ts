/**
 * Proveedor — catálogo administrable (US15, FR-091…FR-093).
 *
 * Hasta US15 el proveedor era una cadena escrita en cada factura. Eso permitía que "Formex",
 * "formex " y "FORMEX" fueran tres proveedores para el sistema y uno solo para quien los
 * tecleó, con lo que preguntar "¿cuánto le compramos a Formex este año?" —el único motivo por
 * el que el campo existe— dejaba de tener una respuesta fiable. Esta entidad convierte esa
 * cadena en un dato de negocio con identidad propia.
 *
 * Gemela de `Categoria` a propósito (FR-091 extiende FR-084…FR-088 íntegras), con dos
 * diferencias que la historia impone y que se ven en este archivo:
 *
 *  - El proveedor de un ingreso es OBLIGATORIO, no opcional como la categoría de un producto.
 *    Eso no se declara aquí sino en `Ingreso.proveedor`, que no admite `null`.
 *  - `esSistema` protege el proveedor que usa la carga masiva (FR-093).
 *
 * TypeScript puro: sin NestJS, sin Prisma, sin Zod (regla de dependencia, docs/arquitectura.md).
 */

export type EstadoProveedor = 'ACTIVO' | 'INACTIVO';

export interface Proveedor {
  readonly id: number;
  readonly nombre: string;
  readonly nit: string | null;
  readonly telefono: string | null;
  readonly email: string | null;
  readonly estado: EstadoProveedor;
  /** `true` solo para el proveedor de la carga masiva (FR-093) — ver `puedeRenombrarse`. */
  readonly esSistema: boolean;
}

/** Proveedor con el número de ingresos que lo referencian — lo que necesita la pantalla de
 *  administración para explicar por qué un proveedor no se puede eliminar (FR-091 → FR-087). */
export interface ProveedorConUso extends Proveedor {
  readonly cantidadIngresos: number;
}

/**
 * Forma con la que se COMPARAN dos nombres de proveedor (FR-091 → FR-085).
 *
 * OJO: normaliza mayúsculas y espacios, NO tildes — "Ferreteria" y "Ferretería" siguen siendo
 * dos proveedores distintos. Quitar tildes exigiría `unaccent` en PostgreSQL para que el índice
 * funcional pudiera hacer lo mismo, y una normalización que la BD no pueda replicar sería peor
 * que ninguna: la aplicación aceptaría lo que el índice rechaza.
 *
 * Se normaliza para comparar, nunca para guardar: el nombre se almacena tal como lo escribió
 * quien lo dio de alta.
 *
 * Debe coincidir exactamente con el índice funcional `lower(btrim(nombre))` de la base de
 * datos —la red final, vale aunque alguien inserte por SQL— y con `nombreProveedorNormalizado`
 * de `@trazo/compartido`, que el frontend usa para avisar antes de enviar.
 */
export function normalizarNombreProveedor(nombre: string): string {
  return nombre.trim().toLocaleLowerCase('es');
}

/** Un proveedor solo se ofrece para registrar ingresos nuevos si está activo. Un ingreso YA
 *  registrado con uno inactivo lo conserva: esta función decide qué se ofrece, no qué se
 *  conserva (mismo criterio que `puedeClasificar` en categorías, FR-086). */
export function puedeRecibirIngresos(proveedor: Proveedor): boolean {
  return proveedor.estado === 'ACTIVO';
}

/**
 * El proveedor de la carga masiva NO se renombra ni se elimina (FR-093).
 *
 * La razón es concreta, no una precaución genérica: `ImportarProductosCasoUso` lo resuelve POR
 * NOMBRE para su ingreso sintético, así que renombrarlo dejaría a la importación sin proveedor
 * al que apuntar y ninguna carga masiva volvería a funcionar. Misma protección que los roles
 * del sistema (FR-059), y por el mismo motivo: hay un proceso automático que depende del dato.
 *
 * Lo que SÍ se puede hacer con él: corregir sus datos de contacto y cambiar su estado. Ninguna
 * de las dos cosas rompe la resolución por nombre.
 */
export function puedeRenombrarse(proveedor: Proveedor): boolean {
  return !proveedor.esSistema;
}

/** Ídem para el borrado (FR-093): el registro tiene que seguir existiendo. */
export function puedeEliminarse(proveedor: Proveedor): boolean {
  return !proveedor.esSistema;
}
