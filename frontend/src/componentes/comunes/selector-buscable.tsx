'use client';

/**
 * `SelectorBuscable` — lista escribible con filtrado en vivo (US23, FR-119).
 *
 * Sustituye al `<select>` nativo en toda lista que pueda crecer. Con un catálogo de cientos de
 * productos, un `<select>` obliga a recorrer la lista a ojo: no se puede escribir, no se puede
 * filtrar, y el teclado solo salta a la siguiente opción que empiece por la letra pulsada. Este
 * componente permite teclear y va reduciendo las opciones con el MISMO criterio que el buscador
 * de los listados (`coincideConTerminos` de `@trazo/compartido`): varios términos, en cualquier
 * orden, sobre todos los textos de la opción, y aquí además sin importar las tildes.
 *
 * ## Por qué no es un `<select>` con truco ni una librería
 *
 * `docs/diseno-nocturne.md` no documenta un combobox —los formularios llevaban meses anotándolo
 * como carencia—, así que se construye con los tokens y las clases del sistema (`.input`,
 * `.card`, `--color-*`), no con una capa visual paralela. Y se implementa a mano en vez de
 * traer una dependencia porque lo que hace falta es exactamente esto: un `input`, una lista
 * filtrada y las teclas. Una librería de combobox traería un modelo de estilos propio que
 * habría que domar para que se pareciera a Nocturne.
 *
 * ## Accesibilidad
 *
 * Sigue el patrón ARIA de combobox: el `input` declara `role="combobox"`, `aria-expanded` y
 * `aria-activedescendant` apuntando a la opción resaltada; la lista es un `role="listbox"` con
 * `role="option"` y `aria-selected`. Eso es lo que hace que un lector de pantalla anuncie
 * "cuántas opciones quedan" al escribir, que es justo el valor del componente.
 *
 * Teclado: ↑/↓ recorren, Enter elige la resaltada, Esc cierra sin cambiar nada, Tab sale. Con la
 * lista cerrada, ↓ la abre. Es lo que hace cualquier buscador de la web y lo que el usuario ya
 * tiene en los dedos.
 *
 * ## La lista se pinta en un PORTAL, y no es un capricho
 *
 * Estos selectores viven dentro de la tabla de líneas, que tiene `overflow-x: auto` para poder
 * desplazarse en pantallas angostas. Un desplegable en `position: absolute` dentro de ese
 * contenedor queda RECORTADO por él: se ve una franja de la primera opción y nada más — probado
 * y confirmado en el navegador antes de escribir esto. Sacarlo a `document.body` con
 * `position: fixed`, anclado a las coordenadas del campo, es la forma habitual de resolverlo sin
 * quitarle el scroll a la tabla (que es lo que hace usable el formulario en un móvil).
 *
 * Las coordenadas se recalculan al abrir y en cada scroll o cambio de tamaño: si no, bastaría
 * con desplazar la página para que la lista se quedara flotando lejos de su campo.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, X } from '@phosphor-icons/react/dist/ssr';
import { coincideConTerminos } from '@trazo/compartido';

/** Una opción de la lista. `textosBuscables` son todos los campos por los que debe encontrarse. */
export interface OpcionBuscable {
  /** Valor que se guarda. `0` se reserva para "ninguna" en los formularios del proyecto. */
  valor: number;
  /** Lo que se lee en la lista y en el campo una vez elegida. */
  etiqueta: string;
  /**
   * Textos adicionales por los que la opción debe encontrarse aunque no se muestren enteros —
   * la ubicación de un producto, la ciudad de un cliente. La etiqueta ya se busca siempre.
   */
  textosBuscables?: (string | null | undefined)[];
  /** Segunda línea de la opción: el dato que ayuda a decidir entre dos parecidas. */
  detalle?: string;
}

interface SelectorBuscableProps {
  id: string;
  opciones: readonly OpcionBuscable[];
  /** Valor actual; `0`/`undefined` mientras no se ha elegido. */
  value: number | undefined;
  onChange: (valor: number) => void;
  /** Texto del campo vacío. */
  placeholder?: string;
  /** Etiqueta accesible cuando el campo no tiene un `<label>` propio (celdas de tabla). */
  ariaLabel?: string;
  disabled?: boolean;
  ariaInvalid?: boolean;
  /** Texto del elemento que deja el campo sin elegir. Ausente = no se ofrece (campo obligatorio). */
  etiquetaVacia?: string;
}

