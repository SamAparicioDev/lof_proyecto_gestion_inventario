/**
 * Detalle/edición de una salida (T055) — `/salidas/[id]`. Server Component: resuelve la
 * salida vía `apiServidor` (T025/T053) y, si está `PENDIENTE`, reutiliza `SalidaForm` (T054)
 * precargado para edición (`PUT /api/salidas/:id`); en cualquier otro estado muestra cabecera
 * y líneas de solo lectura. `AccionesSalida` (Client Component) pone los botones
 * Confirmar/Completar/Cancelar/Anular según estado y rol (contracts/api-rest.md).
 *
 * `GET /api/salidas/:id` trae `clienteId` y `proyectoId` (este último puede ser `null` desde
 * US28/FR-124), así que se resuelven sus nombres con
 * `cargarClientesYProyectos` (mismo helper que el listado, T053) — en modo edición ese mismo
 * proyecto se le pasa a `SalidaForm` como `proyectoInicial` para precargar la cascada
 * cliente→proyecto (ver TSDoc de `salida-form.tsx`).
 *
 * Siempre carga el catálogo de `GET /api/productos` (extensión T052): alimenta el selector
 * del formulario en modo edición y muestra el SKU/descripción de cada línea en la vista de
 * solo lectura — `SalidaConDetalles.detalles` solo trae `productoId` (contracts/api-rest.md).
 *
 * Los DOS recursos auxiliares (`/api/productos` → `productos.ver`, clientes/proyectos →
 * `clientes.ver`) se piden con la variante OPCIONAL desde la revisión adversarial de la Tanda
 * 13: son permisos distintos de `salidas.ver`, y exigirlos para una vista de SOLO LECTURA
 * hacía que un rol propio con salidas cayera en la pantalla de error genérica de Next al abrir
 * un documento desde su propio listado. Sin ellos la pantalla se degrada a los textos de
 * respaldo que ya existían (`Producto N.º 7`, `Proyecto N.º 3`), nunca a un error.
 */
import { notFound } from 'next/navigation';
import type { DatosCrearSalida, ProductoResumen, SalidaConDetalles } from '@trazo/compartido';
import { apiServidor, apiServidorOpcional } from '@/lib/api/servidor';
import { ErrorApi } from '@/lib/api/cliente';
import { cargarClientesYProyectos } from '@/lib/clientes-proyectos-servidor';
import { formatoFecha, formatoFechaHora, formatoMoneda } from '@/lib/formato';
import { EstadoSalidaTag } from '@/componentes/salidas/estado-salida-tag';
import { SalidaForm } from '@/componentes/salidas/salida-form';
import { AccionesSalida } from '@/componentes/salidas/acciones-salida';
import { ExportarSalida } from '@/componentes/salidas/exportar-salida';

/** `2026-08-01T00:00:00.000Z` → `2026-08-01`, el ISO que espera `CampoFecha` (que lo muestra como `dd/mm/aaaa`). */
function aFechaInput(fechaIso: string): string {
  return fechaIso.slice(0, 10);
}

function aValoresFormulario(salida: SalidaConDetalles): DatosCrearSalida {
  return {
    clienteId: salida.clienteId,
    proyectoId: salida.proyectoId,
    fechaSalida: aFechaInput(salida.fechaSalida),
    observaciones: salida.observaciones ?? '',
    lineas: salida.detalles.map((detalle) => ({
      productoId: detalle.productoId,
      cantidad: detalle.cantidad,
      precioUnitario: detalle.precioUnitario,
      // US20: la tasa con la que se guardó cada línea vuelve al formulario tal cual — editar
      // otra cosa del documento no puede cambiarle el impuesto.
      tasaIva: detalle.tasaIva,
    })),
  };
}

export default async function PaginaDetalleSalida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const salidaId = Number(id);
  if (!Number.isInteger(salidaId) || salidaId <= 0) {
    notFound();
  }

  let salida: SalidaConDetalles;
  try {
    salida = await apiServidor<SalidaConDetalles>(`/api/salidas/${salidaId}`);
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) {
      notFound();
    }
    throw error;
  }

  // `AccionesSalida` lee sus permisos con `usePuede()` del contexto de sesión (T108), así que
  // esta página ya no pide `GET /api/auth/perfil` solo para reenviarle el rol.
  const [productos, { clientes, proyectos }] = await Promise.all([
    apiServidorOpcional<ProductoResumen[]>('/api/productos', []),
    cargarClientesYProyectos(),
  ]);
  const productosPorId = new Map(productos.map((producto) => [producto.id, producto]));
  const proyecto = salida.proyectoId === null ? undefined : proyectos.find((p) => p.id === salida.proyectoId);
  const cliente = clientes.find((c) => c.id === salida.clienteId);
  const esPendiente = salida.estado === 'PENDIENTE';

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Despachos</h6>
          <h2 style={{ margin: 0 }}>Salida N.º {salida.numero}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* US11/T122 + US27/T227: el documento completo (FR-065) con el logotipo institucional
              (FR-067) es el archivo que se le envía al cliente como soporte de entrega — por eso
              desde US27 no se descarga de un tirón: antes pregunta si va con o sin valores y a
              nombre de quién se imprime la firma (FR-123). */}
          <ExportarSalida salidaId={salida.id} numero={salida.numero} />
          <EstadoSalidaTag estado={salida.estado} />
        </div>
      </div>

      {esPendiente ? (
        <SalidaForm
          clientes={clientes}
          productos={productos}
          salidaId={salida.id}
          valoresIniciales={aValoresFormulario(salida)}
          proyectoInicial={proyecto}
        />
      ) : (
        <div className="card gap-4 p-5">
          <dl className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', margin: 0 }}>
            <DatoSoloLectura etiqueta="Cliente" valor={cliente?.nombre ?? `Cliente N.º ${salida.clienteId}`} />
            <DatoSoloLectura
              etiqueta="Proyecto"
              valor={
                salida.proyectoId === null
                  ? 'Sin proyecto'
                  : (proyecto?.nombre ?? `Proyecto N.º ${salida.proyectoId}`)
              }
            />
            <DatoSoloLectura etiqueta="Fecha de salida" valor={formatoFecha(salida.fechaSalida)} />
            <DatoSoloLectura etiqueta="Valor total" valor={formatoMoneda(salida.valorTotal)} />
            <DatoSoloLectura
              etiqueta="Autoriza"
              valor={salida.usuarioAutorizaId ? `Usuario N.º ${salida.usuarioAutorizaId}` : '—'}
            />
            {salida.fechaConfirmacion && (
              <DatoSoloLectura etiqueta="Fecha de confirmación" valor={formatoFechaHora(salida.fechaConfirmacion)} />
            )}
            {salida.observaciones && <DatoSoloLectura etiqueta="Observaciones" valor={salida.observaciones} />}
            {salida.motivoAnulacion && <DatoSoloLectura etiqueta="Motivo de anulación" valor={salida.motivoAnulacion} />}
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
                {salida.detalles.map((detalle) => {
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

      <AccionesSalida salida={salida} />
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
