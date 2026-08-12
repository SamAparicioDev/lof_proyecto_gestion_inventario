/**
 * Página de alta de ingreso (T035) — `/ingresos/nuevo`. Server Component: solo compone
 * (docs/arquitectura.md §7); el formulario con líneas dinámicas vive en
 * `componentes/ingresos/ingreso-form.tsx`. Precarga el catálogo de productos para el
 * selector de líneas vía `GET /api/productos` (extensión T035 — ver TSDoc de
 * `controlador-productos.ts`).
 */
import type { ProductoResumen } from '@trazo/compartido';
import { apiServidor } from '@/lib/api/servidor';
import { IngresoForm } from '@/componentes/ingresos/ingreso-form';

export default async function PaginaNuevoIngreso() {
  const productos = await apiServidor<ProductoResumen[]>('/api/productos');

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Compras</h6>
        <h2 style={{ margin: 0 }}>Nuevo ingreso</h2>
      </div>
      <IngresoForm productos={productos} />
    </div>
  );
}
