'use client';

/**
 * Conversación con el ASISTENTE DE CONSULTAS (US33, FR-133/FR-135/FR-136).
 *
 * ## Tres decisiones de pantalla, y su porqué
 *
 * 1. **Las fuentes se ven, plegadas.** Cada respuesta lleva debajo qué consultó el asistente para
 *    darla. No es adorno de ingeniería: es lo que convierte una cifra en un chat en una cifra
 *    verificable (FR-135). Van plegadas porque la mayoría de las veces no se miran, y desplegables
 *    porque el día que un número extrañe, esa lista es la respuesta.
 * 2. **La indisponibilidad se ve distinta de una respuesta.** Cuando el servicio no está,
 *    `disponible: false` pinta un aviso y no un turno del asistente: un mensaje de "no puedo"
 *    con la misma cara que un dato es la forma más rápida de que alguien lo lea como dato.
 * 3. **La conversación no se guarda.** Vive en memoria y se acaba al salir. El botón de empezar de
 *    nuevo está a la vista porque el historial viaja en cada consulta y cuesta: diez turnos
 *    sostienen un hilo, veinte solo encarecen.
 *
 * La espera es real —el asistente encadena consultas y el modelo piensa entre ellas—, así que el
 * estado de carga es explícito en vez de un instante fingido.
 */
import { useEffect, useRef, useState } from 'react';
import { PaperPlaneRight, Sparkle } from '@phosphor-icons/react';
import type { FuenteConsultada, RespuestaAsistente, TurnoAsistente } from '@trazo/compartido';
import { consultarAsistente } from '@/lib/api/asistente';
import { ErrorApi } from '@/lib/api/cliente';
import { TextoConFormato } from './texto-con-formato';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

/** Máximo de turnos que el backend acepta en el historial (`esquemaConsultaAsistente`). Se recorta
 *  aquí para no provocar un 400 que el usuario no puede entender ni corregir. */
const TURNOS_ENVIADOS = 10;

/** Preguntas de ejemplo — no son decoración: dicen QUÉ clase de cosas sabe responder, que es la
 *  duda real de quien abre un chat por primera vez. */
const EJEMPLOS = [
  '¿Qué productos están por acabarse?',
  '¿Cuánto disponible tengo de cemento?',
  '¿Cuánto consumió mi cliente más grande este mes?',
  '¿Por qué cambió la cantidad de este producto?',
];

interface TurnoEnPantalla extends TurnoAsistente {
  fuentes?: FuenteConsultada[];
  aviso?: boolean;
}

export function ConversacionAsistente() {
  const [turnos, setTurnos] = useState<TurnoEnPantalla[]>([]);
  const [pregunta, setPregunta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const finDeLaLista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finDeLaLista.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turnos, enviando]);

  async function preguntar(texto: string): Promise<void> {
    const limpia = texto.trim();
    if (!limpia || enviando) return;

    setErrorGeneral(null);
    setPregunta('');
    const conLaPregunta: TurnoEnPantalla[] = [...turnos, { rol: 'usuario', texto: limpia }];
    setTurnos(conLaPregunta);
    setEnviando(true);

    try {
      const respuesta: RespuestaAsistente = await consultarAsistente({
        pregunta: limpia,
        // Solo los turnos, sin las fuentes: al modelo le sirve lo que se dijo, no cómo se obtuvo.
        historial: turnos.slice(-TURNOS_ENVIADOS).map(({ rol, texto: dicho }) => ({ rol, texto: dicho })),
      });
      setTurnos([
        ...conLaPregunta,
        {
          rol: 'asistente',
          texto: respuesta.respuesta,
          fuentes: respuesta.fuentes,
          aviso: !respuesta.disponible,
        },
      ]);
    } catch (error) {
      setErrorGeneral(error instanceof ErrorApi ? error.mensaje : MENSAJE_ERROR_RED);
      setTurnos(turnos);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-3" style={{ minHeight: 320 }}>
        {turnos.length === 0 ? (
          <EstadoInicial alElegir={(ejemplo) => void preguntar(ejemplo)} deshabilitado={enviando} />
        ) : (
          turnos.map((turno, indice) => <Turno key={indice} turno={turno} />)
        )}
        {enviando && (
          <p className="text-muted" style={{ fontSize: 14 }} role="status">
            Consultando…
          </p>
        )}
        <div ref={finDeLaLista} />
      </div>

      {errorGeneral && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
          {errorGeneral}
        </p>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(evento) => {
          evento.preventDefault();
          void preguntar(pregunta);
        }}
      >
        <div className="field" style={{ flex: '1 1 260px', marginBottom: 0 }}>
          <label htmlFor="asistente-pregunta">Tu pregunta</label>
          <input
            id="asistente-pregunta"
            className="input"
            autoComplete="off"
            placeholder="¿Cuánto disponible tengo de…?"
            value={pregunta}
            disabled={enviando}
            onChange={(evento) => setPregunta(evento.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={enviando || pregunta.trim() === ''}>
          <PaperPlaneRight size={16} /> {enviando ? 'Consultando…' : 'Preguntar'}
        </button>
        {turnos.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => setTurnos([])} disabled={enviando}>
            Empezar de nuevo
          </button>
        )}
      </form>
    </div>
  );
}

