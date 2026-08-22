'use client';

/**
 * Botón "Cerrar sesión" de la barra lateral (T025) — antes vivía en `BarraSuperior`; el
 * diseño de Nocturne (`Trazo Inventarios.dc.html`) lo mueve al bloque de usuario, al final
 * del sidebar (`#sideuser`). Necesita interactividad (el click) → Client Component.
 *
 * Tuvo una variante `soloIcono` entre 2026-08-11 y 2026-08-21: con `#sideuser` oculto en
 * mobile, era la única forma de cerrar sesión en esos anchos. Se retiró con `MenuMovil`
 * (US34/T283), que da cabida al bloque de sesión ENTERO —perfil, tema y cierre— dentro del
 * panel desplegable. Una variante que ya no renderiza nadie es una rama que el siguiente que
 * lea el archivo tiene que descartar a mano (Principio V).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SignOut } from '@phosphor-icons/react/dist/ssr';
import { cerrarSesion } from '@/lib/api/auth';

export function BotonCerrarSesion() {
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
