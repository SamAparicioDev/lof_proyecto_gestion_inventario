'use client';

/**
 * Diálogos de alta y edición de usuario (T077, FR-005/FR-006) — dentro de `.dialog`
 * (Nocturne), mismo patrón que `componentes/clientes/proyecto-form.tsx`. A diferencia de
 * `cliente-form.tsx` (un único componente para alta/edición porque comparten el MISMO
 * esquema), aquí el alta y la edición de usuario usan esquemas DISTINTOS
 * (`esquemaCrearUsuario` agrega `login`/`passwordTemporal`, que no se editan tras el alta —
 * ver TSDoc de `packages/compartido/src/esquemas/usuarios.ts`), así que este archivo expone
 * dos componentes separados en vez de forzar un único `useForm` con campos condicionales
 * (las reglas de hooks de React no permiten llamar `useForm` condicionalmente).
 *
 * `UsuarioForm` (alta): lo abre `componentes/usuarios/boton-nuevo-usuario.tsx`.
 * `EditarUsuarioForm` (edición): lo abre `componentes/usuarios/tabla-usuarios.tsx` desde la
 * fila de la tabla.
 *
 * ## El selector de rol sale de `GET /api/roles`, no de una lista fija (T108, US9)
 *
 * Hasta US9 este archivo llevaba las tres opciones escritas a mano
 * (`ADMINISTRADOR/GERENTE/OPERARIO`) y el body enviaba `rol` como texto. Con los roles como
 * dato (FR-054) esa lista dejaría fuera cualquier rol que el Administrador cree —el caso de uso
 * central de US9-AS1— así que las opciones llegan por prop desde `app/(app)/usuarios/page.tsx`
 * (que las resuelve server-side, sin estado de carga en el diálogo) y el body envía `rolId`, el
 * identificador estable del rol (contracts/api-rest.md § Usuarios).
 *
 * Errores de servidor (`ErrorApi.campos`) se pintan junto al campo correspondiente; el
 * `mensaje` general va en un `<div role="alert">` dentro del diálogo (frontend/CLAUDE.md, no
 * hay sistema de toasts).
 */
import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  esquemaActualizarUsuario,
  esquemaCrearUsuario,
  type DatosActualizarUsuario,
  type DatosCrearUsuario,
  type RolAsignado,
  type Usuario,
} from '@trazo/compartido';
import { actualizarUsuario, crearUsuario } from '@/lib/api/usuarios';
import { ErrorApi } from '@/lib/api/cliente';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

/**
 * Aviso cuando la lista de roles llegó vacía. Ocurre si `GET /api/roles` falló: la pantalla de
 * usuarios exige `usuarios.gestionar` y el listado de roles exige `roles.gestionar`, que son
 * permisos distintos y podrían no ir juntos en un rol propio. Sin roles no hay alta ni cambio
 * de rol posible, así que se dice por qué en vez de mostrar un desplegable vacío.
 */
const MENSAJE_SIN_ROLES =
  'No fue posible cargar los roles disponibles. Necesitas también el permiso de administrar roles para asignarlos.';

interface UsuarioFormProps {
  /** Roles ACTIVOS asignables, resueltos por la página (`GET /api/roles?estado=ACTIVO`). */
  roles: RolAsignado[];
  onCerrar: () => void;
  /** Tras guardar con éxito, antes de cerrar — el padre hace `router.refresh()`. */
  onGuardado: () => void;
}

