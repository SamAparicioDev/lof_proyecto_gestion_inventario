'use client';

/**
 * Diálogo "Restablecer contraseña" (T077, `PUT /api/usuarios/:id/restablecer-password`) — un
 * único campo `passwordTemporal` (`esquemaRestablecerPasswordUsuario`), distinto del cambio
 * de la propia contraseña (`formulario-cambiar-password.tsx`): el Administrador NO necesita
 * conocer la contraseña anterior de OTRO usuario (FR-005). El backend marca
 * `debeCambiarPassword=true`, forzando al usuario afectado a cambiarla en su próximo inicio
 * de sesión (mismo guard de `middleware.ts`/`(app)/layout.tsx` que ya fuerza ese flujo).
 *
 * Mismo patrón de diálogo Nocturne (`.dialog-backdrop`/`.dialog`) que `usuario-form.tsx`.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { esquemaRestablecerPasswordUsuario, type DatosRestablecerPasswordUsuario, type Usuario } from '@trazo/compartido';
import { restablecerPasswordUsuario } from '@/lib/api/usuarios';
import { ErrorApi } from '@/lib/api/cliente';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

interface DialogoRestablecerPasswordProps {
  usuario: Usuario;
  onCerrar: () => void;
  onGuardado: () => void;
}

export function DialogoRestablecerPassword({ usuario, onCerrar, onGuardado }: DialogoRestablecerPasswordProps) {
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DatosRestablecerPasswordUsuario>({
    resolver: zodResolver(esquemaRestablecerPasswordUsuario),
    defaultValues: { passwordTemporal: '' },
  });

  async function alEnviar(datos: DatosRestablecerPasswordUsuario): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      await restablecerPasswordUsuario(usuario.id, datos.passwordTemporal);
      onGuardado();
      onCerrar();
    } catch (error) {
      setErrorGeneral(error instanceof ErrorApi ? error.mensaje : MENSAJE_ERROR_RED);
      setEnviando(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => !enviando && onCerrar()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-restablecer-password"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-title" id="titulo-restablecer-password">
          Restablecer contraseña
        </div>
        <div className="dialog-body">
          Define una contraseña temporal para <strong>{usuario.nombreCompleto}</strong> (usuario {usuario.login}).
          Deberá cambiarla en su próximo inicio de sesión.
        </div>
        <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-3" noValidate>
          <div className="field">
            <label htmlFor="restablecer-password-temporal">Contraseña temporal</label>
            <input
              id="restablecer-password-temporal"
              type="password"
              className="input"
              aria-invalid={!!errors.passwordTemporal}
              aria-describedby={errors.passwordTemporal ? 'restablecer-password-temporal-error' : undefined}
              {...register('passwordTemporal')}
            />
            {errors.passwordTemporal && (
              <p
                id="restablecer-password-temporal-error"
                role="alert"
                style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}
              >
                {errors.passwordTemporal.message}
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
              {enviando ? 'Guardando…' : 'Restablecer contraseña'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
