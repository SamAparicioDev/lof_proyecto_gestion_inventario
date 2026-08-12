'use client';

/**
 * Botón "Nuevo usuario" + diálogo de alta (T077) — mismo criterio que
 * `componentes/inventario/boton-nuevo-producto.tsx`: el botón vive en el header de
 * `app/(app)/usuarios/page.tsx` (Server Component) a través de este Client Component
 * separado, porque abrir el diálogo requiere estado local que un Server Component no puede
 * tener. Tras crear con éxito, `router.refresh()` para que la página vuelva a leer el
 * listado paginado del servidor (mismo patrón que `componentes/salidas/acciones-salida.tsx`).
 *
 * `roles` viaja por prop desde la página (que los resuelve con `GET /api/roles?estado=ACTIVO`,
 * T108) en vez de pedirlos al abrir el diálogo: son los mismos que necesita el diálogo de
 * edición de cada fila, y así el desplegable no estrena un estado de carga.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import type { RolAsignado } from '@trazo/compartido';
import { UsuarioForm } from './usuario-form';

export function BotonNuevoUsuario({ roles }: { roles: RolAsignado[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setAbierto(true)}>
        <Plus size={16} /> Nuevo usuario
      </button>
      {abierto && (
        <UsuarioForm
          roles={roles}
          onCerrar={() => setAbierto(false)}
          onGuardado={() => router.refresh()}
        />
      )}
    </>
  );
}
