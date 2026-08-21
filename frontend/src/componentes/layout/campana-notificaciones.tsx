'use client';

/**
 * La CAMPANA de la barra lateral (US35, FR-140/FR-144) — el acceso diario a los avisos.
 *
 * ## Por qué un panel y no solo un enlace a `/notificaciones`
 *
 * Un aviso se atiende en medio de otra cosa. Si para ver de qué se trata hay que abandonar la
 * pantalla en la que uno está —y volver después—, se deja para luego, y "luego" es cuando el
 * cliente ya llamó. El panel muestra los últimos sin moverse de sitio; la página completa está a
 * un clic para cuando de verdad se quiere revisar el historial.
 *
 * ## `position: fixed`, y es a propósito
 *
 * En pantallas ≤900px la barra lateral pasa a ser una franja horizontal con `overflow-x: auto`
 * (`globals.css`), y cualquier panel `absolute` dentro de ella queda RECORTADO por ese overflow.
 * Con `fixed` + las coordenadas reales del botón, el panel escapa del recorte en los dos layouts.
 * Por eso hay que recalcular al redimensionar y al desplazar: en móvil la barra sí se mueve.
 *
 * ## El contador se refresca solo, con moderación
 *
 * Cada 60 s y al volver a la pestaña. No hay websocket: para un almacén con ~20 personas
 * conectadas, un `count` por minuto es más barato —de escribir y de operar— que mantener una
 * conexión viva, y un aviso que llega hasta un minuto tarde sigue llegando a tiempo. Al volver a
 * la pestaña se pide de inmediato porque es justo cuando alguien mira la campana.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell } from '@phosphor-icons/react';
import type { NotificacionApi } from '@trazo/compartido';
import {
  listarNotificaciones,
  marcarNotificacionLeida,
  marcarTodasLeidas,
  resumenNotificaciones,
} from '@/lib/api/notificaciones';
import { haceCuanto, presentacionDe, rutaDeLaNotificacion } from '@/lib/notificaciones';

/** Cada cuánto se vuelve a preguntar el contador. Ver el TSDoc de arriba. */
const REFRESCO_MS = 60_000;

/** Ancho del panel en escritorio; en pantallas estrechas cede a lo que quepa (ver `situarPanel`). */
const ANCHO_PANEL = 340;

/** Cuántos avisos caben en el panel sin volverlo una segunda bandeja. El resto, en la página. */
const EN_EL_PANEL = 8;

