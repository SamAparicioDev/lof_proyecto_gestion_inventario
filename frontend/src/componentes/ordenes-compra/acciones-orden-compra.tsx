'use client';

/**
 * Acciones de una orden de compra según su estado y los permisos de la sesión (US16, T175).
 *
 * Qué se ofrece y cuándo (FR-096/FR-099/FR-100):
 *
 * | Estado | Acciones |
 * |---|---|
 * | BORRADOR | Enviar al proveedor (`ordenes_compra.enviar`) · Anular (`ordenes_compra.anular`) |
 * | ENVIADA | **Registrar ingreso** · Anular |
 * | RECIBIDA / ANULADA | ninguna: son terminales |
 *
 * "Registrar ingreso" no crea nada: lleva a `/ingresos/nuevo?ordenCompraId=N`, donde el usuario
 * completa lo único que la orden no puede saber —el número y la fecha de la factura— y guarda.
 * Ese ingreso queda vinculado, y al recibirlo la orden pasa a RECIBIDA sola (FR-099).
 *
 * Los permisos se leen con `usePuede()` del contexto de sesión (T108). Ocultar un botón es UX:
 * la autoridad son los guards del backend (FR-003).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PaperPlaneTilt, Prohibit, ArrowSquareIn } from '@phosphor-icons/react/dist/ssr';
import type { OrdenCompra } from '@trazo/compartido';
import { anularOrdenCompra, enviarOrdenCompra } from '@/lib/api/ordenes-compra';
import { ErrorApi } from '@/lib/api/cliente';
import { usePuede } from '@/lib/sesion';
import { PERMISOS } from '@/lib/permisos';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

export function AccionesOrdenCompra({ orden }: { orden: OrdenCompra }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const puedeEnviar = usePuede(PERMISOS.ORDENES_COMPRA_ENVIAR);
  const puedeAnular = usePuede(PERMISOS.ORDENES_COMPRA_ANULAR);

  const esBorrador = orden.estado === 'BORRADOR';
  const esEnviada = orden.estado === 'ENVIADA';
  const anulable = esBorrador || esEnviada;

  async function ejecutar(accion: () => Promise<void>): Promise<void> {
    setOcupado(true);
    setError(null);
    try {
      await accion();
      setAnulando(false);
      setMotivo('');
      router.refresh();
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : MENSAJE_ERROR_RED);
    } finally {
      setOcupado(false);
    }
  }

  if (!anulable) {
    return error ? (
      <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
        {error}
      </div>
    ) : null;
  }

  return (
    <div className="card gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        {esBorrador && puedeEnviar && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={ocupado}
            onClick={() => void ejecutar(() => enviarOrdenCompra(orden.id))}
          >
            <PaperPlaneTilt size={16} /> Marcar como enviada
          </button>
        )}

        {esEnviada && (
          <Link href={`/ingresos/nuevo?ordenCompraId=${orden.id}`} className="btn btn-primary">
            <ArrowSquareIn size={16} /> Registrar ingreso
          </Link>
        )}

        {puedeAnular && !anulando && (
          <button type="button" className="btn btn-secondary" disabled={ocupado} onClick={() => setAnulando(true)}>
            <Prohibit size={16} /> Anular orden
          </button>
        )}
      </div>

      {esBorrador && (
        <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
          Mientras sea un borrador puedes seguir editándola. Al marcarla como enviada dejará de
          ser editable: el proveedor ya tendría el pedido en la mano.
        </p>
      )}

      {anulando && (
        <div className="flex flex-col gap-2">
          <div className="field">
            <label htmlFor="motivo-anulacion">Motivo de la anulación</label>
            <input
              id="motivo-anulacion"
              className="input"
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              placeholder="Por qué no se va a atender este pedido"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={ocupado || motivo.trim() === ''}
              onClick={() => void ejecutar(() => anularOrdenCompra(orden.id, motivo))}
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
