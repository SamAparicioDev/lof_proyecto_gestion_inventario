/**
 * Barra de filtros unificada de los listados (T110) — el MISMO componente para los filtros de
 * inventario, ingresos, salidas, clientes, usuarios, importación y los 4 reportes, para que
 * los diez se vean como una sola pieza y no como diez variaciones del mismo formulario.
 *
 * ## Por qué existe (regla de cascada Nocturne ↔ Tailwind)
 *
 * Las utilidades de Tailwind v4 viven en `@layer utilities`, mientras que el CSS vendido de
 * Nocturne (`globals.css`) está SIN capa — y en la cascada de CSS lo que está sin capa gana
 * SIEMPRE sobre lo que está dentro de una capa, sin importar especificidad ni orden. Como
 * `.card` declara `display:flex; flex-direction:column; gap; padding`, escribir
 * `className="card flex flex-wrap items-end gap-3 p-4"` en un mismo elemento dejaba
 * `flex-direction:column` (Nocturne) e `align-items:flex-end` (Tailwind, sin conflicto): los
 * campos se apilaban en vertical pegados a la derecha, en TODOS los anchos. Fue el bug real
 * que motivó esta tarea. La solución no es `!important` ni `flex-row` (seguirían perdiendo),
 * sino **separar contenedor de layout**: `.card` en el elemento externo y las utilidades de
 * Tailwind en un elemento interno distinto, donde ninguna clase de Nocturne compite.
 *
 * La regla completa está en [docs/diseno-nocturne.md](../../../../docs/diseno-nocturne.md)
 * § "Nunca mezcles una clase de Nocturne con una utilidad de Tailwind sobre la misma
 * propiedad" — léela antes de combinar `.card`/`.dialog`/`.btn`/`.tag` con utilidades.
 *
 * ## Cómo se usa
 *
 * `BarraFiltros` no impone el `<form>`: lo renderiza y le pasa las props que reciba, así sirve
 * igual a los listados de Server Component (`<BarraFiltros method="GET">`, navegación nativa
 * por query string) y a los paneles de reporte de Client Component
 * (`<BarraFiltros onSubmit={handleSubmit(alGenerar)} noValidate noImprimir>`, react-hook-form).
 * Los primeros DEBEN pasar además `claveDeFiltros` — el tipo lo exige, ver `PropiedadesBarraFiltros`.
 *
 * ```tsx
 * <BarraFiltros
 *   method="GET"
 *   claveDeFiltros={claveDeFiltros(filtros)}
 *   pie={<ResumenFiltros filtros={filtros} hrefLimpiar="/inventario" />}
 * >
 *   <CampoFiltro ancho="largo">
 *     <label htmlFor="buscar">Buscar</label>
 *     <input id="buscar" name="buscar" className="input" />
 *   </CampoFiltro>
 *   <OpcionFiltro>
 *     <input type="checkbox" name="soloStockBajo" value="true" /> Solo stock bajo
 *   </OpcionFiltro>
 *   <button type="submit" className="btn btn-secondary">Filtrar</button>
 * </BarraFiltros>
 * ```
 *
 * ## `pie`: el resumen de filtros activos (US13/T136)
 *
 * `pie` es una segunda fila DENTRO de la misma tarjeta, bajo el formulario, donde va
 * `ResumenFiltros` (`comunes/resumen-filtros.tsx`): las etiquetas de lo que está recortando el
 * listado y el botón "Limpiar filtros" (FR-078). Es una EXTENSIÓN de este componente y no una
 * barra paralela a propósito — la lección de T110 es que diez variantes del mismo formulario se
 * desalinean solas. Va fuera del `<form>` porque no captura nada: son enlaces y texto; meterlo
 * dentro haría que un `<Link>` de "Limpiar" conviviera con el `submit` en el mismo contenedor de
 * layout, y la fila del formulario es `items-end` (alineación pensada para campos, no para una
 * línea de etiquetas).
 *
 * El espaciado entre las dos filas lo da `.card` (`gap: var(--space-2)`), no una utilidad de
 * Tailwind: el contenedor es de Nocturne y su `gap` gana igual (regla de cascada de arriba).
 *
 * ## Alineación vertical
 *
 * La fila es `items-end`: el borde inferior del `.input` (36px de alto), del `.btn` (30px) y
 * del checkbox queda sobre la misma línea, que es como se lee una barra de filtros. Por eso
 * `OpcionFiltro` reserva la altura del input en vez del `paddingBottom:9` suelto que tenía
 * antes el checkbox "Solo stock bajo" de `/inventario`.
 *
 * Concesión conocida y deliberada de `items-end`: si un campo muestra su `<p role="alert">` de
 * validación, ese campo crece hacia abajo y su input sube ~32px respecto a los vecinos hasta
 * que se corrige el dato. Se prefiere a la alternativa (`items-start` + un desplazamiento fijo
 * para el botón, que se calcularía a partir del alto del `<label>`): ese desplazamiento se
 * rompería en cuanto una etiqueta pasara a dos líneas, y eso sí ocurre en uso normal, no solo
 * al fallar una validación.
 *
 * NO es Client Component a propósito: no tiene estado ni interactividad propia, así que sirve
 * tal cual dentro de un Server Component; cuando lo usa un Client Component (los reportes)
 * entra en el bundle de cliente junto con su padre.
 */
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/**
 * Escala de anchos mínimos de los campos — tres pasos, no un `minWidth` distinto por pantalla
 * (era el origen de que cada listado se viera diferente). Se elige por el contenido:
 * `corto` para fechas y números, `medio` para selects de estado/tipo, `largo` para texto libre
 * y para los selects de cliente/proyecto/archivo, cuyos valores son nombres completos.
 */
