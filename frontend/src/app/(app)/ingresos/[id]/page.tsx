/**
 * Detalle/edición de un ingreso (T036) — `/ingresos/[id]`. Server Component: resuelve el
 * ingreso vía `apiServidor` (T025/T034) y, si está `PENDIENTE`, reutiliza `IngresoForm`
 * (T035) precargado para edición (`PUT /api/ingresos/:id`, US1-AS5); en cualquier otro
 * estado muestra cabecera y líneas de solo lectura. `AccionesIngreso` (Client Component)
 * pone los botones Recibir/Verificar/Anular según estado y rol (contracts/api-rest.md).
 *
 * Siempre carga el catálogo de `GET /api/productos` (extensión T035): además de alimentar el
 * selector del formulario en modo edición, sirve para mostrar el SKU/descripción de cada
 * línea en la vista de solo lectura — `IngresoConDetalles.detalles` solo trae `productoId`
 * (contracts/api-rest.md), así que sin este catálogo la tabla de solo lectura solo podría
 * mostrar el id crudo del producto.
 *
 * Ese catálogo es un recurso AUXILIAR y exige `productos.ver`, un permiso distinto de
 * `ingresos.ver`, así que se pide con `apiServidorOpcional` (revisión adversarial de la Tanda
 * 13): un rol propio que pueda consultar ingresos pero no el catálogo debe ver el documento
 * con el id del producto —que es justamente el respaldo que la tabla ya tenía previsto—, no la
 * pantalla de error genérica de Next.
 */
import { notFound } from 'next/navigation';
import type { DatosCrearIngreso, IngresoConDetalles, ProductoResumen } from '@trazo/compartido';
import { apiServidor, apiServidorOpcional } from '@/lib/api/servidor';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoFecha, formatoMoneda } from '@/lib/formato';
import { EstadoIngresoTag } from '@/componentes/ingresos/estado-ingreso-tag';
import { IngresoForm } from '@/componentes/ingresos/ingreso-form';
import { AccionesIngreso } from '@/componentes/ingresos/acciones-ingreso';
import { BotonesExportar } from '@/componentes/comunes/botones-exportar';

/** `2026-08-01T00:00:00.000Z` → `2026-08-01`, el formato que espera `<input type="date">` (mismo criterio UTC que `formatoFecha`). */
function aFechaInput(fechaIso: string): string {
  return fechaIso.slice(0, 10);
}

function aValoresFormulario(ingreso: IngresoConDetalles): DatosCrearIngreso {
  return {
    numeroFactura: ingreso.numeroFactura,
    fechaFactura: aFechaInput(ingreso.fechaFactura),
    proveedor: ingreso.proveedor,
    fechaRecepcion: aFechaInput(ingreso.fechaRecepcion),
    observaciones: ingreso.observaciones ?? '',
    lineas: ingreso.detalles.map((detalle) => ({
      productoId: detalle.productoId,
      cantidad: detalle.cantidad,
      precioUnitario: detalle.precioUnitario,
    })),
  };
}

export default async function PaginaDetalleIngreso({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ingresoId = Number(id);
  if (!Number.isInteger(ingresoId) || ingresoId <= 0) {
    notFound();
  }

  let ingreso: IngresoConDetalles;
  try {
    ingreso = await apiServidor<IngresoConDetalles>(`/api/ingresos/${ingresoId}`);
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) {
      notFound();
    }
    throw error;
  }

  // `AccionesIngreso` lee sus permisos con `usePuede()` del contexto de sesión (T108), así que
  // esta página ya no pide `GET /api/auth/perfil` solo para reenviarle el rol.
  const productos = await apiServidorOpcional<ProductoResumen[]>('/api/productos', []);
  const productosPorId = new Map(productos.map((producto) => [producto.id, producto]));
  const esPendiente = ingreso.estado === 'PENDIENTE';

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Compras</h6>
          <h2 style={{ margin: 0 }}>Factura {ingreso.numeroFactura}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* US11/T122: el documento completo (cabecera, líneas, totales y auditoría, FR-065)
              en PDF o Excel — mismo permiso que ya exige ver esta ficha. */}
          <BotonesExportar hrefBase={`/api/ingresos/${ingreso.id}/export`} descripcion="este ingreso" />
          <EstadoIngresoTag estado={ingreso.estado} />
        </div>
      </div>

      {esPendiente ? (
        <IngresoForm productos={productos} ingresoId={ingreso.id} valoresIniciales={aValoresFormulario(ingreso)} />
      ) : (
        <div className="card gap-4 p-5">
          <dl className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', margin: 0 }}>
            <DatoSoloLectura etiqueta="Proveedor" valor={ingreso.proveedor} />
            <DatoSoloLectura etiqueta="Fecha de la factura" valor={formatoFecha(ingreso.fechaFactura)} />
            <DatoSoloLectura etiqueta="Fecha de recepción" valor={formatoFecha(ingreso.fechaRecepcion)} />
            <DatoSoloLectura etiqueta="Valor total" valor={formatoMoneda(ingreso.valorTotal)} />
            {ingreso.observaciones && <DatoSoloLectura etiqueta="Observaciones" valor={ingreso.observaciones} />}
            {ingreso.motivoAnulacion && <DatoSoloLectura etiqueta="Motivo de anulación" valor={ingreso.motivoAnulacion} />}
          </dl>

          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Precio unitario</th>
                  <th>Valor de línea</th>
                </tr>
              </thead>
              <tbody>
                {ingreso.detalles.map((detalle) => {
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

      <AccionesIngreso ingreso={ingreso} />
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
