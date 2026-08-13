'use client';

/**
 * Panel del reporte de consumo por proyecto (T072) — filtro en cascada cliente→proyecto +
 * rango de fechas, detalle de líneas de salida, total consumido, margen vs presupuesto,
 * gráfico de consumo por producto y exportar/imprimir (FR-040, FR-043). Client Component:
 * `app/(app)/reportes/consumo-proyecto/page.tsx` (Server Component) solo compone
 * (docs/arquitectura.md §7).
 *
 * Cascada cliente→proyecto: MISMO patrón que `componentes/salidas/salida-form.tsx`
 * (`clienteSeleccionado` en estado local, `useEffect` que pide los proyectos al cambiar de
 * cliente y resetea `proyectoId`), con una diferencia deliberada — usa `obtenerCliente`
 * (`lib/api/clientes.ts`, TODOS los proyectos del cliente, cualquier estado) en vez de
 * `obtenerProyectosDestino` (solo ACTIVOS): un reporte histórico debe poder consultar también
 * proyectos ya COMPLETADO/SUSPENDIDO, a diferencia de registrar una salida nueva.
 *
 * El filtro final (`proyectoId`) se valida con `esquemaFiltroConsumoProyecto` (react-hook-form
 * + zodResolver, el mismo esquema que usa el backend como autoridad). El reporte se pide al
 * ENVIAR el filtro vía `obtenerReporteConsumoProyecto` (`api<T>()`, `lib/api/reportes.ts`); un
 * `403` (Operario que entró por URL directa — la navegación ya oculta este enlace, FR-003, eso
 * es solo UX) se distingue del resto de errores para un aviso específico de permisos.
 *
 * Exportar Excel/PDF (`exportarConsumoProyecto`, misma excepción de `fetch` nativo documentada
 * en `lib/api/reportes.ts`) usa EXACTAMENTE los filtros que ya generaron el reporte en
 * pantalla (`ultimoFiltro`, SC-007). Imprimir: `window.print()` + clase `no-imprimir`
 * (`globals.css`, FR-043).
 *
 * Margen (US4-AS2): `reporte.margen === null` → "Sin presupuesto asignado" (NUNCA "0%" ni una
 * división por cero); si no, se redondea a un entero de porcentaje (`0.4` → "40%").
 */
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FilePdf, FileXls, Printer } from '@phosphor-icons/react/dist/ssr';
import {
  esquemaFiltroConsumoProyecto,
  type Cliente,
  type FiltroConsumoProyecto,
  type Proyecto,
  type ReporteConsumoProyecto as DatosReporteConsumoProyecto,
} from '@trazo/compartido';
import { obtenerCliente } from '@/lib/api/clientes';
import { exportarConsumoProyecto, obtenerReporteConsumoProyecto } from '@/lib/api/reportes';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoFecha, formatoMoneda } from '@/lib/formato';
import { BarraFiltros, CampoFiltro } from '@/componentes/comunes/barra-filtros';
import { CampoFecha } from '@/componentes/comunes/campo-fecha';
import { GraficoConsumo } from './grafico-consumo';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const MENSAJE_SIN_PERMISO = 'No tienes permiso para ver este reporte. Contacta a un administrador o gerente.';

const VALORES_INICIALES: FiltroConsumoProyecto = { proyectoId: 0, desde: '', hasta: '' };

/** `0.4` → `"40%"` — mismo criterio de redondeo que `mapeadores-documento-reporte.ts` del backend. */
function formatoPorcentaje(valor: number): string {
  return `${Math.round(valor * 100)}%`;
}

