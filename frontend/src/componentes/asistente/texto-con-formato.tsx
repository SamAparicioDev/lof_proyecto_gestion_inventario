/**
 * Pinta el texto del asistente respetando el formato que trae (US33, FR-133).
 *
 * ## Por qué NO se usa una librería de Markdown
 *
 * No es por ahorrar una dependencia. El texto que llega aquí lo redactó un modelo que acaba de
 * LEER la base de datos: descripciones de producto, nombres de cliente, motivos de ajuste. Todo eso
 * lo escriben personas en formularios, así que una descripción de producto puede contener
 * `<script>` o `<img onerror=...>`, y el modelo la repetirá tal cual dentro de su respuesta.
 *
 * Con una librería de Markdown la seguridad depende de acordarse de desactivar el HTML crudo y de
 * sanear la salida — es decir, de una configuración correcta que nadie vuelve a revisar. Aquí no
 * hay nada que configurar: este componente NUNCA inyecta HTML. Construye elementos de React a
 * partir del texto, y React escapa el contenido por definición. La inyección no es que esté
 * bloqueada: es que no hay por dónde.
 *
 * ## Qué subconjunto se soporta, y por qué ese
 *
 * Exactamente lo que el modelo usa al responder sobre inventario, que es poco: negrilla para las
 * cifras, listas para enumerar productos, y saltos de párrafo. Las instrucciones del asistente
 * (`instrucciones-asistente.ts`) le dicen que se limite a esto, así que las dos mitades —lo que
 * escribe y lo que se pinta— se mantienen juntas a propósito. Cualquier marca fuera del
 * subconjunto se muestra tal cual, que es el fallo correcto: texto de más, nunca formato roto.
 */

/** Bloques separados por una línea en blanco: párrafos y listas. */
const SEPARADOR_DE_BLOQUES = /\n\s*\n/;

/** Una línea de lista: `- algo`, `* algo` o `1. algo`. */
const LINEA_DE_LISTA = /^\s*([*-]|\d+\.)\s+(.*)$/;

/** Encabezado tipo `## Título` — se pinta como línea en negrilla, no como `<h*>`: dentro de una
 *  conversación, un encabezado de documento desentona más de lo que ordena. */
const ENCABEZADO = /^\s*#{1,6}\s+(.*)$/;

/**
 * Marcas en línea. El orden importa: `**negrilla**` se reconoce ANTES que `*cursiva*`, porque si
 * no, los dos primeros asteriscos de `**x**` se leerían como una cursiva vacía.
 */
const MARCAS_EN_LINEA = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;

export function TextoConFormato({ texto }: { texto: string }) {
  const bloques = texto.trim().split(SEPARADOR_DE_BLOQUES);
  return (
    <div className="flex flex-col gap-2">
      {bloques.map((bloque, indice) => (
        <Bloque key={indice} bloque={bloque} />
      ))}
    </div>
  );
}

/** Un bloque es una lista si TODAS sus líneas con contenido lo son; si no, es un párrafo. Se exige
 *  "todas" y no "alguna" para que una frase que empiece con un guion no se convierta en lista. */
function Bloque({ bloque }: { bloque: string }) {
  const lineas = bloque.split('\n').filter((linea) => linea.trim() !== '');
  if (lineas.length === 0) return null;

  const elementos = lineas.map((linea) => LINEA_DE_LISTA.exec(linea));
  if (elementos.every((coincidencia) => coincidencia !== null)) {
    const numerada = /^\s*\d+\./.test(lineas[0] ?? '');
    const Lista = numerada ? 'ol' : 'ul';
    return (
      <Lista style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {elementos.map((coincidencia, indice) => (
          <li key={indice}>
            <EnLinea texto={coincidencia?.[2] ?? ''} />
          </li>
        ))}
      </Lista>
    );
  }

  return (
    <p style={{ margin: 0 }}>
      {lineas.map((linea, indice) => {
        const encabezado = ENCABEZADO.exec(linea);
        return (
          <span key={indice}>
            {indice > 0 && <br />}
            {encabezado ? <strong><EnLinea texto={encabezado[1] ?? ''} /></strong> : <EnLinea texto={linea} />}
          </span>
        );
      })}
    </p>
  );
}

/** Negrilla, cursiva y código dentro de una línea. Todo lo demás se pinta literal. */
function EnLinea({ texto }: { texto: string }) {
  const trozos = texto.split(MARCAS_EN_LINEA).filter((trozo) => trozo !== '');
  return (
    <>
      {trozos.map((trozo, indice) => {
        if (trozo.startsWith('**') && trozo.endsWith('**')) {
          return <strong key={indice}>{trozo.slice(2, -2)}</strong>;
        }
        if (trozo.startsWith('`') && trozo.endsWith('`')) {
          return (
            <code key={indice} style={{ fontSize: '0.92em' }}>
              {trozo.slice(1, -1)}
            </code>
          );
        }
        if (trozo.startsWith('*') && trozo.endsWith('*') && trozo.length > 2) {
          return <em key={indice}>{trozo.slice(1, -1)}</em>;
        }
        return <span key={indice}>{trozo}</span>;
      })}
    </>
  );
}
