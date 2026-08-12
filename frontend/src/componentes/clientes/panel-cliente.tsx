'use client';

/**
 * Panel de datos del cliente en el detalle (T045) — a diferencia de `ingreso-form.tsx`
 * (donde la edición depende del ESTADO del documento), un cliente es editable siempre; el
 * toggle es manual: "Editar" reemplaza la vista de solo lectura por `ClienteForm`
 * precargado (`PUT /api/clientes/:id`) y "Activar"/"Desactivar" cambia el estado (baja
 * lógica, FR-038 — un cliente `INACTIVO` deja de aportar destinos válidos de salida para
 * cualquiera de sus proyectos, sin importar el estado de estos).
 *
 * Cada botón de escritura se muestra según SU permiso (T108): "Editar" con `clientes.editar`
 * y "Activar/Desactivar" con `clientes.cambiar_estado` — los mismos que exigen
 * `PUT /api/clientes/:id` y `PUT /api/clientes/:id/estado`. Antes ambos dependían de un único
 * booleano por rol (A,G); con los permisos como dato ya no tienen por qué ir juntos. Se leen
 * con `usePuede()` del contexto de sesión, no por prop (frontend/CLAUDE.md: ocultar UI es solo
 * UX, la autoridad real es `PermisosGuard` en el backend).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Cliente, DatosCrearCliente } from '@trazo/compartido';
import { cambiarEstadoCliente } from '@/lib/api/clientes';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoFecha } from '@/lib/formato';
import { PERMISOS } from '@/lib/permisos';
import { usePuede } from '@/lib/sesion';
import { ClienteForm } from './cliente-form';
import { EstadoClienteTag } from './estado-cliente-tag';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

function aValoresFormulario(cliente: Cliente): DatosCrearCliente {
  return {
    nombre: cliente.nombre,
    nit: cliente.nit,
    telefono: cliente.telefono ?? '',
    email: cliente.email ?? '',
    direccion: cliente.direccion ?? '',
    ciudad: cliente.ciudad ?? '',
  };
}

export function PanelCliente({ cliente }: { cliente: Cliente }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const puedeEditar = usePuede(PERMISOS.CLIENTES_EDITAR);
  const puedeCambiarEstado = usePuede(PERMISOS.CLIENTES_CAMBIAR_ESTADO);

  async function alternarEstado(): Promise<void> {
    setErrorEstado(null);
    setCambiandoEstado(true);
    try {
      await cambiarEstadoCliente(cliente.id, cliente.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO');
      router.refresh();
      setCambiandoEstado(false);
    } catch (error) {
      setErrorEstado(error instanceof ErrorApi ? error.mensaje : MENSAJE_ERROR_RED);
      setCambiandoEstado(false);
    }
  }

  if (editando) {
    return (
      <ClienteForm
        clienteId={cliente.id}
        valoresIniciales={aValoresFormulario(cliente)}
        onCancelar={() => setEditando(false)}
        onGuardado={() => setEditando(false)}
      />
    );
  }

  return (
    <div className="card gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <dl className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', margin: 0, flex: 1 }}>
          <DatoSoloLectura etiqueta="NIT" valor={cliente.nit} />
          <DatoSoloLectura etiqueta="Teléfono" valor={cliente.telefono ?? '—'} />
          <DatoSoloLectura etiqueta="Correo" valor={cliente.email ?? '—'} />
          <DatoSoloLectura etiqueta="Dirección" valor={cliente.direccion ?? '—'} />
          <DatoSoloLectura etiqueta="Ciudad" valor={cliente.ciudad ?? '—'} />
          <DatoSoloLectura etiqueta="Fecha de registro" valor={formatoFecha(cliente.fechaRegistro)} />
        </dl>
        <EstadoClienteTag estado={cliente.estado} />
      </div>

      {(puedeEditar || puedeCambiarEstado) && (
        <div className="flex flex-wrap items-center gap-2">
          {puedeEditar && (
            <button type="button" className="btn btn-secondary" onClick={() => setEditando(true)}>
              Editar
            </button>
          )}
          {puedeCambiarEstado && (
            <button type="button" className="btn btn-ghost" disabled={cambiandoEstado} onClick={alternarEstado}>
              {cambiandoEstado ? 'Procesando…' : cliente.estado === 'ACTIVO' ? 'Desactivar cliente' : 'Activar cliente'}
            </button>
          )}
        </div>
      )}

      {errorEstado && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
          {errorEstado}
        </div>
      )}
    </div>
  );
}

function DatoSoloLectura({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {etiqueta}
      </dt>
      <dd style={{ margin: '2px 0 0' }}>{valor}</dd>
    </div>
  );
}
