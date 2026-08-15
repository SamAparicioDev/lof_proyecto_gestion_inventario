/**
 * El logotipo de LOF en la interfaz web.
 *
 * Lo sirve el backend (`GET /api/marca/logo`, público) en vez de vivir en `frontend/public/`:
 * el mismo archivo que se incrusta en todos los exportables es el que se ve aquí, así que
 * cambiar la imagen es cambiar UN archivo (`assets/marca/logo-lof.png`) y no dos que acabarían
 * distintos. La ruta es relativa, como todo el HTTP del frontend: Next la proxya al backend.
 *
 * **Si el logotipo no está** (despliegue sin el archivo → `404`), el `<img>` falla y el
 * navegador mostraría su icono de imagen rota. Por eso el componente cambia a un respaldo de
 * TEXTO con el nombre: la pantalla de inicio de sesión y la barra lateral siguen teniendo
 * identidad, en vez de un cuadro vacío (FR-068, mismo criterio que los exportables).
 *
 * Es un Client Component solo por ese `onError`: es la única forma de enterarse de que la
 * imagen no cargó.
 */
'use client';

import { useState } from 'react';

interface LogoLofProps {
  /** Alto en píxeles. El ancho se ajusta solo para no deformar el logotipo. */
  alto: number;
  /** Tamaño del texto de respaldo, si la imagen no carga. */
  tamanoTextoRespaldo: number;
}

export function LogoLof({ alto, tamanoTextoRespaldo }: LogoLofProps): React.JSX.Element {
  const [falloLaCarga, setFalloLaCarga] = useState(false);

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
      src="/api/marca/logo"
      alt="LOF Soluciones"
      style={{ height: alto, width: 'auto', display: 'block' }}
      onError={() => setFalloLaCarga(true)}
    />
  );
}
