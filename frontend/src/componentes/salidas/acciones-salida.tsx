'use client';

/**
 * Botones de transición de estado de una salida (T055): Confirmar (PENDIENTE→CONFIRMADA),
 * Completar (CONFIRMADA→COMPLETADA), Cancelar (PENDIENTE→ANULADA con motivo) y Anular
 * (CONFIRMADA→ANULADA con motivo OBLIGATORIO — reversa de stock, FR-032).
 *
 * Cada botón exige SU permiso (T108): `salidas.confirmar`, `salidas.completar`,
 * `salidas.cancelar` y `salidas.anular` — exactamente los que declaran esos cuatro endpoints
 * con `@RequierePermiso`. Se leen con `usePuede()` del contexto de sesión, SIEMPRE los cuatro
 * y antes de cualquier condición (reglas de hooks de React: el número de hooks no puede variar
 * entre renders; el estado del documento se combina después). Mostrar u ocultar un botón aquí
 * es solo UX (frontend/CLAUDE.md): la autoridad real es `PermisosGuard` — si igual se llega a
 * golpear el endpoint sin permiso, el `403` de la API se muestra como error general, igual que
 * cualquier otro error de negocio (p. ej. disponibilidad insuficiente al confirmar, US3-AS2).
 *
 * Cancelar y Anular comparten UN solo diálogo de motivo (parametrizado por `dialogoAbierto`)
 * en vez de duplicar el markup — ambos piden el mismo dato (texto obligatorio) y terminan en
 * el mismo estado (`ANULADA`, ver TSDoc de `repositorio-salidas.prisma.ts`), solo cambia el
 * mensaje y el endpoint que disparan.
 *
 * Tras una transición exitosa hace `router.refresh()` para que el Server Component que monta
 * esta pieza (`app/(app)/salidas/[id]/page.tsx`) vuelva a leer la salida actualizada — mismo
 * patrón que `AccionesIngreso` (T036).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SalidaConDetalles } from '@trazo/compartido';
import { anularSalida, cancelarSalida, completarSalida, confirmarSalida } from '@/lib/api/salidas';
import { ErrorApi } from '@/lib/api/cliente';
import { PERMISOS } from '@/lib/permisos';
import { usePuede } from '@/lib/sesion';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

type AccionConMotivo = 'cancelar' | 'anular';

export function AccionesSalida({ salida }: { salida: SalidaConDetalles }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [dialogoAbierto, setDialogoAbierto] = useState<AccionConMotivo | null>(null);
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);

  const permitidoConfirmar = usePuede(PERMISOS.SALIDAS_CONFIRMAR);
  const permitidoCompletar = usePuede(PERMISOS.SALIDAS_COMPLETAR);
  const permitidoCancelar = usePuede(PERMISOS.SALIDAS_CANCELAR);
  const permitidoAnular = usePuede(PERMISOS.SALIDAS_ANULAR);

  const puedeConfirmar = salida.estado === 'PENDIENTE' && permitidoConfirmar;
  const puedeCompletar = salida.estado === 'CONFIRMADA' && permitidoCompletar;
  const puedeCancelar = salida.estado === 'PENDIENTE' && permitidoCancelar;
  const puedeAnular = salida.estado === 'CONFIRMADA' && permitidoAnular;

  if (!puedeConfirmar && !puedeCompletar && !puedeCancelar && !puedeAnular) {
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

  function abrirDialogo(accion: AccionConMotivo): void {
    setMotivo('');
    setErrorMotivo(null);
    setDialogoAbierto(accion);
  }

  async function confirmarDialogo(): Promise<void> {
    const motivoLimpio = motivo.trim();
    if (!motivoLimpio) {
      setErrorMotivo('El motivo es obligatorio');
      return;
    }
    setErrorMotivo(null);
    const accion = dialogoAbierto;
    await ejecutar(async () => {
      if (accion === 'cancelar') {
        await cancelarSalida(salida.id, motivoLimpio);
      } else if (accion === 'anular') {
        await anularSalida(salida.id, motivoLimpio);
      }
      setDialogoAbierto(null);
      setMotivo('');
    });
  }

  const configuracionDialogo =
    dialogoAbierto === 'cancelar'
      ? {
          titulo: 'Cancelar salida',
          cuerpo: `Esta acción cancela la salida N.º ${salida.numero} y libera el compromiso de disponibilidad. Indica el motivo:`,
          boton: 'Confirmar cancelación',
        }
      : dialogoAbierto === 'anular'
        ? {
            titulo: 'Anular salida',
            cuerpo: `Esta acción anula la salida N.º ${salida.numero} y revierte el stock que había descontado. Indica el motivo:`,
            boton: 'Confirmar anulación',
          }
        : null;

  return (
    <div className="card gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {puedeConfirmar && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={cargando}
            onClick={() => ejecutar(() => confirmarSalida(salida.id))}
          >
            {cargando ? 'Procesando…' : 'Confirmar'}
          </button>
        )}
        {puedeCompletar && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={cargando}
            onClick={() => ejecutar(() => completarSalida(salida.id))}
          >
            {cargando ? 'Procesando…' : 'Completar'}
          </button>
        )}
        {puedeCancelar && (
          <button type="button" className="btn btn-ghost" disabled={cargando} onClick={() => abrirDialogo('cancelar')}>
            Cancelar
          </button>
        )}
        {puedeAnular && (
          <button type="button" className="btn btn-ghost" disabled={cargando} onClick={() => abrirDialogo('anular')}>
            Anular
          </button>
        )}
      </div>

      {errorGeneral && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
          {errorGeneral}
        </div>
      )}

      {configuracionDialogo && (
        <div className="dialog-backdrop" role="presentation" onClick={() => !cargando && setDialogoAbierto(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-dialogo-salida"
            onClick={(evento) => evento.stopPropagation()}
          >
            <div className="dialog-title" id="titulo-dialogo-salida">
              {configuracionDialogo.titulo}
            </div>
            <div className="dialog-body">{configuracionDialogo.cuerpo}</div>
            <div className="field">
              <label htmlFor="motivo-salida">Motivo</label>
              <textarea
                id="motivo-salida"
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
              <button type="button" className="btn btn-secondary" disabled={cargando} onClick={() => setDialogoAbierto(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={cargando} onClick={confirmarDialogo}>
                {cargando ? 'Procesando…' : configuracionDialogo.boton}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
