'use client';

/**
 * Panel del reporte de inventario actual (T082) — filtro (buscar + rango de cantidad
 * disponible), tabla de productos con stock/comprometido/disponible/ubicación/valor, tarjetas
 * de valor total del inventario y productos bajo umbral, exportar PDF/Excel e imprimir
 * (FR-041, FR-043). Client Component: `app/(app)/reportes/inventario/page.tsx` (Server
 * Component) solo compone y hace el control de acceso por rol (docs/arquitectura.md §7).
 *
 * A diferencia de `PanelConsumoCliente`/`PanelConsumoProyecto` (US4: `clienteId`/`proyectoId`
 * OBLIGATORIOS, sin reporte inicial), aquí TODOS los filtros son opcionales (FR-041: "sin
 * filtro" = catálogo completo) — el reporte se genera una vez al montar el componente (sin
 * filtros) y de nuevo cada vez que se envía el formulario, mismo caso de uso
 * (`obtenerReporteInventario`, `lib/api/reportes.ts`) en ambos casos.
 *
 * El filtro se valida con `esquemaFiltroReporteInventario` (react-hook-form + zodResolver, EL
 * MISMO esquema que usa el backend como autoridad). `cantidadMin`/`cantidadMax` filtran sobre
 * `disponible` (no `stockActual` crudo) — el CÁLCULO vive en el backend
 * (`reporte-inventario-actual.caso-uso.ts`), este panel solo pinta lo que devuelve.
 *
 * `stockBajo` (`AlertaStockBajo`, `dominio/entidades/producto.ts#esStockBajo`) NUNCA se
 * recalcula aquí — mismo criterio que `app/(app)/inventario/page.tsx`.
 *
 * Exportar Excel/PDF (`exportarReporteInventario`, misma excepción de `fetch` nativo
 * documentada en `lib/api/reportes.ts`) usa EXACTAMENTE los filtros que ya generaron el
 * reporte en pantalla (`ultimoFiltro`, SC-007). Imprimir: `window.print()` + clase
 * `no-imprimir` (`globals.css`, FR-043) sobre el filtro y los botones.
 *
 * Si el usuario en sesión es Operario y entró por URL directa, la página ya lo bloqueó ANTES
 * de montar este panel (`app/(app)/reportes/inventario/page.tsx`, mismo patrón que
 * `app/(app)/usuarios/page.tsx`); el manejo de `403` aquí es una segunda capa defensiva (p.
 * ej. una sesión que expira/cambia de rol mientras la página ya está abierta), nunca la
 * primera línea de defensa — esa es siempre el guard del backend.
 */
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FilePdf, FileXls, Printer } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import {
  esquemaFiltroReporteInventario,
  type FiltroReporteInventario,
  type ReporteInventarioActual,
} from '@trazo/compartido';
import { exportarReporteInventario, obtenerReporteInventario } from '@/lib/api/reportes';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoMoneda } from '@/lib/formato';
import { AlertaStockBajo } from '@/componentes/inventario/alerta-stock-bajo';
import { BarraFiltros, CampoFiltro } from '@/componentes/comunes/barra-filtros';
import { SelectorCategoria } from '@/componentes/categorias/selector-categoria';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const MENSAJE_SIN_PERMISO = 'No tienes permiso para ver este reporte. Contacta a un administrador o gerente.';

/** `esquemaFiltroReporteInventario` (`@trazo/compartido`) acepta `undefined` como "sin
 *  filtro", pero un `<input type="number">` vacío entrega `''` — sin esta conversión, Zod
 *  interpreta el campo vacío como "no es un número" en vez de "no se filtró". */
function vacioComoNumeroIndefinido(valor: string): number | undefined {
  return valor === '' ? undefined : Number(valor);
}

/** Mismo criterio que `vacioComoNumeroIndefinido` arriba, para el campo de texto "buscar":
 *  sin esto, un input vacío queda como `''` (un string válido para Zod, no `undefined`), y
 *  el resumen de filtros del reporte exportado mostraba "Buscar: " en blanco en vez de "Sin
 *  filtro" (hallazgo LOW de revisión adversarial, tanda US7) — no afectaba el resultado
 *  filtrado en sí, solo el texto mostrado. */
function vacioComoTextoIndefinido(valor: string): string | undefined {
  return valor === '' ? undefined : valor;
}

