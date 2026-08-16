'use client';

/**
 * Botón "Nuevo producto" + diálogo de alta (T111, FR-010/FR-011) — la entrada al catálogo que
 * faltaba: hasta esta tanda, `DialogoProductoNuevo` solo era alcanzable desde una línea del
 * formulario de ingresos, así que `/inventario` mostraba el catálogo sin poder darle de alta
 * nada. Mismo patrón (y mismo motivo) que `componentes/usuarios/boton-nuevo-usuario.tsx`: el
 * botón vive en el header de `app/(app)/inventario/page.tsx` (Server Component) a través de
 * este Client Component separado, porque abrir el diálogo requiere estado local.
 *
 * Tras crear, `router.refresh()` para que la página vuelva a leer el listado paginado del
 * servidor — el producto nuevo aparece en la tabla sin recargar a mano (patrón de
 * `componentes/salidas/acciones-salida.tsx`).
 *
 * Sin gate por rol a propósito: `POST /api/productos` es A,G,O (contracts/api-rest.md), a
 * diferencia de editar/cambiar estado (A,G). Ocultarle este botón al Operario le escondería
 * una acción que sí puede ejecutar.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { DialogoProductoNuevo } from './dialogo-producto-nuevo';

export function BotonNuevoProducto() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setAbierto(true)}>
        <Plus size={16} /> Nuevo producto
      </button>
      {abierto && (
        <DialogoProductoNuevo
          // Desde el catálogo el alta SÍ ofrece existencias iniciales (US18, FR-106); desde el
          // formulario de ingresos no, porque ahí las pone la línea del ingreso (FR-107).
          pideExistenciasIniciales
          onCerrar={() => setAbierto(false)}
          onCreado={() => {
            setAbierto(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
