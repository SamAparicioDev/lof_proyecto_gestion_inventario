/**
 * Mapa de navegación lateral de la app autenticada (T025, filtrado por PERMISO desde T108).
 *
 * Refleja 1:1 la barra lateral de `Trazo Inventarios.dc.html` (sistema de diseño
 * Nocturne — docs/diseno-nocturne.md) y la tabla "Mapa de rutas UI" de
 * contracts/rutas-frontend.md: un solo enlace "Reportes" (apunta a
 * `/reportes/consumo-cliente`, el primero de los 4). A diferencia de lo que decía
 * originalmente este comentario, los 4 sub-reportes NO se resuelven con pestañas dentro de
 * una sola pantalla (`reportTab` del mockup) — se implementaron como 4 rutas Next.js
 * independientes en tandas distintas (US4/US7), tal como exige
 * contracts/rutas-frontend.md. La navegación ENTRE esas 4 rutas vive en
 * `componentes/reportes/pestanas-reportes.tsx` (un componente compartido que las 4 páginas
 * renderizan, no en este menú lateral) — corregido tras un hallazgo de revisión adversarial
 * (tanda US7, 2026-08-11): sin ese componente, un usuario real solo podía llegar a
 * consumo-cliente desde el sidebar, sin forma de descubrir los otros 3.
 *
 * ## Por qué un permiso y no una lista de roles (US9/T108)
 *
 * Hasta US9 cada elemento declaraba `roles: Rol[]` y el sidebar comparaba contra el nombre
 * del rol de la sesión. Con los permisos como dato (research R16) eso deja de funcionar: el
 * Administrador puede crear un rol "Bodeguero" cuyo nombre este archivo no puede conocer, y
 * lo que decide qué ve ese rol son sus permisos (FR-058, US9-AS2). Cada elemento declara
 * ahora EL permiso que exige el endpoint principal de su pantalla — el mismo que el
 * controlador correspondiente pide con `@RequierePermiso`, para que el menú y el servidor
 * nunca discrepen:
 *
 * | Enlace | Permiso | Endpoint que lo exige |
 * |---|---|---|
 * | Panel | — (ninguno) | `GET /api/panel` no exige permiso: ver abajo |
 * | Inventario | `inventario.ver` | `GET /api/inventario` |
 * | Órdenes de compra | `ordenes_compra.ver` | `GET /api/ordenes-compra` |
 * | Ingresos | `ingresos.ver` | `GET /api/ingresos` |
 * | Salidas | `salidas.ver` | `GET /api/salidas` |
 * | Clientes y proyectos | `clientes.ver` | `GET /api/clientes` |
 * | Reportes | `reportes.ver` | `GET /api/reportes/*` |
 * | Usuarios | `usuarios.gestionar` | todo `/api/usuarios` |
 * | Roles y permisos | `roles.gestionar` | `/api/roles`, `GET /api/permisos` |
 *
 * ## "Panel" es el único elemento SIN permiso (US10/T116)
 *
 * Mientras `/` era una redirección a `/inventario`, este elemento exigía `inventario.ver` — el
 * permiso de su destino real, para no mandar a nadie a un `403`. Desde US10, `/` es el panel de
 * control: una pantalla propia que `GET /api/panel` responde a CUALQUIER sesión, recortada en el
 * SERVIDOR a las secciones que esa sesión puede consultar (FR-062; ver el TSDoc de
 * `interfaces/http/panel/controlador-panel.ts` para por qué el endpoint no declara permiso
 * propio). Seguir exigiéndole `inventario.ver` escondería la portada —lo primero que ve todo el
 * mundo al entrar— a un rol propio que no vea inventario pero sí salidas o ingresos, con sus
 * pendientes esperándolo justo ahí. Por eso `permiso` es opcional: sin él, el elemento se
 * muestra a toda sesión autenticada.
 *
 * El filtrado aquí es solo UX (ocultar un enlace no es control de acceso, FR-003): la
 * autoridad real son los guards del backend (docs/arquitectura.md §7).
 */
import type { Icon } from '@phosphor-icons/react';
import {
  ArrowSquareIn,
  ArrowSquareOut,
  ChartBar,
  Gauge,
  Package,
  Receipt,
  ShieldCheck,
  SlidersHorizontal,
  UserGear,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr';
import { PERMISOS, tienePermiso, type ClavePermisoUI } from './permisos';

export interface ElementoNavegacion {
  href: string;
  etiqueta: string;
  icono: Icon;
  /** Permiso que exige el endpoint principal de la pantalla (ver tabla del encabezado).
   *  Ausente = la pantalla no exige ninguno y se muestra a toda sesión autenticada (hoy solo
   *  "Panel" — ver "«Panel» es el único elemento SIN permiso" en el encabezado). */
  permiso?: ClavePermisoUI;
}

export const ELEMENTOS_NAVEGACION: ElementoNavegacion[] = [
  { href: '/', etiqueta: 'Panel', icono: Gauge },
  {
    href: '/ordenes-compra',
    etiqueta: 'Órdenes de compra',
    icono: Receipt,
    permiso: PERMISOS.ORDENES_COMPRA_VER,
  },
  { href: '/ingresos', etiqueta: 'Ingresos', icono: ArrowSquareIn, permiso: PERMISOS.INGRESOS_VER },
  { href: '/inventario', etiqueta: 'Inventario', icono: Package, permiso: PERMISOS.INVENTARIO_VER },
  { href: '/salidas', etiqueta: 'Salidas', icono: ArrowSquareOut, permiso: PERMISOS.SALIDAS_VER },
  {
    href: '/clientes',
    etiqueta: 'Clientes y proyectos',
    icono: UsersThree,
    permiso: PERMISOS.CLIENTES_VER,
  },
  {
    href: '/reportes/consumo-cliente',
    etiqueta: 'Reportes',
    icono: ChartBar,
    permiso: PERMISOS.REPORTES_VER,
  },
  { href: '/usuarios', etiqueta: 'Usuarios', icono: UserGear, permiso: PERMISOS.USUARIOS_GESTIONAR },
  { href: '/roles', etiqueta: 'Roles y permisos', icono: ShieldCheck, permiso: PERMISOS.ROLES_GESTIONAR },
  // US15: una sola entrada para TODOS los catálogos de apoyo. Se filtra por `categorias.gestionar`
  // porque es la primera sección del módulo; `/administracion` redirige a la que el rol pueda ver.
  {
    href: '/administracion',
    etiqueta: 'Administración',
    icono: SlidersHorizontal,
    permiso: PERMISOS.CATEGORIAS_GESTIONAR,
  },
];

/** Elementos del menú que la sesión puede abrir, en el orden del mapa (UX, no seguridad).
 *  Un elemento sin `permiso` declarado se muestra siempre (ver encabezado). */
export function navegacionPermitida(permisos: readonly string[] | undefined | null): ElementoNavegacion[] {
  return ELEMENTOS_NAVEGACION.filter((elemento) => !elemento.permiso || tienePermiso(permisos, elemento.permiso));
}
