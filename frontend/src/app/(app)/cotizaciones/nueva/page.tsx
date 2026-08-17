/**
 * Alta de cotización (US21, T204) — `/cotizaciones/nueva`. Server Component: resuelve el permiso,
 * precarga los catálogos que alimentan la cascada cliente → proyecto y el selector de líneas, y
 * compone; el formulario con líneas dinámicas vive en
 * `componentes/cotizaciones/cotizacion-form.tsx`.
 */
import type { Cliente, Paginado, ProductoResumen } from '@trazo/compartido';
import { POR_PAGINA_MAXIMA } from '@trazo/compartido';
import { apiServidor, apiServidorOpcional } from '@/lib/api/servidor';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { PERMISOS, tienePermiso } from '@/lib/permisos';
import { CotizacionForm } from '@/componentes/cotizaciones/cotizacion-form';

export default async function PaginaNuevaCotizacion() {
  const perfil = await obtenerPerfilServidor();

  if (!tienePermiso(perfil?.permisos, PERMISOS.COTIZACIONES_CREAR)) {
    return (
      <div role="alert" className="card p-5">
        No tienes permiso para crear cotizaciones. Contacta a un administrador o gerente.
      </div>
    );
  }

  const productos = await apiServidor<ProductoResumen[]>('/api/productos');
  // `GET /api/clientes` devuelve un PAGINADO (no un arreglo) y su máximo por página es
  // `POR_PAGINA_MAXIMA` — pedir más se rechaza con 400, que es como se rompió esta pantalla
  // la primera vez. `apiServidorOpcional` porque `clientes.ver` es un permiso distinto.
  const clientesPagina = await apiServidorOpcional<Paginado<Cliente>>(
    `/api/clientes?porPagina=${POR_PAGINA_MAXIMA}`,
    { datos: [], total: 0, pagina: 1, porPagina: POR_PAGINA_MAXIMA },
  );
  const listaClientes = clientesPagina.datos;

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Ventas</h6>
        <h2 style={{ margin: 0 }}>Nueva cotización</h2>
        <p className="text-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
          Nace en borrador: puedes ajustarla las veces que quieras antes de enviársela al cliente.
        </p>
      </div>
      <CotizacionForm clientes={listaClientes} productos={productos} />
    </div>
  );
}
