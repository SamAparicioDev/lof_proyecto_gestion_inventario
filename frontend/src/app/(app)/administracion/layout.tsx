/**
 * Shell del módulo de Administración (US15).
 *
 * Agrupa el mantenimiento de los CATÁLOGOS del sistema: los datos de apoyo que el negocio
 * parametriza (categorías, proveedores, y los que vayan surgiendo) y que el resto de pantallas
 * solo consume. Tenerlos bajo un módulo propio evita que la barra lateral crezca con una
 * entrada por catálogo, que es lo que ocurriría si cada uno colgara de la raíz.
 *
 * El control de acceso NO vive aquí sino en cada página, que es lo correcto: las secciones
 * exigen permisos distintos (`categorias.gestionar`, `proveedores.gestionar`), así que un layout
 * que bloqueara el módulo entero con un solo permiso dejaría fuera a quien puede administrar
 * una sola cosa.
 */
import { PestanasAdministracion } from '@/componentes/administracion/pestanas-administracion';

export default function LayoutAdministracion({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Administración</h6>
        <h2 style={{ margin: 0 }}>Catálogos del sistema</h2>
      </div>
      <PestanasAdministracion />
      {children}
    </div>
  );
}