export function PanelReporteInventario() {
  const [reporte, setReporte] = useState<ReporteInventarioActual | null>(null);
  const [ultimoFiltro, setUltimoFiltro] = useState<FiltroReporteInventario>({});
  const [cargando, setCargando] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FiltroReporteInventario>({
    resolver: zodResolver(esquemaFiltroReporteInventario),
    defaultValues: {},
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

  async function alGenerar(filtros: FiltroReporteInventario): Promise<void> {
    setErrorGeneral(null);
    setSinPermiso(false);
    setCargando(true);
    try {
      const datos = await obtenerReporteInventario(filtros);
      setReporte(datos);
      setUltimoFiltro(filtros);
    } catch (error) {
      setReporte(null);
      manejarError(error);
    } finally {
      setCargando(false);
    }
  }

  // Reporte inicial sin filtros (catálogo completo) — a diferencia de los reportes de
  // consumo (US4), aquí NINGÚN filtro es obligatorio (ver TSDoc de cabecera).
  useEffect(() => {
    alGenerar({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function alExportar(formato: 'pdf' | 'xlsx'): Promise<void> {
    setErrorGeneral(null);
    setExportando(true);
    try {
      await exportarReporteInventario(ultimoFiltro, formato);
    } catch (error) {
      manejarError(error);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <BarraFiltros onSubmit={handleSubmit(alGenerar)} noValidate noImprimir>
        <CampoFiltro ancho="largo">
          <label htmlFor="buscar">Buscar</label>
          <input
            id="buscar"
            className="input"
            placeholder="SKU, descripción, ubicación o categoría — ej. cemento gris"
            {...register('buscar', { setValueAs: vacioComoTextoIndefinido })}
          />
        </CampoFiltro>
        <CampoFiltro ancho="largo">
          <label htmlFor="categoriaId">Categoría</label>
          {/* US24 (FR-120): se reutiliza el selector del catálogo, que ya se trae las
              categorías y desde US23 es escribible. `null` = todas, que es como el reporte se
              comportaba antes de esta historia. */}
          <Controller
            name="categoriaId"
            control={control}
            render={({ field }) => (
              <SelectorCategoria
                id="categoriaId"
                value={field.value ?? null}
                onChange={(categoriaId) => field.onChange(categoriaId ?? undefined)}
                etiquetaVacia="Todas las categorías"
              />
            )}
          />
        </CampoFiltro>
        <CampoFiltro>
          <label htmlFor="cantidadMin">Disponible mínimo</label>
          <input
            id="cantidadMin"
            type="number"
            className="input"
            aria-invalid={!!errors.cantidadMin}
            {...register('cantidadMin', { setValueAs: vacioComoNumeroIndefinido })}
          />
          {errors.cantidadMin && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
              {errors.cantidadMin.message}
            </p>
          )}
        </CampoFiltro>
        <CampoFiltro>
          <label htmlFor="cantidadMax">Disponible máximo</label>
          <input
            id="cantidadMax"
            type="number"
            className="input"
            aria-invalid={!!errors.cantidadMax}
            {...register('cantidadMax', { setValueAs: vacioComoNumeroIndefinido })}
          />
          {errors.cantidadMax && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
              {errors.cantidadMax.message}
            </p>
          )}
        </CampoFiltro>
        <button type="submit" className="btn btn-primary" disabled={cargando}>
          {cargando ? 'Filtrando…' : 'Filtrar'}
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
              {reporte.productos.length} producto{reporte.productos.length === 1 ? '' : 's'}
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

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div className="card p-4">
              <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Valor total del inventario
              </div>
              <div style={{ fontSize: 22, fontFamily: 'var(--font-heading)', marginTop: 4 }}>
                {formatoMoneda(reporte.valorTotalInventario)}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Productos bajo umbral
              </div>
              <div style={{ fontSize: 22, fontFamily: 'var(--font-heading)', marginTop: 4 }}>
                {reporte.cantidadBajoUmbral}
              </div>
            </div>
          </div>

          <div className="card p-0" style={{ overflow: 'hidden' }}>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Descripción</th>
                    <th>Categoría</th>
                    <th>Ubicación</th>
                    <th>Stock</th>
                    <th>Comprometido</th>
                    <th>Disponible</th>
                    <th>Valor</th>
                    <th aria-label="Alertas" />
                  </tr>
                </thead>
                <tbody>
                  {reporte.productos.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                        No se encontraron productos con los filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    reporte.productos.map((fila) => (
                      <tr key={fila.producto.id}>
                        <td>
                          <Link href={`/inventario/${fila.producto.id}`}>{fila.producto.sku}</Link>
                        </td>
                        <td>{fila.producto.descripcion}</td>
                        <td className="text-muted">{fila.producto.categoria?.nombre ?? '—'}</td>
                        <td className="text-muted">{fila.producto.ubicacion ?? '—'}</td>
                        <td>{fila.stock}</td>
                        <td>{fila.comprometido}</td>
                        <td>{fila.disponible}</td>
                        <td>{formatoMoneda(fila.valorLinea)}</td>
                        <td>{fila.stockBajo && <AlertaStockBajo />}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
