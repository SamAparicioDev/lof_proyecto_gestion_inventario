'use client';

/**
 * Las filas de `/notificaciones` (US35, FR-140/FR-144).
 *
 * Client Component pequeño dentro de una página de servidor, por una sola razón: abrir un aviso
 * hace DOS cosas —marcarlo leído y navegar a su origen—, y la primera es una llamada a la API.
 * Todo lo demás de la pantalla (traer la página, el filtro, la paginación) se resuelve en el
 * servidor con enlaces, igual que el resto de los listados del sistema.
 *
 * El estado local existe para que la fila se vea leída al instante. Sin él, marcar y navegar
 * dejaría la lista igual que antes durante toda la transición, y quien vuelve atrás encontraría
 * su aviso todavía resaltado — parecería que no se guardó.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificacionApi } from '@trazo/compartido';
import { marcarNotificacionLeida, marcarTodasLeidas } from '@/lib/api/notificaciones';
import { haceCuanto, presentacionDe, rutaDeLaNotificacion } from '@/lib/notificaciones';

export function ListaNotificaciones({ avisos }: { avisos: NotificacionApi[] }) {
  const [leidas, setLeidas] = useState<Set<number>>(new Set());
  const router = useRouter();

  function abrir(aviso: NotificacionApi): void {
    if (!aviso.leida && !leidas.has(aviso.id)) {
      setLeidas((previas) => new Set(previas).add(aviso.id));
      void marcarNotificacionLeida(aviso.id).catch(() => undefined);
    }
    router.push(rutaDeLaNotificacion(aviso));
  }

  return (
    <div className="flex flex-col gap-1">
      {avisos.map((aviso) => {
        const leida = aviso.leida || leidas.has(aviso.id);
        const { icono: Icono, acento } = presentacionDe(aviso.tipo);
        return (
          <button
            key={aviso.id}
            type="button"
            onClick={() => abrir(aviso)}
            className="flex w-full items-start gap-3 rounded-md p-3 text-left transition-colors hover:bg-white/[0.06]"
            style={{
              border: '1px solid var(--color-divider)',
              background: leida ? 'transparent' : 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
              color: 'var(--color-text)',
              cursor: 'pointer',
            }}
          >
            <Icono size={18} weight="regular" style={{ color: acento, flex: 'none', marginTop: 2 }} />
            <span className="min-w-0 flex-1">
              <span style={{ display: 'block', fontSize: 14, fontWeight: leida ? 400 : 600 }}>{aviso.titulo}</span>
              {aviso.detalle && (
                <span className="text-muted" style={{ display: 'block', fontSize: 13 }}>
                  {aviso.detalle}
                </span>
              )}
            </span>
            <span className="text-muted" style={{ fontSize: 12, flex: 'none' }}>
              {haceCuanto(aviso.creadaEn)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Marcar todas como leídas". Vive aquí y no en la página porque necesita refrescar los datos
 * del servidor después (`router.refresh()`), que es lo que devuelve la lista ya sin resaltados
 * y el contador de la campana a cero — sin recargar la pantalla entera.
 */
export function BotonLeerTodas({ deshabilitado }: { deshabilitado: boolean }) {
  const [ocupado, setOcupado] = useState(false);
  const router = useRouter();

  async function ejecutar(): Promise<void> {
    setOcupado(true);
    try {
      await marcarTodasLeidas();
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-secondary"
      disabled={deshabilitado || ocupado}
      onClick={() => void ejecutar()}
    >
      {ocupado ? 'Marcando…' : 'Marcar todas como leídas'}
    </button>
  );
}
