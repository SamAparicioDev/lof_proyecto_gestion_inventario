'use client';

/**
 * Tabla de roles con acciones por fila (T107, FR-055/FR-057): editar (nombre, descripción y
 * matriz de permisos), activar/desactivar y eliminar. Client Component recibido por
 * `app/(app)/roles/page.tsx` (Server Component, que resuelve el listado paginado y el catálogo
 * de permisos vía `apiServidor`) porque las tres acciones necesitan estado local para sus
 * diálogos — mismo reparto que `componentes/usuarios/tabla-usuarios.tsx`.
 *
 * ## Los roles del sistema se ven distintos porque SE COMPORTAN distinto (FR-057/FR-059)
 *
 * Administrador, Gerente y Operario nacen con la instalación y el contrato responde `409` a
 * cualquier intento de eliminarlos o desactivarlos. Por eso llevan un `.tag` "Del sistema" y no
 * ofrecen esas dos acciones: mostrar botones que siempre fallan enseña a ignorar los errores.
 * Editar SÍ se ofrece — cambiarles los permisos es justamente lo que US9 hace configurable— y
 * el diálogo bloquea solo el nombre (ver `rol-form.tsx`).
 *
 * ## Un rol con usuarios no se elimina: se desactiva (US9-AS5)
 *
 * El listado ya trae `cantidadUsuarios`, así que el diálogo lo dice ANTES de intentarlo y
 * ofrece "Desactivar" en su lugar, en vez de dejar al usuario chocar contra un `409`. Eso es
 * UX, no la regla: la autoridad es el caso de uso del backend, que verifica el conteo en el
 * momento (el que ve esta pantalla pudo quedar viejo si alguien asignó el rol entretanto) y
 * cuyo mensaje se muestra tal cual en el `<div role="alert">` del diálogo.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EstadoRol, ModuloPermisos, RolListado } from '@trazo/compartido';
import { cambiarEstadoRol, eliminarRol } from '@/lib/api/roles';
import { ErrorApi } from '@/lib/api/cliente';
import { EstadoRolTag } from './estado-rol-tag';
import { RolForm } from './rol-form';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

interface SolicitudCambioEstado {
  rol: RolListado;
  nuevoEstado: EstadoRol;
}

export function TablaRoles({ roles, catalogo }: { roles: RolListado[]; catalogo: ModuloPermisos[] }) {
  const router = useRouter();
  const [rolEditando, setRolEditando] = useState<RolListado | null>(null);
  const [solicitudEstado, setSolicitudEstado] = useState<SolicitudCambioEstado | null>(null);
  const [rolEliminando, setRolEliminando] = useState<RolListado | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  function abrirCambioEstado(rol: RolListado): void {
    setErrorAccion(null);
    setSolicitudEstado({ rol, nuevoEstado: rol.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO' });
  }

  function abrirEliminacion(rol: RolListado): void {
    setErrorAccion(null);
    setRolEliminando(rol);
  }

  async function confirmarCambioEstado(): Promise<void> {
    if (!solicitudEstado) return;
    setErrorAccion(null);
    setProcesando(true);
    try {
      await cambiarEstadoRol(solicitudEstado.rol.id, solicitudEstado.nuevoEstado);
      setSolicitudEstado(null);
      setRolEliminando(null);
      router.refresh();
    } catch (error) {
      setErrorAccion(error instanceof ErrorApi ? error.mensaje : MENSAJE_ERROR_RED);
    } finally {
      setProcesando(false);
    }
  }

  async function confirmarEliminacion(): Promise<void> {
    if (!rolEliminando) return;
    setErrorAccion(null);
    setProcesando(true);
    try {
      await eliminarRol(rolEliminando.id);
      setRolEliminando(null);
      router.refresh();
    } catch (error) {
      setErrorAccion(error instanceof ErrorApi ? error.mensaje : MENSAJE_ERROR_RED);
    } finally {
      setProcesando(false);
    }
  }

  /** Desactivar es la salida que se le ofrece a un rol con usuarios (US9-AS5). */
  async function desactivarDesdeEliminacion(): Promise<void> {
    if (!rolEliminando) return;
    setSolicitudEstado({ rol: rolEliminando, nuevoEstado: 'INACTIVO' });
    setRolEliminando(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Rol</th>
                <th>Permisos</th>
                <th>Usuarios</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {roles.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    No se encontraron roles con los filtros aplicados.
                  </td>
                </tr>
              ) : (
                roles.map((rol) => (
                  <tr key={rol.id}>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{rol.nombre}</span>
                        {rol.esSistema && <span className="tag tag-outline">Del sistema</span>}
                      </div>
                      {rol.descripcion && (
                        <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {rol.descripcion}
                        </div>
                      )}
                    </td>
                    <td>
                      {rol.permisos.length} {rol.permisos.length === 1 ? 'permiso' : 'permisos'}
                    </td>
                    <td>
                      {rol.cantidadUsuarios} {rol.cantidadUsuarios === 1 ? 'usuario' : 'usuarios'}
                    </td>
                    <td>
                      <EstadoRolTag estado={rol.estado} />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn btn-secondary" onClick={() => setRolEditando(rol)}>
                          Editar permisos
                        </button>
                        {!rol.esSistema && (
                          <>
                            <button type="button" className="btn btn-ghost" onClick={() => abrirCambioEstado(rol)}>
                              {rol.estado === 'ACTIVO' ? 'Desactivar' : 'Activar'}
                            </button>
                            <button type="button" className="btn btn-ghost" onClick={() => abrirEliminacion(rol)}>
                              Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {rolEditando && (
        <RolForm
          catalogo={catalogo}
          rol={rolEditando}
          onCerrar={() => setRolEditando(null)}
          onGuardado={() => router.refresh()}
        />
      )}

      {solicitudEstado && (
        <div className="dialog-backdrop" role="presentation" onClick={() => !procesando && setSolicitudEstado(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-cambiar-estado-rol"
            onClick={(evento) => evento.stopPropagation()}
          >
            <div className="dialog-title" id="titulo-cambiar-estado-rol">
              {solicitudEstado.nuevoEstado === 'INACTIVO' ? 'Desactivar rol' : 'Activar rol'}
            </div>
            <div className="dialog-body">
              {solicitudEstado.nuevoEstado === 'INACTIVO' ? (
                <>
                  <strong>{solicitudEstado.rol.nombre}</strong> dejará de ofrecerse al asignar el rol de un usuario. Los{' '}
                  {solicitudEstado.rol.cantidadUsuarios}{' '}
                  {solicitudEstado.rol.cantidadUsuarios === 1 ? 'usuario que lo tiene' : 'usuarios que lo tienen'} lo
                  conservan y siguen entrando con sus permisos actuales.
                </>
              ) : (
                <>
                  <strong>{solicitudEstado.rol.nombre}</strong> vuelve a estar disponible para asignarlo a un usuario.
                </>
              )}
            </div>

            {errorAccion && (
              <div role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>
                {errorAccion}
              </div>
            )}

            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" disabled={procesando} onClick={() => setSolicitudEstado(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={procesando} onClick={confirmarCambioEstado}>
                {procesando
                  ? 'Procesando…'
                  : solicitudEstado.nuevoEstado === 'INACTIVO'
                    ? 'Confirmar desactivación'
                    : 'Confirmar activación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rolEliminando && (
        <div className="dialog-backdrop" role="presentation" onClick={() => !procesando && setRolEliminando(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-eliminar-rol"
            onClick={(evento) => evento.stopPropagation()}
          >
            <div className="dialog-title" id="titulo-eliminar-rol">
              Eliminar rol
            </div>
            <div className="dialog-body">
              {rolEliminando.cantidadUsuarios > 0 ? (
                <>
                  <strong>{rolEliminando.nombre}</strong> no se puede eliminar: {rolEliminando.cantidadUsuarios}{' '}
                  {rolEliminando.cantidadUsuarios === 1 ? 'usuario lo tiene' : 'usuarios lo tienen'} asignado, y eliminarlo
                  los dejaría sin rol. Puedes desactivarlo para que no se asigne a nadie más.
                </>
              ) : (
                <>
                  <strong>{rolEliminando.nombre}</strong> se eliminará definitivamente. Ningún usuario lo tiene asignado.
                </>
              )}
            </div>

            {errorAccion && (
              <div role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>
                {errorAccion}
              </div>
            )}

            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" disabled={procesando} onClick={() => setRolEliminando(null)}>
                Cancelar
              </button>
              {rolEliminando.cantidadUsuarios > 0 ? (
                <button type="button" className="btn btn-primary" disabled={procesando} onClick={desactivarDesdeEliminacion}>
                  Desactivar en su lugar
                </button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={procesando} onClick={confirmarEliminacion}>
                  {procesando ? 'Eliminando…' : 'Confirmar eliminación'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
