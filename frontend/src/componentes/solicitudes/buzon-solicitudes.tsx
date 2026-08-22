'use client';

/**
 * Buzón de solicitudes del super administrador (US36, FR-148…FR-157).
 *
 * Client Component porque todo aquí es estado de navegador: el filtro vigente, el formulario de
 * alta y cuál solicitud se está refinando en este momento. No hay nada que renderizar en servidor
 * que valga el viaje.
 *
 * ## El alta está SIEMPRE arriba y abierta
 *
 * No detrás de un botón "Nueva solicitud" ni en un diálogo, a diferencia del resto de listados del
 * sistema. Es deliberado: quien anota está en mitad de otra cosa y acaba de notar que algo falta
 * (FR-149). Un clic de más entre la idea y el campo de texto es un clic donde la idea se pierde, y
 * un pedido no anotado no se implementa nunca.
 *
 * ## Las dos cajas de texto no se mezclan nunca
 *
 * Lo que escribió la persona y lo que redactó el modelo se muestran por separado, siempre (FR-152).
 * Es lo único que permite darse cuenta de que el modelo entendió otra cosa — si la pantalla
 * mostrara solo el prompt, esa divergencia sería invisible justo cuando importa.
 *
 * Ocultar controles aquí es UX, no seguridad: la autoridad es `SuperAdminGuard` (FR-003).
 */
import { useCallback, useEffect, useState } from 'react';
import type { EstadoSolicitud, PaginaSolicitudes, Solicitud } from '@trazo/compartido';
import { ErrorApi } from '@/lib/api/cliente';
import {
  cambiarEstadoSolicitud,
  crearSolicitud,
  listarSolicitudes,
  refinarSolicitud,
} from '@/lib/api/solicitudes';

/** Los filtros de la barra superior. `TODAS` no viaja al servidor: es la ausencia de filtro. */
const FILTROS = [
  { clave: 'TODAS', etiqueta: 'Todas' },
  { clave: 'PENDIENTE', etiqueta: 'Pendientes' },
  { clave: 'COMPLETADA', etiqueta: 'Completadas' },
  { clave: 'DESCARTADA', etiqueta: 'Descartadas' },
] as const;

type ClaveFiltro = (typeof FILTROS)[number]['clave'];

const ETIQUETA_ESTADO: Record<EstadoSolicitud, string> = {
  PENDIENTE: 'Pendiente',
  COMPLETADA: 'Completada',
  DESCARTADA: 'Descartada',
};

