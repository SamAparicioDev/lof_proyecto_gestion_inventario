'use client';

/**
 * Panel del reporte de INVENTARIO INMÓVIL (US37, FR-158…FR-162).
 *
 * Client Component: el umbral de días, la búsqueda y las descargas son estado del navegador.
 *
 * ## Lo que esta pantalla NO tiene
 *
 * Ni un botón que actúe sobre el producto (FR-162). Es tentador poner "dar de baja" junto a cada
 * fila —está justo ahí, y el que mira ya decidió— pero liquidar, devolver al proveedor o dar de
 * baja son decisiones de negocio que tienen que quedar auditadas con su motivo y su responsable,
 * y eso solo pasa por las pantallas de Inventario e Ingresos. Un reporte que además actuara
 * escondería decisiones dentro de una consulta.
 *
 * ## El orden no es negociable
 *
 * Llega ordenado por VALOR inmovilizado desde el servidor y la tabla lo respeta (FR-161). La
 * primera fila es dónde está la plata detenida, no lo más viejo — que en una bodega suele ser
 * también lo más barato, y encabezar con eso haría parecer pequeño el problema.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReporteInventarioInmovil } from '@trazo/compartido';
import { ErrorApi } from '@/lib/api/cliente';
import { exportarInventarioInmovil, obtenerInventarioInmovil } from '@/lib/api/reportes';
import { formatoMoneda } from '@/lib/formato';

/** Mismo valor que el esquema compartido: un trimestre sin salir es donde casi cualquier negocio
 *  empieza a preocuparse. Es el valor inicial del filtro, no una regla. */
const DIAS_POR_DEFECTO = 90;

export function PanelReporteInventarioInmovil() {
  const [dias, setDias] = useState(DIAS_POR_DEFECTO);
  const [buscar, setBuscar] = useState('');
  const [aplicado, setAplicado] = useState({ diasSinSalida: DIAS_POR_DEFECTO, buscar: '' });
  const [reporte, setReporte] = useState<ReporteInventarioInmovil | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setReporte(
        await obtenerInventarioInmovil({
          diasSinSalida: aplicado.diasSinSalida,
          buscar: aplicado.buscar || undefined,
        }),
      );
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : 'No se pudo generar el reporte.');
    } finally {
      setCargando(false);
    }
  }, [aplicado]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function descargar(formato: 'xlsx' | 'pdf') {
    setDescargando(true);
    try {
      await exportarInventarioInmovil(
        { diasSinSalida: aplicado.diasSinSalida, buscar: aplicado.buscar || undefined },
        formato,
      );
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : 'No se pudo exportar el reporte.');
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="card flex flex-wrap items-end gap-3"
        onSubmit={(evento) => {
          evento.preventDefault();
          setAplicado({ diasSinSalida: dias, buscar: buscar.trim() });
        }}
      >
        <div className="field">
          <label htmlFor="dias-sin-salida">Días sin salir (mínimo)</label>
          <input
            id="dias-sin-salida"
            className="input"
            type="number"
            min={1}
            max={3650}
            value={dias}
            onChange={(evento) => setDias(Number(evento.target.value))}
            style={{ width: 140 }}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="buscar-inmovil">Producto</label>
          <input
            id="buscar-inmovil"
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

      {cargando && <p className="text-muted">Generando…</p>}

      {!cargando && reporte && reporte.productos.length === 0 && (
        <div className="card">
          <p className="text-muted" style={{ margin: 0 }}>
            Nada lleva más de {aplicado.diasSinSalida} días sin salir. Todo el inventario con
            existencias ha rotado dentro de ese plazo.
          </p>
        </div>
      )}

      {!cargando && reporte && reporte.productos.length > 0 && (
        <>
          <div className="card flex flex-wrap items-center gap-4">
            <div>
              <div className="text-muted text-[12px]">Valor total inmovilizado</div>
              <strong style={{ fontSize: 20 }}>{formatoMoneda(reporte.valorTotalInmovilizado)}</strong>
            </div>
            <div>
              <div className="text-muted text-[12px]">Productos detenidos</div>
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
                  <th style={{ textAlign: 'right' }}>Costo unitario</th>
                  <th style={{ textAlign: 'right' }}>Valor inmovilizado</th>
                  <th>Última salida</th>
                  <th style={{ textAlign: 'right' }}>Días</th>
                </tr>
              </thead>
              <tbody>
                {reporte.productos.map((fila) => (
                  <tr key={fila.productoId}>
                    <td>{fila.sku}</td>
                    <td>{fila.descripcion}</td>
                    <td>{fila.categoria ?? 'Sin categoría'}</td>
                    <td style={{ textAlign: 'right' }}>{fila.existencias}</td>
                    <td style={{ textAlign: 'right' }}>{formatoMoneda(fila.ultimoCosto)}</td>
                    <td style={{ textAlign: 'right' }}>{formatoMoneda(fila.valorInmovilizado)}</td>
                    <td>
                      {/* Se dice con letras, no con una celda vacía: es el hallazgo más grave del
                          reporte y una celda en blanco se lee como un dato que faltó capturar. */}
                      {fila.nuncaHaSalido ? (
                        <span className="tag">Nunca ha salido</span>
                      ) : (
                        new Date(fila.ultimaSalida as string).toLocaleDateString('es-CO')
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{fila.diasSinSalida}</td>
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
