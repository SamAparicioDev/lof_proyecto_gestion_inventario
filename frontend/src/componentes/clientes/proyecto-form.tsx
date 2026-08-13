'use client';

/**
 * Diálogo de alta/edición de proyecto (T045, FR-036) — reutiliza `esquemaCrearProyecto`
 * (mismo esquema para `POST /api/clientes/:id/proyectos` y `PUT /api/proyectos/:id`,
 * contracts/api-rest.md) dentro de `.dialog` (Nocturne), mismo patrón que
 * `componentes/inventario/dialogo-producto-nuevo.tsx`.
 *
 * Dos modos según la prop `proyecto`: ausente → alta para `clienteId` (ruta anidada,
 * FR-036); presente → edición del proyecto dado (precarga sus valores, `PUT
 * /api/proyectos/:id`, la ruta NO es anidada así que el `clienteId` no viaja en el body).
 *
 * `presupuestoEstimado` es el único campo numérico opcional: se registra con `setValueAs`
 * en vez de `valueAsNumber` para que un campo vacío llegue como `undefined` (válido para
 * `.optional()`) en vez de `NaN` (que `z.number()` rechaza como tipo inválido) — mismo
 * problema que `umbralStockBajo` de `inventario/dialogo-producto-nuevo.tsx` evita defaulteando a 0,
 * pero aquí 0 no es un valor por defecto razonable (un presupuesto en blanco no es "cero").
 */
import { useState } from 'react';
import { Controller, useForm, type Control, type Path, type UseFormRegisterReturn } from 'react-hook-form';
import { CampoFecha as CampoFechaBase } from '@/componentes/comunes/campo-fecha';
import { zodResolver } from '@hookform/resolvers/zod';
import { esquemaCrearProyecto, type DatosCrearProyecto, type Proyecto } from '@trazo/compartido';
import { actualizarProyecto, crearProyecto } from '@/lib/api/clientes';
import { ErrorApi } from '@/lib/api/cliente';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const CAMPOS_VALIDOS = new Set<keyof DatosCrearProyecto>([
  'nombre',
  'descripcion',
  'fechaInicio',
  'fechaCierreEstimada',
  'responsable',
  'presupuestoEstimado',
]);

const VALORES_INICIALES_VACIOS: DatosCrearProyecto = {
  nombre: '',
  descripcion: '',
  fechaInicio: '',
  fechaCierreEstimada: '',
  responsable: '',
  presupuestoEstimado: undefined,
};

/** `2026-08-01T00:00:00.000Z` → `2026-08-01`, el ISO que espera `CampoFecha` (mismo criterio UTC que `formatoFecha`). */
function aFechaInput(fechaIso: string | null): string {
  return fechaIso ? fechaIso.slice(0, 10) : '';
}

function aValoresFormulario(proyecto: Proyecto): DatosCrearProyecto {
  return {
    nombre: proyecto.nombre,
    descripcion: proyecto.descripcion ?? '',
    fechaInicio: aFechaInput(proyecto.fechaInicio),
    fechaCierreEstimada: aFechaInput(proyecto.fechaCierreEstimada),
    responsable: proyecto.responsable ?? '',
    presupuestoEstimado: proyecto.presupuestoEstimado ?? undefined,
  };
}

interface ProyectoFormProps {
  /** Cliente dueño del proyecto — solo se usa para el alta (ruta anidada, FR-036). */
  clienteId: number;
  /** Presente en modo edición; ausente en alta. */
  proyecto?: Proyecto;
  onCerrar: () => void;
  /** Tras guardar con éxito, antes de cerrar — el padre hace `router.refresh()`. */
  onGuardado: () => void;
}

export function ProyectoForm({ clienteId, proyecto, onCerrar, onGuardado }: ProyectoFormProps) {
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosCrearProyecto>({
    resolver: zodResolver(esquemaCrearProyecto),
    defaultValues: proyecto ? aValoresFormulario(proyecto) : VALORES_INICIALES_VACIOS,
  });

  async function alEnviar(datos: DatosCrearProyecto): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      if (proyecto) {
        await actualizarProyecto(proyecto.id, datos);
      } else {
        await crearProyecto(clienteId, datos);
      }
      onGuardado();
      onCerrar();
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrorGeneral(error.mensaje);
        for (const [campo, mensaje] of Object.entries(error.campos ?? {})) {
          if (CAMPOS_VALIDOS.has(campo as keyof DatosCrearProyecto)) {
            setError(campo as keyof DatosCrearProyecto, { message: mensaje });
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
        aria-labelledby="titulo-proyecto-form"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-title" id="titulo-proyecto-form">
          {proyecto ? 'Editar proyecto' : 'Nuevo proyecto'}
        </div>
        <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-3" noValidate>
          <CampoTexto id="proyecto-nombre" label="Nombre" error={errors.nombre?.message} registro={register('nombre')} />

          <div className="field">
            <label htmlFor="proyecto-descripcion">Descripción (opcional)</label>
            <textarea id="proyecto-descripcion" className="input" rows={2} {...register('descripcion')} />
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <CampoFecha
              id="proyecto-fecha-inicio"
              label="Fecha de inicio (opcional)"
              error={errors.fechaInicio?.message}
              control={control} name="fechaInicio"
            />
            <CampoFecha
              id="proyecto-fecha-cierre"
              label="Cierre estimado (opcional)"
              error={errors.fechaCierreEstimada?.message}
              control={control} name="fechaCierreEstimada"
            />
          </div>

          <CampoTexto
            id="proyecto-responsable"
            label="Responsable (opcional)"
            error={errors.responsable?.message}
            registro={register('responsable')}
          />

          <div className="field">
            <label htmlFor="proyecto-presupuesto">Presupuesto estimado (opcional)</label>
            <input
              id="proyecto-presupuesto"
              type="number"
              step="0.01"
              min={0}
              className="input"
              aria-invalid={!!errors.presupuestoEstimado}
              {...register('presupuestoEstimado', {
                setValueAs: (valor) => (valor === '' || valor === null ? undefined : Number(valor)),
              })}
            />
            {errors.presupuestoEstimado && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.presupuestoEstimado.message}
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
              {enviando ? 'Guardando…' : proyecto ? 'Guardar cambios' : 'Crear proyecto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CampoTexto({
  id,
  label,
  error,
  registro,
}: {
  id: string;
  label: string;
  error?: string;
  registro: UseFormRegisterReturn;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} {...registro} />
      {error && (
        <p id={`${id}-error`} role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Campo de fecha del formulario. Delega en `CampoFechaBase` (componentes/comunes), que muestra
 * y acepta `dd/mm/aaaa` en vez del formato que imponga el idioma del navegador — ver el TSDoc
 * de ese componente. Va con `Controller` y no con `register` porque `CampoFechaBase` es
 * controlado: entrega el ISO ya armado, no un evento de un `<input>` nativo.
 */
function CampoFecha({
  id,
  label,
  error,
  control,
  name,
}: {
  id: string;
  label: string;
  error?: string;
  control: Control<DatosCrearProyecto>;
  name: Path<DatosCrearProyecto>;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <CampoFechaBase
            id={id}
            value={typeof field.value === 'string' ? field.value : ''}
            onChange={field.onChange}
            ariaInvalid={!!error}
          />
        )}
      />
      {error && (
        <p id={`${id}-error`} role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          {error}
        </p>
      )}
    </div>
  );
}