export function PanelConsumoProyecto({ clientes }: { clientes: Cliente[] }) {
  const [clienteSeleccionado, setClienteSeleccionado] = useState<number | null>(null);
  const [proyectosDelCliente, setProyectosDelCliente] = useState<Proyecto[]>([]);
  const [cargandoProyectos, setCargandoProyectos] = useState(false);

  const [reporte, setReporte] = useState<DatosReporteConsumoProyecto | null>(null);
  const [ultimoFiltro, setUltimoFiltro] = useState<FiltroConsumoProyecto | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FiltroConsumoProyecto>({
    resolver: zodResolver(esquemaFiltroConsumoProyecto),
    defaultValues: VALORES_INICIALES,
  });

  // Carga (y recarga al cambiar de cliente) TODOS los proyectos del cliente elegido — ver
  // TSDoc de cabecera para el porqué de `obtenerCliente` en vez de `obtenerProyectosDestino`.
  useEffect(() => {
    if (clienteSeleccionado === null) {
      setProyectosDelCliente([]);
      return;
    }
    let cancelado = false;
    setCargandoProyectos(true);
    obtenerCliente(clienteSeleccionado)
      .then((cliente) => {
        if (!cancelado) setProyectosDelCliente(cliente.proyectos);
      })
      .catch(() => {
        if (!cancelado) setProyectosDelCliente([]);
      })
      .finally(() => {
        if (!cancelado) setCargandoProyectos(false);
      });
    return () => {
      cancelado = true;
    };
  }, [clienteSeleccionado]);

  function alCambiarCliente(valor: string): void {
    setClienteSeleccionado(Number(valor) || null);
    setValue('proyectoId', 0);
  }

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

  async function alGenerar(filtros: FiltroConsumoProyecto): Promise<void> {
    setErrorGeneral(null);
    setSinPermiso(false);
    setCargando(true);
    try {
      const datos = await obtenerReporteConsumoProyecto(filtros);
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
      await exportarConsumoProyecto(ultimoFiltro, formato);
    } catch (error) {
      manejarError(error);
    } finally {
      setExportando(false);
    }
  }

  const sinProyectosDelCliente = clienteSeleccionado !== null && !cargandoProyectos && proyectosDelCliente.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <BarraFiltros onSubmit={handleSubmit(alGenerar)} noValidate noImprimir>
        <CampoFiltro ancho="largo">
          <label htmlFor="cliente-filtro">Cliente</label>
          <select
            id="cliente-filtro"
            className="input"
            value={clienteSeleccionado ?? ''}
            onChange={(evento) => alCambiarCliente(evento.target.value)}
          >
            <option value="">Selecciona un cliente…</option>
            {clientes.map((cliente) => (
              <option key={cliente.id} value={cliente.id}>
                {cliente.nombre}
              </option>
            ))}
          </select>
        </CampoFiltro>
        <CampoFiltro ancho="largo">
          <label htmlFor="proyectoId">Proyecto</label>
          <select
            id="proyectoId"
            className="input"
            aria-invalid={!!errors.proyectoId}
            disabled={clienteSeleccionado === null || cargandoProyectos || proyectosDelCliente.length === 0}
            {...register('proyectoId', { valueAsNumber: true })}
          >
            <option value={0}>{cargandoProyectos ? 'Cargando…' : 'Selecciona un proyecto…'}</option>
            {proyectosDelCliente.map((proyecto) => (
              <option key={proyecto.id} value={proyecto.id}>
                {proyecto.nombre}
              </option>
            ))}
          </select>
          {sinProyectosDelCliente && (
            <p className="text-muted" style={{ fontSize: 12, marginTop: 5 }}>
              Este cliente no tiene proyectos registrados.
            </p>
          )}
          {errors.proyectoId && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
              {errors.proyectoId.message}
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
              {reporte.proyecto.nombre} — {reporte.cliente.nombre}
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
            <h5 style={{ margin: '0 0 4px' }}>{reporte.proyecto.nombre}</h5>
            <div className="text-muted" style={{ fontSize: 13 }}>
              {reporte.cliente.nombre}
            </div>
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div className="card p-4">
              <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Total consumido
              </div>
              <div style={{ fontSize: 22, fontFamily: 'var(--font-heading)', marginTop: 4 }}>
                {formatoMoneda(reporte.totalConsumo)}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Presupuesto estimado
              </div>
              <div style={{ fontSize: 22, fontFamily: 'var(--font-heading)', marginTop: 4 }}>
                {reporte.presupuestoEstimado === null ? 'Sin presupuesto asignado' : formatoMoneda(reporte.presupuestoEstimado)}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Margen consumo/presupuesto
              </div>
              <div style={{ fontSize: 22, fontFamily: 'var(--font-heading)', marginTop: 4 }}>
                {reporte.margen === null ? 'Sin presupuesto asignado' : formatoPorcentaje(reporte.margen)}
              </div>
            </div>
          </div>

          <GraficoConsumo serie={reporte.serie} />

          {reporte.lineas.length === 0 ? (
            <div className="card p-4 text-muted" style={{ textAlign: 'center' }}>
              Sin consumo registrado para este proyecto en el período seleccionado.
            </div>
          ) : (
            <div className="card p-0" style={{ overflow: 'hidden' }}>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>N.º salida</th>
                      <th>Producto</th>
                      <th>Cantidad</th>
                      <th>Valor unitario</th>
                      <th>Valor total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reporte.lineas.map((linea, indice) => (
                      <tr key={`${linea.numeroSalida}-${linea.producto}-${indice}`}>
                        <td>{formatoFecha(linea.fecha)}</td>
                        <td>{linea.numeroSalida}</td>
                        <td>{linea.producto}</td>
                        <td>{linea.cantidad}</td>
                        <td>{formatoMoneda(linea.valorUnitario)}</td>
                        <td>{formatoMoneda(linea.valorTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
