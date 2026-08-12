'use client';

/**
 * Proveedor de sesión para Client Components (T026).
 *
 * El layout autenticado del lado servidor (frontend/src/app/(app)/layout.tsx, T025) ya
 * resuelve el `PerfilSesion` (reenviando la cookie a `GET /api/auth/perfil`) antes de
 * renderizar cualquier página. `ProveedorSesion` recibe ese perfil como prop inicial y lo
 * expone a los Client Components vía `useUsuario()`, para que ninguno tenga que volver a
 * pedirlo por su cuenta (evita una llamada de red duplicada — frontend/CLAUDE.md).
 *
 * Desde US9 el perfil incluye además `permisos` (las claves efectivas del rol, resueltas en
 * el servidor en cada petición — FR-058). `usePuede()` es la forma en que un Client Component
 * pregunta por uno de ellos, en vez de comparar contra un nombre de rol fijo: un rol propio
 * creado por el Administrador no tiene nombre conocido de antemano, pero sí tiene permisos
 * (T108). Recuerda que mostrar u ocultar así es solo UX — la autoridad es el guard del
 * backend (FR-003, ver `lib/permisos.ts`).
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { PerfilSesion } from '@trazo/compartido';
import { tienePermiso, type ClavePermisoUI } from './permisos';

const ContextoSesion = createContext<PerfilSesion | null>(null);

export function ProveedorSesion({
  perfil,
  children,
}: {
  perfil: PerfilSesion;
  children: ReactNode;
}) {
  return <ContextoSesion.Provider value={perfil}>{children}</ContextoSesion.Provider>;
}

/**
 * Perfil de la sesión activa (id, nombre, rol, permisos, debeCambiarPassword) dentro de un
 * Client Component. Lanza si se usa fuera de `<ProveedorSesion>` — el layout de T025 siempre
 * lo monta para todas las rutas de `(app)`, así que este error solo indicaría un componente
 * mal ubicado (error de programación, no de negocio).
 */
export function useUsuario(): PerfilSesion {
  const perfil = useContext(ContextoSesion);
  if (perfil === null) {
    throw new Error('useUsuario debe usarse dentro de <ProveedorSesion>');
  }
  return perfil;
}

/**
 * Claves de permiso efectivas de la sesión (`modulo.accion`), tal como las resolvió el
 * servidor en la petición que renderizó la página. Úsala cuando necesites varias a la vez o
 * pasarlas a un hijo; para una sola pregunta, `usePuede()` se lee mejor.
 */
export function usePermisos(): string[] {
  return useUsuario().permisos;
}

/**
 * ¿La sesión concede este permiso? Sustituye a las comparaciones por nombre de rol
 * (`rol === 'ADMINISTRADOR'`) que el frontend usaba antes de US9 — ver `lib/permisos.ts`
 * para por qué esto NO es control de acceso.
 */
export function usePuede(clave: ClavePermisoUI): boolean {
  return tienePermiso(useUsuario().permisos, clave);
}