export function CampanaNotificaciones() {
  const [noLeidas, setNoLeidas] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const [avisos, setAvisos] = useState<NotificacionApi[] | null>(null);
  const [posicion, setPosicion] = useState<{ top: number; left: number } | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const refrescarContador = useCallback(async () => {
    try {
      const { noLeidas: cuantas } = await resumenNotificaciones();
      setNoLeidas(cuantas);
    } catch {
      // Silencio a propósito: el contador es accesorio y su fallo no debe pintar un error
      // encima de lo que la persona esté haciendo. La próxima vuelta lo vuelve a intentar.
    }
  }, []);

  useEffect(() => {
    void refrescarContador();
    const reloj = setInterval(() => void refrescarContador(), REFRESCO_MS);
    const alVolver = () => {
      if (document.visibilityState === 'visible') void refrescarContador();
    };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    return () => {
      clearInterval(reloj);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
    };
  }, [refrescarContador]);

  // Navegar cierra el panel: si no, queda flotando sobre la pantalla nueva.
  useEffect(() => setAbierto(false), [pathname]);

  const situarPanel = useCallback(() => {
    const marco = boton.current?.getBoundingClientRect();
    if (!marco) return;
    const ancho = Math.min(ANCHO_PANEL, window.innerWidth - 16);
    // Se abre a la derecha del botón; si no cabe (barra horizontal en móvil), se pega al borde.
    const left = Math.min(Math.max(8, marco.right + 8), window.innerWidth - ancho - 8);
    setPosicion({ top: Math.min(marco.top, window.innerHeight - 120), left });
  }, []);

  useEffect(() => {
    if (!abierto) return;
    situarPanel();
    const alMover = () => situarPanel();
    window.addEventListener('resize', alMover);
    window.addEventListener('scroll', alMover, true);

    const alPulsarFuera = (evento: MouseEvent) => {
      const destino = evento.target as Node;
      if (!panel.current?.contains(destino) && !boton.current?.contains(destino)) setAbierto(false);
    };
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('mousedown', alPulsarFuera);
    document.addEventListener('keydown', alTeclear);
    return () => {
      window.removeEventListener('resize', alMover);
      window.removeEventListener('scroll', alMover, true);
      document.removeEventListener('mousedown', alPulsarFuera);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto, situarPanel]);

  async function alternar(): Promise<void> {
    if (abierto) {
      setAbierto(false);
      return;
    }
    setAbierto(true);
    setAvisos(null);
    try {
      const bandeja = await listarNotificaciones({ porPagina: EN_EL_PANEL });
      setAvisos(bandeja.datos);
      setNoLeidas(bandeja.noLeidas);
    } catch {
      setAvisos([]);
    }
  }

  /**
   * Abrir un aviso hace las dos cosas que se esperan: marcarlo leído y llevar a su origen.
   *
   * El contador baja ANTES de que el servidor conteste (optimista) porque el usuario ya está
   * navegando: esperar la respuesta dejaría el número viejo durante la transición, y volver a
   * subirlo si fallara sería peor — el aviso ya se leyó, que es lo que el número cuenta.
   */
  async function abrir(aviso: NotificacionApi): Promise<void> {
    setAbierto(false);
    if (!aviso.leida) {
      setNoLeidas((previas) => Math.max(0, previas - 1));
      void marcarNotificacionLeida(aviso.id).catch(() => undefined);
    }
    router.push(rutaDeLaNotificacion(aviso));
  }

  async function leerTodas(): Promise<void> {
    setNoLeidas(0);
    setAvisos((previos) => previos?.map((aviso) => ({ ...aviso, leida: true })) ?? null);
    try {
      await marcarTodasLeidas();
    } catch {
      void refrescarContador();
    }
  }

  return (
    <>
      <button
        ref={boton}
        type="button"
        className="btn btn-ghost"
        aria-expanded={abierto}
        aria-haspopup="dialog"
        aria-label={noLeidas > 0 ? `Avisos: ${noLeidas} sin leer` : 'Avisos'}
        title="Avisos"
        onClick={() => void alternar()}
        style={{ position: 'relative', justifyContent: 'flex-start', gap: 10, width: '100%' }}
      >
        <Bell size={17} />
        <span className="nav-label">Avisos</span>
        {noLeidas > 0 && (
          <span
            aria-hidden="true"
            style={{
              marginLeft: 'auto',
              minWidth: 20,
              borderRadius: 999,
              padding: '1px 6px',
              fontSize: 11,
              lineHeight: '16px',
              textAlign: 'center',
              background: 'var(--color-accent)',
              color: 'var(--color-accent-100, #fff)',
            }}
          >
            {noLeidas > 99 ? '99+' : noLeidas}
          </span>
        )}
      </button>

      {abierto && posicion && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Avisos recientes"
          className="card"
          style={{
            position: 'fixed',
            top: posicion.top,
            left: posicion.left,
            // El ancho también se acota a la ventana, no solo la posición: en un teléfono muy
            // estrecho el tope inferior del clamp gana y un panel de ancho fijo se saldría.
            width: `min(${ANCHO_PANEL}px, calc(100vw - 16px))`,
            maxHeight: 'min(70vh, 520px)',
            overflowY: 'auto',
            zIndex: 60,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <strong style={{ fontSize: 14 }}>Avisos</strong>
            {noLeidas > 0 && (
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => void leerTodas()}>
                Marcar todas como leídas
              </button>
            )}
          </div>

          {avisos === null && (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              Cargando…
            </p>
          )}

          {avisos?.length === 0 && (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              No tienes avisos. Aquí aparecerán las entradas de mercancía, las salidas por aprobar y
              los productos que se estén acabando.
            </p>
          )}

          {avisos?.map((aviso) => (
            <FilaAviso key={aviso.id} aviso={aviso} alAbrir={() => void abrir(aviso)} />
          ))}

          <Link href="/notificaciones" style={{ fontSize: 12, marginTop: 4 }} onClick={() => setAbierto(false)}>
            Ver todos los avisos
          </Link>
        </div>
      )}
    </>
  );
}

/** Una fila del panel. Es un `button` y no un `Link` porque abrir también MARCA como leído: es
 *  una acción, no solo una navegación (la navegación la hace `abrir`). */
function FilaAviso({ aviso, alAbrir }: { aviso: NotificacionApi; alAbrir: () => void }) {
  const { icono: Icono, acento } = presentacionDe(aviso.tipo);
  return (
    <button
      type="button"
      onClick={alAbrir}
      className="flex w-full items-start gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-white/[0.06]"
      style={{
        border: 'none',
        background: aviso.leida ? 'transparent' : 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
        color: 'var(--color-text)',
        cursor: 'pointer',
      }}
    >
      <Icono size={16} weight="regular" style={{ color: acento, flex: 'none', marginTop: 2 }} />
      <span className="min-w-0 flex-1">
        <span style={{ display: 'block', fontSize: 13, fontWeight: aviso.leida ? 400 : 600 }}>{aviso.titulo}</span>
        {aviso.detalle && (
          <span className="text-muted" style={{ display: 'block', fontSize: 12 }}>
            {aviso.detalle}
          </span>
        )}
        <span className="text-muted" style={{ display: 'block', fontSize: 11 }}>
          {haceCuanto(aviso.creadaEn)}
        </span>
      </span>
    </button>
  );
}
