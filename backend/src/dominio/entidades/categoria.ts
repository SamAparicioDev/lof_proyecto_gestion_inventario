/**
 * Categoría de producto — catálogo administrable (US15, FR-084…FR-088).
 *
 * Hasta US15 la categoría era una cadena guardada en cada producto (FR-052, US8). Eso permitía
 * que "Ferretería", "ferretería " y "FERRETERÍA" fueran tres clasificaciones distintas para el
 * sistema y una sola para la persona que las escribió, con lo que filtrar por categoría —el
 * único motivo por el que existe el campo— dejaba de ser fiable. Esta entidad convierte esa
 * cadena en un dato de negocio con identidad propia.
 *
 * TypeScript puro: sin NestJS, sin Prisma, sin Zod (regla de dependencia, docs/arquitectura.md).
 *
 * Implementa: FR-084 (catálogo administrable), FR-085 (unicidad normalizada), FR-086 (opcional
 * en el producto y solo se ofrecen las activas), FR-087 (baja lógica cuando está en uso).
 */

export type EstadoCategoria = 'ACTIVA' | 'INACTIVA';

export interface Categoria {
  readonly id: number;
  readonly nombre: string;
  readonly descripcion: string | null;
  readonly estado: EstadoCategoria;
}

/** Categoría con el número de productos que la usan — lo que necesita la pantalla de
 *  administración para explicar por qué una categoría no se puede eliminar (FR-087). */
export interface CategoriaConUso extends Categoria {
  readonly cantidadProductos: number;
}

/**
 * Forma con la que se COMPARAN dos nombres de categoría (FR-085).
 *
 * OJO: normaliza mayúsculas y espacios, NO tildes — "Ferreteria" y "Ferretería" siguen siendo
 * dos categorías distintas. Quitar tildes exigiría `unaccent` en PostgreSQL para que el índice
 * funcional pudiera hacer lo mismo, y una normalización que la BD no pueda replicar sería peor
 * que ninguna: la aplicación aceptaría lo que el índice rechaza.
 *
 * Se normaliza para comparar, nunca para guardar: el nombre se almacena tal como lo escribió
 * quien lo dio de alta, porque "Ferretería" en pantalla es lo correcto y "ferretería" no.
 *
 * Debe coincidir exactamente con el índice funcional `lower(btrim(nombre))` de la base de
 * datos, que es la red final —vale aunque alguien inserte por SQL— y con
 * `nombreCategoriaNormalizado` de `@trazo/compartido`, que el frontend usa para avisar antes
 * de enviar. Tres implementaciones del mismo criterio a propósito: cada capa tiene que poder
 * decidir sola, y la de la BD manda.
 */
export function normalizarNombreCategoria(nombre: string): string {
  return nombre.trim().toLocaleLowerCase('es');
}

/** Una categoría solo se ofrece para clasificar productos nuevos si está activa (FR-086). Un
 *  producto YA clasificado con una inactiva la conserva: esta función decide qué se ofrece,
 *  no qué se conserva. */
export function puedeClasificar(categoria: Categoria): boolean {
  return categoria.estado === 'ACTIVA';
}
