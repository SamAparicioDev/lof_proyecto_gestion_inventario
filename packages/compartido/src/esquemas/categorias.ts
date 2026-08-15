/**
 * Esquemas del catálogo de categorías de producto (US15, FR-084…FR-088).
 *
 * La categoría nació en US8 como texto libre dentro del producto (FR-052) y desde US15 es una
 * entidad propia: se administra, se activa y se desactiva, y es lo que alimenta el filtro por
 * categoría del inventario.
 *
 * Un detalle que se decide AQUÍ y se repite en toda la historia: el nombre se compara
 * normalizado (sin espacios sobrantes y sin distinguir mayúsculas) pero se GUARDA tal como lo
 * escribió el usuario. Normalizar para almacenar convertiría "Ferretería" en "ferretería" en
 * pantalla, que no es lo que nadie quiere; normalizar solo para comparar es lo que impide que
 * "Ferretería" y "ferreteria " convivan (FR-085).
 *
 * Los límites replican los `VARCHAR` de data-model.md, para que la validación de UX (frontend) y
 * la autoritativa (backend) coincidan exactamente con lo que la base de datos acepta.
 */
import { z } from 'zod';

/** Estados posibles de una categoría — en femenino, igual que el enum de la base de datos. */
export const ESTADOS_CATEGORIA = ['ACTIVA', 'INACTIVA'] as const;

export const esquemaCrearCategoria = z.object({
  nombre: z
    .string({ required_error: 'El nombre es obligatorio' })
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(100, 'El nombre no puede superar 100 caracteres'),
  descripcion: z.string().trim().max(300, 'La descripción no puede superar 300 caracteres').optional(),
});

/** Editar usa exactamente los mismos campos y reglas que crear: no hay nada que solo se pueda
 *  fijar al dar de alta. */
export const esquemaActualizarCategoria = esquemaCrearCategoria;

export const esquemaEstadoCategoria = z.object({
  estado: z.enum(ESTADOS_CATEGORIA, { errorMap: () => ({ message: 'El estado no es válido' }) }),
});

/**
 * Query de `GET /api/categorias`. `estado` omitido devuelve AMBOS: la pantalla de
 * administración necesita ver también las desactivadas para poder reactivarlas, y los
 * selectores de producto piden explícitamente `ACTIVA` (FR-086).
 */
export const esquemaListarCategorias = z.object({
  buscar: z.string().trim().optional(),
  estado: z.enum(ESTADOS_CATEGORIA, { errorMap: () => ({ message: 'El estado no es válido' }) }).optional(),
});

export type DatosCrearCategoria = z.infer<typeof esquemaCrearCategoria>;
export type DatosEstadoCategoria = z.infer<typeof esquemaEstadoCategoria>;
export type FiltroListarCategorias = z.infer<typeof esquemaListarCategorias>;
export type EstadoCategoria = (typeof ESTADOS_CATEGORIA)[number];

/**
 * Forma normalizada con la que se COMPARAN dos nombres de categoría (FR-085).
 *
 * Vive en el paquete compartido porque la usan los dos lados: el backend para decidir si un
 * alta es duplicada, y el frontend para avisar antes de enviar. La autoridad final sigue siendo
 * el índice funcional `lower(btrim(nombre))` de la base de datos, que aplica aunque alguien
 * inserte por SQL — esta función solo tiene que coincidir con él.
 */
export function nombreCategoriaNormalizado(nombre: string): string {
  return nombre.trim().toLocaleLowerCase('es');
}
