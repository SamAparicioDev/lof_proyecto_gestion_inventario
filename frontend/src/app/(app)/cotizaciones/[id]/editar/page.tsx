/**
 * Edición de una cotización en BORRADOR (US21, T204, FR-114) — `/cotizaciones/[id]/editar`.
 *
 * Ruta propia y no el detalle mismo: ver el TSDoc de `../page.tsx`. Aquí se comprueban las DOS
 * condiciones —permiso y estado— antes de montar el formulario; el backend las vuelve a exigir,
 * así que esto es UX: quien llegue por URL directa a una cotización ya enviada ve un aviso en
 * español en vez de un formulario que no va a poder guardar.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  formatoNumeroCotizacion,
  type Cliente,
  type Paginado,
  type CotizacionConDetalles,
  type DatosCrearCotizacion,
  type ProductoResumen,
  type Proyecto,
} from '@trazo/compartido';
import { POR_PAGINA_MAXIMA } from '@trazo/compartido';
import { apiServidor, apiServidorOpcional } from '@/lib/api/servidor';
import { ErrorApi } from '@/lib/api/cliente';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { PERMISOS, tienePermiso } from '@/lib/permisos';
import { CotizacionForm } from '@/componentes/cotizaciones/cotizacion-form';

/** `2026-08-01T00:00:00.000Z` → `2026-08-01`, el ISO que espera `CampoFecha`. */
function aFechaInput(fechaIso: string): string {
  return fechaIso.slice(0, 10);
}

function aValoresFormulario(cotizacion: CotizacionConDetalles): DatosCrearCotizacion {
  return {
    clienteId: cotizacion.cliente.id,
    proyectoId: cotizacion.proyecto.id,
    fecha: aFechaInput(cotizacion.fecha),
    fechaValidez: aFechaInput(cotizacion.fechaValidez),
    observaciones: cotizacion.observaciones ?? '',
    lineas: cotizacion.detalles.map((detalle) => ({
      productoId: detalle.productoId,
      cantidad: detalle.cantidad,
      precioUnitario: detalle.precioUnitario,
      // US20: la tasa con la que se guardó cada línea vuelve al formulario tal cual.
      tasaIva: detalle.tasaIva,
    })),
  };
}

export default async function PaginaEditarCotizacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cotizacionId = Number(id);
  if (!Number.isInteger(cotizacionId) || cotizacionId <= 0) {
    notFound();
  }

  const perfil = await obtenerPerfilServidor();
  if (!tienePermiso(perfil?.permisos, PERMISOS.COTIZACIONES_EDITAR)) {
    return (
      <div role="alert" className="card p-5">
        No tienes permiso para editar cotizaciones. Contacta a un administrador o gerente.
      </div>
    );
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

  if (cotizacion.estado !== 'BORRADOR') {
    return (
      <div role="alert" className="card p-5">
        Esta cotización ya no está en borrador, así que no puede editarse: lo que se le mostró al
        cliente no se reescribe. Para cambiarla, anúlala y haz una nueva.{' '}
        <Link href={`/cotizaciones/${cotizacion.id}`}>Volver a la cotización</Link>.
      </div>
    );
  }

  const productos = await apiServidorOpcional<ProductoResumen[]>('/api/productos', []);
  // `GET /api/clientes` devuelve un PAGINADO (no un arreglo) y su máximo por página es
  // `POR_PAGINA_MAXIMA` — pedir más se rechaza con 400, que es como se rompió esta pantalla
  // la primera vez. `apiServidorOpcional` porque `clientes.ver` es un permiso distinto.
  const clientesPagina = await apiServidorOpcional<Paginado<Cliente>>(
    `/api/clientes?porPagina=${POR_PAGINA_MAXIMA}`,
    { datos: [], total: 0, pagina: 1, porPagina: POR_PAGINA_MAXIMA },
  );
  const listaClientes = clientesPagina.datos;
  // El proyecto actual, para precargar la cascada aunque hoy ya no sea un destino válido.
  const proyectoInicial: Proyecto = {
    id: cotizacion.proyecto.id,
    clienteId: cotizacion.cliente.id,
    nombre: cotizacion.proyecto.nombre,
  } as Proyecto;

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Ventas</h6>
        <h2 style={{ margin: 0 }}>Editar {formatoNumeroCotizacion(cotizacion.numero)}</h2>
      </div>
      <CotizacionForm
        clientes={listaClientes}
        productos={productos}
        cotizacionId={cotizacion.id}
        valoresIniciales={aValoresFormulario(cotizacion)}
        proyectoInicial={proyectoInicial}
      />
    </div>
  );
}
