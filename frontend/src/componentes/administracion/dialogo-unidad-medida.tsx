'use client';

/**
 * Diálogo de alta y edición de unidad de medida (US17, FR-101).
 *
 * Mismo patrón que `dialogo-categoria.tsx` y `dialogo-proveedor.tsx`; lo particular de esta
 * pantalla son sus DOS unicidades. El backend responde `400` anclando el mensaje al campo que
 * choca —`campos.nombre` si el conflicto es de nombre, `campos.abreviatura` si es de
 * abreviatura—, y aquí se pinta junto a ese campo. Un error general diciendo "ya existe" dejaría
 * al usuario adivinando cuál de los dos textos tiene que cambiar.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { esquemaCrearUnidadMedida, type DatosCrearUnidadMedida } from '@trazo/compartido';
import { ErrorApi } from '@/lib/api/cliente';
import {
  actualizarUnidadMedida,
  crearUnidadMedida,
  type UnidadMedidaListada,
} from '@/lib/api/unidades-medida';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const CAMPOS_VALIDOS = new Set<keyof DatosCrearUnidadMedida>(['nombre', 'abreviatura']);

interface DialogoUnidadMedidaProps {
  /** Presente en modo edición; ausente en alta. */
  unidad: UnidadMedidaListada | null;
  onCerrar: () => void;
  onGuardado: () => void;
}

export function DialogoUnidadMedida({
  unidad,
  onCerrar,
  onGuardado,
}: DialogoUnidadMedidaProps): React.JSX.Element {
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosCrearUnidadMedida>({
    resolver: zodResolver(esquemaCrearUnidadMedida),
    defaultValues: {
      nombre: unidad?.nombre ?? '',
      abreviatura: unidad?.abreviatura ?? '',
    },
  });

  async function alEnviar(datos: DatosCrearUnidadMedida): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      if (unidad) {
        await actualizarUnidadMedida(unidad.id, datos);
      } else {
        await crearUnidadMedida(datos);
      }
      onGuardado();
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        setErrorGeneral(fallo.mensaje);
        for (const [campo, mensaje] of Object.entries(fallo.campos ?? {})) {
          if (CAMPOS_VALIDOS.has(campo as keyof DatosCrearUnidadMedida)) {
            setError(campo as keyof DatosCrearUnidadMedida, { message: mensaje });
          }
        }
      } else {
        setErrorGeneral(MENSAJE_ERROR_RED);
      }
      setEnviando(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => !enviando && onCerrar()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-unidad-medida"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-title" id="titulo-unidad-medida">
          {unidad ? 'Editar unidad de medida' : 'Nueva unidad de medida'}
        </div>

        <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-3" noValidate>
          <div className="field">
            <label htmlFor="unidad-nombre">Nombre</label>
            <input
              id="unidad-nombre"
              className="input"
              placeholder="Kilogramo"
              aria-invalid={!!errors.nombre}
              {...register('nombre')}
            />
            {errors.nombre && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.nombre.message}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="unidad-abreviatura">Abreviatura</label>
            <input
              id="unidad-abreviatura"
              className="input"
              placeholder="kg"
              aria-invalid={!!errors.abreviatura}
              {...register('abreviatura')}
            />
            <p className="text-muted" style={{ fontSize: 12, marginTop: 5 }}>
              Es lo que se muestra junto a las cantidades en el inventario y en los documentos.
            </p>
            {errors.abreviatura && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.abreviatura.message}
              </p>
            )}
          </div>

          {errorGeneral && (
            <div role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>
              {errorGeneral}
            </div>
          )}

          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={enviando}>
              {enviando ? 'Guardando…' : unidad ? 'Guardar cambios' : 'Crear unidad'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
