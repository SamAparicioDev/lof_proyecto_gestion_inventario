/**
 * Funciones de administración de roles y permisos del frontend, lado navegador (T107/T108).
 *
 * Envuelven `/api/roles` y `GET /api/permisos` (contracts/api-rest.md § Roles y permisos,
 * exigen `roles.gestionar`) usando SIEMPRE `api<T>()` (frontend/CLAUDE.md) — nunca `fetch`
 * directo. Sigue el patrón de `lib/api/usuarios.ts`: aquí van las operaciones que corren en el
 * navegador (diálogos y botones de la pantalla de roles); los listados que la página necesita
 * antes del primer render los pide `app/(app)/roles/page.tsx` (Server Component) vía
 * `apiServidor`.
 *
 * Implementa: FR-055 (crear, editar, activar/desactivar y eliminar roles, y asignar o quitar
 * sus permisos) y FR-056 (el catálogo de permisos solo se LEE — no hay ninguna función de
 * escritura sobre `/api/permisos`).
 */
import type { DatosActualizarRol, DatosCrearRol, EstadoRol } from '@trazo/compartido';
import { api } from './cliente';

/** `POST /api/roles` — alta de un rol propio (nace `esSistema=false`, `estado=ACTIVO`). */
export function crearRol(datos: DatosCrearRol): Promise<{ id: number }> {
  return api<{ id: number }>('/api/roles', { method: 'POST', body: JSON.stringify(datos) });
}

/**
 * `PUT /api/roles/:id` — nombre, descripción y matriz de permisos. `permisoIds` REEMPLAZA el
 * conjunto completo: desmarcar una casilla quita el permiso, y el cambio rige en la siguiente
 * petición de cada usuario con ese rol, sin re-login (US9-AS3).
 */
export function actualizarRol(id: number, datos: DatosActualizarRol): Promise<void> {
  return api<void>(`/api/roles/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

/**
 * `PUT /api/roles/:id/estado` — baja lógica de un rol. Es la alternativa que el sistema ofrece
 * cuando un rol no se puede eliminar por tener usuarios asignados (US9-AS5). Responde `409`
 * ante un rol del sistema o si dejaría a la organización sin `roles.gestionar` (FR-057).
 */
export function cambiarEstadoRol(id: number, estado: EstadoRol): Promise<void> {
  return api<void>(`/api/roles/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado }) });
}

/**
 * `DELETE /api/roles/:id` — solo para roles propios sin usuarios asignados. Ante un rol del
 * sistema o con usuarios responde `409` con un mensaje que indica cuántos lo tienen (FR-057);
 * el llamador lo muestra como error general dentro del diálogo, nunca un toast.
 */
export function eliminarRol(id: number): Promise<void> {
  return api<void>(`/api/roles/${id}`, { method: 'DELETE' });
}

/*
 * Sin funciones de LECTURA aquí: los tres listados que consume la interfaz —los roles de
 * `/roles`, su catálogo de permisos y los roles asignables del formulario de usuarios— los
 * resuelven las páginas (Server Components) con `apiServidor`, antes del primer render y sin
 * estados de carga en los diálogos. Mismo reparto y mismo criterio que `lib/api/usuarios.ts`.
 */
