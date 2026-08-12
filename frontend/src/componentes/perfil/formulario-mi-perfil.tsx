'use client';

/**
 * Formulario de datos personales propios (T143, US14/FR-080).
 *
 * Solo edita nombre y correo. El usuario y el rol se muestran como SOLO LECTURA con la razón
 * a la vista, en vez de simplemente omitirlos: si desaparecieran, la pregunta natural sería
 * "¿y dónde cambio mi rol?" — mostrarlos deshabilitados responde esa pregunta sin que nadie
 * tenga que preguntar (US14-AS3). El rol no se edita porque sería concederse permisos a uno
 * mismo, y el usuario porque identifica los registros históricos de esa persona.
 *
 * Valida para UX con `esquemaActualizarMiPerfil`, el MISMO esquema Zod que el backend usa como
 * autoridad. El correo duplicado lo detecta el servidor (`400` con `campos.email`) y se pinta
 * junto al campo; nunca se comprueba en el cliente, que no puede saberlo.
 *
 * Tras guardar, `router.refresh()` releé el perfil en el layout de servidor para que el nombre
 * del bloque de usuario de la barra lateral cambie de inmediato, sin volver a iniciar sesión
 * (US14-AS1).
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { esquemaActualizarMiPerfil, type DatosActualizarMiPerfil, type PerfilSesion } from '@trazo/compartido';
import { actualizarMiPerfil } from '@/lib/api/auth';
import { ErrorApi } from '@/lib/api/cliente';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

/** Campos que el backend puede señalar en `error.campos` — los mismos que edita el formulario. */
const CAMPOS_DEL_FORMULARIO = ['nombreCompleto', 'email'] as const;

export function FormularioMiPerfil({ perfil, login }: { perfil: PerfilSesion; login: string }) {
  const router = useRouter();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosActualizarMiPerfil>({
    resolver: zodResolver(esquemaActualizarMiPerfil),
    defaultValues: { nombreCompleto: perfil.nombreCompleto, email: perfil.email },
  });

  async function alEnviar(datos: DatosActualizarMiPerfil): Promise<void> {
    setErrorGeneral(null);
    setGuardado(false);
    setEnviando(true);
    try {
      await actualizarMiPerfil(datos);
      setGuardado(true);
      router.refresh();
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrorGeneral(error.mensaje);
        for (const [campo, mensaje] of Object.entries(error.campos ?? {})) {
          if ((CAMPOS_DEL_FORMULARIO as readonly string[]).includes(campo)) {
            setError(campo as (typeof CAMPOS_DEL_FORMULARIO)[number], { message: mensaje });
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
    <div className="flex flex-col gap-5">
      {/* Contenedor Nocturne por fuera, layout por dentro: nunca en el mismo elemento
          (docs/diseno-nocturne.md — el CSS sin capa de Nocturne gana a las utilidades). */}
      <div className="card">
        <form onSubmit={handleSubmit(alEnviar)} noValidate className="flex flex-col gap-4 p-2">
          <div className="field">
            <label htmlFor="nombreCompleto">Nombre completo</label>
            <input
              id="nombreCompleto"
              className="input"
              aria-invalid={!!errors.nombreCompleto}
              {...register('nombreCompleto')}
            />
            {errors.nombreCompleto && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.nombreCompleto.message}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="email">Correo electrónico</label>
            <input id="email" type="email" className="input" aria-invalid={!!errors.email} {...register('email')} />
            {errors.email && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.email.message}
              </p>
            )}
          </div>

          {errorGeneral && (
            <div role="alert" style={{ color: 'var(--color-accent-300)', fontSize: 13 }}>
              {errorGeneral}
            </div>
          )}
          {guardado && !errorGeneral && (
            <div role="status" style={{ color: 'var(--color-accent-300)', fontSize: 13 }}>
              Tus datos quedaron actualizados.
            </div>
          )}

          <div className="flex">
            <button type="submit" className="btn btn-primary" disabled={enviando}>
              {enviando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="flex flex-col gap-4 p-2">
          <div>
            <h5 style={{ margin: 0 }}>Datos que no se editan aquí</h5>
            <p className="text-muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              Si alguno está mal, un administrador puede corregirlo desde la gestión de usuarios.
            </p>
          </div>

          <div className="field">
            <label htmlFor="login">Usuario</label>
            <input id="login" className="input" value={login} readOnly disabled />
            <p className="text-muted" style={{ fontSize: 12, marginTop: 5 }}>
              Identifica todos tus registros en el historial, así que no cambia.
            </p>
          </div>

          <div className="field">
            <label htmlFor="rol">Rol</label>
            <input id="rol" className="input" value={perfil.rol.nombre} readOnly disabled />
            <p className="text-muted" style={{ fontSize: 12, marginTop: 5 }}>
              Define lo que puedes hacer en el sistema; solo un administrador lo asigna.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col gap-3 p-2">
          <div>
            <h5 style={{ margin: 0 }}>Contraseña</h5>
            <p className="text-muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              Para cambiarla necesitas escribir la actual.
            </p>
          </div>
          <div className="flex">
            <Link href="/cambiar-password" className="btn btn-secondary">
              Cambiar contraseña
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
