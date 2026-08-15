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
import { useEffect, useState } from 'react';
import { listarCategorias, type CategoriaListada } from '@/lib/api/categorias';

interface SelectorCategoriaProps {
  id: string;
  /** Id seleccionado, o `null`/`undefined` si el producto no está clasificado. */
  value: number | null | undefined;
  onChange: (categoriaId: number | null) => void;
  /** Categoría que el producto ya tiene, para conservarla aunque esté inactiva (ver TSDoc). */
  categoriaActual?: { id: number; nombre: string } | null;
  disabled?: boolean;
}

export function SelectorCategoria({
  id,
  value,
  onChange,
  categoriaActual,
  disabled,
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

  return (
    <select
      id={id}
      className="input"
      disabled={disabled || cargando}
      value={value ?? ''}
      onChange={(evento) => onChange(evento.target.value === '' ? null : Number(evento.target.value))}
    >
      <option value="">{cargando ? 'Cargando categorías…' : 'Sin categoría'}</option>
      {opciones.map((categoria) => (
        <option key={categoria.id} value={categoria.id}>
          {categoria.nombre}
          {categoria.estado === 'INACTIVA' ? ' (inactiva)' : ''}
        </option>
      ))}
    </select>
  );
}
