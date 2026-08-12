/**
 * Página de alta de cliente (T044) — `/clientes/nuevo`. Server Component: solo compone
 * (docs/arquitectura.md §7); el formulario plano vive en `componentes/clientes/cliente-form.tsx`.
 */
import { ClienteForm } from '@/componentes/clientes/cliente-form';

export default function PaginaNuevoCliente() {
  return (
    <div className="flex max-w-[720px] flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Relaciones</h6>
        <h2 style={{ margin: 0 }}>Nuevo cliente</h2>
      </div>
      <ClienteForm />
    </div>
  );
}
