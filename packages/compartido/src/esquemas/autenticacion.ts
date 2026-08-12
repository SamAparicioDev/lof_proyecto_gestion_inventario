/**
 * Esquemas de autenticación — módulo de seguridad.
 *
 * Implementa: FR-001 (autenticación con usuario y contraseña) y FR-016/FR-047
 * (validaciones con mensajes en español que indican el campo y la corrección esperada).
 *
 * ARCHIVO EJEMPLAR: este es el patrón que siguen TODOS los esquemas del paquete —
 * un `z.object` por operación, mensajes en español en cada regla, y el tipo TypeScript
 * derivado con `z.infer` exportado junto al esquema. Los demás módulos (productos,
 * ingresos, clientes, salidas, usuarios) replican esta estructura en sus tareas.
 */
import { z } from 'zod';

/** Body de POST /api/auth/login (contracts/api-rest.md). */
export const esquemaLogin = z.object({
  login: z
    .string({ required_error: 'El usuario es obligatorio' })
    .trim()
    .min(1, 'El usuario es obligatorio')
    .max(50, 'El usuario no puede superar 50 caracteres'),
  password: z
    .string({ required_error: 'La contraseña es obligatoria' })
    .min(1, 'La contraseña es obligatoria'),
});
export type DatosLogin = z.infer<typeof esquemaLogin>;

/**
 * Body de PUT /api/auth/password.
 * La política mínima de contraseña vive aquí para que el formulario y el backend
 * la apliquen idéntica (Principio IV: el servidor es la autoridad).
 */
export const esquemaCambiarPassword = z.object({
  passwordActual: z
    .string({ required_error: 'La contraseña actual es obligatoria' })
    .min(1, 'La contraseña actual es obligatoria'),
  passwordNueva: z
    .string({ required_error: 'La nueva contraseña es obligatoria' })
    .min(8, 'La nueva contraseña debe tener al menos 8 caracteres')
    .max(72, 'La nueva contraseña no puede superar 72 caracteres'),
});
export type DatosCambiarPassword = z.infer<typeof esquemaCambiarPassword>;
