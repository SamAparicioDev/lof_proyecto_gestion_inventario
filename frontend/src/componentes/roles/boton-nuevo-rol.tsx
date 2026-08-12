'use client';

/**
 * Botón "Nuevo rol" + diálogo de alta (T107, FR-055) — mismo criterio que
 * `componentes/usuarios/boton-nuevo-usuario.tsx`: el botón vive en el header de
 * `app/(app)/roles/page.tsx` (Server Component) a través de este Client Component separado,
 * porque abrir el diálogo requiere estado local. Tras crear con éxito, `router.refresh()` para
 * que la página vuelva a leer el listado paginado del servidor.
 *
 * Recibe el catálogo de permisos ya resuelto por la página (`GET /api/permisos`) en vez de
 * pedirlo al abrir: la misma respuesta alimenta este diálogo y el de edición de cada fila, y
 * así el usuario no espera una carga para ver las casillas.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import type { ModuloPermisos } from '@trazo/compartido';
import { RolForm } from './rol-form';

export function BotonNuevoRol({ catalogo }: { catalogo: ModuloPermisos[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setAbierto(true)}>
        <Plus size={16} /> Nuevo rol
      </button>
      {abierto && (
        <RolForm catalogo={catalogo} onCerrar={() => setAbierto(false)} onGuardado={() => router.refresh()} />
      )}
    </>
  );
}
