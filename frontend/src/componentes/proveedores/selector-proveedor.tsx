'use client';

/**
 * Selector de proveedor del catálogo (US15, FR-091).
 *
 * Sustituye al `<input>` de texto libre que tenía el formulario de ingreso hasta US14. Se trae
 * el catálogo él mismo, igual que `SelectorCategoria` y por el mismo motivo: el formulario se
 * monta desde dos rutas (`/ingresos/nuevo` y la edición de `/ingresos/[id]`) y pasarlo por props
 * obligaría a las dos páginas —Server Components— a cargarlo y encadenarlo.
 *
 * Dos diferencias con el de categorías, las dos de la historia:
 *
 *  - **No hay opción vacía**: el proveedor es OBLIGATORIO. El placeholder es una opción
 *    deshabilitada, no un valor elegible, para que no se pueda "desasignar" sin querer.
 *  - **Un fallo de carga SÍ se muestra**: si el catálogo no llega, el campo se queda sin
 *    opciones y el ingreso no se puede guardar; callarlo dejaría al usuario mirando un
 *    desplegable vacío sin saber por qué. (En categorías se puede callar porque el campo es
 *    opcional y el resto del alta sigue funcionando.)
 *
 * Solo ofrece proveedores ACTIVOS, con la excepción necesaria: si el ingreso que se edita ya
 * apunta a uno desactivado, ese se añade a la lista. Sin eso, al abrir la factura el campo
 * aparecería vacío y guardar sin tocarlo fallaría por un cambio de catálogo ajeno a ella.
 */
import { useEffect, useMemo, useState } from 'react';
import { SelectorBuscable } from '@/componentes/comunes/selector-buscable';
import { ErrorApi } from '@/lib/api/cliente';
import { listarProveedores, type ProveedorListado } from '@/lib/api/proveedores';

const MENSAJE_ERROR_RED = 'No fue posible cargar los proveedores. Revisa tu conexión e intenta de nuevo.';

interface SelectorProveedorProps {
  id: string;
  /** Id seleccionado; `0`/`undefined` mientras no se ha elegido ninguno. */
  value: number | undefined;
  onChange: (proveedorId: number) => void;
  /** Proveedor que el ingreso ya tiene, para conservarlo aunque esté inactivo (ver TSDoc). */
  proveedorActual?: { id: number; nombre: string } | null;
  disabled?: boolean;
  ariaInvalid?: boolean;
}

export function SelectorProveedor({
  id,
  value,
  onChange,
  proveedorActual,
  disabled,
  ariaInvalid,
}: SelectorProveedorProps): React.JSX.Element {
  const [proveedores, setProveedores] = useState<ProveedorListado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    listarProveedores({ estado: 'ACTIVO' })
      .then((lista) => {
        if (vigente) setProveedores(lista);
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

  const opciones = [...proveedores];
  if (proveedorActual && !opciones.some((proveedor) => proveedor.id === proveedorActual.id)) {
    opciones.unshift({
      ...proveedorActual,
      nit: null,
      telefono: null,
      email: null,
      estado: 'INACTIVO',
      esSistema: false,
      cantidadIngresos: 0,
    });
  }

  const opcionesBuscables = useMemo(
    () =>
      opciones.map((proveedor) => ({
        valor: proveedor.id,
        etiqueta: `${proveedor.nombre}${proveedor.estado === 'INACTIVO' ? ' (inactivo)' : ''}`,
        textosBuscables: [proveedor.nombre],
      })),
    [opciones],
  );

  return (
    <>
      {/* US23 (FR-119): lista escribible, sin opción vacía — el proveedor es obligatorio. */}
      <SelectorBuscable
        id={id}
        opciones={opcionesBuscables}
        value={value}
        onChange={onChange}
        disabled={disabled || cargando}
        ariaInvalid={ariaInvalid}
        placeholder={cargando ? 'Cargando proveedores…' : 'Escribe para buscar un proveedor…'}
      />
      {error && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          {error}
        </p>
      )}
      {!cargando && !error && opciones.length === 0 && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          No hay proveedores activos. Crea uno en Administración → Proveedores antes de registrar
          el ingreso.
        </p>
      )}
    </>
  );
}
