'use client';

/**
 * Formulario de inicio de sesión (T023).
 *
 * Implementa FR-001 (autenticación con usuario y contraseña): validación de UX con
 * `esquemaLogin` (el mismo esquema Zod que usa el backend como autoridad — Principio IV),
 * y en el envío llama a `iniciarSesion` (frontend/src/lib/api/auth.ts). Los errores del
 * servidor (`ErrorApi`) se muestran como banner general (`mensaje`) y, si el backend los
 * asocia a un campo (`campos`), junto al input correspondiente. Estilo: clases `.field`/
 * `.input`/`.btn` del sistema de diseño Nocturne (docs/diseno-nocturne.md) — nunca clases
 * paralelas propias para estos elementos.
 *
 * Lee `sesionExpirada`/`next` de la URL: el cliente HTTP (frontend/src/lib/api/cliente.ts,
 * T021) redirige aquí con esos parámetros cuando una petición autenticada recibe `401`,
 * para avisar en español sin perder silenciosamente a dónde iba el usuario (edge case de
 * spec.md / contracts/rutas-frontend.md). Tras un login exitoso, vuelve a `next` (o `/` si
 * no hay).
 *
 * El banner de `sesionExpirada` (T087, auditoría de Polish) es explícito sobre lo que pasó
 * con lo capturado: la redirección completa a `/login` (`window.location.href` en
 * `cliente.ts`) desmonta el formulario de origen, así que su estado en memoria SIEMPRE se
 * pierde — no hay un mecanismo de borrador persistido (no lo pide ningún FR, Principio V).
 * El edge case de spec.md acepta esto ("sin perder la información capturada O indicando
 * claramente que debe recapturarse"): se eligió la segunda rama, así que el mensaje lo dice
 * en vez de sugerir silenciosamente que el usuario recuperará lo que tenía escrito.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { esquemaLogin, type DatosLogin } from '@trazo/compartido';
import { iniciarSesion } from '@/lib/api/auth';
import { ErrorApi } from '@/lib/api/cliente';

/** Mensaje genérico de red — coincide con el que arma cliente.ts ante un cuerpo no-JSON. */
const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

export function FormularioLogin() {
  const router = useRouter();
  const parametros = useSearchParams();
  const siguiente = parametros.get('next') || '/';
  const sesionExpirada = parametros.get('sesionExpirada') === '1';

  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosLogin>({ resolver: zodResolver(esquemaLogin) });

  async function alEnviar(datos: DatosLogin): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      await iniciarSesion(datos);
      // router.refresh() obliga a los Server Components (layout de T025) a releer la
      // sesión recién creada — de lo contrario seguirían con la respuesta cacheada de
      // "sin sesión" de la navegación anterior.
      router.push(siguiente);
      router.refresh();
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrorGeneral(error.mensaje);
        for (const [campo, mensaje] of Object.entries(error.campos ?? {})) {
          if (campo === 'login' || campo === 'password') {
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
      {sesionExpirada && (
        <p role="status" className="text-muted m-0 text-[13px]">
          Tu sesión expiró. Inicia sesión de nuevo; si estabas completando un formulario, no
          se guardó y deberás capturar la información otra vez.
        </p>
      )}

      <div className="field">
        <label htmlFor="login">Usuario</label>
        <input
          id="login"
          type="text"
          autoComplete="username"
          placeholder="usuario"
          className="input"
          aria-invalid={!!errors.login}
          aria-describedby={errors.login ? 'login-error' : undefined}
          {...register('login')}
        />
        {errors.login && (
          <p id="login-error" role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
            {errors.login.message}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          className="input"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...register('password')}
        />
        {errors.password && (
          <p id="password-error" role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
            {errors.password.message}
          </p>
        )}
      </div>

      {errorGeneral && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>
          {errorGeneral}
        </div>
      )}

      <button type="submit" disabled={enviando} className="btn btn-primary btn-block">
        {enviando ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  );
}
