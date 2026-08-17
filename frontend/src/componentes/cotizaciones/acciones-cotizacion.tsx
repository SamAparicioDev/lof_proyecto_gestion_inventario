'use client';

/**
 * Acciones de una cotización según su estado y los permisos de la sesión (US21, T204).
 *
 * Qué se ofrece y cuándo (FR-112/FR-115/FR-117):
 *
 * | Estado | Acciones |
 * |---|---|
 * | BORRADOR | Editar · Enviar al cliente (`cotizaciones.enviar`) · Anular (`cotizaciones.anular`) |
 * | ENVIADA | **Aceptar** (`cotizaciones.cerrar`) · Rechazar · Anular |
 * | ACEPTADA / RECHAZADA / ANULADA | ninguna: son terminales |
 *
 * **Aceptar es la única que crea algo**: genera la salida pendiente (FR-115) y lleva al usuario
 * directo a ella. Por eso se confirma antes — no por cortesía, sino porque a partir de ahí
 * existe un documento nuevo con vida propia, y deshacerlo es anular esa salida, no la
 * cotización.
 *
 * Los permisos se leen con `usePuede()` del contexto de sesión (T108). Ocultar un botón es UX:
 * la autoridad son los guards del backend (FR-003).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, PaperPlaneTilt, PencilSimple, Prohibit, XCircle } from '@phosphor-icons/react/dist/ssr';
import type { Cotizacion } from '@trazo/compartido';
import {
  aceptarCotizacion,
  anularCotizacion,
  enviarCotizacion,
  rechazarCotizacion,
} from '@/lib/api/cotizaciones';
import { ErrorApi } from '@/lib/api/cliente';
import { usePuede } from '@/lib/sesion';
import { PERMISOS } from '@/lib/permisos';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

export function AccionesCotizacion({ cotizacion }: { cotizacion: Cotizacion }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [confirmandoAceptar, setConfirmandoAceptar] = useState(false);
  const [motivo, setMotivo] = useState('');

  const puedeEditar = usePuede(PERMISOS.COTIZACIONES_EDITAR);
  const puedeEnviar = usePuede(PERMISOS.COTIZACIONES_ENVIAR);
  const puedeCerrar = usePuede(PERMISOS.COTIZACIONES_CERRAR);
  const puedeAnular = usePuede(PERMISOS.COTIZACIONES_ANULAR);

  const esBorrador = cotizacion.estado === 'BORRADOR';
  const esEnviada = cotizacion.estado === 'ENVIADA';
  const hayAcciones = esBorrador || esEnviada;

  async function ejecutar(accion: () => Promise<void>): Promise<void> {
    setOcupado(true);
    setError(null);
    try {
      await accion();
      setAnulando(false);
      setConfirmandoAceptar(false);
      setMotivo('');
      router.refresh();
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : MENSAJE_ERROR_RED);
    } finally {
      setOcupado(false);
    }
  }

  /** Aceptar navega a la salida recién creada: es el documento que el usuario necesita ahora. */
  async function aceptar(): Promise<void> {
    setOcupado(true);
    setError(null);
    try {
      const { salidaId } = await aceptarCotizacion(cotizacion.id);
      router.push(`/salidas/${salidaId}`);
      router.refresh();
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : MENSAJE_ERROR_RED);
      setOcupado(false);
    }
  }

  if (!hayAcciones) {
    return error ? (
      <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
        {error}
      </div>
    ) : null;
  }

  return (
    <div className="card gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        {esBorrador && puedeEditar && (
          <Link href={`/cotizaciones/${cotizacion.id}/editar`} className="btn btn-secondary">
            <PencilSimple size={16} /> Editar
          </Link>
        )}

        {esBorrador && puedeEnviar && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={ocupado}
            onClick={() => void ejecutar(() => enviarCotizacion(cotizacion.id))}
          >
            <PaperPlaneTilt size={16} /> Enviar al cliente
          </button>
        )}

        {esEnviada && puedeCerrar && (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={ocupado}
              onClick={() => setConfirmandoAceptar(true)}
            >
              <CheckCircle size={16} /> El cliente aceptó
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={ocupado}
              onClick={() => void ejecutar(() => rechazarCotizacion(cotizacion.id))}
            >
              <XCircle size={16} /> El cliente rechazó
            </button>
          </>
        )}

        {puedeAnular && !anulando && (
          <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={() => setAnulando(true)}>
            <Prohibit size={16} /> Anular
          </button>
        )}
      </div>

      {confirmandoAceptar && (
        <div className="flex flex-col gap-2" style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 12 }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            Al aceptarla se creará una <strong>salida pendiente</strong> con estas mismas líneas y
            precios. El inventario no se mueve todavía: eso ocurre cuando confirmes esa salida.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" disabled={ocupado} onClick={() => void aceptar()}>
              {ocupado ? 'Generando la salida…' : 'Aceptar y crear la salida'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={ocupado}
              onClick={() => setConfirmandoAceptar(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {anulando && (
        <div className="flex flex-col gap-2" style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 12 }}>
          <div className="field">
            <label htmlFor="motivo-anulacion">Motivo de la anulación</label>
            <textarea
              id="motivo-anulacion"
              className="input"
              rows={2}
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={ocupado || motivo.trim() === ''}
              onClick={() => void ejecutar(() => anularCotizacion(cotizacion.id, motivo))}
            >
              Confirmar anulación
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={ocupado}
              onClick={() => {
                setAnulando(false);
                setMotivo('');
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
          {error}
        </div>
      )}
    </div>
  );
}