type AnchoCampo = 'corto' | 'medio' | 'largo';

/** Las clases se escriben literales (no concatenadas) para que Tailwind las detecte al compilar. */
const CLASE_ANCHO: Record<AnchoCampo, string> = {
  corto: 'min-w-[140px]',
  medio: 'min-w-[190px]',
  largo: 'min-w-[240px]',
};

/**
 * `className` y `method` quedan fuera del tipo base a propósito.
 *
 * `className` es justo la prop que reintroduciría el bug de cascada (una utilidad de Tailwind
 * sobre el mismo elemento que `.card`); el único ajuste previsto del contenedor es `noImprimir`.
 *
 * `method` sale de aquí para volver abajo dentro de la unión que EXIGE `claveDeFiltros` en los
 * listados (ver `PropiedadesBarraFiltros`).
 */
interface PropiedadesComunesBarraFiltros extends Omit<ComponentPropsWithoutRef<'form'>, 'className' | 'method'> {
  /** Oculta la barra completa en la vista de impresión de un reporte (FR-043, clase `no-imprimir` de `globals.css`). */
  noImprimir?: boolean;
  /**
   * Fila opcional bajo el formulario, dentro de la misma tarjeta — hoy siempre `ResumenFiltros`
   * (US13/FR-078). Se renderiza tal cual: cuando no hay filtros activos ese componente devuelve
   * `null` y la tarjeta queda exactamente como antes, sin un contenedor vacío que ocupe espacio.
   */
  pie?: ReactNode;
}

/**
 * La barra tiene dos usos y el tipo los separa para que el segundo no pueda olvidar su clave:
 *
 * - **Listado** (`method="GET"`): campos NO CONTROLADOS cuyo valor sale de `defaultValue` /
 *   `defaultChecked` a partir de la URL. Exige `claveDeFiltros` — sin ella, una navegación suave
 *   entre dos URLs de la misma ruta deja los `<select>` y los checkbox mostrando el filtro
 *   anterior (bug real de la Tanda 14; el detalle completo está en `lib/filtros.ts#claveDeFiltros`,
 *   que es quien la calcula). Es el mismo tipo de barandilla que `className` fuera del tipo: la
 *   invariante la sostiene el compilador, no la memoria de quien añada la próxima pantalla.
 * - **Panel de reporte** (`onSubmit`, sin `method`): campos gobernados por react-hook-form, que ya
 *   conserva y repuebla su propio estado. Ahí un remontaje sería justo lo contrario de lo que se
 *   quiere, así que `claveDeFiltros` no se acepta.
 */
type PropiedadesBarraFiltros = PropiedadesComunesBarraFiltros &
  (
    | { method: 'GET'; claveDeFiltros: string }
    | { method?: never; claveDeFiltros?: never }
  );

export function BarraFiltros(propiedades: PropiedadesBarraFiltros) {
  const { children, noImprimir = false, pie, claveDeFiltros, ...propiedadesFormulario } = propiedades;

  return (
    // Contenedor: SOLO clases de Nocturne (su propio relleno `--space-3` y su superficie).
    <div className={noImprimir ? 'card no-imprimir' : 'card'}>
      {/* Layout: SOLO utilidades de Tailwind, en un elemento donde no hay clase de Nocturne
          con la que competir. `--space-4` mantiene el ritmo de espaciado del sistema.
          `key`: remonta los campos cuando cambian los filtros de la URL (ver arriba). */}
      <form key={claveDeFiltros} {...propiedadesFormulario} className="flex flex-wrap items-end gap-[var(--space-4)]">
        {children}
      </form>
      {pie}
    </div>
  );
}

interface PropiedadesCampoFiltro {
  /** Ancho mínimo según el contenido del campo (ver `AnchoCampo`). */
  ancho?: AnchoCampo;
  /** El `<label>` y el control (`.input`), más su `<p role="alert">` de error si lo hay. */
  children: ReactNode;
}

/**
 * Un campo de la barra. Es el `.field` de Nocturne (que solo estiliza su `<label>`, sin tocar
 * layout) más el ancho mínimo de la escala — combinación sin conflicto de cascada.
 */
export function CampoFiltro({ ancho = 'medio', children }: PropiedadesCampoFiltro) {
  return <div className={`field ${CLASE_ANCHO[ancho]}`}>{children}</div>;
}

/**
 * Opción de tipo checkbox dentro de la barra (ej. "Solo stock bajo" en `/inventario`). Reserva
 * la altura de un `.input` (36px, fijada por Nocturne en `globals.css`) para que, con la fila
 * en `items-end`, el checkbox quede centrado con los campos vecinos en vez de calzado a mano
 * con un `paddingBottom` suelto.
 */
export function OpcionFiltro({ children }: { children: ReactNode }) {
  return <label className="flex min-h-[36px] items-center gap-[var(--space-3)]">{children}</label>;
}