/** Diálogo "Nuevo usuario" (`POST /api/usuarios`, FR-005/FR-006). */
export function UsuarioForm({ roles, onCerrar, onGuardado }: UsuarioFormProps) {
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const CAMPOS_VALIDOS = new Set<keyof DatosCrearUsuario>(['nombreCompleto', 'email', 'login', 'passwordTemporal', 'rolId']);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosCrearUsuario>({
    resolver: zodResolver(esquemaCrearUsuario),
    defaultValues: {
      nombreCompleto: '',
      email: '',
      login: '',
      passwordTemporal: '',
      rolId: roles[0]?.id,
    },
  });

  async function alEnviar(datos: DatosCrearUsuario): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      await crearUsuario(datos);
      onGuardado();
      onCerrar();
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrorGeneral(error.mensaje);
        for (const [campo, mensaje] of Object.entries(error.campos ?? {})) {
          if (CAMPOS_VALIDOS.has(campo as keyof DatosCrearUsuario)) {
            setError(campo as keyof DatosCrearUsuario, { message: mensaje });
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
        aria-labelledby="titulo-usuario-nuevo"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-title" id="titulo-usuario-nuevo">
          Nuevo usuario
        </div>
        <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-3" noValidate>
          <CampoTexto
            id="usuario-nuevo-nombre"
            label="Nombre completo"
            error={errors.nombreCompleto?.message}
            registro={register('nombreCompleto')}
          />
          <CampoTexto id="usuario-nuevo-email" label="Correo" error={errors.email?.message} registro={register('email')} />
          <CampoTexto id="usuario-nuevo-login" label="Usuario" error={errors.login?.message} registro={register('login')} />
          <CampoTexto
            id="usuario-nuevo-password"
            label="Contraseña temporal"
            type="password"
            error={errors.passwordTemporal?.message}
            registro={register('passwordTemporal')}
          />
          <CampoRol
            id="usuario-nuevo-rol"
            roles={roles}
            error={errors.rolId?.message}
            registro={register('rolId', { valueAsNumber: true })}
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
            <button type="submit" className="btn btn-primary" disabled={enviando || roles.length === 0}>
              {enviando ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface EditarUsuarioFormProps extends UsuarioFormProps {
  usuario: Usuario;
}

/** Diálogo "Editar usuario" (`PUT /api/usuarios/:id`, FR-005) — sin `login` ni contraseña. */
export function EditarUsuarioForm({ usuario, roles, onCerrar, onGuardado }: EditarUsuarioFormProps) {
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const CAMPOS_VALIDOS = new Set<keyof DatosActualizarUsuario>(['nombreCompleto', 'email', 'rolId']);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosActualizarUsuario>({
    resolver: zodResolver(esquemaActualizarUsuario),
    defaultValues: { nombreCompleto: usuario.nombreCompleto, email: usuario.email, rolId: usuario.rol.id },
  });

  async function alEnviar(datos: DatosActualizarUsuario): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      await actualizarUsuario(usuario.id, datos);
      onGuardado();
      onCerrar();
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrorGeneral(error.mensaje);
        for (const [campo, mensaje] of Object.entries(error.campos ?? {})) {
          if (CAMPOS_VALIDOS.has(campo as keyof DatosActualizarUsuario)) {
            setError(campo as keyof DatosActualizarUsuario, { message: mensaje });
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
        aria-labelledby="titulo-usuario-editar"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-title" id="titulo-usuario-editar">
          Editar usuario
        </div>
        <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-3" noValidate>
          <div className="field">
            <label htmlFor="usuario-editar-usuario">Usuario</label>
            <input id="usuario-editar-usuario" className="input" value={usuario.login} disabled readOnly />
          </div>
          <CampoTexto
            id="usuario-editar-nombre"
            label="Nombre completo"
            error={errors.nombreCompleto?.message}
            registro={register('nombreCompleto')}
          />
          <CampoTexto id="usuario-editar-email" label="Correo" error={errors.email?.message} registro={register('email')} />
          <CampoRol
            id="usuario-editar-rol"
            roles={conRolActual(roles, usuario.rol)}
            error={errors.rolId?.message}
            registro={register('rolId', { valueAsNumber: true })}
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
              {enviando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Garantiza que el rol ACTUAL del usuario esté entre las opciones aunque ya no sea asignable.
 *
 * El selector se alimenta de los roles ACTIVOS, pero un usuario puede conservar uno que se
 * desactivó después (desactivar un rol no se lo quita a nadie — US9-AS5). Sin esta opción el
 * `<select>` mostraría otro rol como si fuera el suyo, y guardar sin tocar nada se lo habría
 * cambiado en silencio.
 */
function conRolActual(roles: RolAsignado[], actual: RolAsignado): RolAsignado[] {
  return roles.some((rol) => rol.id === actual.id) ? roles : [actual, ...roles];
}

function CampoTexto({
  id,
  label,
  error,
  registro,
  type = 'text',
}: {
  id: string;
  label: string;
  error?: string;
  registro: UseFormRegisterReturn;
  type?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        className="input"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        {...registro}
      />
      {error && (
        <p id={`${id}-error`} role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          {error}
        </p>
      )}
    </div>
  );
}

function CampoRol({
  id,
  roles,
  error,
  registro,
}: {
  id: string;
  roles: RolAsignado[];
  error?: string;
  registro: UseFormRegisterReturn;
}) {
  const sinRoles = roles.length === 0;
  const idAviso = sinRoles ? `${id}-sin-roles` : undefined;

  return (
    <div className="field">
      <label htmlFor={id}>Rol</label>
      <select
        id={id}
        className="input"
        disabled={sinRoles}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : idAviso}
        {...registro}
      >
        {roles.map((rol) => (
          <option key={rol.id} value={rol.id}>
            {rol.nombre}
          </option>
        ))}
      </select>
      {sinRoles && (
        <p id={idAviso} role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          {MENSAJE_SIN_ROLES}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          {error}
        </p>
      )}
    </div>
  );
}
