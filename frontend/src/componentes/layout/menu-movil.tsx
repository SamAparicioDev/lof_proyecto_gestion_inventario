'use client';

/**
 * Menú desplegable de navegación para pantallas estrechas (<=900px) — US34, FR-137/US34-AS5.
 *
 * ## Por qué reemplaza a la tira de iconos
 *
 * Hasta 2026-08-21 la barra lateral se convertía en mobile en una FILA horizontal de iconos sin
 * etiqueta, con `overflow-x: auto`. Eso se rompió del todo cuando el menú creció: un super
 * administrador ve trece enlaces, que a 375 px son unos 520 px de iconos metidos en menos de 300,
 * dentro de dos contenedores con scroll horizontal anidados que se disputan el mismo gesto. En la
 * práctica solo quedaban visibles el logotipo y la campana —que además se llevaba el ancho
 * sobrante por su `width: 100%`—, y el resto de la aplicación era inalcanzable desde un teléfono.
 *
 * Tres cosas de la tira eran malas incluso antes de desbordarse, y este menú las corrige:
 *
 * - **Iconos sin etiqueta**: un icono es un recordatorio para quien ya sabe qué hay, no una forma
 *   de descubrirlo. Aquí cada destino se lee con su nombre, igual que en escritorio.
 * - **Scroll horizontal como forma de descubrir**: nada indica que haya más a la derecha, así que
 *   lo que no se ve no existe.
 * - **Cuanto más crece el sistema, peor se ve**: cada historia nueva agravaba el problema. Un
 *   panel vertical admite el enlace número catorce sin inmutarse.
 *
 * ## Lo que se cierra, y con qué
 *
 * Al navegar, con Escape y al tocar fuera. Las tres son la misma promesa: de este panel siempre se
 * sale, incluso si el destino es la pantalla en la que ya se estaba. Al cerrarse, el foco vuelve
 * al botón que lo abrió — sin eso, quien navega con teclado queda al principio del documento.
 *
 * Ocultar enlaces aquí es UX, no control de acceso (FR-003): la lista sale de `navegacionPermitida`
 * —los mismos permisos que el sidebar de escritorio— y la autoridad son los guards del servidor.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { List, X } from '@phosphor-icons/react';
import { navegacionPermitida } from '@/lib/navegacion';
import { iniciales } from '@/lib/formato';
import { BotonCerrarSesion } from './boton-cerrar-sesion';
import { BotonTema } from './boton-tema';

export function MenuMovil({
  permisos,
  esSuperAdmin = false,
  nombreCompleto,
  nombreRol,
}: {
  permisos: string[];
  esSuperAdmin?: boolean;
  nombreCompleto: string;
  nombreRol: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const elementos = navegacionPermitida(permisos, esSuperAdmin);

  /**
   * Cerrar al cambiar de ruta.
   *
   * No basta con hacerlo en el `onClick` de cada enlace: la navegación también ocurre por el botón
   * "atrás" del teléfono, y un panel que sobrevive a eso tapa la pantalla a la que se acaba de
   * volver.
   */
  useEffect(() => {
    setAbierto(false);
  }, [pathname]);

  /** Escape y clic fuera. Se registran solo mientras está abierto: un listener global permanente
   *  correría en cada tecla de cada formulario de la aplicación. */
  useEffect(() => {
    if (!abierto) return;

    function alPulsarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        setAbierto(false);
        boton.current?.focus();
      }
    }
    function alTocarFuera(evento: MouseEvent) {
      const destino = evento.target as Node;
      if (panel.current?.contains(destino) || boton.current?.contains(destino)) return;
      setAbierto(false);
    }

    document.addEventListener('keydown', alPulsarTecla);
    document.addEventListener('mousedown', alTocarFuera);
    return () => {
      document.removeEventListener('keydown', alPulsarTecla);
      document.removeEventListener('mousedown', alTocarFuera);
    };
  }, [abierto]);

  return (
    <div id="menu-movil" className="hidden">
      <button
        ref={boton}
        type="button"
        className="btn btn-ghost"
        aria-expanded={abierto}
        aria-controls="menu-movil-panel"
        aria-label={abierto ? 'Cerrar menú' : 'Abrir menú'}
        title="Menú"
        onClick={() => setAbierto((previo) => !previo)}
      >
        {abierto ? <X size={18} /> : <List size={18} />}
      </button>

      {abierto && (
        <div
          ref={panel}
          id="menu-movil-panel"
          className="card"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 8,
            left: 8,
            zIndex: 60,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            // Un teléfono en horizontal tiene poco alto: el panel se desplaza por dentro en vez
            // de dejar los últimos enlaces fuera de alcance (mismo criterio que `.dialog`).
            maxHeight: 'min(75vh, 560px)',
            overflowY: 'auto',
          }}
        >
          <nav aria-label="Navegación principal" className="flex flex-col gap-0.5">
            {elementos.map((elemento) => {
              const activo =
                elemento.href === '/'
                  ? pathname === '/'
                  : pathname === elemento.href || pathname.startsWith(`${elemento.href}/`);
              const Icono = elemento.icono;
              return (
                <Link
                  key={elemento.href}
                  href={elemento.href}
                  aria-current={activo ? 'page' : undefined}
                  onClick={() => setAbierto(false)}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm no-underline transition-colors hover:bg-white/[0.06]"
                  style={{
                    background: activo ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent',
                    color: activo ? 'var(--color-accent-300)' : 'var(--color-text)',
                  }}
                >
                  <Icono size={18} weight="regular" />
                  <span>{elemento.etiqueta}</span>
                </Link>
              );
            })}
          </nav>

          {/* El bloque de sesión vive aquí porque `#sideuser` se oculta en este ancho. Antes solo
              sobrevivía "Cerrar sesión" (como icono suelto en la barra), así que desde un teléfono
              no había forma de llegar a los datos personales ni de cambiar el tema. */}
          <div className="mt-1 flex flex-col gap-2" style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 8 }}>
            <Link
              href="/mi-perfil"
              onClick={() => setAbierto(false)}
              className="flex items-center gap-2.5 rounded-md px-1.5 py-2 no-underline transition-colors hover:bg-white/[0.06]"
              style={{ color: 'var(--color-text)' }}
            >
              <div
                className="grid size-7.5 flex-none place-items-center rounded-full text-xs"
                style={{ background: 'var(--color-accent-800)', color: 'var(--color-accent-100)' }}
              >
                {iniciales(nombreCompleto)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px]">{nombreCompleto}</div>
                <div className="text-muted text-[11px]">{nombreRol}</div>
              </div>
            </Link>
            <BotonTema />
            <BotonCerrarSesion />
          </div>
        </div>
      )}
    </div>
  );
}
