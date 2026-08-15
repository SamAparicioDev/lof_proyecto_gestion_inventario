'use client';

/**
 * Diálogo de alta y edición de categoría (US15, FR-084/FR-085).
 *
 * Un solo componente para los dos modos, igual que `proyecto-form.tsx`: los campos y las reglas
 * son idénticos, no hay nada que solo se pueda fijar al crear.
 *
 * El duplicado se muestra junto al campo `nombre`, no como error general: el backend responde
 * `400` con `campos.nombre` diciendo con qué categoría EXISTENTE choca —"ferretería " contra
 * "Ferretería"—, que es la información que le falta al usuario para entender por qué se le
 * rechaza algo que él ve distinto (FR-085).
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { esquemaCrearCategoria, type DatosCrearCategoria } from '@trazo/compartido';
import { actualizarCategoria, crearCategoria, type CategoriaListada } from '@/lib/api/categorias';
import { ErrorApi } from '@/lib/api/cliente';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const CAMPOS_VALIDOS = new Set<keyof DatosCrearCategoria>(['nombre', 'descripcion']);

interface DialogoCategoriaProps {
  /** Presente en modo edición; ausente en alta. */
  categoria: CategoriaListada | null;
  onCerrar: () => void;
  onGuardado: () => void;
}

export function DialogoCategoria({ categoria, onCerrar, onGuardado }: DialogoCategoriaProps): React.JSX.Element {
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosCrearCategoria>({
    resolver: zodResolver(esquemaCrearCategoria),
    defaultValues: {
      nombre: categoria?.nombre ?? '',
      descripcion: categoria?.descripcion ?? '',
    },
  });

  async function alEnviar(datos: DatosCrearCategoria): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      if (categoria) {
        await actualizarCategoria(categoria.id, datos);
      } else {
        await crearCategoria(datos);
      }
      onGuardado();
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        setErrorGeneral(fallo.mensaje);
        for (const [campo, mensaje] of Object.entries(fallo.campos ?? {})) {
          if (CAMPOS_VALIDOS.has(campo as keyof DatosCrearCategoria)) {
            setError(campo as keyof DatosCrearCategoria, { message: mensaje });
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
        aria-labelledby="titulo-categoria"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-title" id="titulo-categoria">
          {categoria ? 'Editar categoría' : 'Nueva categoría'}
        </div>

        <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-3" noValidate>
          <div className="field">
            <label htmlFor="categoria-nombre">Nombre</label>
            <input id="categoria-nombre" className="input" aria-invalid={!!errors.nombre} {...register('nombre')} />
            {errors.nombre && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.nombre.message}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="categoria-descripcion">Descripción (opcional)</label>
            <textarea id="categoria-descripcion" className="input" rows={2} {...register('descripcion')} />
            {errors.descripcion && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.descripcion.message}
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
              {enviando ? 'Guardando…' : categoria ? 'Guardar cambios' : 'Crear categoría'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
