'use client';

/**
 * CRUD del catálogo de unidades de medida (US17, T183 — FR-101, FR-104).
 *
 * Espejo de `tabla-proveedores.tsx`, con dos particularidades de la historia:
 *
 *  - **La columna "Productos" no es informativa, es la que decide**: una unidad que ya mide
 *    productos no se puede eliminar (FR-104), porque borrarla dejaría a esos productos sin la
 *    unidad que la historia declara obligatoria. La vía es desactivarla: deja de ofrecerse en
 *    los formularios y los productos que ya la tienen la conservan. El servidor lo comprueba
 *    igualmente; deshabilitar el botón solo evita el viaje.
 *  - **El catálogo llega sembrado**: la migración de US17 crea quince unidades de uso corriente,
 *    así que el estado vacío es casi imposible. Se mantiene por si alguien las elimina todas.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, PencilSimple, Plus, Prohibit, TrashSimple } from '@phosphor-icons/react/dist/ssr';
import { ErrorApi } from '@/lib/api/cliente';
import {
  cambiarEstadoUnidadMedida,
  eliminarUnidadMedida,
  listarUnidadesMedida,
  type UnidadMedidaListada,
} from '@/lib/api/unidades-medida';
import { DialogoUnidadMedida } from './dialogo-unidad-medida';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

export function TablaUnidadesMedida(): React.JSX.Element {
  const [unidades, setUnidades] = useState<UnidadMedidaListada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<UnidadMedidaListada | null>(null);
  const [creando, setCreando] = useState(false);
  const [ocupado, setOcupado] = useState<number | null>(null);

  const recargar = useCallback(async () => {
    setError(null);
    try {
      setUnidades(await listarUnidadesMedida());
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : MENSAJE_ERROR_RED);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  async function ejecutar(id: number, accion: () => Promise<void>): Promise<void> {
    setOcupado(id);
    setError(null);
    try {
      await accion();
      await recargar();
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : MENSAJE_ERROR_RED);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
          La unidad de medida dice en qué se cuenta cada producto (unidades, kilos, metros). Todo
          producto nuevo debe tener una, y su abreviatura acompaña a las cantidades en el
          inventario y en los documentos que se exportan.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setCreando(true)}>
          <Plus size={14} /> Nueva unidad
        </button>
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
          {error}
        </div>
      )}

      <div className="card p-0">
        {/* US34 (FR-137): la tabla se desplaza DENTRO de su tarjeta — nunca la página. */}
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Abreviatura</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Productos</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {cargando && (
                <tr>
                  <td colSpan={5}>Cargando unidades de medida…</td>
                </tr>
              )}

              {!cargando && unidades.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    Todavía no hay unidades de medida. Crea la primera para poder dar de alta
                    productos.
                  </td>
                </tr>
              )}

              {unidades.map((unidad) => {
                const enUso = unidad.cantidadProductos > 0;
                const trabajando = ocupado === unidad.id;
                return (
                  <tr key={unidad.id}>
                    <td>{unidad.nombre}</td>
                    <td className="text-muted">{unidad.abreviatura}</td>
                    <td>
                      <span className={unidad.estado === 'ACTIVA' ? 'tag tag-accent' : 'tag tag-neutral'}>
                        {unidad.estado === 'ACTIVA' ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{unidad.cantidadProductos}</td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={trabajando}
                          onClick={() => setEditando(unidad)}
                        >
                          <PencilSimple size={14} /> Editar
                        </button>

                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={trabajando}
                          onClick={() =>
                            void ejecutar(unidad.id, () =>
                              cambiarEstadoUnidadMedida(unidad.id, unidad.estado === 'ACTIVA' ? 'INACTIVA' : 'ACTIVA'),
                            )
                          }
                        >
                          {unidad.estado === 'ACTIVA' ? (
                            <>
                              <Prohibit size={14} /> Desactivar
                            </>
                          ) : (
                            <>
                              <CheckCircle size={14} /> Activar
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={trabajando || enUso}
                          title={
                            enUso
                              ? `No se puede eliminar: ${unidad.cantidadProductos} producto(s) la usan. Desactívala para dejar de ofrecerla.`
                              : 'Eliminar la unidad de medida'
                          }
                          onClick={() => void ejecutar(unidad.id, () => eliminarUnidadMedida(unidad.id))}
                        >
                          <TrashSimple size={14} /> Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {(creando || editando) && (
        <DialogoUnidadMedida
          unidad={editando}
          onCerrar={() => {
            setCreando(false);
            setEditando(null);
          }}
          onGuardado={() => {
            setCreando(false);
            setEditando(null);
            void recargar();
          }}
        />
      )}
    </div>
  );
}
