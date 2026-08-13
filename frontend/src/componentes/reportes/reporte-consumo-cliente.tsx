'use client';

/**
 * Panel del reporte de consumo por cliente (T071) — filtro (cliente + rango de fechas), tabla
 * por proyecto con sus productos y totales, exportar PDF/Excel e imprimir (FR-039, FR-043).
 * Client Component: necesita estado interactivo para el filtro y la descarga de archivos —
 * `app/(app)/reportes/consumo-cliente/page.tsx` (Server Component) solo compone
 * (docs/arquitectura.md §7).
 *
 * El filtro se valida con `esquemaFiltroConsumoCliente` (react-hook-form + zodResolver, EL
 * MISMO esquema que usa el backend como autoridad — frontend/CLAUDE.md), mismo criterio que
 * `componentes/salidas/salida-form.tsx`. El reporte se pide al ENVIAR el filtro (no hay
 * reporte inicial: FR-039 exige elegir un cliente primero) vía `obtenerReporteConsumoCliente`
 * (`api<T>()`, `lib/api/reportes.ts`).
 *
 * Si el usuario en sesión es Operario y entró por URL directa (la navegación ya oculta este
 * enlace, FR-003, pero eso es solo UX), el `403` de la API se distingue del resto de errores
 * para mostrar un aviso específico de permisos — la autoridad real sigue siendo el guard del
 * backend (`@Roles`).
 *
 * Exportar Excel/PDF (`exportarConsumoCliente`, misma excepción de `fetch` nativo documentada
 * en `lib/api/reportes.ts`) usa EXACTAMENTE los filtros que ya generaron el reporte en
 * pantalla (`ultimoFiltro`, SC-007) — nunca los del formulario sin enviar, por si el usuario
 * los cambió sin volver a generar. Imprimir: `window.print()` + clase `no-imprimir`
 * (`globals.css`, FR-043) sobre el filtro y los botones — la tabla del reporte queda visible
 * en la vista impresa.
 *
 * Estado vacío (US4-AS4): un proyecto sin consumo en el período aparece igual en la tabla con
 * "Sin consumo registrado" (nunca se omite); si NINGÚN proyecto del cliente tuvo consumo, se
 * suma un aviso general encima de las tarjetas.
 */
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FilePdf, FileXls, Printer } from '@phosphor-icons/react/dist/ssr';
import {
  esquemaFiltroConsumoCliente,
  type Cliente,
  type FiltroConsumoCliente,
  type ReporteConsumoCliente as DatosReporteConsumoCliente,
} from '@trazo/compartido';
import { exportarConsumoCliente, obtenerReporteConsumoCliente } from '@/lib/api/reportes';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoMoneda } from '@/lib/formato';
import { EstadoProyectoTag } from '@/componentes/clientes/estado-proyecto-tag';
import { BarraFiltros, CampoFiltro } from '@/componentes/comunes/barra-filtros';
import { CampoFecha } from '@/componentes/comunes/campo-fecha';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const MENSAJE_SIN_PERMISO = 'No tienes permiso para ver este reporte. Contacta a un administrador o gerente.';

const VALORES_INICIALES: FiltroConsumoCliente = { clienteId: 0, desde: '', hasta: '' };

