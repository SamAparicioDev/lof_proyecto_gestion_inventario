'use client';

/**
 * Logo del cliente en su ficha (T122, US11 — FR-066) — `/clientes/[id]`. Muestra la VISTA
 * PREVIA del logo cargado y, para quien puede editar el cliente, los botones de cargar,
 * reemplazar y quitar.
 *
 * ## Quién ve qué
 *
 * La vista previa la ve cualquiera que pueda abrir la ficha (`clientes.ver`, ya resuelto por la
 * página). Los botones de escritura se muestran con `clientes.editar` —el MISMO permiso que
 * exigen `PUT`/`DELETE /api/clientes/:id/logo`— leído con `usePuede()` del contexto de sesión,
 * nunca por nombre de rol (frontend/CLAUDE.md). Ocultar los botones es UX: la autoridad es el
 * guard del backend, que responde `403` a quien llame el endpoint a mano.
 *
 * ## Por qué la vista previa se decide con `tieneLogo` y no intentando cargar la imagen
 *
 * `GET /api/clientes/:id/logo` responde `404` cuando no hay logo. Renderizar siempre un `<img>`
 * y esconderlo con `onError` dejaría un `404` en la consola del navegador en la ficha de la
 * MAYORÍA de los clientes (los que aún no tienen logo) y un parpadeo de imagen rota. La ficha
 * ya sabe la respuesta: `GET /api/clientes/:id` trae `tieneLogo`.
 *
 * ## Por qué `<img>` y no `next/image`
 *
 * El logo lo sirve una RUTA DE API que devuelve bytes con `Content-Disposition: inline` y una
 * marca de tiempo en la query para invalidar la caché tras reemplazarlo. El optimizador de Next
 * no aporta nada sobre una imagen de ≤ 500 KB del mismo origen y sí exigiría configurar
 * `images.remotePatterns`/`unoptimized` para una URL que cambia en cada carga.
 *
 * ## Cascada Nocturne ↔ Tailwind (docs/diseno-nocturne.md)
 *
 * `.card` reclama `display`, `flex-direction`, `gap`, `padding`, `border-radius` y `background`,
 * y el CSS de Nocturne está SIN capa, así que gana siempre sobre las utilidades de Tailwind. Por
 * eso el layout en fila vive en un `<div>` INTERNO sin ninguna clase de Nocturne — mismo patrón
 * que `componentes/comunes/barra-filtros.tsx`.
 *
 * Errores en un `<div role="alert">` dentro de la propia tarjeta; no hay sistema de toasts
 * (frontend/CLAUDE.md).
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Image as IconoImagen, Trash, UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { eliminarLogoCliente, subirLogoCliente } from '@/lib/api/clientes';
import { ErrorApi } from '@/lib/api/cliente';
import { PERMISOS } from '@/lib/permisos';
import { usePuede } from '@/lib/sesion';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

/** Formatos que el backend admite (data-model.md § Logo del cliente). El `accept` del input es
 *  una comodidad para el usuario, NUNCA un control: el servidor valida los bytes reales. */
const FORMATOS_ADMITIDOS = 'image/png,image/jpeg';

export function LogoCliente({ clienteId, tieneLogo }: { clienteId: number; tieneLogo: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Cambia en cada carga/borrado para que el navegador no sirva la imagen anterior desde su
   *  caché: la URL del logo es siempre la misma, solo cambia su contenido. */
  const [version, setVersion] = useState(0);
  const puedeEditar = usePuede(PERMISOS.CLIENTES_EDITAR);

  async function alElegirArchivo(evento: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const archivo = evento.target.files?.[0];
    if (!archivo) return;

    setError(null);
    setProcesando(true);
    try {
      await subirLogoCliente(clienteId, archivo);
      setVersion((anterior) => anterior + 1);
      // El dato `tieneLogo` vive en el Server Component que renderiza esta ficha.
      router.refresh();
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : MENSAJE_ERROR_RED);
    } finally {
      setProcesando(false);
      // Se limpia el input para que elegir OTRA VEZ el mismo archivo (tras corregirlo) vuelva a
      // disparar `change`; sin esto, el navegador considera que el valor no cambió.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function alQuitar(): Promise<void> {
    setError(null);
    setProcesando(true);
    try {
      await eliminarLogoCliente(clienteId);
      setVersion((anterior) => anterior + 1);
      router.refresh();
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.mensaje : MENSAJE_ERROR_RED);
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="card gap-4 p-5">
      {/* Contenedor de layout SIN clases de Nocturne (ver TSDoc: regla de cascada). */}
      <div className="flex flex-wrap items-center gap-4">
        <VistaPreviaLogo clienteId={clienteId} tieneLogo={tieneLogo} version={version} />

        <div className="flex flex-col gap-2" style={{ flex: 1, minWidth: 240 }}>
          <div>
            <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Logo del cliente
            </div>
            <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              {tieneLogo
                ? 'Aparece en los documentos y reportes que corresponden solo a este cliente.'
                : 'Sin logo cargado. Los documentos de este cliente se generan igual, sin logo.'}
            </p>
          </div>

          {puedeEditar && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={procesando}
                onClick={() => inputRef.current?.click()}
              >
                <UploadSimple size={16} /> {tieneLogo ? 'Reemplazar logo' : 'Subir logo'}
              </button>
              {tieneLogo && (
                <button type="button" className="btn btn-ghost" disabled={procesando} onClick={alQuitar}>
                  <Trash size={16} /> Quitar logo
                </button>
              )}
              <span className="text-muted" style={{ fontSize: 12 }}>
                {procesando ? 'Procesando…' : 'PNG o JPEG, máximo 500 KB.'}
              </span>
              <input
                ref={inputRef}
                type="file"
                name="logo"
                accept={FORMATOS_ADMITIDOS}
                onChange={alElegirArchivo}
                style={{ display: 'none' }}
                aria-label="Archivo del logo del cliente"
              />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

/** Recuadro de vista previa: la imagen si hay logo, o un marcador neutro si no (nunca una
 *  imagen rota — ver TSDoc del componente). */
function VistaPreviaLogo({
  clienteId,
  tieneLogo,
  version,
}: {
  clienteId: number;
  tieneLogo: boolean;
  version: number;
}) {
  const marco: React.CSSProperties = {
    width: 132,
    height: 72,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // Tokens de Nocturne, nunca hex sueltos (frontend/CLAUDE.md): `--color-divider` es el mismo
    // borde que usan las tablas y `--color-bg` hunde el recuadro respecto a la `.card`.
    border: '1px solid var(--color-divider)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-bg)',
    overflow: 'hidden',
  };

  if (!tieneLogo) {
    return (
      <div style={marco} className="text-muted" aria-label="El cliente no tiene logo cargado">
        <IconoImagen size={24} />
      </div>
    );
  }

  return (
    <div style={marco}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ver TSDoc: la fuente es una ruta
          de API con una marca de versión en la query, no un asset estático que Next pueda
          optimizar. */}
      <img
        src={`/api/clientes/${clienteId}/logo?v=${version}`}
        alt="Logo del cliente"
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
      />
    </div>
  );
}
