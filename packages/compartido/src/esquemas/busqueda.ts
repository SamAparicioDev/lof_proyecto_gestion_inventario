/**
 * Criterio de coincidencia de texto, COMPARTIDO entre el servidor y el navegador (US22/US23,
 * FR-118/FR-119).
 *
 * El backend lo traduce a un `where` de Prisma (`busqueda-por-terminos.ts`) y el frontend lo
 * aplica en memoria para filtrar las opciones de una lista mientras se escribe. Los dos tienen
 * que decidir IGUAL: si el buscador de la pantalla de inventario encontrara un producto que el
 * selector de una línea no encuentra, el usuario concluiría —con razón— que uno de los dos está
 * roto. Por eso la regla vive aquí y no duplicada a cada lado.
 *
 * La regla: se parte lo escrito en TÉRMINOS y coincide si CADA término aparece en ALGUNO de los
 * textos de la fila. Y entre términos, O entre campos — el orden no importa y cada palabra
 * estrecha.
 *
 * Diferencia deliberada con el servidor: **aquí sí se ignoran las tildes**. En el navegador la
 * comparación es sobre cadenas ya cargadas en memoria, así que normalizarlas cuesta nada; en
 * PostgreSQL exigiría la extensión `unaccent` (anotado como el siguiente paso de FR-118). El
 * resultado práctico es que la lista escribible es MÁS indulgente que el buscador del listado,
 * nunca menos: nadie busca algo y lo encuentra en un sitio pero no en el otro por culpa de una
 * tilde.
 */

/** Máximo de términos que se tienen en cuenta — mismo criterio (y mismo motivo) que el servidor. */
const MAXIMO_TERMINOS = 10;

/**
 * Texto listo para comparar: minúsculas y SIN tildes.
 *
 * `normalize('NFD')` separa cada letra acentuada en letra + marca diacrítica, y el reemplazo
 * borra las marcas: "Ferretería" → "ferreteria". Es la forma estándar de hacerlo en JavaScript
 * y no necesita ninguna tabla de equivalencias propia.
 */
export function normalizarParaBuscar(texto: string): string {
  return texto
    .toLocaleLowerCase('es')
    // La Ñ se pone a salvo ANTES de descomponer: `normalize('NFD')` la parte en n + virgulilla
    // y el borrado de marcas la dejaría en "n", convirtiendo "año" en "ano" y "muñeco" en
    // "muneco". En español la eñe es una letra propia del alfabeto, no una n acentuada, así que
    // se conserva; las vocales acentuadas sí se pliegan, que es lo que la gente espera al
    // escribir sin tildes.
    .replace(/ñ/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(//g, 'ñ');
}

/** Términos de la consulta, ya normalizados. Una consulta vacía o de solo espacios no tiene. */
export function terminosDeBusqueda(consulta: string): string[] {
  return normalizarParaBuscar(consulta)
    .split(/\s+/)
    .filter((termino) => termino !== '')
    .slice(0, MAXIMO_TERMINOS);
}

/**
 * `true` si la fila coincide con lo escrito.
 *
 * `textos` son todos los campos buscables de esa fila (el SKU y la descripción de un producto,
 * el nombre y la ciudad de un cliente…); los `undefined`/`null` se ignoran, así que quien llama
 * puede pasarlos sin filtrar antes.
 *
 * Sin términos devuelve `true`: una consulta vacía no filtra nada, igual que en el servidor.
 */
export function coincideConTerminos(
  textos: readonly (string | null | undefined)[],
  consulta: string,
): boolean {
  const terminos = terminosDeBusqueda(consulta);
  if (terminos.length === 0) return true;

  const contenido = textos
    .filter((texto): texto is string => typeof texto === 'string' && texto !== '')
    .map(normalizarParaBuscar);

  return terminos.every((termino) => contenido.some((texto) => texto.includes(termino)));
}
