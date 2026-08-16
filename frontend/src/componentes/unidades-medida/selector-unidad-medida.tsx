'use client';

/**
 * Selector de unidad de medida (US17, FR-102).
 *
 * Se trae el catálogo él mismo, igual que `SelectorCategoria` y `SelectorProveedor` y por el
 * mismo motivo: el campo aparece en el alta rápida desde ingresos, en el alta desde inventario y
 * en la edición de la ficha, y pasarlo por props obligaría a tres páginas —dos de ellas Server
 * Components— a cargarlo y encadenarlo.
 *
 * Dos diferencias con el de categorías, las dos de la historia:
 *
 *  - **No hay opción vacía**: la unidad es OBLIGATORIA desde US17. El texto inicial es una
 *    opción deshabilitada, no un valor elegible.
 *  - **Un fallo de carga SÍ se muestra**: sin catálogo no se puede guardar el producto, así que
 *    callarlo dejaría al usuario ante un desplegable vacío sin saber por qué (en categorías se
 *    puede callar porque el campo es opcional).
 *
 * Solo ofrece unidades ACTIVAS, con la excepción necesaria: si el producto que se edita ya usa
 * una desactivada, esa se añade a la lista. Sin eso, abrir la ficha de un producto viejo
 * mostraría el campo vacío y guardarlo obligaría a cambiarle la unidad sin quererlo.
 */
import { useEffect, useState } from 'react';
import { ErrorApi } from '@/lib/api/cliente';
import { listarUnidadesMedida, type UnidadMedidaListada } from '@/lib/api/unidades-medida';

const MENSAJE_ERROR_RED = 'No fue posible cargar las unidades de medida. Revisa tu conexión e intenta de nuevo.';

interface SelectorUnidadMedidaProps {
  id: string;
  /** Id seleccionado; `0`/`undefined` mientras no se ha elegido ninguna. */
  value: number | undefined;
  onChange: (unidadMedidaId: number) => void;
  /** Unidad que el producto ya tiene, para conservarla aunque esté inactiva (ver TSDoc). */
  unidadActual?: { id: number; nombre: string; abreviatura: string } | null;
  disabled?: boolean;
  ariaInvalid?: boolean;
}

export function SelectorUnidadMedida({
  id,
  value,
  onChange,
  unidadActual,
  disabled,
  ariaInvalid,
}: SelectorUnidadMedidaProps): React.JSX.Element {
  const [unidades, setUnidades] = useState<UnidadMedidaListada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    listarUnidadesMedida({ estado: 'ACTIVA' })
      .then((lista) => {
        if (vigente) setUnidades(lista);
      })
      .catch((fallo: unknown) => {
        if (vigente) setError(fallo instanceof ErrorApi ? fallo.mensaje : MENSAJE_ERROR_RED);
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, []);

  const opciones = [...unidades];
  if (unidadActual && !opciones.some((unidad) => unidad.id === unidadActual.id)) {
    opciones.unshift({ ...unidadActual, estado: 'INACTIVA', cantidadProductos: 0 });
  }

  return (
    <>
      <select
        id={id}
        className="input"
        aria-invalid={ariaInvalid}
        disabled={disabled || cargando}
        value={value && value > 0 ? value : ''}
        onChange={(evento) => onChange(Number(evento.target.value))}
      >
        <option value="" disabled>
          {cargando ? 'Cargando unidades…' : 'Selecciona una unidad…'}
        </option>
        {opciones.map((unidad) => (
          <option key={unidad.id} value={unidad.id}>
            {unidad.nombre} ({unidad.abreviatura}){unidad.estado === 'INACTIVA' ? ' — inactiva' : ''}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          {error}
        </p>
      )}
      {!cargando && !error && opciones.length === 0 && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          No hay unidades de medida activas. Crea una en Administración → Unidades de medida.
        </p>
      )}
    </>
  );
}
