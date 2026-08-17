/**
 * Búsqueda de texto de los listados: el modelo que usa cualquier buscador web (US22, FR-118).
 *
 * ## Qué cambia respecto de cómo se buscaba hasta ahora
 *
 * Antes, lo escrito viajaba como UNA subcadena literal: buscar `cemento gris` solo encontraba
 * filas donde esas dos palabras aparecieran juntas, en ese orden y con ese espacio exacto. En un
 * catálogo real eso falla casi siempre — el producto se llama "Cemento gris 50 kg", el proveedor
 * "Ferretería Central Demo S.A.S." — y el usuario concluye que el buscador no sirve.
 *
 * Ahora la consulta se parte en TÉRMINOS y se aplica la regla estándar:
 *
 * > una fila coincide si **cada término** aparece en **alguno** de los campos buscables.
 *
 * Es decir, Y entre términos, O entre campos. Eso es lo que hace que funcionen las tres formas
 * en que la gente busca de verdad:
 *
 * - `cemento gris` y `gris cemento` encuentran lo mismo — el orden deja de importar.
 * - `cem 001` encuentra `CEM-001` aunque el guion no se haya escrito.
 * - `ferret central` encuentra "Ferretería Central" escribiendo trozos de cada palabra.
 *
 * Y sigue siendo PRECISO, que es la otra mitad del pedido: cada término más que se escribe
 * ESTRECHA el resultado, nunca lo amplía. Un O entre términos (que también existe en la web)
 * haría lo contrario — devolvería más cuanto más específico se es, que es justo lo que
 * frustra al buscar.
 *
 * ## Lo que NO hace, y por qué
 *
 * **No ignora las tildes.** `ferreteria` no encuentra "Ferretería". Hacerlo exige la extensión
 * `unaccent` de PostgreSQL, que es una decisión de infraestructura con su propia migración —
 * está anotado como el siguiente paso natural de esta historia, no olvidado.
 *
 * **No busca por prefijo de campo entero ni por relevancia.** No hay ranking: los listados se
 * ordenan por fecha/número como siempre. Ordenar por "qué tan bien coincide" exigiría índices
 * de texto completo y cambiaría el orden que el usuario ya conoce en cada pantalla.
 *
 * Vive en `persistencia/` y no en el dominio porque produce `where` de Prisma: es una decisión
 * de CÓMO se consulta, no una regla de negocio (docs/arquitectura.md §3).
 */

/**
 * Máximo de términos que se tienen en cuenta.
 *
 * Cada término añade una condición `OR` sobre todos los campos buscables, así que una consulta
 * de veinte palabras produciría un `WHERE` desproporcionado para una pantalla de listado. Diez
 * es holgado —nadie busca con más— y acota el coste. Los sobrantes se ignoran en silencio: la
 * búsqueda ya es lo bastante estrecha con los primeros diez.
 */
const MAXIMO_TERMINOS = 10;

/**
 * Parte lo escrito en términos: separa por espacios y descarta los vacíos.
 *
 * Exportada porque las pruebas la usan directamente y porque `construirBusquedaPorTerminos`
 * necesita poder devolver `undefined` cuando no queda ningún término (una consulta de solo
 * espacios no es una búsqueda).
 */
export function separarEnTerminos(consulta: string | undefined): string[] {
  return (consulta ?? '')
    .split(/\s+/)
    .map((termino) => termino.trim())
    .filter((termino) => termino !== '')
    .slice(0, MAXIMO_TERMINOS);
}

/** Un campo buscable: la ruta Prisma hasta él, tal como se escribiría en un `where`. */
export type CampoBuscable<TWhere> = (termino: string) => TWhere;

/**
 * `where` de Prisma para la consulta escrita, o `undefined` si no hay nada que buscar.
 *
 * `campos` recibe un término y devuelve la condición para UN campo — así cada repositorio
 * declara sus campos (incluidos los que cruzan una relación, como el nombre del proveedor de un
 * ingreso) sin que esta función sepa nada de su modelo.
 *
 * ```ts
 * const busqueda = construirBusquedaPorTerminos(filtros.buscar, [
 *   (t) => ({ sku: { contains: t, mode: 'insensitive' } }),
 *   (t) => ({ descripcion: { contains: t, mode: 'insensitive' } }),
 * ]);
 * ```
 */
export function construirBusquedaPorTerminos<TWhere>(
  consulta: string | undefined,
  campos: readonly CampoBuscable<TWhere>[],
): { AND: { OR: TWhere[] }[] } | undefined {
  const terminos = separarEnTerminos(consulta);
  if (terminos.length === 0 || campos.length === 0) return undefined;

  return {
    // Y entre términos: cada palabra que se escribe estrecha el resultado.
    AND: terminos.map((termino) => ({
      // O entre campos: da igual en cuál de ellos aparezca.
      OR: campos.map((campo) => campo(termino)),
    })),
  };
}

/**
 * Los dígitos de un término, o `null` si no tiene ninguno.
 *
 * Los documentos se identifican por un correlativo numérico (`salidas.numero`,
 * `cotizaciones.numero`) que el usuario ve formateado como `COT-000042`. Buscando "COT-42",
 * "42" o "cot 42" debe encontrarlo, así que de cada término se extraen sus dígitos para
 * compararlos con el número. Un término sin dígitos devuelve `null` y simplemente no aporta
 * esa alternativa — buscar "3M" no puede reventar la consulta ni devolver algo arbitrario.
 *
 * Se descartan los ceros a la izquierda con `BigInt`, para que "000042" y "42" sean lo mismo.
 */
export function digitosDelTermino(termino: string): bigint | null {
  const soloDigitos = termino.replace(/\D/g, '');
  if (soloDigitos === '') return null;
  try {
    return BigInt(soloDigitos);
  } catch {
    // Un número tan largo que no cabe ni en BigInt no es un correlativo de este sistema.
    return null;
  }
}
