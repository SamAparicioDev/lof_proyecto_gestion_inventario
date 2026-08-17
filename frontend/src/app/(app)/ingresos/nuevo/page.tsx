/**
 * Página de alta de ingreso (T035) — `/ingresos/nuevo`. Server Component: solo compone
 * (docs/arquitectura.md §7); el formulario con líneas dinámicas vive en
 * `componentes/ingresos/ingreso-form.tsx`. Precarga el catálogo de productos para el
 * selector de líneas vía `GET /api/productos` (extensión T035 — ver TSDoc de
 * `controlador-productos.ts`).
 *
 * ## `?ordenCompraId=N` — registrar el ingreso de una orden (US16, T175, FR-099)
 *
 * Cuando se llega desde una orden de compra ENVIADA, la página la carga y precarga el
 * formulario con SU proveedor y SUS líneas. Lo único que queda por escribir es lo que la orden
 * no puede saber: el número y las fechas de la factura. El vínculo viaja en el body y hace que,
 * al recibir el ingreso, la orden pase a RECIBIDA sola.
 *
 * Si la orden no existe o la sesión no puede consultarla, se abre el alta normal en vez de
 * romper la pantalla: el usuario podrá registrar el ingreso igual, solo que sin el vínculo —
 * que es exactamente como funcionaba antes de US16.
 */
import type { DatosCrearIngreso, OrdenCompraConDetalles, ProductoResumen } from '@trazo/compartido';
import { apiServidor, apiServidorOpcional } from '@/lib/api/servidor';
import { IngresoForm } from '@/componentes/ingresos/ingreso-form';

interface ParametrosBusqueda {
  ordenCompraId?: string;
}

export default async function PaginaNuevoIngreso({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusqueda>;
}) {
  const { ordenCompraId } = await searchParams;
  const productos = await apiServidor<ProductoResumen[]>('/api/productos');

  const idOrden = Number(ordenCompraId);
  const orden =
    Number.isInteger(idOrden) && idOrden > 0
      ? await apiServidorOpcional<OrdenCompraConDetalles | null>(`/api/ordenes-compra/${idOrden}`, null)
      : null;

  // Solo se precarga desde una orden ENVIADA: el backend rechazaría cualquier otra (FR-099), así
  // que ofrecer el formulario ya vinculado sería prometer algo que no se va a poder guardar.
  const ordenSurtible = orden?.estado === 'ENVIADA' ? orden : null;

  const valoresIniciales: DatosCrearIngreso | undefined = ordenSurtible
    ? {
        numeroFactura: '',
        fechaFactura: '',
        proveedorId: ordenSurtible.proveedor.id,
        ordenCompraId: ordenSurtible.id,
        fechaRecepcion: '',
        observaciones: '',
        lineas: ordenSurtible.detalles.map((detalle) => ({
          productoId: detalle.productoId,
          cantidad: detalle.cantidad,
          // El precio de la orden es ESTIMADO: llega como punto de partida y el usuario lo
          // ajusta a lo que diga la factura, que es lo que fija el costo del inventario.
          precioUnitario: detalle.precioUnitario,
          // US20: la tasa de la orden viaja igual que el precio — el impuesto de lo que se
          // pidió es el mismo que el de lo que se recibe, salvo que el usuario lo cambie.
          tasaIva: detalle.tasaIva,
        })),
      }
    : undefined;

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Compras</h6>
        <h2 style={{ margin: 0 }}>Nuevo ingreso</h2>
      </div>
      <IngresoForm
        productos={productos}
        valoresIniciales={valoresIniciales}
        proveedorActual={ordenSurtible?.proveedor ?? null}
        ordenVinculada={ordenSurtible ? { id: ordenSurtible.id, numero: ordenSurtible.numero } : null}
      />
    </div>
  );
}
