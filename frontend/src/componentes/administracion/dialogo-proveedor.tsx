'use client';

/**
 * Diálogo de alta y edición de proveedor (US15, FR-091/FR-093).
 *
 * Mismo componente para los dos modos que `dialogo-categoria.tsx`, con una diferencia: al editar
 * el proveedor DEL SISTEMA el campo Nombre queda de solo lectura y explica por qué (FR-093). El
 * bloqueo real es del servidor —responde `409`—; esto evita que el usuario escriba un nombre
 * nuevo y descubra al guardar que no se podía.
 *
 * El duplicado se muestra junto al campo `nombre`, no como error general: el backend responde
 * `400` con `campos.nombre` diciendo con qué proveedor EXISTENTE choca, que es la información
 * que le falta al usuario para entender por qué se le rechaza algo que él ve distinto.
 */
import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { esquemaCrearProveedor, type DatosCrearProveedor } from '@trazo/compartido';
import { actualizarProveedor, crearProveedor, type ProveedorListado } from '@/lib/api/proveedores';
import { ErrorApi } from '@/lib/api/cliente';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const CAMPOS_VALIDOS = new Set<keyof DatosCrearProveedor>(['nombre', 'nit', 'telefono', 'email']);

interface DialogoProveedorProps {
  /** Presente en modo edición; ausente en alta. */
  proveedor: ProveedorListado | null;
  onCerrar: () => void;
  onGuardado: () => void;
}

export function DialogoProveedor({ proveedor, onCerrar, onGuardado }: DialogoProveedorProps): React.JSX.Element {
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const nombreBloqueado = proveedor?.esSistema ?? false;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosCrearProveedor>({
    resolver: zodResolver(esquemaCrearProveedor),
    defaultValues: {
      nombre: proveedor?.nombre ?? '',
      nit: proveedor?.nit ?? '',
      telefono: proveedor?.telefono ?? '',
      email: proveedor?.email ?? '',
    },
  });

  async function alEnviar(datos: DatosCrearProveedor): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      if (proveedor) {
        await actualizarProveedor(proveedor.id, datos);
      } else {
        await crearProveedor(datos);
      }
      onGuardado();
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        setErrorGeneral(fallo.mensaje);
        for (const [campo, mensaje] of Object.entries(fallo.campos ?? {})) {
          if (CAMPOS_VALIDOS.has(campo as keyof DatosCrearProveedor)) {
            setError(campo as keyof DatosCrearProveedor, { message: mensaje });
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
        aria-labelledby="titulo-proveedor"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-title" id="titulo-proveedor">
          {proveedor ? 'Editar proveedor' : 'Nuevo proveedor'}
        </div>

        <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-3" noValidate>
          <div className="field">
            <label htmlFor="proveedor-nombre">Nombre</label>
            {/* `readOnly` y no `disabled`: un campo deshabilitado no viaja en el submit, y el
                nombre tiene que seguir enviándose tal cual para que el servidor lo reconozca como
                "no cambió" y acepte la edición de los datos de contacto (FR-093). */}
            <input
              id="proveedor-nombre"
              className="input"
              aria-invalid={!!errors.nombre}
              readOnly={nombreBloqueado}
              {...register('nombre')}
            />
            {nombreBloqueado && (
              <p className="text-muted" style={{ fontSize: 12, marginTop: 5 }}>
                Este proveedor lo usa la carga masiva de inventario, que lo busca por su nombre: no
                se puede renombrar. Sus datos de contacto sí se pueden corregir.
              </p>
            )}
            {errors.nombre && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.nombre.message}
              </p>
            )}
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <CampoOpcional id="proveedor-nit" etiqueta="NIT (opcional)" error={errors.nit?.message} registro={register('nit')} />
            <CampoOpcional
              id="proveedor-telefono"
              etiqueta="Teléfono (opcional)"
              error={errors.telefono?.message}
              registro={register('telefono')}
            />
          </div>

          <CampoOpcional
            id="proveedor-email"
            etiqueta="Correo (opcional)"
            error={errors.email?.message}
            registro={register('email')}
          />

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
              {enviando ? 'Guardando…' : proveedor ? 'Guardar cambios' : 'Crear proveedor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CampoOpcional({
  id,
  etiqueta,
  error,
  registro,
}: {
  id: string;
  etiqueta: string;
  error?: string;
  registro: UseFormRegisterReturn;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{etiqueta}</label>
      <input id={id} className="input" aria-invalid={!!error} {...registro} />
      {error && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          {error}
        </p>
      )}
    </div>
  );
}
