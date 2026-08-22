'use client';

/**
 * Interruptor que alterna claro/oscuro (US19, FR-108).
 *
 * Sustituye al antiguo `BotonTema` (2026-08-22, solicitud del dueño del sistema): mismo
 * comportamiento, control distinto. El cambio no es solo estético y por eso cambia también lo
 * que se muestra.
 *
 * ## Un botón dice A DÓNDE VAS; un interruptor dice DÓNDE ESTÁS
 *
 * El botón anterior mostraba el tema de DESTINO: estando en oscuro decía "Modo claro" y pintaba
 * un sol, porque eso era lo que iba a pasar al pulsarlo. Es lo correcto para un botón y es
 * incoherente en un interruptor, cuya posición ya comunica el estado — un interruptor apagado
 * junto a la palabra "claro" no se puede leer sin dudar.
 *
 * Así que aquí todo habla del PRESENTE: la etiqueta nombra lo que el control gobierna y no
 * cambia nunca, la posición dice si está activo y el icono acompaña al estado actual, no al
 * siguiente. Encendido = modo claro.
 *
 * ## Por qué "Modo claro" y no "Modo oscuro"
 *
 * Oscuro es el aspecto normal de LOF: es el tema por omisión y el del sistema de diseño. Claro es
 * lo que se añade — la historia se llama US19 "Modo claro" justamente por eso. Un interruptor
 * apagado por defecto que se enciende para pedir algo distinto se lee mejor que uno encendido de
 * fábrica que hay que apagar.
 *
 * ## Un `<input type="checkbox">` de verdad
 *
 * Con `role="switch"`, siguiendo el mismo idioma que `.radio` y `.seg` de Nocturne: el control
 * nativo va escondido y un hermano pinta el estado. Así el foco, la barra espaciadora y los
 * lectores de pantalla funcionan sin escribir una línea. Un `<div>` con `onClick` se vería
 * idéntico y no sería un interruptor para nadie que no use el ratón.
 *
 * ## Por qué el estado se lee en un `useEffect`
 *
 * Igual que hacía el botón, y por el mismo motivo: en el servidor no existen `localStorage` ni
 * `matchMedia`, así que calcular el tema durante el render daría un HTML distinto del que React
 * espera al hidratar. El atributo del `<html>` ya lo dejó puesto `SCRIPT_TEMA_INICIAL` antes de
 * la primera pintura (FR-108: sin destello); este componente solo lee qué dice para colocar el
 * interruptor donde corresponde.
 */
import { useEffect, useState } from 'react';
import { Moon, Sun } from '@phosphor-icons/react/dist/ssr';
import { aplicarTema, temaInicial, type Tema } from '@/lib/tema';

export function InterruptorTema(): React.JSX.Element {
  const [tema, setTema] = useState<Tema>('oscuro');

  useEffect(() => {
    setTema(temaInicial());
  }, []);

  const esClaro = tema === 'claro';

  function alternar(activado: boolean): void {
    const elegido: Tema = activado ? 'claro' : 'oscuro';
    aplicarTema(elegido);
    setTema(elegido);
  }

  return (
    <label className="switch" title="Modo claro">
      <input
        type="checkbox"
        role="switch"
        checked={esClaro}
        onChange={(evento) => alternar(evento.target.checked)}
      />
      <span className="via" aria-hidden="true" />
      {/* El icono acompaña al estado ACTUAL — sol cuando la pantalla está clara. Va oculto a los
          lectores de pantalla porque no añade nada: el `role="switch"` ya anuncia el estado, y
          repetirlo solo alargaría lo que se escucha. */}
      {esClaro ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
      <span>Modo claro</span>
    </label>
  );
}
