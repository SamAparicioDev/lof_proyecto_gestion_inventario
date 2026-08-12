/**
 * Página de alta de salida (T054) — `/salidas/nueva`. Server Component: solo compone
 * (docs/arquitectura.md §7); el formulario con la cascada cliente→proyecto y las líneas
 * dinámicas vive en `componentes/salidas/salida-form.tsx`. Precarga el listado de clientes
 * (para el combobox raíz de la cascada) y el catálogo de productos (con `disponible`/
 * `ultimoCosto`, extensión T052) para el selector de líneas.
 */
import type { Cliente, Paginado, ProductoResumen } from '@trazo/compartido';
import { POR_PAGINA_MAXIMA } from '@trazo/compartido';
import { apiServidor } from '@/lib/api/servidor';
import { SalidaForm } from '@/componentes/salidas/salida-form';

export default async function PaginaNuevaSalida() {
  const [clientesPagina, productos] = await Promise.all([
    apiServidor<Paginado<Cliente>>(`/api/clientes?porPagina=${POR_PAGINA_MAXIMA}`),
    apiServidor<ProductoResumen[]>('/api/productos'),
  ]);

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Despachos</h6>
        <h2 style={{ margin: 0 }}>Nueva salida</h2>
      </div>
      <SalidaForm clientes={clientesPagina.datos} productos={productos} />
    </div>
  );
}
