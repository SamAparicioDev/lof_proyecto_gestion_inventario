'use client';

/**
 * `CampoFecha` — campo de fecha que SIEMPRE se escribe y se lee en `dd/mm/aaaa`.
 *
 * ## Por qué no basta `<input type="date">`
 *
 * El navegador pinta el campo de fecha nativo según SU idioma, no según el `lang` del
 * documento ni el del propio campo (comprobado en Chromium: `<html lang="es-CO">`,
 * `lang="es-CO"` en el input y un contenedor con `lang="es-CO"` dan exactamente el mismo
 * resultado). Con el navegador en inglés, el 12 de agosto de 2026 se muestra `08/12/2026`,
 * que en Colombia se lee como 8 de diciembre. No es un detalle estético: es una fecha
 * ambigua en un sistema donde las fechas deciden qué entró, qué salió y en qué periodo se
 * consumió. Y como FR-047 exige español en TODA la interfaz, dejar el formato a merced de la
 * configuración de cada navegador no es aceptable.
 *
 * ## Cómo lo resuelve
 *
 * - Lo que se ve y se teclea es un campo de TEXTO con máscara `dd/mm/aaaa` — el único que
 *   podemos formatear nosotros. Al escribir, las barras se ponen solas.
 * - El valor que viaja al servidor sigue siendo `aaaa-mm-dd` (ISO), en un `<input hidden>`
 *   con el `name` del campo, así que los formularios GET de filtros funcionan igual que antes
 *   y los esquemas Zod compartidos no cambian ni una línea.
 * - El botón de calendario abre el selector NATIVO (`showPicker()`) sobre un campo de fecha
 *   oculto: se conserva el calendario del sistema, que es lo bueno del control nativo, sin
 *   heredar su formato.
 *
 * ## Dos modos de uso
 *
 * - **No controlado** (formularios GET de filtros, que son Server Components): `name` +
 *   `defaultValue`. El componente gestiona su propio estado.
 * - **Controlado** (`react-hook-form`, vía `Controller`): `value` + `onChange`, que emite ISO
 *   o `''` cuando el campo está vacío o la fecha aún no es válida.
 *
 * Una fecha incompleta o imposible (`31/02/2026`) NO emite valor: se marca el campo como
 * inválido en vez de mandar basura al servidor.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CalendarBlank } from '@phosphor-icons/react/dist/ssr';

export interface CampoFechaProps {
  /** `id` del campo visible — el que debe apuntar el `<label htmlFor>`. */
  id?: string;
  /** Nombre con el que viaja el valor ISO al enviar un formulario nativo (filtros GET). */
  name?: string;
  /** Valor ISO inicial (`aaaa-mm-dd`) en modo NO controlado. */
  defaultValue?: string;
  /** Valor ISO en modo controlado (`react-hook-form`). */
  value?: string;
  /** Recibe el ISO (`aaaa-mm-dd`) o `''` si el campo está vacío/incompleto. */
  onChange?: (valorIso: string) => void;
  /** Marca de error externa (p. ej. el error de Zod del formulario). */
  ariaInvalid?: boolean;
  disabled?: boolean;
  /** Texto para lectores de pantalla del botón de calendario, si el genérico no basta. */
  etiquetaCalendario?: string;
}

/** Longitud de `dd/mm/aaaa`, que es también el máximo que admite el campo visible. */
const LARGO_MASCARA = 10;

