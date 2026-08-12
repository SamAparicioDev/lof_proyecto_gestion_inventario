'use client';

/**
 * Botón "Cerrar sesión" de la barra lateral (T025) — antes vivía en `BarraSuperior`; el
 * diseño de Nocturne (`Trazo Inventarios.dc.html`) lo mueve al bloque de usuario, al final
 * del sidebar (`#sideuser`). Necesita interactividad (el click) → Client Component.
 *
 * `soloIcono` (auditoría de responsividad, 2026-08-11): en mobile/tablet (<=900px) todo
 * `#sideuser` se oculta por espacio (`globals.css`) y con él se perdía la ÚNICA forma de
 * cerrar sesión en esos anchos — hallazgo real, no cosmético. `(app)/layout.tsx` renderiza
 * una segunda instancia de este botón con `soloIcono` fuera de `#sideuser`, visible solo en
 * ese breakpoint vía `#cerrar-sesion-movil`. Mismo componente/lógica, sin duplicar el
 * manejador de logout — solo cambia lo que se pinta (`.btn-icon` de Nocturne en vez de
 * texto, con `aria-label` porque no queda texto visible que lo describa).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SignOut } from '@phosphor-icons/react/dist/ssr';
import { cerrarSesion } from '@/lib/api/auth';

export function BotonCerrarSesion({ soloIcono = false }: { soloIcono?: boolean }) {
  const router = useRouter();
  const [cerrando, setCerrando] = useState(false);

  async function manejarCerrarSesion(): Promise<void> {
    setCerrando(true);
    try {
      await cerrarSesion();
    } finally {
      // Si POST /api/auth/logout falla por red, igual navegamos a /login: no hay forma
      // de operar la app sin sesión y el middleware (T022) volvería a rebotar aquí de
      // cualquier forma en la próxima petición.
      router.push('/login');
      router.refresh();
    }
  }

  const etiqueta = cerrando ? 'Cerrando sesión…' : 'Cerrar sesión';

  if (soloIcono) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={manejarCerrarSesion}
        disabled={cerrando}
        aria-label={etiqueta}
        title={etiqueta}
      >
        <SignOut size={16} />
      </button>
    );
  }

  return (
    <button
      type="button"
      // `text-[13px]` estaba aquí y era una clase MUERTA: `.btn` (Nocturne) declara
      // `font-size:14px` sin capa CSS, así que la utilidad nunca se aplicó (medido en el
      // navegador: `getComputedStyle(boton).fontSize === '14px'` con y sin ella). Se quitó en la
      // verificación de la Tanda 12 por el mismo criterio con el que T110 limpió
      // `alerta-stock-bajo.tsx`: una clase que no hace nada engaña al siguiente que lea el
      // archivo. Quitarla no cambia un pixel; si algún día el botón debe ser de 13px de verdad,
      // va en el `style` inline de abajo, no como utilidad (ver docs/diseno-nocturne.md § cascada).
      className="btn btn-ghost"
      // `justifyContent` va inline y NO como la utilidad `justify-start` de Tailwind: `.btn`
      // (Nocturne) declara `justify-content:center` SIN capa CSS y por eso gana siempre sobre
      // `@layer utilities`, así que la utilidad no hacía nada y el texto quedaba centrado
      // mientras los enlaces de navegación de arriba van alineados a la izquierda (bug real
      // encontrado barriendo esta misma cascada en T110). Este botón ocupa el ancho del
      // sidebar a propósito (hover de ancho completo, igual que los enlaces de `#navlist`),
      // así que la propiedad tiene que ir en ESTE elemento: no hay un contenedor interno al
      // que moverla, y el estilo inline es la única forma correcta de ganar sin `!important`
      // (ver docs/diseno-nocturne.md § cascada).
      style={{ justifyContent: 'flex-start' }}
      onClick={manejarCerrarSesion}
      disabled={cerrando}
    >
      <SignOut size={16} />
      {etiqueta}
    </button>
  );
}
