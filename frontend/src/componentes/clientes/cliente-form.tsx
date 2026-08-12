'use client';

/**
 * Formulario de cliente — formulario PLANO, sin líneas dinámicas (T044/T045): a diferencia
 * de `ingreso-form.tsx`, un cliente no tiene una colección de líneas, así que no hace falta
 * `useFieldArray` (Principio V — no inventar complejidad que esta historia no pide).
 *
 * Reutilizado en dos sitios: alta (`/clientes/nuevo`, sin `clienteId`) y edición desde el
 * detalle (`/clientes/[id]`, con `clienteId` — T045, botón "Editar"). Valida para UX con
 * `esquemaCrearCliente` — el MISMO esquema que usa `PUT /api/clientes/:id` como autoridad
 * (contracts/api-rest.md: "mismo esquema" para crear/actualizar).
 *
 * Errores de servidor (`ErrorApi.campos`) se pintan junto al campo correspondiente; el
 * `mensaje` general va en un `<div role="alert">` dentro de la tarjeta (frontend/CLAUDE.md,
 * no hay sistema de toasts).
 *
 * Implementa: FR-034 (registro de cliente con datos de contacto), FR-035 (NIT único — el
 * mensaje de duplicado lo produce el backend y se pinta junto al campo `nit`).
 */
import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { esquemaCrearCliente, type DatosCrearCliente } from '@trazo/compartido';
import { actualizarCliente, crearCliente } from '@/lib/api/clientes';
import { ErrorApi } from '@/lib/api/cliente';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const CAMPOS_VALIDOS = new Set<keyof DatosCrearCliente>(['nombre', 'nit', 'telefono', 'email', 'direccion', 'ciudad']);

const VALORES_INICIALES_VACIOS: DatosCrearCliente = {
  nombre: '',
  nit: '',
  telefono: '',
  email: '',
  direccion: '',
  ciudad: '',
};

interface ClienteFormProps {
  /** Presente en modo edición (`/clientes/[id]`, T045); ausente en alta (`/clientes/nuevo`). */
  clienteId?: number;
  /** Precarga de edición — mismo shape que `esquemaCrearCliente`. */
  valoresIniciales?: DatosCrearCliente;
  /** Cancelar edición sin navegar (usado desde el panel de detalle, T045); si se omite, vuelve atrás. */
  onCancelar?: () => void;
  /** Tras guardar con éxito (usado desde el panel de detalle para volver a modo lectura). */
  onGuardado?: () => void;
}

export function ClienteForm({ clienteId, valoresIniciales, onCancelar, onGuardado }: ClienteFormProps) {
  const router = useRouter();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosCrearCliente>({
    resolver: zodResolver(esquemaCrearCliente),
    defaultValues: valoresIniciales ?? VALORES_INICIALES_VACIOS,
  });

  async function alEnviar(datos: DatosCrearCliente): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      if (clienteId) {
        await actualizarCliente(clienteId, datos);
        if (onGuardado) {
          onGuardado();
        } else {
          router.push(`/clientes/${clienteId}`);
        }
      } else {
        const { id } = await crearCliente(datos);
        router.push(`/clientes/${id}`);
      }
      router.refresh();
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrorGeneral(error.mensaje);
        for (const [campo, mensaje] of Object.entries(error.campos ?? {})) {
          if (CAMPOS_VALIDOS.has(campo as keyof DatosCrearCliente)) {
            setError(campo as keyof DatosCrearCliente, { message: mensaje });
          }
        }
      } else {
        setErrorGeneral(MENSAJE_ERROR_RED);
      }
      setEnviando(false);
    }
  }

  function alCancelar(): void {
    if (onCancelar) {
      onCancelar();
    } else {
      router.back();
    }
  }

  return (
    <form onSubmit={handleSubmit(alEnviar)} className="card flex flex-col gap-4 p-5" noValidate>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <CampoTexto id="nombre" label="Nombre" error={errors.nombre?.message} registro={register('nombre')} />
        <CampoTexto id="nit" label="NIT" error={errors.nit?.message} registro={register('nit')} />
        <CampoTexto id="telefono" label="Teléfono (opcional)" error={errors.telefono?.message} registro={register('telefono')} />
        <CampoTexto id="email" label="Correo (opcional)" error={errors.email?.message} registro={register('email')} />
        <CampoTexto id="direccion" label="Dirección (opcional)" error={errors.direccion?.message} registro={register('direccion')} />
        <CampoTexto id="ciudad" label="Ciudad (opcional)" error={errors.ciudad?.message} registro={register('ciudad')} />
      </div>

      {errorGeneral && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
          {errorGeneral}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {enviando ? 'Guardando…' : clienteId ? 'Guardar cambios' : 'Crear cliente'}
        </button>
      </div>
    </form>
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
