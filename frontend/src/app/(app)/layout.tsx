/**
 * Layout autenticado — envuelve todas las rutas del grupo `(app)` (T025).
 *
 * Responsabilidades (contracts/rutas-frontend.md):
 *  1. Resuelve la sesión del lado servidor reenviando la cookie a `GET /api/auth/perfil`
 *     (frontend/src/lib/api/auth-servidor.ts). Sin sesión válida → `redirect('/login')`.
 *     Esto complementa el gate básico del middleware (T022), que solo revisa la
 *     PRESENCIA de la cookie porque el Edge Runtime no puede validar el JWT contra BD.
 *  2. Si `perfil.debeCambiarPassword` es true y la ruta actual no es ya
 *     `/cambiar-password`, fuerza la redirección (FR-004). La ruta actual llega vía el
 *     header que inyecta el middleware (`ENCABEZADO_RUTA_ACTUAL`) porque un layout de
 *     servidor no tiene una forma oficial de leer el pathname de la petición.
 *  3. Renderiza el "shell" de `Trazo Inventarios.dc.html` (sistema de diseño Nocturne —
 *     docs/diseno-nocturne.md): barra lateral fija de 224px con marca, navegación filtrada
 *     por PERMISO (T108: `perfil.permisos`, no el nombre del rol — un rol propio creado por
 *     el Administrador no tiene nombre conocido de antemano, FR-058) y bloque de usuario con
 *     iniciales + "Cerrar sesión". Recuerda: ocultar un enlace NO es control de acceso
 *     (FR-003); la autoridad real son los guards del backend. La barra lateral lleva `no-imprimir` (`globals.css`, FR-043 — T071/T072): al
 *     imprimir un reporte desde `/reportes/*`, la vista impresa muestra solo el contenido
 *     del reporte, nunca la navegación de la app.
 *     En mobile/tablet (<=900px, `globals.css`) `#sideuser` completo se oculta por espacio;
 *     `#cerrar-sesion-movil` (auditoría de responsividad, 2026-08-11) es la segunda
 *     instancia de `BotonCerrarSesion` que queda visible ahí — sin ella no había NINGUNA
 *     forma de cerrar sesión en esos anchos, un hallazgo real de esa auditoría.
 *  4. Expone el perfil ya resuelto a los Client Components vía `ProveedorSesion` (T026),
 *     evitando que cada uno vuelva a pedir `GET /api/auth/perfil` por su cuenta.
 */
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { CubeTransparent } from '@phosphor-icons/react/dist/ssr';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { ENCABEZADO_RUTA_ACTUAL } from '@/lib/sesion-constantes';
import { ProveedorSesion } from '@/lib/sesion';
import { iniciales } from '@/lib/formato';
import { NavegacionLateral } from '@/componentes/layout/navegacion-lateral';
import { BotonCerrarSesion } from '@/componentes/layout/boton-cerrar-sesion';

const RUTA_CAMBIAR_PASSWORD = '/cambiar-password';

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const perfil = await obtenerPerfilServidor();
  if (!perfil) {
    redirect('/login');
  }

  const rutaActual = (await headers()).get(ENCABEZADO_RUTA_ACTUAL);
  if (perfil.debeCambiarPassword && rutaActual !== RUTA_CAMBIAR_PASSWORD) {
    redirect(RUTA_CAMBIAR_PASSWORD);
  }

  return (
    <ProveedorSesion perfil={perfil}>
      <div id="shell" className="grid min-h-screen" style={{ gridTemplateColumns: '224px 1fr', background: 'var(--color-bg)' }}>
        <aside
          id="sidebar"
          className="no-imprimir sticky top-0 flex h-screen flex-col gap-[18px] p-3.5"
          style={{ borderRight: '1px solid var(--color-divider)', gridColumn: '1' }}
        >
          <div className="flex items-center gap-2.5 px-1.5 py-0.5">
            <div
              className="flex size-7 flex-none items-center justify-center rounded-[7px]"
              style={{ border: '1px solid var(--color-accent)', color: 'var(--color-accent)' }}
            >
              <CubeTransparent size={16} />
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 16 }}>Trazo</div>
          </div>

          <NavegacionLateral permisos={perfil.permisos} />

          <div id="sideuser" className="mt-auto flex flex-col gap-2">
            {/* El bloque de usuario es el enlace a los datos personales (US14): es donde el
                usuario ya mira su propio nombre, así que es donde espera poder corregirlo. Sin
                permiso asociado a propósito — son sus datos, no la administración de otros. */}
            <Link
              href="/mi-perfil"
              title="Ver y editar mis datos personales"
              className="flex items-center gap-2.5 rounded-md px-1.5 py-2 no-underline transition-colors hover:bg-white/[0.06]"
              style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}
            >
              <div
                className="grid size-7.5 flex-none place-items-center rounded-full text-xs"
                style={{ background: 'var(--color-accent-800)', color: 'var(--color-accent-100)' }}
              >
                {iniciales(perfil.nombreCompleto)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px]">{perfil.nombreCompleto}</div>
                {/* Etiqueta del rol: presentación pura. El nombre llega listo para mostrar
                    desde `GET /api/auth/perfil` (T106, `rol: {id, nombre}`) — ya no hay un mapa
                    de nombres fijos, porque un rol propio como "Bodeguero" no estaría en él.
                    Quién puede qué lo dicen `perfil.permisos` y el guard del servidor. */}
                <div className="text-muted text-[11px]">{perfil.rol.nombre}</div>
              </div>
            </Link>
            <BotonCerrarSesion />
          </div>

          {/* Oculto en escritorio (Tailwind `hidden`); `globals.css` lo muestra solo en
              <=900px, cuando `#sideuser` de arriba desaparece — ver comentario del punto 3. */}
          <div id="cerrar-sesion-movil" className="hidden">
            <BotonCerrarSesion soloIcono />
          </div>
        </aside>

        <main className="flex min-w-0 flex-col gap-5 px-[30px] py-[26px]" style={{ gridColumn: '2' }}>{children}</main>
      </div>
    </ProveedorSesion>
  );
}
