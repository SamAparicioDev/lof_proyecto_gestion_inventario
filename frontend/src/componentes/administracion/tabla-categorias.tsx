'use client';

/**
 * CRUD del catálogo de categorías (US15, T154 — FR-084…FR-087).
 *
 * Sigue el patrón de `/usuarios` y `/roles`: diálogos `.dialog` sobre el propio listado, no
 * páginas separadas. Los datos se cargan en el cliente (no en un Server Component) porque las
 * cuatro operaciones vuelven a la misma tabla, y recargar la ruta entera tras cada una haría
 * parpadear una pantalla que se usa para ajustes rápidos y encadenados.
 *
 * Dos comportamientos que la historia exige y que se ven aquí:
 *
 *  - **Eliminar solo si nadie la usa** (FR-087). El botón se deshabilita en cuanto la categoría
 *    tiene productos, y el texto explica que la vía es desactivarla. La comprobación de verdad
 *    la hace el servidor: esto solo evita el viaje de ida y vuelta.
 *  - **Desactivar no borra nada**: la categoría deja de ofrecerse para clasificar, pero los
 *    productos que ya la tienen la conservan (FR-086).
 */
import { useCallback, useEffect, useState } from 'react';
import { PencilSimple, Plus, Prohibit, TrashSimple, CheckCircle } from '@phosphor-icons/react/dist/ssr';
import { ErrorApi } from '@/lib/api/cliente';
import {
  cambiarEstadoCategoria,
  eliminarCategoria,
  listarCategorias,
  type CategoriaListada,
} from '@/lib/api/categorias';
import { DialogoCategoria } from './dialogo-categoria';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

export function TablaCategorias(): React.JSX.Element {
  const [categorias, setCategorias] = useState<CategoriaListada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<CategoriaListada | null>(null);
  const [creando, setCreando] = useState(false);
  const [ocupada, setOcupada] = useState<number | null>(null);

  const recargar = useCallback(async () => {
    setError(null);
    try {
      setCategorias(await listarCategorias());
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
    setOcupada(id);
    setError(null);
    try {
      await accion();
      await recargar();
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : MENSAJE_ERROR_RED);
    } finally {
      setOcupada(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
          Las categorías clasifican los productos del inventario y alimentan su filtro de búsqueda.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setCreando(true)}>
          <Plus size={14} /> Nueva categoría
        </button>
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
          {error}
        </div>
      )}

      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Descripción</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Productos</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr>
                <td colSpan={5}>Cargando categorías…</td>
              </tr>
            )}

            {!cargando && categorias.length === 0 && (
              <tr>
                <td colSpan={5}>Todavía no hay categorías. Crea la primera para clasificar tus productos.</td>
              </tr>
            )}

            {categorias.map((categoria) => {
              const enUso = categoria.cantidadProductos > 0;
              const trabajando = ocupada === categoria.id;
              return (
                <tr key={categoria.id}>
                  <td>{categoria.nombre}</td>
                  <td className="text-muted">{categoria.descripcion ?? '—'}</td>
                  <td>
                    <span className={categoria.estado === 'ACTIVA' ? 'tag tag-accent' : 'tag tag-neutral'}>
                      {categoria.estado === 'ACTIVA' ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{categoria.cantidadProductos}</td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={trabajando}
                        onClick={() => setEditando(categoria)}
                      >
                        <PencilSimple size={14} /> Editar
                      </button>

                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={trabajando}
                        onClick={() =>
                          void ejecutar(categoria.id, () =>
                            cambiarEstadoCategoria(categoria.id, categoria.estado === 'ACTIVA' ? 'INACTIVA' : 'ACTIVA'),
                          )
                        }
                      >
                        {categoria.estado === 'ACTIVA' ? (
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
                            ? `No se puede eliminar: ${categoria.cantidadProductos} producto(s) la usan. Desactívala para dejar de ofrecerla.`
                            : 'Eliminar la categoría'
                        }
                        onClick={() => void ejecutar(categoria.id, () => eliminarCategoria(categoria.id))}
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

      {(creando || editando) && (
        <DialogoCategoria
          categoria={editando}
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
