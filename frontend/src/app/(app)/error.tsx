'use client';

/**
 * Frontera de error del grupo `(app)` — la red de seguridad que faltaba (corrección de la
 * revisión adversarial de la Tanda 13, hallazgo CRITICAL).
 *
 * Hasta esta tanda no existía NINGÚN `error.tsx` en `frontend/src/app`, así que cualquier
 * error no capturado en un Server Component —típicamente un `403` de un endpoint que la
 * pantalla pidió sin comprobar antes el permiso— llegaba al usuario como la pantalla genérica
 * de error de Next: en inglés, sin navegación y sin salida. Con los permisos como dato (US9)
 * ese caso dejó de ser hipotético, porque el Administrador puede crear roles con cualquier
 * combinación de permisos.
 *
 * Esto NO reemplaza a los gates por permiso de cada pantalla (frontend/CLAUDE.md: el permiso
 * se resuelve ANTES de llamar al endpoint restringido, con su propio aviso explicativo); es la
 * última línea de defensa para lo que se escape, igual que los `CHECK` de la base de datos lo
 * son de las reglas de negocio. Renderiza DENTRO del layout autenticado, así que el usuario
 * conserva la barra lateral y puede irse a otro módulo sin volver atrás en el navegador.
 *
 * Mensajes en español (FR-016/FR-047) y `role="alert"`, nunca un toast (frontend/CLAUDE.md).
 */
import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Marca que `lib/api/cliente.ts` pone en los errores del contrato — permite distinguir un
 * `403` real del backend de un fallo de red o de render, sin importar la clase (las clases no
 * sobreviven al cruce servidor→cliente que hace Next con este componente).
 *
 * Límite conocido: en PRODUCCIÓN Next reemplaza el mensaje de un error lanzado en el servidor
 * por uno genérico (solo conserva `digest`), así que ahí esta distinción no aplica y se muestra
 * el texto general. No se compensa con nada más: el aviso PRECISO de "no tienes permiso para
 * X" es responsabilidad del gate de cada pantalla —que es donde debe estar— y esto es solo la
 * red que impide una pantalla de error en inglés.
 */
const NOMBRE_ERROR_API = 'ErrorApi';

/** Texto por defecto del `403` que produce `PermisosGuard` (contracts/api-rest.md). */
const MENSAJE_SIN_PERMISOS = 'No tienes permisos para realizar esta acción.';

export default function ErrorApp({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Sin sistema de telemetría en el proyecto: la consola del navegador es donde hoy se
    // diagnostica (mismo criterio que el resto del frontend, Principio V).
    console.error(error);
  }, [error]);

  const esFaltaDePermisos = error.name === NOMBRE_ERROR_API && error.message === MENSAJE_SIN_PERMISOS;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Trazo</h6>
        <h2 style={{ margin: 0 }}>{esFaltaDePermisos ? 'No tienes acceso a esta pantalla' : 'Algo salió mal'}</h2>
      </div>

      <div role="alert" className="card flex flex-col items-start gap-3 p-4" style={{ color: 'var(--color-accent-300)' }}>
        <p style={{ margin: 0 }}>
          {esFaltaDePermisos
            ? 'Esta pantalla necesita permisos que tu rol no tiene. Solicítalos a quien administra los roles del sistema.'
            : 'No pudimos cargar esta pantalla. Vuelve a intentarlo; si el problema continúa, avisa a quien administra el sistema.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {!esFaltaDePermisos && (
            <button type="button" className="btn btn-primary" onClick={reset}>
              Reintentar
            </button>
          )}
          <Link href="/" className="btn btn-secondary">
            Ir al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
