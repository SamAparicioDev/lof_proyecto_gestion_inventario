/**
 * El logotipo de LOF en la interfaz web.
 *
 * Lo sirve el backend (`GET /api/marca/logo`, público) en vez de vivir en `frontend/public/`:
 * el mismo archivo que se incrusta en todos los exportables es el que se ve aquí, así que
 * cambiar la imagen es cambiar UN archivo (`assets/marca/logo-lof.png`) y no dos que acabarían
 * distintos. La ruta es relativa, como todo el HTTP del frontend: Next la proxya al backend.
 *
 * ## Cuando el logotipo no está, se ve "LOF" — nunca una imagen rota
 *
 * Si el despliegue no trae el archivo, el endpoint responde `404` y el navegador pintaría su
 * icono de imagen rota. Detectarlo tiene una trampa que costó un ciclo: **`onError` no basta**.
 * El `<img>` lo pinta el servidor y el navegador empieza a descargarlo de inmediato, así que
 * cuando React hidrata y engancha el manejador el error YA ocurrió — el evento se perdió y el
 * respaldo no aparecía nunca.
 *
 * Por eso hay DOS detecciones, y las dos hacen falta:
 *
 *  1. `useEffect` al montar: si la imagen ya terminó (`complete`) y no tiene píxeles
 *     (`naturalWidth === 0`), es que falló antes de que hubiera nadie escuchando.
 *  2. `onError`: para el fallo que ocurra DESPUÉS de hidratar (red lenta, caché caducada).
 *
 * Es un Client Component precisamente por eso: sin JavaScript no hay forma de saber que una
 * imagen no cargó.
 */
'use client';

import { useEffect, useRef, useState } from 'react';

interface LogoLofProps {
  /** Alto en píxeles. El ancho se ajusta solo para no deformar el logotipo. */
  alto: number;
  /** Tamaño del texto de respaldo, si la imagen no carga. */
  tamanoTextoRespaldo: number;
}

export function LogoLof({ alto, tamanoTextoRespaldo }: LogoLofProps): React.JSX.Element {
  const [falloLaCarga, setFalloLaCarga] = useState(false);
  const referencia = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const imagen = referencia.current;
    // `complete` es `true` tanto si cargó bien como si falló; lo que distingue el fallo es que
    // no haya píxeles. Ver el TSDoc de cabecera para por qué esto no lo cubre `onError`.
    if (imagen && imagen.complete && imagen.naturalWidth === 0) {
      setFalloLaCarga(true);
    }
  }, []);

  if (falloLaCarga) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: tamanoTextoRespaldo,
          color: 'var(--color-accent)',
          letterSpacing: '0.04em',
        }}
      >
        LOF
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- `next/image` optimiza rutas propias
    // o dominios declarados; esto es un binario que sirve nuestro backend por el proxy de Next,
    // y pasarlo por el optimizador solo agregaría una capa que puede fallar sobre una imagen
    // que ya viene del tamaño correcto y cacheada un día.
    <img
      ref={referencia}
      src="/api/marca/logo"
      alt="LOF Soluciones"
      style={{ height: alto, width: 'auto', display: 'block' }}
      onError={() => setFalloLaCarga(true)}
    />
  );
}
