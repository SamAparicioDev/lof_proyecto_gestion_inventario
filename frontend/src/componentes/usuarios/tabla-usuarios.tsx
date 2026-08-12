'use client';

/**
 * Tabla de usuarios con acciones por fila (T077, FR-005/FR-008): editar, restablecer
 * contraseña y activar/desactivar. Client Component recibido por
 * `app/(app)/usuarios/page.tsx` (Server Component, que resuelve el listado paginado vía
 * `apiServidor` — mismo patrón que `app/(app)/clientes/page.tsx`) porque las tres acciones
 * necesitan estado local para sus diálogos.
 *
 * Activar/desactivar pide confirmación en un diálogo (`.dialog` Nocturne) en vez de un toggle
 * directo como `componentes/clientes/panel-cliente.tsx`: desactivar a un usuario le corta el
 * acceso de inmediato (FR-008), así que el criterio de esta tanda es "botón con
 * confirmación" (a diferencia de clientes/productos, que no lo piden). Si el Administrador
 * en sesión intenta desactivarse a sí mismo, el backend responde `409` (US6-AS) y el mensaje
 * se muestra DENTRO del diálogo de confirmación como `<div role="alert">`, nunca un toast
 * (frontend/CLAUDE.md).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EstadoUsuario, RolAsignado, Usuario } from '@trazo/compartido';
import { cambiarEstadoUsuario } from '@/lib/api/usuarios';
import { ErrorApi } from '@/lib/api/cliente';
import { mensajeListadoVacio } from '@/lib/filtros';
import { EditarUsuarioForm } from './usuario-form';
import { DialogoRestablecerPassword } from './dialogo-restablecer-password';
import { EstadoUsuarioTag } from './estado-usuario-tag';
import { RolUsuarioTag } from './rol-usuario-tag';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

interface SolicitudCambioEstado {
  usuario: Usuario;
  nuevoEstado: EstadoUsuario;
}

interface PropiedadesTablaUsuarios {
  usuarios: Usuario[];
  usuarioActualId: number | null;
  /** Roles ACTIVOS asignables, resueltos por la página — alimentan el diálogo de edición (T108). */
  roles: RolAsignado[];
  /** Si el listado llegó recortado por algún filtro — decide el texto del estado vacío (US13/FR-079). */
  hayFiltros: boolean;
}

export function TablaUsuarios({ usuarios, usuarioActualId, roles, hayFiltros }: PropiedadesTablaUsuarios) {
  const router = useRouter();
  const [usuarioEditando, setUsuarioEditando] = useState<Usuario | null>(null);
  const [usuarioRestableciendo, setUsuarioRestableciendo] = useState<Usuario | null>(null);
  const [solicitudEstado, setSolicitudEstado] = useState<SolicitudCambioEstado | null>(null);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);

  function abrirCambioEstado(usuario: Usuario): void {
    setErrorEstado(null);
    setSolicitudEstado({ usuario, nuevoEstado: usuario.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO' });
  }

  async function confirmarCambioEstado(): Promise<void> {
    if (!solicitudEstado) return;
    setErrorEstado(null);
    setCambiandoEstado(true);
    try {
      await cambiarEstadoUsuario(solicitudEstado.usuario.id, solicitudEstado.nuevoEstado);
      setSolicitudEstado(null);
      router.refresh();
    } catch (error) {
      setErrorEstado(error instanceof ErrorApi ? error.mensaje : MENSAJE_ERROR_RED);
    } finally {
      setCambiandoEstado(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="card p-0" style={{ overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Usuario</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    {mensajeListadoVacio('usuarios', hayFiltros)}
                  </td>
                </tr>
              ) : (
                usuarios.map((usuario) => (
                  <tr key={usuario.id}>
                    <td>{usuario.nombreCompleto}</td>
                    <td>{usuario.login}</td>
                    <td>{usuario.email}</td>
                    <td>
                      <RolUsuarioTag rol={usuario.rol} />
                    </td>
                    <td>
                      <EstadoUsuarioTag estado={usuario.estado} />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn btn-secondary" onClick={() => setUsuarioEditando(usuario)}>
                          Editar
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setUsuarioRestableciendo(usuario)}>
                          Restablecer contraseña
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => abrirCambioEstado(usuario)}>
                          {usuario.estado === 'ACTIVO' ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {usuarioEditando && (
        <EditarUsuarioForm
          usuario={usuarioEditando}
          roles={roles}
          onCerrar={() => setUsuarioEditando(null)}
          onGuardado={() => router.refresh()}
        />
      )}

      {usuarioRestableciendo && (
        <DialogoRestablecerPassword
          usuario={usuarioRestableciendo}
          onCerrar={() => setUsuarioRestableciendo(null)}
          onGuardado={() => router.refresh()}
        />
      )}

      {solicitudEstado && (
        <div className="dialog-backdrop" role="presentation" onClick={() => !cambiandoEstado && setSolicitudEstado(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-cambiar-estado-usuario"
            onClick={(evento) => evento.stopPropagation()}
          >
            <div className="dialog-title" id="titulo-cambiar-estado-usuario">
              {solicitudEstado.nuevoEstado === 'INACTIVO' ? 'Desactivar usuario' : 'Activar usuario'}
            </div>
            <div className="dialog-body">
              {solicitudEstado.nuevoEstado === 'INACTIVO' ? (
                <>
                  <strong>{solicitudEstado.usuario.nombreCompleto}</strong> ({solicitudEstado.usuario.login}) no podrá iniciar
                  sesión mientras esté inactivo. Sus movimientos registrados conservan su nombre.
                </>
              ) : (
                <>
                  <strong>{solicitudEstado.usuario.nombreCompleto}</strong> ({solicitudEstado.usuario.login}) podrá volver a
                  iniciar sesión.
                </>
              )}
              {solicitudEstado.usuario.id === usuarioActualId && solicitudEstado.nuevoEstado === 'INACTIVO' && (
                <>
                  {' '}
                  Estás a punto de desactivar tu propia cuenta mientras tienes la sesión activa.
                </>
              )}
            </div>

            {errorEstado && (
              <div role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>
                {errorEstado}
              </div>
            )}

            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={cambiandoEstado}
                onClick={() => setSolicitudEstado(null)}
              >
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={cambiandoEstado} onClick={confirmarCambioEstado}>
                {cambiandoEstado
                  ? 'Procesando…'
                  : solicitudEstado.nuevoEstado === 'INACTIVO'
                    ? 'Confirmar desactivación'
                    : 'Confirmar activación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
