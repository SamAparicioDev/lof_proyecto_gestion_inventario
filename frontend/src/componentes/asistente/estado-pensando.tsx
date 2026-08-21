'use client';

/**
 * Lo que se ve mientras el asistente trabaja (US33).
 *
 * ## Por qué no es un "Cargando…" fijo
 *
 * Una consulta tarda entre cinco y treinta segundos: el modelo razona, pide datos, los lee y
 * redacta. Con una etiqueta inmóvil todo ese rato, la pantalla parece congelada y la gente
 * recarga — perdiendo la conversación y disparando otra consulta que también cuesta.
 *
 * ## Las etapas avanzan; no rotan al azar
 *
 * El texto sigue el orden real del trabajo (pensar → consultar → contrastar → redactar) y NO
 * vuelve atrás. Eso importa: un indicador que va y viene entre palabras sueltas se lee como
 * decoración, y a los diez segundos deja de mirarse. Uno que avanza dice "esto sigue moviéndose".
 *
 * Lo que NO se hace es fingir precisión. El servidor resuelve la consulta en UNA petición y no
 * informa de su progreso, así que estos tiempos son una aproximación honesta de las etapas que
 * ocurren, no un reflejo de en cuál está. Por eso las etiquetas son generales —"Consultando los
 * datos"— y nunca dicen algo comprobablemente falso como "Leyendo el inventario" cuando podría
 * estar mirando clientes.
 *
 * La última etapa se queda fija en vez de saltar a un mensaje de error: mientras la petición siga
 * viva, la respuesta puede llegar.
 */
import { useEffect, useState } from 'react';

/** Etapa: desde qué segundo se muestra y qué dice. En orden, sin vuelta atrás. */
const ETAPAS: readonly { desdeSegundos: number; texto: string }[] = [
  { desdeSegundos: 0, texto: 'Pensando' },
  { desdeSegundos: 4, texto: 'Consultando los datos' },
  { desdeSegundos: 10, texto: 'Contrastando las cifras' },
  { desdeSegundos: 18, texto: 'Redactando la respuesta' },
  { desdeSegundos: 30, texto: 'La consulta es larga, sigo en ello' },
];

export function EstadoPensando() {
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    const reloj = setInterval(() => setSegundos((previos) => previos + 1), 1000);
    return () => clearInterval(reloj);
  }, []);

  const etapa = [...ETAPAS].reverse().find((candidata) => segundos >= candidata.desdeSegundos) ?? ETAPAS[0];

  return (
    <p className="text-muted" style={{ fontSize: 14, margin: 0 }}>
      {/* Un solo anuncio estable para lectores de pantalla: leerles cada cambio de etiqueta cada
          pocos segundos convierte una espera en una interrupción constante. */}
      <span className="sr-only" role="status">
        Consultando, espera un momento.
      </span>
      <span aria-hidden="true">
        {etapa?.texto}
        <Puntos />
      </span>
    </p>
  );
}

/** Tres puntos que aparecen de uno en uno — la señal de que algo sigue vivo entre etapa y etapa,
 *  que pueden ser ocho segundos de silencio. */
function Puntos() {
  const [cuantos, setCuantos] = useState(1);

  useEffect(() => {
    const reloj = setInterval(() => setCuantos((previos) => (previos % 3) + 1), 450);
    return () => clearInterval(reloj);
  }, []);

  // Ancho fijo para que el texto de al lado no se mueva al cambiar el número de puntos.
  return <span style={{ display: 'inline-block', width: '1.4em' }}>{'.'.repeat(cuantos)}</span>;
}
