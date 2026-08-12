/**
 * Funciones de administración de usuarios del frontend, lado navegador (T077).
 *
 * Envuelven las MUTACIONES de `/api/usuarios/*` (contracts/api-rest.md § Usuarios, exclusivo
 * del rol Administrador) usando SIEMPRE `api<T>()` (frontend/CLAUDE.md) — nunca `fetch`
 * directo. Sigue el patrón de `lib/api/clientes.ts`. El listado (`GET /api/usuarios`) lo pide
 * directamente `app/(app)/usuarios/page.tsx` (Server Component) vía `apiServidor` — aquí solo
 * van las operaciones que corren en el navegador (diálogos y botones de acción, Client
 * Components).
 */
import type {
  DatosActualizarUsuario,
  DatosCrearUsuario,
  DatosRestablecerPasswordUsuario,
  EstadoUsuario,
} from '@trazo/compartido';
import { api } from './cliente';

/** `POST /api/usuarios` — alta de usuario (FR-005/FR-006); nace con `debeCambiarPassword=true`. */
export function crearUsuario(datos: DatosCrearUsuario): Promise<{ id: number }> {
  return api<{ id: number }>('/api/usuarios', { method: 'POST', body: JSON.stringify(datos) });
}

/** `PUT /api/usuarios/:id` — edición de usuario (FR-005), sin `login` ni contraseña. */
export function actualizarUsuario(id: number, datos: DatosActualizarUsuario): Promise<void> {
  return api<void>(`/api/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

/**
 * `PUT /api/usuarios/:id/restablecer-password` — el Administrador fija una contraseña
 * temporal para OTRO usuario sin conocer la anterior; marca `debeCambiarPassword=true` en el
 * backend (FR-005).
 */
export function restablecerPasswordUsuario(id: number, passwordTemporal: string): Promise<void> {
  const datos: DatosRestablecerPasswordUsuario = { passwordTemporal };
  return api<void>(`/api/usuarios/${id}/restablecer-password`, { method: 'PUT', body: JSON.stringify(datos) });
}

/**
 * `PUT /api/usuarios/:id/estado` — activa/desactiva un usuario (baja lógica, FR-008, nunca
 * `DELETE`). Si el Administrador intenta desactivar su propia sesión, el backend responde
 * `409` (US6-AS) que el llamador muestra como error general, nunca un toast.
 */
export function cambiarEstadoUsuario(id: number, estado: EstadoUsuario): Promise<void> {
  return api<void>(`/api/usuarios/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado }) });
}
