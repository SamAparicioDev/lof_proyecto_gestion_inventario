/**
 * Esquemas del ASISTENTE DE CONSULTAS (US33, FR-133).
 *
 * El historial viaja en el cuerpo y no en el servidor a propósito: la conversación es efímera —
 * sirve para que "¿y el mes pasado?" tenga sentido y se acaba al cerrar la pantalla. Guardarla
 * significaría persistir preguntas de negocio con sus respuestas, y eso es un almacén de datos
 * sensibles que nadie ha pedido (Principio V).
 *
 * Los topes no son burocracia: el historial entra en cada petición al modelo, así que su tamaño es
 * costo por consulta. Diez turnos sostienen un hilo razonable; a partir de ahí conviene empezar de
 * nuevo, y la pantalla lo ofrece.
 */
import { z } from 'zod';

/** Un turno previo de la conversación. */
export const esquemaTurnoAsistente = z.object({
  rol: z.enum(['usuario', 'asistente'], { errorMap: () => ({ message: 'El turno no es válido' }) }),
  texto: z.string().trim().min(1).max(4000),
});
export type TurnoAsistente = z.infer<typeof esquemaTurnoAsistente>;

/** Body de `POST /api/asistente/consulta`. */
export const esquemaConsultaAsistente = z.object({
  pregunta: z
    .string({ required_error: 'Escribe una pregunta' })
    .trim()
    .min(1, 'Escribe una pregunta')
    .max(1000, 'La pregunta no puede superar 1000 caracteres'),
  historial: z
    .array(esquemaTurnoAsistente)
    .max(10, 'La conversación es demasiado larga: empieza una nueva')
    .optional()
    .default([]),
});
export type DatosConsultaAsistente = z.infer<typeof esquemaConsultaAsistente>;
