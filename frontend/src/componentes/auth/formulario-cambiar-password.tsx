'use client';

/**
 * Formulario de cambio de contraseña (T024).
 *
 * Cubre tanto el cambio OBLIGATORIO (`Usuario.debeCambiarPassword`, FR-004 — el layout
 * autenticado de T025 redirige aquí forzosamente) como el voluntario. Valida para UX con
 * `esquemaCambiarPassword` (mismo esquema Zod del backend). El backend rechaza la
 * contraseña actual incorrecta con `409` (contracts/api-rest.md); ese mensaje llega en
 * `ErrorApi.mensaje` y, si el backend lo asocia al campo, también junto a `passwordActual`.
 * Estilo: clases `.field`/`.input`/`.btn` de Nocturne (docs/diseno-nocturne.md).
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { esquemaCambiarPassword, type DatosCambiarPassword } from '@trazo/compartido';
import { cambiarPassword } from '@/lib/api/auth';
import { ErrorApi } from '@/lib/api/cliente';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

export function FormularioCambiarPassword() {
  const router = useRouter();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosCambiarPassword>({ resolver: zodResolver(esquemaCambiarPassword) });

  async function alEnviar(datos: DatosCambiarPassword): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      await cambiarPassword(datos);
      // router.refresh() releé el perfil en el layout servidor (T025): debeCambiarPassword
      // ya en false, así que deja de forzar el redirect a esta misma página.
      router.push('/');
      router.refresh();
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrorGeneral(error.mensaje);
        for (const [campo, mensaje] of Object.entries(error.campos ?? {})) {
          if (campo === 'passwordActual' || campo === 'passwordNueva') {
            setError(campo, { message: mensaje });
          }
        }
      } else {
        setErrorGeneral(MENSAJE_ERROR_RED);
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-3.5" noValidate>
      <div className="field">
        <label htmlFor="passwordActual">Contraseña actual</label>
        <input
          id="passwordActual"
          type="password"
          autoComplete="current-password"
          className="input"
          aria-invalid={!!errors.passwordActual}
          aria-describedby={errors.passwordActual ? 'passwordActual-error' : undefined}
          {...register('passwordActual')}
        />
        {errors.passwordActual && (
          <p id="passwordActual-error" role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
            {errors.passwordActual.message}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="passwordNueva">Nueva contraseña</label>
        <input
          id="passwordNueva"
          type="password"
          autoComplete="new-password"
          className="input"
          aria-invalid={!!errors.passwordNueva}
          aria-describedby={errors.passwordNueva ? 'passwordNueva-error' : undefined}
          {...register('passwordNueva')}
        />
        {errors.passwordNueva && (
          <p id="passwordNueva-error" role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
            {errors.passwordNueva.message}
          </p>
        )}
      </div>

      {errorGeneral && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>
          {errorGeneral}
        </div>
      )}

      <button type="submit" disabled={enviando} className="btn btn-primary btn-block">
        {enviando ? 'Guardando…' : 'Cambiar contraseña'}
      </button>
    </form>
  );
}
