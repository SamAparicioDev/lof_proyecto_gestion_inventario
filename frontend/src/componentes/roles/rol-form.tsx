'use client';

/**
 * Diálogo de alta y edición de un rol con su matriz de permisos (T107, FR-055) — `.dialog` de
 * Nocturne, mismo patrón que `componentes/usuarios/usuario-form.tsx`.
 *
 * A diferencia de usuarios (donde alta y edición usan esquemas DISTINTOS y por eso son dos
 * componentes), aquí `esquemaCrearRol` y `esquemaActualizarRol` tienen exactamente la misma
 * forma —un rol ES su nombre, su descripción y su conjunto de permisos— así que un solo
 * componente cubre ambos casos, igual que `componentes/clientes/cliente-form.tsx`. La
 * distinción es qué endpoint se llama y el texto de los botones.
 *
 * ## Roles del sistema
 *
 * Administrador, Gerente y Operario nacen con la instalación (`esSistema=true`, FR-059). Su
 * NOMBRE no es editable —el contrato responde `409` a un `PUT` que lo cambie— pero su matriz
 * de permisos sí: es justamente lo que hace configurable el control de acceso (US9-AS1). El
 * campo de nombre va `readOnly` en vez de `disabled` a propósito: un `<input disabled>` no
 * envía su valor y react-hook-form lo registraría como vacío, así que el `PUT` fallaría la
 * validación de "el nombre es obligatorio" por un motivo que el usuario no puede ver.
 *
 * ## Permisos: estado propio, no un `register` de react-hook-form
 *
 * `permisoIds` es un arreglo de números que se edita con 30 casillas agrupadas
 * (`MatrizPermisos`), no con un `<input>` por campo; se mantiene en `useState` y se inyecta en
 * el `handleSubmit`. El esquema Zod compartido sigue siendo la autoridad de forma (se valida
 * el objeto completo antes de enviar) y el backend revalida y rechaza ids inexistentes.
 *
 * Errores de servidor: `ErrorApi.campos` se pinta junto al campo correspondiente; el `mensaje`
 * general —incluidos los `409` de FR-057, como "no puedes quitar el permiso de gestionar roles
 * al último rol que lo tiene"— va en un `<div role="alert">` dentro del diálogo
 * (frontend/CLAUDE.md, no hay sistema de toasts).
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  esquemaCrearRol,
  type DatosCrearRol,
  type ModuloPermisos,
  type RolListado,
} from '@trazo/compartido';
import { actualizarRol, crearRol } from '@/lib/api/roles';
import { ErrorApi } from '@/lib/api/cliente';
import { PERMISOS } from '@/lib/permisos';
import { useUsuario } from '@/lib/sesion';
import { MatrizPermisos } from './matriz-permisos';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

/**
 * Permisos RESERVADOS (US31, FR-131): solo un super administrador los concede o los retira.
 *
 * La lista replica la del dominio (`PERMISOS_RESERVADOS` en
 * `backend/src/dominio/entidades/permiso.ts`) — el backend no puede importar código del
 * frontend, así que ambos lados la escriben. El servidor es el que manda: quien fuerce la
 * casilla desde el navegador recibe un `409` igual (FR-003).
 */
const PERMISOS_RESERVADOS: readonly string[] = [PERMISOS.INVENTARIO_AJUSTAR];

/** Campos de formulario a los que tiene sentido anclar un error de `ErrorApi.campos`. */
const CAMPOS_VALIDOS = new Set<keyof DatosCrearRol>(['nombre', 'descripcion', 'permisoIds']);

interface PropiedadesRolForm {
  catalogo: ModuloPermisos[];
  /** Ausente = alta; presente = edición de ese rol (`PUT /api/roles/:id`). */
  rol?: RolListado;
  onCerrar: () => void;
  /** Tras guardar con éxito, antes de cerrar — el padre hace `router.refresh()`. */
  onGuardado: () => void;
}

