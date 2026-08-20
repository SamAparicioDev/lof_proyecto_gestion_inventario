'use client';

/**
 * Diálogo de CORRECCIÓN DE CANTIDAD (US31, FR-130) — cuadrar el sistema con el conteo físico
 * sin fabricar un ingreso ni una salida.
 *
 * ## Dos decisiones de la pantalla, y por qué
 *
 * 1. **Se pide la cantidad CONTADA, no la diferencia.** Es lo que la persona tiene delante al
 *    terminar de contar. Pedirle el delta es pedirle justo la resta en la que se equivoca, y el
 *    error resultante entraría al sistema como un hecho. El campo llega precargado con lo que el
 *    sistema cree tener, así que corregir "40 → 47" es cambiar un número, y la diferencia se
 *    muestra en vivo para que se vea qué se va a registrar antes de confirmar.
 * 2. **El motivo es obligatorio y está arriba, no escondido.** Sin documento detrás, es lo único
 *    que justifica el movimiento (Principio II). Tratarlo como un campo opcional al final
 *    invitaría a dejarlo en blanco, que es como se pierde la trazabilidad sin que nadie lo note.
 *
 * La validación de forma la hace el MISMO esquema Zod que valida el servidor
 * (`esquemaCorregirCantidad` de `@trazo/compartido`) — el navegador da la respuesta inmediata y
 * el servidor sigue siendo la autoridad (Principio IV).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { esquemaCorregirCantidad, type DatosCorregirCantidad, type FilaInventario } from '@trazo/compartido';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { corregirCantidadProducto } from '@/lib/api/inventario';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoCantidadConUnidad } from '@/lib/formato';

/** Mismo texto que el resto de la tabla de inventario ante un fallo de red (patrón del
 *  proyecto: sin toasts, el aviso se pinta dentro de la propia tarjeta). */
const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

interface Propiedades {
  fila: FilaInventario;
  alCerrar: () => void;
  alGuardar: () => void;
}

export function DialogoCorregirCantidad({ fila, alCerrar, alGuardar }: Propiedades) {
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<DatosCorregirCantidad>({
    resolver: zodResolver(esquemaCorregirCantidad),
    defaultValues: { cantidad: fila.stock, motivo: '' },
  });

  const cantidadEscrita = watch('cantidad');
  const diferencia = Number.isFinite(cantidadEscrita) ? cantidadEscrita - fila.stock : 0;

  async function alEnviar(datos: DatosCorregirCantidad): Promise<void> {
    setErrorGeneral(null);
    try {
      await corregirCantidadProducto(fila.producto.id, datos);
      alGuardar();
    } catch (error) {
      setErrorGeneral(error instanceof ErrorApi ? error.mensaje : MENSAJE_ERROR_RED);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => !isSubmitting && alCerrar()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="corregir-cantidad-titulo"
        style={{ maxWidth: 520, width: '100%' }}
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-title" id="corregir-cantidad-titulo">
          Corregir cantidad
        </div>
        <p className="text-muted" style={{ marginTop: 4 }}>
          {fila.producto.sku} — {fila.producto.descripcion}
        </p>

        <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-3" noValidate>
          <div className="field">
            <label htmlFor="corregir-cantidad">Cantidad contada</label>
            <input
              id="corregir-cantidad"
              type="number"
              step="1"
              min={0}
              className="input"
              aria-invalid={!!errors.cantidad}
              aria-describedby="corregir-cantidad-ayuda"
              {...register('cantidad', { valueAsNumber: true })}
            />
            <p id="corregir-cantidad-ayuda" className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
              El sistema tiene registradas {formatoCantidadConUnidad(fila.stock, fila.producto.unidadMedida)}.
              {diferencia !== 0 && (
                <>
                  {' '}
                  Se registrará {diferencia > 0 ? 'una entrada' : 'una salida'} de{' '}
                  <strong>{Math.abs(diferencia)}</strong> por ajuste.
                </>
              )}
            </p>
            {errors.cantidad && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.cantidad.message}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="corregir-motivo">Motivo</label>
            <textarea
              id="corregir-motivo"
              className="input"
              rows={3}
              placeholder="Conteo físico de agosto, mercancía averiada, devolución del cliente…"
              aria-invalid={!!errors.motivo}
              {...register('motivo')}
            />
            {errors.motivo && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.motivo.message}
              </p>
            )}
          </div>

          {errorGeneral && (
            <p role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)', marginBottom: 12 }}>
              {errorGeneral}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando…' : 'Corregir cantidad'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={alCerrar} disabled={isSubmitting}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
