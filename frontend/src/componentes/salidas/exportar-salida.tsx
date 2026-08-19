'use client';

/**
 * Diálogo de exportación del documento de una salida (US27/T227 — FR-123).
 *
 * ## Por qué esta salida NO usa `BotonesExportar`
 *
 * Las otras once rutas `/export` se resuelven con un `<a href>` porque no hay nada que
 * preguntar: el filtro ya está en la URL de la pantalla. Aquí el archivo no es un informe sino
 * el comprobante de una entrega, y hacen falta dos datos que no están en ninguna parte del
 * sistema: si el documento va con precios y a nombre de quién se imprime la firma. Ninguno de
 * los dos se puede adivinar —el sistema no sabe a quién mandará el cliente a recoger la
 * mercancía—, así que se preguntan antes de generar nada.
 *
 * El LISTADO de salidas sigue exportándose con `BotonesExportar`, sin preguntar: ahí sí es un
 * informe de gestión.
 *
 * ## Validación
 *
 * Reutiliza `esquemaExportDocumentoSalida`, el MISMO esquema con el que el servidor valida la
 * query (validación doble, Principio IV): el navegador da la respuesta inmediata y el servidor
 * sigue siendo la autoridad. Sin esto, un `recibe` vacío llegaría hasta el backend para volver
 * como un `400` genérico en una descarga, que es la peor forma de enterarse.
 *
 * ## La descarga
 *
 * `window.location.assign` sobre el endpoint: la respuesta trae `Content-Disposition:
 * attachment`, así que el navegador descarga el archivo y la página no se mueve. Es lo mismo
 * que hace un `<a href>` normal, solo que con la URL construida a partir de lo respondido en el
 * diálogo.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileArrowDown } from '@phosphor-icons/react';
import { esquemaExportDocumentoSalida, type ExportDocumentoSalida } from '@trazo/compartido';

interface PropiedadesExportarSalida {
  /** Id de la salida — la ruta del documento se arma con él. */
  salidaId: number;
  /** Correlativo de negocio, solo para el texto del diálogo (el usuario piensa en él, no en el id). */
  numero: number;
}

export function ExportarSalida({ salidaId, numero }: PropiedadesExportarSalida) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-secondary no-imprimir" onClick={() => setAbierto(true)}>
        <FileArrowDown size={16} /> Exportar salida
      </button>
      {abierto && <DialogoExportar salidaId={salidaId} numero={numero} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

function DialogoExportar({
  salidaId,
  numero,
  onCerrar,
}: PropiedadesExportarSalida & { onCerrar: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ExportDocumentoSalida>({
    resolver: zodResolver(esquemaExportDocumentoSalida),
    // Los defectos son los del caso habitual: el PDF es lo que se imprime para firmar, y con
    // valores es como salía el documento hasta esta historia. `recibe` nace vacío a propósito:
    // es el único dato que nadie más puede poner.
    defaultValues: { formato: 'pdf', valores: 'con', recibe: '' },
  });

  function alEnviar(datos: ExportDocumentoSalida): void {
    const parametros = new URLSearchParams({
      formato: datos.formato,
      valores: datos.valores,
      recibe: datos.recibe,
    });
    window.location.assign(`/api/salidas/${salidaId}/export?${parametros.toString()}`);
    onCerrar();
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCerrar}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-exportar-salida"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-title" id="titulo-exportar-salida">
          Exportar salida N.º {numero}
        </div>
        <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-3" noValidate>
          <div className="field">
            <label htmlFor="exportar-salida-formato">Formato</label>
            {/* Lista CERRADA y corta: desplegable nativo, no buscador (FR-119). */}
            <select id="exportar-salida-formato" className="input" {...register('formato')}>
              <option value="pdf">PDF (para imprimir y firmar)</option>
              <option value="xlsx">Excel</option>
            </select>
          </div>

          <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={{ fontSize: 13, marginBottom: 6 }}>Valores</legend>
            <label className="flex items-center gap-2" style={{ fontWeight: 400 }}>
              <input type="radio" value="con" {...register('valores')} />
              Con valores — precios, IVA y total
            </label>
            <label className="flex items-center gap-2" style={{ fontWeight: 400, marginTop: 4 }}>
              <input type="radio" value="sin" {...register('valores')} />
              Sin valores — solo producto y cantidad
            </label>
            {errors.valores && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.valores.message}
              </p>
            )}
          </fieldset>

          <div className="field">
            <label htmlFor="exportar-salida-recibe">Recibe la mercancía</label>
            <input
              id="exportar-salida-recibe"
              className="input"
              placeholder="Nombre de quien firma"
              autoComplete="off"
              aria-invalid={!!errors.recibe}
              aria-describedby={errors.recibe ? 'exportar-salida-recibe-error' : 'exportar-salida-recibe-ayuda'}
              {...register('recibe')}
            />
            {errors.recibe ? (
              <p
                id="exportar-salida-recibe-error"
                role="alert"
                style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}
              >
                {errors.recibe.message}
              </p>
            ) : (
              <p id="exportar-salida-recibe-ayuda" style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 5 }}>
                Se imprime bajo la línea de firma, en las dos variantes.
              </p>
            )}
          </div>

          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onCerrar}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary">
              Descargar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