/** Lo que se ve antes de la primera pregunta: qué es esto y qué se le puede preguntar. */
function EstadoInicial({
  alElegir,
  deshabilitado,
}: {
  alElegir: (ejemplo: string) => void;
  deshabilitado: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkle size={18} />
        <strong>Pregúntale al inventario</strong>
      </div>
      <p className="text-muted" style={{ fontSize: 14, margin: 0 }}>
        Responde consultas sobre los datos que ya están en el sistema. No registra ni modifica nada, y
        solo ve lo que tu rol te deja ver.
      </p>
      <div className="flex flex-wrap gap-2">
        {EJEMPLOS.map((ejemplo) => (
          <button
            key={ejemplo}
            type="button"
            className="btn btn-secondary"
            disabled={deshabilitado}
            onClick={() => alElegir(ejemplo)}
          >
            {ejemplo}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Un turno de la conversación. El del asistente puede traer sus fuentes o ser un aviso. */
function Turno({ turno }: { turno: TurnoEnPantalla }) {
  if (turno.rol === 'usuario') {
    return (
      <div style={{ alignSelf: 'flex-end', maxWidth: '90%' }}>
        <div className="tag" style={{ display: 'block', whiteSpace: 'pre-wrap', textAlign: 'left' }}>
          {turno.texto}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '95%' }}>
      {/* Un AVISO se pinta plano y en color de alerta: no es una respuesta, y darle el mismo
          tratamiento tipográfico que a un dato es la forma más rápida de que se lea como un dato. */}
      {turno.aviso ? (
        <p style={{ margin: 0, color: 'var(--color-accent-300)' }} role="alert">
          {turno.texto}
        </p>
      ) : (
        <TextoConFormato texto={turno.texto} />
      )}
      {turno.fuentes && turno.fuentes.length > 0 && <Fuentes fuentes={turno.fuentes} />}
    </div>
  );
}

/** De dónde salió la respuesta (FR-135). Plegado por defecto: se consulta cuando algo extraña. */
function Fuentes({ fuentes }: { fuentes: FuenteConsultada[] }) {
  return (
    <details style={{ marginTop: 6 }}>
      <summary className="text-muted" style={{ fontSize: 12, cursor: 'pointer' }}>
        {fuentes.length === 1 ? '1 consulta' : `${fuentes.length} consultas`} para responder esto
      </summary>
      <ul className="text-muted" style={{ fontSize: 12, margin: '6px 0 0', paddingLeft: 18 }}>
        {fuentes.map((fuente, indice) => (
          <li key={indice}>
            <code>{fuente.herramienta}</code>
            {Object.keys(fuente.argumentos).length > 0 && <> · {JSON.stringify(fuente.argumentos)}</>}
            {!fuente.permitida && <> · sin permiso para tu rol</>}
          </li>
        ))}
      </ul>
    </details>
  );
}