export function RolForm({ catalogo, rol, onCerrar, onGuardado }: PropiedadesRolForm) {
  const editando = rol !== undefined;
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // US31 (FR-131): un super administrador sí puede mover la casilla reservada; el resto la ve
  // con su estado real pero bloqueada, con la razón al lado (es UX — el servidor decide).
  const perfil = useUsuario();
  const reservadasParaEstaSesion = perfil.esSuperAdmin ? [] : PERMISOS_RESERVADOS;
  const [permisoIds, setPermisoIds] = useState<number[]>(() => idsDePermisosDelRol(catalogo, rol));

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosCrearRol>({
    resolver: zodResolver(esquemaCrearRol),
    defaultValues: {
      nombre: rol?.nombre ?? '',
      descripcion: rol?.descripcion ?? '',
      permisoIds: [],
    },
  });

  async function alEnviar(datos: DatosCrearRol): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      const cuerpo: DatosCrearRol = { ...datos, permisoIds };
      if (rol) {
        await actualizarRol(rol.id, cuerpo);
      } else {
        await crearRol(cuerpo);
      }
      onGuardado();
      onCerrar();
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrorGeneral(error.mensaje);
        for (const [campo, mensaje] of Object.entries(error.campos ?? {})) {
          if (CAMPOS_VALIDOS.has(campo as keyof DatosCrearRol)) {
            setError(campo as keyof DatosCrearRol, { message: mensaje });
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
      {/*
        `.dialog` fija `width: min(440px, 100%)` sin capa CSS, así que una utilidad de Tailwind
        sobre el mismo elemento no la tocaría (docs/diseno-nocturne.md § regla de cascada); el
        escape hatch documentado para ese caso es un `style` inline, que sí gana. La matriz son
        30 casillas en 9 módulos: a 440px cada descripción se parte en tres líneas y la
        pantalla deja de leerse como una matriz. El alto no necesita nada: `globals.css` ya le
        da a `.dialog` un `max-height` de viewport con scroll propio.
      */}
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-rol"
        style={{ width: 'min(720px, 100%)' }}
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-title" id="titulo-rol">
          {editando ? `Editar rol: ${rol.nombre}` : 'Nuevo rol'}
        </div>

        <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-[var(--space-3)]" noValidate>
          <div className="field">
            <label htmlFor="rol-nombre">Nombre</label>
            <input
              id="rol-nombre"
              className="input"
              readOnly={rol?.esSistema}
              aria-invalid={!!errors.nombre}
              aria-describedby={errors.nombre ? 'rol-nombre-error' : rol?.esSistema ? 'rol-nombre-ayuda' : undefined}
              {...register('nombre')}
            />
            {rol?.esSistema && (
              <p id="rol-nombre-ayuda" className="text-muted" style={{ fontSize: 12, marginTop: 5 }}>
                Es un rol del sistema: su nombre no se puede cambiar, pero sus permisos sí.
              </p>
            )}
            {errors.nombre && (
              <p id="rol-nombre-error" role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.nombre.message}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="rol-descripcion">Descripción</label>
            <input
              id="rol-descripcion"
              className="input"
              placeholder="Para qué sirve este rol (opcional)"
              aria-invalid={!!errors.descripcion}
              aria-describedby={errors.descripcion ? 'rol-descripcion-error' : undefined}
              {...register('descripcion')}
            />
            {errors.descripcion && (
              <p
                id="rol-descripcion-error"
                role="alert"
                style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}
              >
                {errors.descripcion.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-[var(--space-1)]">
            <h5 style={{ margin: 0 }}>Permisos</h5>
            <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
              Marca lo que este rol puede hacer. {permisoIds.length} {permisoIds.length === 1 ? 'permiso' : 'permisos'}{' '}
              seleccionado{permisoIds.length === 1 ? '' : 's'}. El cambio rige en la siguiente acción de cada usuario con
              este rol, sin que tenga que volver a iniciar sesión.
            </p>
          </div>

          <MatrizPermisos
            catalogo={catalogo}
            seleccionados={permisoIds}
            onCambiar={setPermisoIds}
            deshabilitada={enviando}
            reservadas={reservadasParaEstaSesion}
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
              {enviando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear rol'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Traduce las CLAVES que el rol trae del backend a los IDS del catálogo que el cuerpo de la
 * petición necesita (`permisoIds`).
 *
 * El listado publica `permisos` como claves (`modulo.accion`) porque es lo que compara la
 * autorización y lo estable entre instalaciones; el `POST`/`PUT` recibe ids porque es lo que
 * define el contrato. El catálogo de `GET /api/permisos` es el único sitio donde conviven
 * ambos, así que la traducción se hace aquí y una sola vez, al abrir el diálogo.
 */
function idsDePermisosDelRol(catalogo: ModuloPermisos[], rol?: RolListado): number[] {
  if (!rol) {
    return [];
  }
  const concedidas = new Set(rol.permisos);
  return catalogo.flatMap((grupo) => grupo.permisos.filter((permiso) => concedidas.has(permiso.clave)).map((p) => p.id));
}