export function BuzonSolicitudes() {
  const [filtro, setFiltro] = useState<ClaveFiltro>('TODAS');
  const [pagina, setPagina] = useState<PaginaSolicitudes | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [erroresCampo, setErroresCampo] = useState<Record<string, string>>({});

  /** Id de la solicitud que se está refinando ahora mismo, para no bloquear la pantalla entera. */
  const [refinandoId, setRefinandoId] = useState<string | null>(null);
  /** Aviso del último refinado que no salió bien, junto a la solicitud que lo produjo (FR-155). */
  const [avisoRefinado, setAvisoRefinado] = useState<{ id: string; texto: string } | null>(null);

  const recargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setPagina(await listarSolicitudes(filtro === 'TODAS' ? {} : { estado: filtro }));
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : 'No se pudo cargar el buzón de solicitudes.');
    } finally {
      setCargando(false);
    }
  }, [filtro]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  async function anotar(evento: React.FormEvent) {
    evento.preventDefault();
    setGuardando(true);
    setErroresCampo({});
    setError(null);
    try {
      await crearSolicitud({ titulo: titulo.trim(), descripcion: descripcion.trim() });
      setTitulo('');
      setDescripcion('');
      await recargar();
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        setErroresCampo(fallo.campos ?? {});
        if (!fallo.campos) setError(fallo.mensaje);
      } else {
        setError('No se pudo guardar la solicitud.');
      }
    } finally {
      setGuardando(false);
    }
  }

  async function refinar(solicitud: Solicitud) {
    setRefinandoId(solicitud.id);
    setAvisoRefinado(null);
    try {
      const resultado = await refinarSolicitud(solicitud.id);
      if (!resultado.disponible) {
        // No es un error de la API: la solicitud sigue intacta y el buzón sigue vivo (FR-155).
        setAvisoRefinado({ id: solicitud.id, texto: resultado.aviso ?? 'El refinado no está disponible.' });
        return;
      }
      await recargar();
    } catch (fallo) {
      setAvisoRefinado({
        id: solicitud.id,
        texto: fallo instanceof ErrorApi ? fallo.mensaje : 'No se pudo refinar la solicitud.',
      });
    } finally {
      setRefinandoId(null);
    }
  }

  async function moverA(solicitud: Solicitud, estado: EstadoSolicitud) {
    try {
      await cambiarEstadoSolicitud(solicitud.id, estado);
      await recargar();
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : 'No se pudo cambiar el estado.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Alta: siempre visible y siempre abierta — ver el TSDoc de cabecera. */}
      <form className="card flex flex-col gap-3" onSubmit={anotar}>
        <div className="field">
          <label htmlFor="titulo-solicitud">Qué falta</label>
          <input
            id="titulo-solicitud"
            className="input"
            value={titulo}
            maxLength={150}
            placeholder="Filtrar el reporte de consumo por proveedor"
            onChange={(evento) => setTitulo(evento.target.value)}
          />
          {erroresCampo.titulo && (
            <span role="alert" className="text-muted">
              {erroresCampo.titulo}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="descripcion-solicitud">Cuéntalo con tus palabras</label>
          <textarea
            id="descripcion-solicitud"
            className="input"
            rows={4}
            value={descripcion}
            maxLength={5000}
            placeholder="Cuando reviso el consumo de un cliente quiero poder ver solo lo que vino de un proveedor, porque hoy toca exportar a Excel y filtrar a mano."
            onChange={(evento) => setDescripcion(evento.target.value)}
          />
          {erroresCampo.descripcion && (
            <span role="alert" className="text-muted">
              {erroresCampo.descripcion}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Anotar solicitud'}
          </button>
          <span className="text-muted">Sin formato. La estructura la pone el refinado, después.</span>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((opcion) => (
          <button
            key={opcion.clave}
            type="button"
            className={filtro === opcion.clave ? 'btn btn-secondary' : 'btn btn-ghost'}
            aria-pressed={filtro === opcion.clave}
            onClick={() => setFiltro(opcion.clave)}
          >
            {opcion.etiqueta}
          </button>
        ))}
        {pagina && (
          <span className="tag" title="Solicitudes que están esperando trabajo, con cualquier filtro">
            {pagina.pendientes} pendiente{pagina.pendientes === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="card">
          {error}
        </div>
      )}

      {cargando && <p className="text-muted">Cargando…</p>}

      {!cargando && pagina?.datos.length === 0 && (
        <div className="card">
          <p className="text-muted" style={{ margin: 0 }}>
            {filtro === 'TODAS'
              ? 'Todavía no has anotado nada. La próxima vez que uses el sistema y notes que algo falta, escríbelo aquí antes de que se te olvide.'
              : 'No hay solicitudes en este estado.'}
          </p>
        </div>
      )}

      {pagina?.datos.map((solicitud) => (
        <TarjetaSolicitud
          key={solicitud.id}
          solicitud={solicitud}
          refinando={refinandoId === solicitud.id}
          aviso={avisoRefinado?.id === solicitud.id ? avisoRefinado.texto : null}
          onRefinar={() => void refinar(solicitud)}
          onMover={(estado) => void moverA(solicitud, estado)}
        />
      ))}
    </div>
  );
}

function TarjetaSolicitud({
  solicitud,
  refinando,
  aviso,
  onRefinar,
  onMover,
}: {
  solicitud: Solicitud;
  refinando: boolean;
  aviso: string | null;
  onRefinar: () => void;
  onMover: (estado: EstadoSolicitud) => void;
}) {
  const [copiado, setCopiado] = useState(false);

  /** Copiar en UN gesto es el punto del módulo (FR-157): el prompt existe para salir de aquí. */
  async function copiar() {
    if (!solicitud.promptRefinado) return;
    try {
      await navigator.clipboard.writeText(solicitud.promptRefinado);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin portapapeles (contexto no seguro o permiso denegado) el texto sigue visible y
      // seleccionable a mano: se pierde la comodidad, no la función.
      setCopiado(false);
    }
  }

  return (
    <article className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong style={{ flex: 1 }}>{solicitud.titulo}</strong>
        <span className="tag">{ETIQUETA_ESTADO[solicitud.estado]}</span>
      </div>

      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{solicitud.descripcion}</p>

      <p className="text-muted" style={{ margin: 0 }}>
        Anotada por {solicitud.creadaPor.nombreCompleto} el{' '}
        {new Date(solicitud.creadaEn).toLocaleDateString('es-CO')}
        {solicitud.estadoCambiadoPor && solicitud.estadoCambiadoEn && (
          <>
            {' · '}
            {ETIQUETA_ESTADO[solicitud.estado].toLowerCase()} por {solicitud.estadoCambiadoPor.nombreCompleto} el{' '}
            {new Date(solicitud.estadoCambiadoEn).toLocaleDateString('es-CO')}
          </>
        )}
      </p>

      {aviso && (
        <div role="alert" className="card">
          {aviso}
        </div>
      )}

      {solicitud.promptRefinado && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <strong style={{ flex: 1 }}>Prompt de implementación</strong>
            {solicitud.refinadoEn && (
              <span className="text-muted">
                generado el {new Date(solicitud.refinadoEn).toLocaleDateString('es-CO')}
              </span>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => void copiar()}>
              {copiado ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <pre
            className="input"
            style={{ whiteSpace: 'pre-wrap', maxHeight: '22rem', overflowY: 'auto', margin: 0 }}
          >
            {solicitud.promptRefinado}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {solicitud.estado === 'PENDIENTE' && (
          <button type="button" className="btn btn-ghost" onClick={onRefinar} disabled={refinando}>
            {refinando ? 'Refinando…' : solicitud.promptRefinado ? 'Volver a refinar' : 'Refinar'}
          </button>
        )}
        {solicitud.estado !== 'COMPLETADA' && (
          <button type="button" className="btn btn-ghost" onClick={() => onMover('COMPLETADA')}>
            Marcar completada
          </button>
        )}
        {solicitud.estado !== 'DESCARTADA' && (
          <button type="button" className="btn btn-ghost" onClick={() => onMover('DESCARTADA')}>
            Descartar
          </button>
        )}
        {solicitud.estado !== 'PENDIENTE' && (
          <button type="button" className="btn btn-ghost" onClick={() => onMover('PENDIENTE')}>
            Reabrir
          </button>
        )}
      </div>
    </article>
  );
}
