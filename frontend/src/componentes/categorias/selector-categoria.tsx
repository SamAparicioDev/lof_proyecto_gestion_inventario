'use client';

/**
 * Selector de categoría del catálogo (US15, FR-086).
 *
 * Sustituye al `<input>` de texto libre que tenían los formularios de producto hasta US14. Se
 * trae el catálogo ÉL MISMO en vez de recibirlo por props, y es deliberado: el campo aparece en
 * el alta rápida desde ingresos, en el alta desde inventario y en la edición de la ficha, y
 * pasarlo por props obligaría a que tres páginas distintas —dos de ellas Server Components que
 * hoy no consultan categorías— cargaran y encadenaran la lista. El catálogo es pequeño y la
 * respuesta se cachea en el navegador.
 *
 * Solo ofrece categorías ACTIVAS (FR-086), con una excepción necesaria: si el producto que se
 * edita ya está clasificado con una categoría desactivada, esa se añade a la lista. Sin eso, al
 * abrir la ficha el campo aparecería vacío y guardar sin tocarlo DESCLASIFICARÍA el producto en
 * silencio, que es justo lo contrario de lo que promete FR-086.
 */
import { useEffect, useMemo, useState } from 'react';
import { SelectorBuscable } from '@/componentes/comunes/selector-buscable';
import { listarCategorias, type CategoriaListada } from '@/lib/api/categorias';

interface SelectorCategoriaProps {
  id: string;
  /** Id seleccionado, o `null`/`undefined` si el producto no está clasificado. */
  value: number | null | undefined;
  onChange: (categoriaId: number | null) => void;
  /** Categoría que el producto ya tiene, para conservarla aunque esté inactiva (ver TSDoc). */
  categoriaActual?: { id: number; nombre: string } | null;
  disabled?: boolean;
  /**
   * Qué significa "no elegir nada" en ESTE sitio. En el formulario de un producto es "sin
   * categoría" (el producto queda sin clasificar); en el filtro de un reporte es "todas" (no se
   * acota nada). Es la misma opción vacía con dos lecturas opuestas, así que el texto lo pone
   * quien usa el selector — US24 (FR-120).
   */
  etiquetaVacia?: string;
}

export function SelectorCategoria({
  id,
  value,
  onChange,
  categoriaActual,
  disabled,
  etiquetaVacia = 'Sin categoría',
}: SelectorCategoriaProps): React.JSX.Element {
  const [categorias, setCategorias] = useState<CategoriaListada[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vigente = true;
    listarCategorias({ estado: 'ACTIVA' })
      .then((lista) => {
        if (vigente) setCategorias(lista);
      })
      // Un fallo al cargar el catálogo NO debe romper el formulario: el campo es opcional, así
      // que se queda vacío y el resto del alta sigue funcionando.
      .catch(() => undefined)
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, []);

  const opciones = [...categorias];
  if (categoriaActual && !opciones.some((categoria) => categoria.id === categoriaActual.id)) {
    opciones.unshift({
      ...categoriaActual,
      descripcion: null,
      estado: 'INACTIVA',
      cantidadProductos: 0,
    });
  }

  const opcionesBuscables = useMemo(
    () =>
      opciones.map((categoria) => ({
        valor: categoria.id,
        etiqueta: `${categoria.nombre}${categoria.estado === 'INACTIVA' ? ' (inactiva)' : ''}`,
        textosBuscables: [categoria.nombre],
      })),
    [opciones],
  );

  return (
    // US23 (FR-119): lista escribible. `etiquetaVacia` es lo que mantiene viva la opción
    // "sin categoría" — el campo es OPCIONAL (FR-086) y quitarla lo convertiría en obligatorio.
    <SelectorBuscable
      id={id}
      opciones={opcionesBuscables}
      value={value ?? 0}
      onChange={(categoriaId) => onChange(categoriaId === 0 ? null : categoriaId)}
      disabled={disabled || cargando}
      etiquetaVacia={etiquetaVacia}
      placeholder={cargando ? 'Cargando categorías…' : `${etiquetaVacia} — escribe para buscar`}
    />
  );
}
