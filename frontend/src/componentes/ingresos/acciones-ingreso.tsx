'use client';

/**
 * Botones de transición de estado de un ingreso (T036): Recibir (PENDIENTE→RECIBIDO),
 * Verificar (RECIBIDO→VERIFICADO) y Anular (PENDIENTE|RECIBIDO→ANULADO con motivo
 * obligatorio, FR-019).
 *
 * Cada botón exige SU permiso (T108): `ingresos.recibir`, `ingresos.verificar` e
 * `ingresos.anular` — exactamente los que declaran esos tres endpoints con
 * `@RequierePermiso`. Antes Verificar y Anular compartían un booleano por rol (A,G); con los
 * permisos como dato son dos decisiones distintas. Se leen con `usePuede()` del contexto de
 * sesión, SIEMPRE los tres y antes de cualquier condición (reglas de hooks de React: el
 * número de hooks no puede variar entre renders; el estado del documento se combina después).
 * Mostrar u ocultar un botón aquí es solo UX (frontend/CLAUDE.md): la autoridad real es
 * `PermisosGuard` — si igual se llega a golpear el endpoint sin permiso, el `403` de la API se
 * muestra como error general, igual que cualquier otro error de negocio.
 *
 * Tras una transición exitosa hace `router.refresh()` para que el Server Component que monta
 * esta pieza (`app/(app)/ingresos/[id]/page.tsx`) vuelva a leer el ingreso actualizado —
 * mismo patrón que `FormularioCambiarPassword` (T024) tras cambiar la contraseña.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { IngresoConDetalles } from '@trazo/compartido';
import { anularIngreso, recibirIngreso, verificarIngreso } from '@/lib/api/ingresos';
import { ErrorApi } from '@/lib/api/cliente';
import { PERMISOS } from '@/lib/permisos';
import { usePuede } from '@/lib/sesion';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

export function AccionesIngreso({ ingreso }: { ingreso: IngresoConDetalles }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [mostrarAnular, setMostrarAnular] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);

  const permitidoRecibir = usePuede(PERMISOS.INGRESOS_RECIBIR);
  const permitidoVerificar = usePuede(PERMISOS.INGRESOS_VERIFICAR);
  const permitidoAnular = usePuede(PERMISOS.INGRESOS_ANULAR);

  const puedeRecibir = ingreso.estado === 'PENDIENTE' && permitidoRecibir;
  const puedeVerificar = ingreso.estado === 'RECIBIDO' && permitidoVerificar;
  const puedeAnular = (ingreso.estado === 'PENDIENTE' || ingreso.estado === 'RECIBIDO') && permitidoAnular;

  if (!puedeRecibir && !puedeVerificar && !puedeAnular) {
    return null;
  }

  async function ejecutar(accion: () => Promise<void>): Promise<void> {
    setErrorGeneral(null);
    setCargando(true);
    try {
      await accion();
      router.refresh();
    } catch (error) {
      setErrorGeneral(error instanceof ErrorApi ? error.mensaje : MENSAJE_ERROR_RED);
    } finally {
      setCargando(false);
    }
  }

  async function confirmarAnulacion(): Promise<void> {
    const motivoLimpio = motivo.trim();
    if (!motivoLimpio) {
      setErrorMotivo('El motivo de anulación es obligatorio');
      return;
    }
    setErrorMotivo(null);
    await ejecutar(async () => {
      await anularIngreso(ingreso.id, motivoLimpio);
      setMostrarAnular(false);
      setMotivo('');
    });
  }

  return (
    <div className="card gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {puedeRecibir && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={cargando}
            onClick={() => ejecutar(() => recibirIngreso(ingreso.id))}
          >
            {cargando ? 'Procesando…' : 'Recibir'}
          </button>
        )}
        {puedeVerificar && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={cargando}
            onClick={() => ejecutar(() => verificarIngreso(ingreso.id))}
          >
            {cargando ? 'Procesando…' : 'Verificar'}
          </button>
        )}
        {puedeAnular && (
          <button type="button" className="btn btn-ghost" disabled={cargando} onClick={() => setMostrarAnular(true)}>
            Anular
          </button>
        )}
      </div>

      {errorGeneral && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
          {errorGeneral}
        </div>
      )}

      {mostrarAnular && (
        <div className="dialog-backdrop" role="presentation" onClick={() => !cargando && setMostrarAnular(false)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-anular-ingreso"
            onClick={(evento) => evento.stopPropagation()}
          >
            <div className="dialog-title" id="titulo-anular-ingreso">
              Anular ingreso
            </div>
            <div className="dialog-body">
              Esta acción anula la factura {ingreso.numeroFactura}
              {ingreso.estado === 'RECIBIDO' ? ' y revierte el stock que había ingresado.' : '.'} Indica el motivo:
            </div>
            <div className="field">
              <label htmlFor="motivo-anulacion-ingreso">Motivo</label>
              <textarea
                id="motivo-anulacion-ingreso"
                className="input"
                rows={3}
                value={motivo}
                aria-invalid={!!errorMotivo}
                onChange={(evento) => setMotivo(evento.target.value)}
              />
              {errorMotivo && (
                <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                  {errorMotivo}
                </p>
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" disabled={cargando} onClick={() => setMostrarAnular(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={cargando} onClick={confirmarAnulacion}>
                {cargando ? 'Anulando…' : 'Confirmar anulación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
