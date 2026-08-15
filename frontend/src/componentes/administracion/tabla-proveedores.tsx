'use client';

/**
 * CRUD del catálogo de proveedores (US15, T162 — FR-091…FR-093).
 *
 * Espejo de `tabla-categorias.tsx`: mismos diálogos `.dialog` sobre el propio listado, mismos
 * datos cargados en el cliente porque las cuatro operaciones vuelven a esta misma tabla.
 *
 * Tres comportamientos que la historia exige y que se ven aquí:
 *
 *  - **Eliminar solo si nadie lo usa**: el botón se deshabilita en cuanto el proveedor tiene
 *    ingresos, y el texto explica que la vía es desactivarlo. La comprobación de verdad la hace
 *    el servidor: esto solo evita el viaje de ida y vuelta.
 *  - **Desactivar no borra nada**: el proveedor deja de ofrecerse al registrar ingresos, pero
 *    las facturas que ya lo tienen lo conservan.
 *  - **El proveedor del sistema está protegido** (FR-093): ni se renombra ni se elimina, porque
 *    la carga masiva lo busca por su nombre. Se marca con una etiqueta y sus dos controles
 *    quedan deshabilitados con la explicación en el `title` — mostrar el botón activo y
 *    responder `409` al pulsarlo sería enseñar una puerta que no abre.
 */
import { useCallback, useEffect, useState } from 'react';
import { PencilSimple, Plus, Prohibit, TrashSimple, CheckCircle } from '@phosphor-icons/react/dist/ssr';
import { ErrorApi } from '@/lib/api/cliente';
import {
  cambiarEstadoProveedor,
  eliminarProveedor,
  listarProveedores,
  type ProveedorListado,
} from '@/lib/api/proveedores';
import { DialogoProveedor } from './dialogo-proveedor';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const MOTIVO_SISTEMA = 'La carga masiva de inventario depende de este proveedor: no se puede renombrar ni eliminar.';

export function TablaProveedores(): React.JSX.Element {
  const [proveedores, setProveedores] = useState<ProveedorListado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<ProveedorListado | null>(null);
  const [creando, setCreando] = useState(false);
  const [ocupado, setOcupado] = useState<number | null>(null);

  const recargar = useCallback(async () => {
    setError(null);
    try {
      setProveedores(await listarProveedores());
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
          Los proveedores son a quién se le compra la mercancía: cada ingreso referencia uno, y de
          aquí sale el filtro por proveedor del listado de ingresos.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setCreando(true)}>
          <Plus size={14} /> Nuevo proveedor
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
              <th>NIT</th>
              <th>Contacto</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Ingresos</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr>
                <td colSpan={6}>Cargando proveedores…</td>
              </tr>
            )}

            {!cargando && proveedores.length === 0 && (
              <tr>
                <td colSpan={6}>Todavía no hay proveedores. Crea el primero para registrar ingresos.</td>
              </tr>
            )}

            {proveedores.map((proveedor) => {
              const enUso = proveedor.cantidadIngresos > 0;
              const trabajando = ocupado === proveedor.id;
              const contacto = [proveedor.telefono, proveedor.email].filter(Boolean).join(' · ');
              return (
                <tr key={proveedor.id}>
                  <td>
                    {proveedor.nombre}
                    {proveedor.esSistema && (
                      <span className="tag tag-neutral" style={{ marginLeft: 8 }} title={MOTIVO_SISTEMA}>
                        Del sistema
                      </span>
                    )}
                  </td>
                  <td className="text-muted">{proveedor.nit ?? '—'}</td>
                  <td className="text-muted">{contacto === '' ? '—' : contacto}</td>
                  <td>
                    <span className={proveedor.estado === 'ACTIVO' ? 'tag tag-accent' : 'tag tag-neutral'}>
                      {proveedor.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{proveedor.cantidadIngresos}</td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={trabajando}
                        onClick={() => setEditando(proveedor)}
                      >
                        <PencilSimple size={14} /> Editar
                      </button>

                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={trabajando}
                        onClick={() =>
                          void ejecutar(proveedor.id, () =>
                            cambiarEstadoProveedor(proveedor.id, proveedor.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO'),
                          )
                        }
                      >
                        {proveedor.estado === 'ACTIVO' ? (
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
                        disabled={trabajando || enUso || proveedor.esSistema}
                        title={
                          proveedor.esSistema
                            ? MOTIVO_SISTEMA
                            : enUso
                              ? `No se puede eliminar: ${proveedor.cantidadIngresos} ingreso(s) lo usan. Desactívalo para dejar de ofrecerlo.`
                              : 'Eliminar el proveedor'
                        }
                        onClick={() => void ejecutar(proveedor.id, () => eliminarProveedor(proveedor.id))}
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
        <DialogoProveedor
          proveedor={editando}
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
