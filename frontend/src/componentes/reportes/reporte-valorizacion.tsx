'use client';

/**
 * Panel de la VALORIZACIÓN DE INVENTARIO A UNA FECHA (US38, FR-163…FR-168).
 *
 * Client Component: la fecha, la búsqueda y las descargas son estado del navegador.
 *
 * ## El campo de fecha nace VACÍO, y es deliberado
 *
 * Precargarlo con hoy sería cómodo y sería un error (FR-163). Quien viene a sacar el cierre de
 * diciembre y recibe el inventario de hoy no tiene forma de notarlo mirando la tabla: se ve igual
 * de plausible. Un campo vacío obliga a decir de qué día se está hablando, que es exactamente lo
 * que un documento de cierre necesita que alguien decida a conciencia.
 *
 * Una fecha futura la rechaza el esquema compartido antes de enviar y el backend otra vez al
 * recibirla, con el mismo texto en español (FR-167): validación doble, Principio IV.
 */
import { useState } from 'react';
import type { ReporteValorizacion } from '@trazo/compartido';
import { ErrorApi } from '@/lib/api/cliente';
import { exportarValorizacion, obtenerValorizacion } from '@/lib/api/reportes';
import { formatoMoneda } from '@/lib/formato';
import { CampoFecha } from '@/componentes/comunes/campo-fecha';

export function PanelReporteValorizacion() {
  const [fecha, setFecha] = useState('');
  const [buscar, setBuscar] = useState('');
  const [aplicado, setAplicado] = useState<{ fecha: string; buscar: string } | null>(null);
  const [reporte, setReporte] = useState<ReporteValorizacion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);

  async function generar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!fecha) {
      setError('Elige la fecha del cierre.');
      return;
    }
    const filtros = { fecha, buscar: buscar.trim() };
    setAplicado(filtros);
    setCargando(true);
    setError(null);
    try {
      setReporte(await obtenerValorizacion({ fecha, buscar: filtros.buscar || undefined }));
    } catch (fallo) {
      setReporte(null);
      // El backend rechaza la fecha futura con su propio mensaje en español; se muestra tal cual
      // en vez de sustituirlo por uno genérico, que borraría justo la explicación útil.
      setError(fallo instanceof ErrorApi ? fallo.mensaje : 'No se pudo generar la valorización.');
    } finally {
      setCargando(false);
    }
  }

  async function descargar(formato: 'xlsx' | 'pdf') {
    if (!aplicado) return;
    setDescargando(true);
    try {
      await exportarValorizacion({ fecha: aplicado.fecha, buscar: aplicado.buscar || undefined }, formato);
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : 'No se pudo exportar la valorización.');
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form className="card flex flex-wrap items-end gap-3" onSubmit={generar}>
        <div className="field">
          <label htmlFor="fecha-corte">Fecha del cierre</label>
          {/* `CampoFecha` y NO un `input type="date"` suelto: el campo nativo se pinta según el
              idioma del NAVEGADOR, ignorando el del documento, así que con Chrome en inglés el 12
              de agosto se lee 08/12/2026 — 8 de diciembre para quien está aquí. En un cierre
              contable esa confusión no se detecta mirando el archivo. */}
          <CampoFecha id="fecha-corte" value={fecha} onChange={setFecha} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="buscar-valorizacion">Producto</label>
          <input
            id="buscar-valorizacion"
            className="input"
            value={buscar}
            placeholder="SKU o descripción"
            onChange={(evento) => setBuscar(evento.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary">
          Generar
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={descargando || !reporte?.productos.length}
          onClick={() => void descargar('xlsx')}
        >
          Excel
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={descargando || !reporte?.productos.length}
          onClick={() => void descargar('pdf')}
        >
          PDF
        </button>
      </form>

      {error && (
        <div role="alert" className="card">
          {error}
        </div>
      )}

      {!aplicado && !error && (
        <div className="card">
          <p className="text-muted" style={{ margin: 0 }}>
            Elige una fecha para ver qué existencias había ese día y cuánto valían, con el costo que
            estaba vigente entonces — no con el de hoy.
          </p>
        </div>
      )}

      {cargando && <p className="text-muted">Reconstruyendo el inventario a esa fecha…</p>}

      {!cargando && reporte && reporte.productos.length === 0 && (
        <div className="card">
          <p className="text-muted" style={{ margin: 0 }}>
            No había existencias de ningún producto al {new Date(`${reporte.fecha}T12:00:00`).toLocaleDateString('es-CO')}.
          </p>
        </div>
      )}

      {!cargando && reporte && reporte.productos.length > 0 && (
        <>
          <div className="card flex flex-wrap items-center gap-4">
            <div>
              <div className="text-muted text-[12px]">
                Valor del inventario al {new Date(`${reporte.fecha}T12:00:00`).toLocaleDateString('es-CO')}
              </div>
              <strong style={{ fontSize: 20 }}>{formatoMoneda(reporte.valorTotalInventario)}</strong>
            </div>
            <div>
              <div className="text-muted text-[12px]">Productos con existencias</div>
              <strong style={{ fontSize: 20 }}>{reporte.productos.length}</strong>
            </div>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th style={{ textAlign: 'right' }}>Existencias</th>
                  <th style={{ textAlign: 'right' }}>Costo vigente</th>
                  <th style={{ textAlign: 'right' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {reporte.productos.map((fila) => (
                  <tr key={fila.productoId}>
                    <td>{fila.sku}</td>
                    <td>{fila.descripcion}</td>
                    <td>{fila.categoria ?? 'Sin categoría'}</td>
                    <td style={{ textAlign: 'right' }}>{fila.existencias}</td>
                    <td style={{ textAlign: 'right' }}>{formatoMoneda(fila.costoVigente)}</td>
                    <td style={{ textAlign: 'right' }}>{formatoMoneda(fila.valorLinea)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
