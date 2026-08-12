'use client';

/**
 * Proyectos de un cliente (T045, FR-036/FR-038) — tarjeta `.card` por proyecto (nombre,
 * responsable, presupuesto en COP vía `formatoMoneda`, tag de estado), botón "Nuevo
 * proyecto" que abre `ProyectoForm` en diálogo, "Editar" que reabre el mismo formulario
 * precargado, y un selector de estado (ACTIVO/COMPLETADO/SUSPENDIDO, US2-AS4) por tarjeta —
 * `PUT /api/proyectos/:id/estado`. Un proyecto que deja de estar ACTIVO (o su cliente se
 * desactiva, ver `panel-cliente.tsx`) deja de ser destino válido de nuevas salidas (FR-038).
 *
 * Cada control de escritura se muestra según SU permiso (T108): "Nuevo proyecto" con
 * `proyectos.crear`, "Editar" con `proyectos.editar` y el selector de estado con
 * `proyectos.cambiar_estado` — los mismos tres que exigen `POST /api/clientes/:id/proyectos`,
 * `PUT /api/proyectos/:id` y `PUT /api/proyectos/:id/estado`. Se leen con `usePuede()` del
 * contexto de sesión, no por prop. Mostrar u ocultar aquí es solo UX (frontend/CLAUDE.md): la
 * autoridad real es `PermisosGuard` en el backend.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import type { EstadoProyecto, Proyecto } from '@trazo/compartido';
import { cambiarEstadoProyecto } from '@/lib/api/clientes';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoMoneda } from '@/lib/formato';
import { PERMISOS } from '@/lib/permisos';
import { usePuede } from '@/lib/sesion';
import { EstadoProyectoTag } from './estado-proyecto-tag';
import { ProyectoForm } from './proyecto-form';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const ESTADOS_PROYECTO: { valor: EstadoProyecto; etiqueta: string }[] = [
  { valor: 'ACTIVO', etiqueta: 'Activo' },
  { valor: 'COMPLETADO', etiqueta: 'Completado' },
  { valor: 'SUSPENDIDO', etiqueta: 'Suspendido' },
];

export function ProyectosCliente({ clienteId, proyectos }: { clienteId: number; proyectos: Proyecto[] }) {
  const router = useRouter();
  const [dialogoAbierto, setDialogoAbierto] = useState<'nuevo' | Proyecto | null>(null);
  const puedeCrear = usePuede(PERMISOS.PROYECTOS_CREAR);
  const puedeEditar = usePuede(PERMISOS.PROYECTOS_EDITAR);
  const puedeCambiarEstado = usePuede(PERMISOS.PROYECTOS_CAMBIAR_ESTADO);

  function alGuardar(): void {
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h5 style={{ margin: 0 }}>Proyectos</h5>
        {puedeCrear && (
          <button type="button" className="btn btn-secondary" onClick={() => setDialogoAbierto('nuevo')}>
            <Plus size={16} /> Nuevo proyecto
          </button>
        )}
      </div>

      {proyectos.length === 0 ? (
        <div className="card p-4 text-muted" style={{ fontSize: 13 }}>
          Este cliente todavía no tiene proyectos registrados.
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {proyectos.map((proyecto) => (
            <TarjetaProyecto
              key={proyecto.id}
              proyecto={proyecto}
              puedeEditar={puedeEditar}
              puedeCambiarEstado={puedeCambiarEstado}
              onEditar={() => setDialogoAbierto(proyecto)}
              onCambiado={() => router.refresh()}
            />
          ))}
        </div>
      )}

      {dialogoAbierto && (
        <ProyectoForm
          clienteId={clienteId}
          proyecto={dialogoAbierto === 'nuevo' ? undefined : dialogoAbierto}
          onCerrar={() => setDialogoAbierto(null)}
          onGuardado={alGuardar}
        />
      )}
    </div>
  );
}

function TarjetaProyecto({
  proyecto,
  puedeEditar,
  puedeCambiarEstado,
  onEditar,
  onCambiado,
}: {
  proyecto: Proyecto;
  puedeEditar: boolean;
  puedeCambiarEstado: boolean;
  onEditar: () => void;
  onCambiado: () => void;
}) {
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);

  async function alCambiarEstado(nuevoEstado: EstadoProyecto): Promise<void> {
    if (nuevoEstado === proyecto.estado) return;
    setErrorEstado(null);
    setCambiandoEstado(true);
    try {
      await cambiarEstadoProyecto(proyecto.id, nuevoEstado);
      onCambiado();
      setCambiandoEstado(false);
    } catch (error) {
      setErrorEstado(error instanceof ErrorApi ? error.mensaje : MENSAJE_ERROR_RED);
      setCambiandoEstado(false);
    }
  }

  return (
    <div className="card elev-sm gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="card-title">{proyecto.nombre}</div>
        <EstadoProyectoTag estado={proyecto.estado} />
      </div>
      {proyecto.descripcion && <p className="card-body">{proyecto.descripcion}</p>}
      {/* Contenedor (`.card-meta`, Nocturne: tipografía y color atenuado) y layout (utilidades
          de Tailwind) en elementos DISTINTOS: `.card-meta` declara `align-items:center` sin
          capa CSS y ganaba sobre el `items-start` de Tailwind del mismo elemento, así que las
          dos líneas salían CENTRADAS dentro de la tarjeta en vez de alineadas a la izquierda
          con el título (bug real encontrado barriendo esta cascada en T110 — misma regla que
          `componentes/comunes/barra-filtros.tsx`, ver docs/diseno-nocturne.md). */}
      <div className="card-meta" style={{ fontSize: 12 }}>
        <div className="flex flex-col items-start gap-[var(--space-1)]">
          <span>Responsable: {proyecto.responsable ?? '—'}</span>
          <span>Presupuesto: {proyecto.presupuestoEstimado != null ? formatoMoneda(proyecto.presupuestoEstimado) : '—'}</span>
        </div>
      </div>

      {(puedeEditar || puedeCambiarEstado) && (
        <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 4 }}>
          {puedeEditar && (
            <button type="button" className="btn btn-ghost" onClick={onEditar}>
              Editar
            </button>
          )}
          {puedeCambiarEstado && (
            <select
              className="input"
              aria-label={`Cambiar estado de ${proyecto.nombre}`}
              value={proyecto.estado}
              disabled={cambiandoEstado}
              onChange={(evento) => alCambiarEstado(evento.target.value as EstadoProyecto)}
              style={{ width: 'auto', minHeight: 32, fontSize: 13 }}
            >
              {ESTADOS_PROYECTO.map((estado) => (
                <option key={estado.valor} value={estado.valor}>
                  {estado.etiqueta}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {errorEstado && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>
          {errorEstado}
        </div>
      )}
    </div>
  );
}
