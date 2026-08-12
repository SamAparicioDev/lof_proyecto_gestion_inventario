/**
 * Utilidades compartidas de los filtros de listado (US13 — FR-078/FR-079).
 *
 * Los 5 listados del sistema (inventario, ingresos, salidas, clientes, usuarios) filtran con un
 * `<form method="GET">` nativo: el estado vive en la URL, así que un listado filtrado se
 * comparte, se marca como favorito y se recarga sin perder nada, y el enlace de exportar (US11)
 * hereda los mismos filtros sin código adicional. Lo que NO tenían hasta US13 es una forma de
 * responder dos preguntas que el usuario se hace al mirar una tabla corta:
 *
 *   1. "¿Por qué veo tan poco?" → `filtrosActivos` arma la lista legible de lo que está
 *      recortando, que `ResumenFiltros` pinta bajo la barra (FR-078).
 *   2. "¿Está vacío porque filtré, o porque no hay nada?" → `mensajeListadoVacio` distingue los
 *      dos casos, que hasta ahora compartían el MISMO texto ("No se encontraron X con los
 *      filtros aplicados") incluso en un sistema recién instalado sin un solo registro (FR-079).
 *
 * Vive en `lib/` y no en `componentes/` porque son funciones puras sin JSX: las usan tanto los
 * Server Components de las páginas como los Client Components de las tablas
 * (`tabla-inventario.tsx`, `tabla-usuarios.tsx`), que reciben `hayFiltros` como prop.
 */

/** Un filtro activo, listo para mostrarse: la etiqueta del campo y su valor legible. */
export interface FiltroAplicado {
  readonly etiqueta: string;
  readonly valor: string;
}

/**
 * Candidato a filtro activo tal como lo declara cada página: la etiqueta del campo y el valor
 * CRUDO que llegó por query string (o el nombre ya resuelto, cuando el valor es un id y la
 * página tiene el catálogo a mano — un chip que dijera "Cliente: 4" no le sirve a nadie).
 */
export interface CandidatoFiltro {
  readonly etiqueta: string;
  readonly valor: string | number | null | undefined;
}

/**
 * Descarta los candidatos sin valor y devuelve los filtros realmente activos, en el orden en que
 * la página los declaró (el mismo de los campos de la barra, para que la vista se lea de
 * izquierda a derecha igual que se llenó).
 *
 * Trata la cadena vacía como ausente porque un `<form method="GET">` envía SIEMPRE todos sus
 * campos, también los que el usuario dejó en blanco: sin esto, cualquier listado visitado desde
 * el botón "Filtrar" mostraría chips vacíos de todos sus campos.
 */
export function filtrosActivos(candidatos: readonly CandidatoFiltro[]): FiltroAplicado[] {
  return candidatos
    .filter((candidato) => candidato.valor !== undefined && candidato.valor !== null && candidato.valor !== '')
    .map((candidato) => ({ etiqueta: candidato.etiqueta, valor: String(candidato.valor) }));
}

/**
 * Identidad del ESTADO de filtrado de un listado, para que la barra de filtros vuelva a montarse
 * cuando ese estado cambia (`BarraFiltros`, prop `claveDeFiltros`).
 *
 * ## Por qué hace falta (corrección de la revisión adversarial de la Tanda 14, hallazgo HIGH)
 *
 * Los campos de la barra son NO CONTROLADOS: su valor sale de `defaultValue`/`defaultChecked`, que
 * React solo aplica al MONTAR el nodo. En una navegación suave entre dos URLs de la MISMA ruta
 * (`/inventario?...` → `/inventario`, que es exactamente lo que hacen "Limpiar filtros" y el enlace
 * del menú lateral) React reutiliza el DOM que ya existe, así que los `<input type="text">` se
 * reinician —React sí sincroniza su `defaultValue`— pero los `<select>` y los checkbox NO: la tabla
 * pasaba a mostrarlo todo mientras la barra seguía enseñando el filtro anterior, es decir, la
 * pantalla contradecía a la fila de chips que acababa de vaciarse (FR-078).
 *
 * Con esta clave como `key` del `<form>`, cambiar de filtros equivale a montar controles nuevos y
 * los tres tipos de campo quedan siempre de acuerdo con la URL.
 *
 * Se calcula a partir de los MISMOS filtros que se muestran como chips —no de la query cruda— por
 * dos razones: es la lista que cada página ya mantiene (añadir un filtro nuevo no puede olvidarse
 * de actualizar la clave) y FR-078 exige que todo filtro activo aparezca ahí, así que es completa
 * por definición. Deliberadamente NO entra la página: paginar no cambia los filtros, y remontar
 * ahí borraría lo que el usuario estuviera escribiendo en la barra.
 */
export function claveDeFiltros(filtros: readonly CandidatoFiltro[]): string {
  return JSON.stringify(filtrosActivos(filtros));
}

/**
 * Texto del estado vacío de una tabla (FR-079), en español y distinguiendo las dos causas:
 * "filtraste y no hay coincidencias" (revisa o limpia los filtros) frente a "todavía no hay
 * nada" (registra el primero). Son dos situaciones que se resuelven de forma distinta, así que
 * no pueden compartir mensaje.
 *
 * @param entidadesEnPlural cómo se llaman las filas de esa tabla: `'productos'`, `'ingresos'`…
 */
export function mensajeListadoVacio(entidadesEnPlural: string, hayFiltros: boolean): string {
  return hayFiltros
    ? `No se encontraron ${entidadesEnPlural} con los filtros aplicados.`
    : `Aún no hay ${entidadesEnPlural} registrados.`;
}
