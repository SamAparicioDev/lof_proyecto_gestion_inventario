/**
 * Ficha de una cotización (US21, T204) — `/cotizaciones/[id]`.
 *
 * Server Component de SOLO LECTURA: resuelve la cotización vía `apiServidor` y la muestra con
 * sus tres cifras. La edición vive en su propia ruta (`/cotizaciones/[id]/editar`), a diferencia
 * de las órdenes de compra, donde el detalle en BORRADOR ES el formulario. El motivo es la
 * acción de aceptar: quien entra a una cotización enviada viene a registrar la respuesta del
 * cliente, y una pantalla que fuera un formulario editable invitaría a tocar precios que ya
 * están en manos del cliente.
 *
 * El catálogo de productos se pide con `apiServidorOpcional` —igual que en el detalle de una
 * orden— porque exige `productos.ver`, un permiso distinto: un rol que pueda consultar
 * cotizaciones pero no el catálogo debe ver el documento con el id del producto, que es el
 * respaldo ya previsto, y no la pantalla de error genérica de Next.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  formatoNumeroCotizacion,
  type CotizacionConDetalles,
  type ProductoResumen,
} from '@trazo/compartido';
import { apiServidor, apiServidorOpcional } from '@/lib/api/servidor';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoFecha, formatoMoneda } from '@/lib/formato';
import { EstadoCotizacionTag } from '@/componentes/cotizaciones/estado-cotizacion-tag';
import { AccionesCotizacion } from '@/componentes/cotizaciones/acciones-cotizacion';
import { BotonesExportar } from '@/componentes/comunes/botones-exportar';

export default async function PaginaDetalleCotizacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cotizacionId = Number(id);
  if (!Number.isInteger(cotizacionId) || cotizacionId <= 0) {
    notFound();
  }

  let cotizacion: CotizacionConDetalles;
  try {
    cotizacion = await apiServidor<CotizacionConDetalles>(`/api/cotizaciones/${cotizacionId}`);
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const productos = await apiServidorOpcional<ProductoResumen[]>('/api/productos', []);
  const productosPorId = new Map(productos.map((producto) => [producto.id, producto]));
  const hayIva = cotizacion.valorIva > 0;

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Ventas</h6>
          <h2 style={{ margin: 0 }}>Cotización {formatoNumeroCotizacion(cotizacion.numero)}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* El PDF de esta cotización ES la oferta que se le envía al cliente (FR-116). */}
          <BotonesExportar hrefBase={`/api/cotizaciones/${cotizacion.id}/export`} descripcion="esta cotización" />
          <EstadoCotizacionTag estado={cotizacion.estado} vencida={cotizacion.vencida} />
        </div>
      </div>

      <div className="card gap-4 p-5">
        <dl className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', margin: 0 }}>
          <DatoSoloLectura etiqueta="Cliente" valor={cotizacion.cliente.nombre} />
          <DatoSoloLectura etiqueta="Proyecto" valor={cotizacion.proyecto.nombre} />
          <DatoSoloLectura etiqueta="Fecha" valor={formatoFecha(cotizacion.fecha)} />
          <DatoSoloLectura etiqueta="Válida hasta" valor={formatoFecha(cotizacion.fechaValidez)} />
          {cotizacion.observaciones && (
            <DatoSoloLectura etiqueta="Observaciones" valor={cotizacion.observaciones} />
          )}
          {cotizacion.motivoAnulacion && (
            <DatoSoloLectura etiqueta="Motivo de anulación" valor={cotizacion.motivoAnulacion} />
          )}
        </dl>

        {/* La salida que nació al aceptarla (FR-115): es el documento que continúa la historia. */}
        {cotizacion.salidaId !== null && (
          <div style={{ fontSize: 13 }}>
            Esta cotización generó la{' '}
            <Link href={`/salidas/${cotizacion.salidaId}`}>salida N.º {cotizacion.salidaId}</Link>. El
            inventario se compromete cuando esa salida se confirme.
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Precio unitario</th>
                <th>IVA</th>
                <th>Valor de línea</th>
              </tr>
            </thead>
            <tbody>
              {cotizacion.detalles.map((detalle) => {
                const producto = productosPorId.get(detalle.productoId);
                return (
                  <tr key={detalle.id}>
                    <td>
                      {producto ? `${producto.sku} — ${producto.descripcion}` : `Producto N.º ${detalle.productoId}`}
                    </td>
                    <td>{detalle.cantidad}</td>
                    <td>{formatoMoneda(detalle.precioUnitario)}</td>
                    <td className="text-muted">
                      {detalle.tasaIva}% — {formatoMoneda(detalle.valorIva)}
                    </td>
                    <td>{formatoMoneda(detalle.valorTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Las tres cifras, con el mismo criterio que el documento exportado: sin impuesto se
            muestra una sola, porque repetir el mismo número tres veces no informa de nada. */}
        <div className="flex flex-col items-end gap-1">
          {hayIva && (
            <>
              <div className="text-muted" style={{ fontSize: 13 }}>
                Base gravable: {formatoMoneda(cotizacion.valorTotal)}
              </div>
              <div className="text-muted" style={{ fontSize: 13 }}>
                IVA: {formatoMoneda(cotizacion.valorIva)}
              </div>
            </>
          )}
          <div style={{ fontSize: 16, fontFamily: 'var(--font-heading)' }}>
            Total: {formatoMoneda(cotizacion.valorTotal + cotizacion.valorIva)}
          </div>
        </div>
      </div>

      <AccionesCotizacion cotizacion={cotizacion} />
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
