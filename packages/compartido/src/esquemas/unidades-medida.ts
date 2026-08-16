/**
 * Esquemas del catálogo de unidades de medida (US17, FR-101…FR-105).
 *
 * Tercer catálogo de la familia que abrió US15, y sigue sus mismas reglas: unicidad ignorando
 * mayúsculas y espacios (no tildes), baja lógica cuando está en uso, selectores alimentados del
 * catálogo. Lo propio de este es que tiene DOS textos, y los dos son únicos:
 *
 *  - **`nombre`** ("Kilogramo") es lo que se lee en un formulario, donde hay sitio.
 *  - **`abreviatura`** ("kg") es lo que cabe junto a una cantidad en una celda de tabla, que es
 *    justo donde la unidad hace falta. Si dos unidades compartieran abreviatura, la tabla
 *    dejaría de distinguirlas — de ahí que la unicidad se exija por separado en cada uno.
 *
 * Los límites replican los `VARCHAR` de data-model.md, para que la validación de UX (frontend) y
 * la autoritativa (backend) coincidan exactamente con lo que la base de datos acepta.
 */
import { z } from 'zod';

/** Estados posibles — en femenino, igual que el enum de la base de datos. */
export const ESTADOS_UNIDAD_MEDIDA = ['ACTIVA', 'INACTIVA'] as const;

export const esquemaCrearUnidadMedida = z.object({
  nombre: z
    .string({ required_error: 'El nombre es obligatorio' })
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(60, 'El nombre no puede superar 60 caracteres'),
  abreviatura: z
    .string({ required_error: 'La abreviatura es obligatoria' })
    .trim()
    .min(1, 'La abreviatura es obligatoria')
    .max(10, 'La abreviatura no puede superar 10 caracteres'),
});

/** Editar usa exactamente los mismos campos y reglas que crear: no hay nada que solo se pueda
 *  fijar al dar de alta. */
export const esquemaActualizarUnidadMedida = esquemaCrearUnidadMedida;

export const esquemaEstadoUnidadMedida = z.object({
  estado: z.enum(ESTADOS_UNIDAD_MEDIDA, { errorMap: () => ({ message: 'El estado no es válido' }) }),
});

/**
 * Query de `GET /api/unidades-medida`. `estado` omitido devuelve AMBAS: la pantalla de
 * administración necesita ver las desactivadas para poder reactivarlas, y el selector del
 * formulario de producto pide explícitamente `ACTIVA`.
 */
export const esquemaListarUnidadesMedida = z.object({
  buscar: z.string().trim().optional(),
  estado: z
    .enum(ESTADOS_UNIDAD_MEDIDA, { errorMap: () => ({ message: 'El estado no es válido' }) })
    .optional(),
});

export type DatosCrearUnidadMedida = z.infer<typeof esquemaCrearUnidadMedida>;
export type DatosEstadoUnidadMedida = z.infer<typeof esquemaEstadoUnidadMedida>;
export type FiltroListarUnidadesMedida = z.infer<typeof esquemaListarUnidadesMedida>;
export type EstadoUnidadMedida = (typeof ESTADOS_UNIDAD_MEDIDA)[number];

/**
 * Forma normalizada con la que se COMPARAN nombres y abreviaturas (FR-101).
 *
 * La misma función para los dos campos: son dos unicidades independientes, pero el criterio de
 * comparación es idéntico y debe coincidir con los índices funcionales
 * `lower(btrim(nombre))` / `lower(btrim(abreviatura))` de la base de datos, que son la autoridad
 * final. **No normaliza tildes**, igual que en categorías y proveedores.
 */
export function textoUnidadMedidaNormalizado(valor: string): string {
  return valor.trim().toLocaleLowerCase('es');
}
