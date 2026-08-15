/**
 * Alta de orden de compra (US16, T174) — `/ordenes-compra/nueva`. Server Component: solo resuelve
 * el permiso, precarga el catálogo de productos para el selector de líneas y compone; el
 * formulario con líneas dinámicas y el panel de sugerencias vive en
 * `componentes/ordenes-compra/orden-compra-form.tsx`.
 */
import type { ProductoResumen } from '@trazo/compartido';
import { apiServidor } from '@/lib/api/servidor';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { PERMISOS, tienePermiso } from '@/lib/permisos';
import { OrdenCompraForm } from '@/componentes/ordenes-compra/orden-compra-form';

export default async function PaginaNuevaOrdenCompra() {
  const perfil = await obtenerPerfilServidor();

  if (!tienePermiso(perfil?.permisos, PERMISOS.ORDENES_COMPRA_CREAR)) {
    return (
      <div role="alert" className="card p-5">
        No tienes permiso para crear órdenes de compra. Contacta a un administrador o gerente.
      </div>
    );
  }

  const productos = await apiServidor<ProductoResumen[]>('/api/productos');

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Compras</h6>
        <h2 style={{ margin: 0 }}>Nueva orden de compra</h2>
        <p className="text-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
          Elige el proveedor y te mostraremos qué productos suyos están bajo su umbral de stock.
        </p>
      </div>
      <OrdenCompraForm productos={productos} />
    </div>
  );
}
