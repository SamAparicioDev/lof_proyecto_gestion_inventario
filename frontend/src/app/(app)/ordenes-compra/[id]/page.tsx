/**
 * Detalle/edición de una orden de compra (US16, T175) — `/ordenes-compra/[id]`.
 *
 * Server Component: resuelve la orden vía `apiServidor` y, si está en BORRADOR, monta
 * `OrdenCompraForm` precargado para edición (FR-096); en cualquier otro estado la muestra de
 * solo lectura. `AccionesOrdenCompra` (Client Component) pone Enviar / Anular / Registrar
 * ingreso según estado y permiso.
 *
 * El catálogo de productos se pide con `apiServidorOpcional` —igual que en el detalle de un
 * ingreso— porque exige `productos.ver`, un permiso distinto de `ordenes_compra.ver`: un rol que
 * pueda consultar órdenes pero no el catálogo debe ver el documento con el id del producto, que
 * es el respaldo ya previsto, y no la pantalla de error genérica de Next.
 */
import { notFound } from 'next/navigation';
import {
  formatoNumeroOrdenCompra,
  type DatosCrearOrdenCompra,
  type OrdenCompraConDetalles,
  type ProductoResumen,
} from '@trazo/compartido';
import { apiServidor, apiServidorOpcional } from '@/lib/api/servidor';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoFecha, formatoMoneda } from '@/lib/formato';
import { EstadoOrdenCompraTag } from '@/componentes/ordenes-compra/estado-orden-compra-tag';
import { OrdenCompraForm } from '@/componentes/ordenes-compra/orden-compra-form';
import { AccionesOrdenCompra } from '@/componentes/ordenes-compra/acciones-orden-compra';
import { BotonesExportar } from '@/componentes/comunes/botones-exportar';

/** `2026-08-01T00:00:00.000Z` → `2026-08-01`, el ISO que espera `CampoFecha`. */
function aFechaInput(fechaIso: string): string {
  return fechaIso.slice(0, 10);
}

function aValoresFormulario(orden: OrdenCompraConDetalles): DatosCrearOrdenCompra {
  return {
    proveedorId: orden.proveedor.id,
    fechaOrden: aFechaInput(orden.fechaOrden),
    fechaEntregaEsperada: orden.fechaEntregaEsperada ? aFechaInput(orden.fechaEntregaEsperada) : undefined,
    observaciones: orden.observaciones ?? '',
    lineas: orden.detalles.map((detalle) => ({
      productoId: detalle.productoId,
      cantidad: detalle.cantidad,
      precioUnitario: detalle.precioUnitario,
      // US20: la tasa con la que se guardó cada línea vuelve al formulario tal cual — editar
      // otra cosa del documento no puede cambiarle el impuesto.
      tasaIva: detalle.tasaIva,
    })),
  };
}

export default async function PaginaDetalleOrdenCompra({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ordenId = Number(id);
  if (!Number.isInteger(ordenId) || ordenId <= 0) {
    notFound();
  }

  let orden: OrdenCompraConDetalles;
  try {
    orden = await apiServidor<OrdenCompraConDetalles>(`/api/ordenes-compra/${ordenId}`);
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const productos = await apiServidorOpcional<ProductoResumen[]>('/api/productos', []);
  const productosPorId = new Map(productos.map((producto) => [producto.id, producto]));
  const esBorrador = orden.estado === 'BORRADOR';

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Compras</h6>
          <h2 style={{ margin: 0 }}>Orden {formatoNumeroOrdenCompra(orden.numero)}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* El PDF de esta orden ES el pedido que se le envía al proveedor (FR-097). */}
          <BotonesExportar hrefBase={`/api/ordenes-compra/${orden.id}/export`} descripcion="esta orden de compra" />
          <EstadoOrdenCompraTag estado={orden.estado} />
        </div>
      </div>

      {esBorrador ? (
        <OrdenCompraForm
          productos={productos}
          ordenId={orden.id}
          valoresIniciales={aValoresFormulario(orden)}
          proveedorActual={orden.proveedor}
        />
      ) : (
        <div className="card gap-4 p-5">
          <dl className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', margin: 0 }}>
            <DatoSoloLectura etiqueta="Proveedor" valor={orden.proveedor.nombre} />
            <DatoSoloLectura etiqueta="Fecha de la orden" valor={formatoFecha(orden.fechaOrden)} />
            <DatoSoloLectura
              etiqueta="Entrega esperada"
              valor={orden.fechaEntregaEsperada ? formatoFecha(orden.fechaEntregaEsperada) : 'Sin fecha'}
            />
            <DatoSoloLectura etiqueta="Valor total estimado" valor={formatoMoneda(orden.valorTotal)} />
            {orden.observaciones && <DatoSoloLectura etiqueta="Observaciones" valor={orden.observaciones} />}
            {orden.motivoAnulacion && <DatoSoloLectura etiqueta="Motivo de anulación" valor={orden.motivoAnulacion} />}
          </dl>

          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Precio estimado</th>
                  <th>Valor de línea</th>
                </tr>
              </thead>
              <tbody>
                {orden.detalles.map((detalle) => {
                  const producto = productosPorId.get(detalle.productoId);
                  return (
                    <tr key={detalle.id}>
                      <td>{producto ? `${producto.sku} — ${producto.descripcion}` : `Producto N.º ${detalle.productoId}`}</td>
                      <td>{detalle.cantidad}</td>
                      <td>{formatoMoneda(detalle.precioUnitario)}</td>
                      <td>{formatoMoneda(detalle.valorTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AccionesOrdenCompra orden={orden} />
    </div>
  );
}

function DatoSoloLectura({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {etiqueta}
      </dt>
      <dd style={{ margin: '2px 0 0' }}>{valor}</dd>
    </div>
  );
}