export function PanelConsumoCliente({ clientes }: { clientes: Cliente[] }) {
  const [reporte, setReporte] = useState<DatosReporteConsumoCliente | null>(null);
  const [ultimoFiltro, setUltimoFiltro] = useState<FiltroConsumoCliente | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FiltroConsumoCliente>({
    resolver: zodResolver(esquemaFiltroConsumoCliente),
    defaultValues: VALORES_INICIALES,
  });

  function manejarError(error: unknown): void {
    if (error instanceof ErrorApi) {
      if (error.status === 403) {
        setSinPermiso(true);
      } else {
        setErrorGeneral(error.mensaje);
      }
    } else {
      setErrorGeneral(MENSAJE_ERROR_RED);
    }
  }

  async function alGenerar(filtros: FiltroConsumoCliente): Promise<void> {
    setErrorGeneral(null);
    setSinPermiso(false);
    setCargando(true);
    try {
      const datos = await obtenerReporteConsumoCliente(filtros);
      setReporte(datos);
      setUltimoFiltro(filtros);
    } catch (error) {
      setReporte(null);
      manejarError(error);
    } finally {
      setCargando(false);
    }
  }

  async function alExportar(formato: 'pdf' | 'xlsx'): Promise<void> {
    if (!ultimoFiltro) return;
    setErrorGeneral(null);
    setExportando(true);
    try {
      await exportarConsumoCliente(ultimoFiltro, formato);
    } catch (error) {
      manejarError(error);
    } finally {
      setExportando(false);
    }
  }

  const sinConsumoEnNingunProyecto = !!reporte && reporte.proyectos.length > 0 && reporte.totalCliente === 0;

  return (
    <div className="flex flex-col gap-5">
      <BarraFiltros onSubmit={handleSubmit(alGenerar)} noValidate noImprimir>
        <CampoFiltro ancho="largo">
          <label htmlFor="clienteId">Cliente</label>
          <select
            id="clienteId"
            className="input"
            aria-invalid={!!errors.clienteId}
            {...register('clienteId', { valueAsNumber: true })}
          >
            <option value={0}>Selecciona un cliente…</option>
            {clientes.map((cliente) => (
              <option key={cliente.id} value={cliente.id}>
                {cliente.nombre}
              </option>
            ))}
          </select>
          {errors.clienteId && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
              {errors.clienteId.message}
            </p>
          )}
        </CampoFiltro>
        <CampoFiltro ancho="corto">
          <label htmlFor="desde">Desde</label>
          <Controller
            name="desde"
            control={control}
            render={({ field }) => (
              <CampoFecha
                id="desde"
                value={field.value ?? ''}
                onChange={(iso) => field.onChange(iso === '' ? undefined : iso)}
                ariaInvalid={!!errors.desde}
              />
            )}
          />
          {errors.desde && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
              {errors.desde.message}
            </p>
          )}
        </CampoFiltro>
        <CampoFiltro ancho="corto">
          <label htmlFor="hasta">Hasta</label>
          <Controller
            name="hasta"
            control={control}
            render={({ field }) => (
              <CampoFecha
                id="hasta"
                value={field.value ?? ''}
                onChange={(iso) => field.onChange(iso === '' ? undefined : iso)}
                ariaInvalid={!!errors.hasta}
              />
            )}
          />
          {errors.hasta && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
              {errors.hasta.message}
            </p>
          )}
        </CampoFiltro>
        <button type="submit" className="btn btn-primary" disabled={cargando}>
          {cargando ? 'Generando…' : 'Generar reporte'}
        </button>
      </BarraFiltros>

      {sinPermiso && (
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {MENSAJE_SIN_PERMISO}
        </div>
      )}
      {errorGeneral && (
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {errorGeneral}
        </div>
      )}

      {reporte && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 no-imprimir">
            <div className="text-muted" style={{ fontSize: 13 }}>
              {reporte.proyectos.length} proyecto{reporte.proyectos.length === 1 ? '' : 's'} — Total cliente:{' '}
              <strong style={{ color: 'var(--color-text)' }}>{formatoMoneda(reporte.totalCliente)}</strong>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" disabled={exportando} onClick={() => alExportar('xlsx')}>
                <FileXls size={16} /> Exportar Excel
              </button>
              <button type="button" className="btn btn-secondary" disabled={exportando} onClick={() => alExportar('pdf')}>
                <FilePdf size={16} /> Exportar PDF
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
                <Printer size={16} /> Imprimir
              </button>
            </div>
          </div>

          <div>
            <h5 style={{ margin: '0 0 4px' }}>{reporte.cliente.nombre}</h5>
            <div className="text-muted" style={{ fontSize: 13 }}>
              NIT {reporte.cliente.nit} — Total cliente: {formatoMoneda(reporte.totalCliente)}
            </div>
          </div>

          {reporte.proyectos.length === 0 ? (
            <div className="card p-4 text-muted" style={{ textAlign: 'center' }}>
              Este cliente no tiene proyectos registrados.
            </div>
          ) : (
            <>
              {sinConsumoEnNingunProyecto && (
                <div className="card p-4 text-muted" style={{ textAlign: 'center' }}>
                  Sin consumo registrado para este cliente en el período seleccionado.
                </div>
              )}
              {reporte.proyectos.map((proyectoConsumo) => (
                <div key={proyectoConsumo.proyecto.id} className="card gap-3 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h6 style={{ margin: 0 }}>{proyectoConsumo.proyecto.nombre}</h6>
                      <EstadoProyectoTag estado={proyectoConsumo.proyecto.estado} />
                    </div>
                    <strong>{formatoMoneda(proyectoConsumo.totalProyecto)}</strong>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Cantidad</th>
                          <th>Valor total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proyectoConsumo.productos.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="text-muted" style={{ textAlign: 'center', padding: '16px 0' }}>
                              Sin consumo registrado en el período.
                            </td>
                          </tr>
                        ) : (
                          proyectoConsumo.productos.map((producto) => (
                            <tr key={producto.productoId}>
                              <td>{producto.nombre}</td>
                              <td>{producto.cantidad}</td>
                              <td>{formatoMoneda(producto.valorTotal)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
