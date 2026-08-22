/**
 * Esquemas del BUZÓN DE SOLICITUDES del super administrador (US36, FR-148…FR-157).
 *
 * ## Por qué el alta pide tan poco
 *
 * Un título y una descripción libre, nada más (FR-149). La tentación de pedir aquí prioridad,
 * módulo afectado o criterios de aceptación es fuerte y hay que resistirla: quien anota está en
 * mitad de otra cosa y acaba de notar que algo falta. Cada campo obligatorio de más es una razón
 * para no anotarlo, y un pedido no anotado no se implementa nunca. La estructura llega después,
 * al refinar — que es opcional y repetible (FR-153).
 *
 * ## Los topes
 *
 * `descripcion` admite 5000 caracteres porque es la materia prima del refinado: cuanto más
 * contexto dé el autor, menos tiene que inventar el modelo. `titulo` se queda en 150 porque es lo
 * que se lee en la lista, y un título que no cabe en una fila deja de ser un título.
 */
import { z } from 'zod';

/** Los tres estados de una solicitud (FR-154). El significado de COMPLETADA es «implementado
 *  Y desplegado», no «el código compila» — está fijado en contracts/api-rest.md. */
export const ESTADOS_SOLICITUD = ['PENDIENTE', 'COMPLETADA', 'DESCARTADA'] as const;
export type EstadoSolicitud = (typeof ESTADOS_SOLICITUD)[number];

/** Body de `POST /api/solicitudes` (FR-149). */
export const esquemaCrearSolicitud = z.object({
  titulo: z
    .string({ required_error: 'Escribe un título' })
    .trim()
    .min(3, 'El título debe tener al menos 3 caracteres')
    .max(150, 'El título no puede superar 150 caracteres'),
  descripcion: z
    .string({ required_error: 'Describe lo que necesitas' })
    .trim()
    .min(10, 'La descripción debe tener al menos 10 caracteres')
    .max(5000, 'La descripción no puede superar 5000 caracteres'),
});
export type DatosCrearSolicitud = z.infer<typeof esquemaCrearSolicitud>;

/**
 * Body de `PATCH /api/solicitudes/:id`.
 *
 * Los mismos dos campos y NINGUNO más: este endpoint no toca `promptRefinado` (FR-152). Que el
 * esquema no lo admita es la garantía —el pipe descarta lo que no está declarado—, no una
 * comprobación que el caso de uso tenga que recordar hacer.
 */
export const esquemaActualizarSolicitud = esquemaCrearSolicitud;
export type DatosActualizarSolicitud = z.infer<typeof esquemaActualizarSolicitud>;

/** Body de `PATCH /api/solicitudes/:id/estado` (FR-154). */
export const esquemaCambiarEstadoSolicitud = z.object({
  estado: z.enum(ESTADOS_SOLICITUD, {
    errorMap: () => ({ message: 'El estado debe ser PENDIENTE, COMPLETADA o DESCARTADA' }),
  }),
});
export type DatosCambiarEstadoSolicitud = z.infer<typeof esquemaCambiarEstadoSolicitud>;

/** Query de `GET /api/solicitudes`. El filtro por estado es opcional: sin él se ven todas. */
export const esquemaFiltrosSolicitudes = z.object({
  estado: z.enum(ESTADOS_SOLICITUD).optional(),
  pagina: z.coerce.number().int().min(1).optional().default(1),
  porPagina: z.coerce.number().int().min(1).max(100).optional().default(20),
});
export type FiltrosSolicitudes = z.infer<typeof esquemaFiltrosSolicitudes>;