/** Cuántas opciones se pintan como mucho. Con un catálogo de miles, dibujarlas todas cuelga el
 *  navegador y no ayuda: quien ve 50 resultados escribe una palabra más, no baja 3.000 filas. */
const MAXIMO_VISIBLES = 50;

export function SelectorBuscable({
  id,
  opciones,
  value,
  onChange,
  placeholder = 'Escribe para buscar…',
  ariaLabel,
  disabled,
  ariaInvalid,
  etiquetaVacia,
}: SelectorBuscableProps): React.JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState('');
  const [resaltada, setResaltada] = useState(0);
  const contenedor = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const [posicion, setPosicion] = useState<{ arriba: number; izquierda: number; ancho: number } | null>(null);
  const idLista = useId();

  /** Ancla la lista al campo. `getBoundingClientRect` da coordenadas de viewport, que es
   *  justo lo que `position: fixed` necesita. */
  const recalcularPosicion = useCallback(() => {
    const rect = campo.current?.getBoundingClientRect();
    if (!rect) return;
    setPosicion({ arriba: rect.bottom + 4, izquierda: rect.left, ancho: rect.width });
  }, []);

  const seleccionada = opciones.find((opcion) => opcion.valor === value && opcion.valor !== 0);

  const filtradas = useMemo(() => {
    const coincidentes = opciones.filter((opcion) =>
      coincideConTerminos([opcion.etiqueta, opcion.detalle, ...(opcion.textosBuscables ?? [])], consulta),
    );
    return coincidentes.slice(0, MAXIMO_VISIBLES);
  }, [opciones, consulta]);

  const totalCoincidencias = useMemo(
    () =>
      opciones.filter((opcion) =>
        coincideConTerminos([opcion.etiqueta, opcion.detalle, ...(opcion.textosBuscables ?? [])], consulta),
      ).length,
    [opciones, consulta],
  );

  // Mantiene la lista pegada a su campo mientras se desplaza o se cambia el tamaño. `true` en
  // el tercer argumento para capturar TAMBIÉN el scroll de contenedores internos (la tabla).
  useLayoutEffect(() => {
    if (!abierto) return;
    recalcularPosicion();
    window.addEventListener('scroll', recalcularPosicion, true);
    window.addEventListener('resize', recalcularPosicion);
    return () => {
      window.removeEventListener('scroll', recalcularPosicion, true);
      window.removeEventListener('resize', recalcularPosicion);
    };
  }, [abierto, recalcularPosicion]);

  // Cierra al hacer clic fuera. Sin esto, abrir un selector y pulsar en otro sitio de la página
  // dejaría la lista flotando sobre el contenido.
  useEffect(() => {
    if (!abierto) return;
    function alPulsarFuera(evento: MouseEvent): void {
      const objetivo = evento.target as Node;
      // La lista vive en un portal, fuera de `contenedor`: hay que preguntarle también a ella o
      // el propio clic en una opción cerraría el desplegable antes de elegirla.
      const dentroDeLista = document.getElementById(idLista)?.contains(objetivo);
      if (!contenedor.current?.contains(objetivo) && !dentroDeLista) cerrar();
    }
    document.addEventListener('mousedown', alPulsarFuera);
    return () => document.removeEventListener('mousedown', alPulsarFuera);
  });

  function abrir(): void {
    if (disabled) return;
    setAbierto(true);
    setResaltada(0);
  }

  /** Cierra y descarta lo tecleado: el campo vuelve a mostrar lo que hay elegido de verdad. */
  function cerrar(): void {
    setAbierto(false);
    setConsulta('');
  }

  function elegir(valor: number): void {
    onChange(valor);
    cerrar();
  }

  function alTeclear(evento: React.KeyboardEvent<HTMLInputElement>): void {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      if (!abierto) return abrir();
      setResaltada((actual) => Math.min(actual + 1, filtradas.length - 1));
      return;
    }
    if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setResaltada((actual) => Math.max(actual - 1, 0));
      return;
    }
    if (evento.key === 'Enter') {
      // Solo se traga el Enter si hay algo que elegir; si no, deja que el formulario haga lo suyo.
      if (!abierto || filtradas.length === 0) return;
      evento.preventDefault();
      elegir(filtradas[resaltada]!.valor);
      return;
    }
    if (evento.key === 'Escape') {
      evento.preventDefault();
      cerrar();
    }
  }

  const textoVisible = abierto ? consulta : (seleccionada?.etiqueta ?? '');

  return (
    <div ref={contenedor} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={campo}
          id={id}
          className="input"
          role="combobox"
          aria-expanded={abierto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={abierto && filtradas[resaltada] ? `${idLista}-${resaltada}` : undefined}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          autoComplete="off"
          disabled={disabled}
          placeholder={seleccionada ? seleccionada.etiqueta : placeholder}
          value={textoVisible}
          onChange={(evento) => {
            setConsulta(evento.target.value);
            setResaltada(0);
            if (!abierto) setAbierto(true);
          }}
          onFocus={abrir}
          onKeyDown={alTeclear}
          style={{ paddingRight: 56 }}
        />

        {/* Quitar lo elegido, solo cuando el campo admite quedarse vacío. */}
        {seleccionada && etiquetaVacia && !disabled && (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            title={etiquetaVacia}
            aria-label={etiquetaVacia}
            onClick={() => elegir(0)}
            style={{ position: 'absolute', right: 26, top: '50%', transform: 'translateY(-50%)' }}
          >
            <X size={13} />
          </button>
        )}
        <CaretDown
          size={14}
          aria-hidden
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            opacity: 0.6,
            pointerEvents: 'none',
          }}
        />
      </div>

      {abierto &&
        posicion &&
        createPortal(
          <div
            id={idLista}
            role="listbox"
            className="card elev-lg"
            style={{
              position: 'fixed',
              zIndex: 60,
              top: posicion.arriba,
              left: posicion.izquierda,
              width: Math.max(posicion.ancho, 280),
              maxHeight: 280,
              overflowY: 'auto',
              padding: 4,
              gap: 0,
            }}
          >
          {etiquetaVacia && (
            <Opcion
              id={`${idLista}-vacia`}
              texto={etiquetaVacia}
              seleccionada={!seleccionada}
              resaltada={false}
              onElegir={() => elegir(0)}
            />
          )}

          {filtradas.length === 0 ? (
            <div className="text-muted" style={{ padding: '10px 8px', fontSize: 13 }}>
              Ningún resultado para «{consulta}». Prueba con menos palabras.
            </div>
          ) : (
            filtradas.map((opcion, indice) => (
              <Opcion
                key={opcion.valor}
                id={`${idLista}-${indice}`}
                texto={opcion.etiqueta}
                detalle={opcion.detalle}
                seleccionada={opcion.valor === value}
                resaltada={indice === resaltada}
                onElegir={() => elegir(opcion.valor)}
                onResaltar={() => setResaltada(indice)}
              />
            ))
          )}

            {/* Con el tope alcanzado hay que decirlo: callarlo haría creer que no hay más. */}
            {totalCoincidencias > filtradas.length && (
              <div className="text-muted" style={{ padding: '8px', fontSize: 12 }}>
                Se muestran {filtradas.length} de {totalCoincidencias}. Escribe una palabra más
                para afinar.
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

function Opcion({
  id,
  texto,
  detalle,
  seleccionada,
  resaltada,
  onElegir,
  onResaltar,
}: {
  id: string;
  texto: string;
  detalle?: string;
  seleccionada: boolean;
  resaltada: boolean;
  onElegir: () => void;
  onResaltar?: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={seleccionada}
      onMouseDown={(evento) => {
        // `mousedown` y no `click`: el `blur` del input llegaría antes que el clic y cerraría la
        // lista, así que el clic nunca alcanzaría a esta opción.
        evento.preventDefault();
        onElegir();
      }}
      onMouseEnter={onResaltar}
      style={{
        padding: '7px 8px',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        fontSize: 13,
        background: resaltada ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)' : undefined,
        color: seleccionada ? 'var(--color-accent)' : undefined,
      }}
    >
      {texto}
      {detalle && (
        <div className="text-muted" style={{ fontSize: 11 }}>
          {detalle}
        </div>
      )}
    </div>
  );
}