export function CampoFecha({
  id,
  name,
  defaultValue = '',
  value,
  onChange,
  ariaInvalid,
  disabled,
  etiquetaCalendario = 'Abrir calendario',
}: CampoFechaProps): React.JSX.Element {
  const esControlado = value !== undefined;
  const isoExterno = esControlado ? value : undefined;

  const [texto, setTexto] = useState(() => aTextoVisible(esControlado ? (value ?? '') : defaultValue));
  const nativo = useRef<HTMLInputElement>(null);
  const idGenerado = useId();
  const idCampo = id ?? idGenerado;

  const iso = useMemo(() => aIso(texto), [texto]);

  // En modo controlado, un cambio de `value` desde fuera (reset del formulario, "Limpiar
  // filtros") tiene que reflejarse en el texto. Solo se reescribe si el ISO mostrado ya no
  // coincide, para no pisar lo que el usuario está tecleando a medias.
  useEffect(() => {
    if (isoExterno === undefined) return;
    if (isoExterno !== iso) setTexto(aTextoVisible(isoExterno));
    // `iso` se deja fuera a propósito: depende de `texto`, y reaccionar a él reescribiría
    // el campo en cada pulsación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isoExterno]);

  const incompleto = texto.length > 0 && iso === '';

  function cambiarTexto(entrada: string): void {
    const nuevoTexto = enmascarar(entrada);
    setTexto(nuevoTexto);
    onChange?.(aIso(nuevoTexto));
  }

  function abrirCalendario(): void {
    const campoNativo = nativo.current;
    if (!campoNativo) return;
    // `showPicker` es lo que abre el calendario sin depender de dónde se hizo clic; si el
    // navegador no lo trae, un clic sobre el campo nativo hace lo mismo en la mayoría.
    try {
      campoNativo.showPicker();
    } catch {
      campoNativo.click();
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        id={idCampo}
        type="text"
        className="input"
        // Inline y no una clase: el hueco del botón es geometría de ESTE componente. Además,
        // un `style` inline gana siempre sobre `.input`, sin pelear con las capas de la
        // cascada (docs/diseno-nocturne.md).
        style={{ paddingRight: 34 }}
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        maxLength={LARGO_MASCARA}
        value={texto}
        disabled={disabled}
        aria-invalid={ariaInvalid || incompleto || undefined}
        aria-describedby={incompleto ? `${idCampo}-formato` : undefined}
        onChange={(evento) => cambiarTexto(evento.target.value)}
      />

      <button
        type="button"
        onClick={abrirCalendario}
        disabled={disabled}
        aria-label={etiquetaCalendario}
        title={etiquetaCalendario}
        style={{
          position: 'absolute',
          right: 4,
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'grid',
          placeItems: 'center',
          width: 26,
          height: 26,
          padding: 0,
          border: 0,
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          // Mismo tono apagado que `.text-muted` de Nocturne (no hay token propio para él).
          color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <CalendarBlank size={16} />
      </button>

      {/* Campo nativo SOLO para el calendario del sistema. No se ve y no recibe foco por
          tabulación (el campo de texto ya es el punto de entrada accesible), pero no puede
          ser `display:none` o `showPicker()` falla. */}
      <input
        ref={nativo}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={iso}
        disabled={disabled}
        onChange={(evento) => {
          setTexto(aTextoVisible(evento.target.value));
          onChange?.(evento.target.value);
        }}
        style={{
          position: 'absolute',
          right: 8,
          bottom: 0,
          width: 1,
          height: 1,
          padding: 0,
          border: 0,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />

      {/* El valor real que viaja en los formularios nativos de filtros (GET). */}
      {name && <input type="hidden" name={name} value={iso} />}

      {incompleto && (
        <p id={`${idCampo}-formato`} style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          Escribe la fecha como dd/mm/aaaa.
        </p>
      )}
    </div>
  );
}

/** `2026-08-12` → `12/08/2026`. Cualquier otra cosa (vacío, valor raro) → `''`. */
function aTextoVisible(valorIso: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valorIso ?? '');
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : '';
}

/** Deja solo dígitos (máx. 8) y les pone las barras: `1208` → `12/08`. */
function enmascarar(entrada: string): string {
  const digitos = entrada.replace(/\D/g, '').slice(0, 8);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
}

/**
 * `12/08/2026` → `2026-08-12`. Devuelve `''` mientras la fecha esté incompleta o no exista
 * (el 31 de febrero se teclea igual de fácil que cualquier otra, y no debe llegar al
 * servidor). La comprobación es de ida y vuelta: se construye la fecha en UTC y se verifica
 * que sus partes siguen siendo las tecleadas, que es lo que delata un desbordamiento de mes.
 */
function aIso(texto: string): string {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (!partes) return '';

  const dia = Number(partes[1]);
  const mes = Number(partes[2]);
  const anio = Number(partes[3]);

  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  const coincide =
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;

  return coincide ? `${partes[3]}-${partes[2]}-${partes[1]}` : '';
}
