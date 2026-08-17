'use client';

/**
 * Botón que alterna claro/oscuro (US19, FR-108).
 *
 * Vive en el shell autenticado y en `/login`, que son los dos sitios desde los que se ve la
 * aplicación entera. Muestra el icono del tema al que se va a cambiar, no el actual: un sol
 * significa "pasar a claro", que es lo que el usuario está a punto de hacer.
 *
 * El estado inicial se lee en un `useEffect`, no en el `useState`, y el motivo es la
 * hidratación: en el servidor no existen `localStorage` ni `matchMedia`, así que calcular el
 * tema durante el render daría un HTML distinto del que React espera en el cliente. El atributo
 * del `<html>` ya lo dejó puesto `SCRIPT_TEMA_INICIAL` antes de la primera pintura; este
 * componente solo necesita saber qué dice para pintar el icono correcto.
 */
import { useEffect, useState } from 'react';
import { Moon, Sun } from '@phosphor-icons/react/dist/ssr';
import { aplicarTema, temaInicial, type Tema } from '@/lib/tema';

interface BotonTemaProps {
  /** En la barra lateral estrecha el botón va sin texto; en `/login` acompaña con etiqueta. */
  soloIcono?: boolean;
}

export function BotonTema({ soloIcono = false }: BotonTemaProps): React.JSX.Element {
  const [tema, setTema] = useState<Tema>('oscuro');

  useEffect(() => {
    setTema(temaInicial());
  }, []);

  const siguiente: Tema = tema === 'oscuro' ? 'claro' : 'oscuro';
  const etiqueta = siguiente === 'claro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';

  function alternar(): void {
    aplicarTema(siguiente);
    setTema(siguiente);
  }

  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={alternar}
      title={etiqueta}
      aria-label={etiqueta}
    >
      {siguiente === 'claro' ? <Sun size={16} /> : <Moon size={16} />}
      {!soloIcono && <span>{siguiente === 'claro' ? 'Modo claro' : 'Modo oscuro'}</span>}
    </button>
  );
}
