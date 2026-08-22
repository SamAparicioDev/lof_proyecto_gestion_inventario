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
 * | Administración | `categorias.gestionar`, `proveedores.gestionar` **o** `unidades_medida.gestionar` | el módulo tiene varias secciones y basta con poder abrir una |
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
  NotePencil,
  Package,
  Receipt,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
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
  /**
   * Para los elementos que son un MÓDULO con varias secciones (hoy solo "Administración"): se
   * muestra si la sesión puede abrir CUALQUIERA de ellas, no una en concreto.
   *
   * Nació de un defecto real (2026-08-15): la entrada se filtraba por `categorias.gestionar`, la
   * primera sección del módulo, así que un rol con `proveedores.gestionar` pero sin la otra no
   * veía el módulo en el menú — aunque `/administracion` sí sabía redirigirlo a la sección que
   * sí podía abrir. El menú escondía una puerta que la aplicación tenía abierta.
   */
  permisosAlternativos?: readonly ClavePermisoUI[];
  /**
   * Exclusivo del SUPER ADMINISTRADOR (US36, FR-148). No es un permiso y no puede serlo: este
   * módulo NO se resuelve contra la matriz, así que no existe casilla en `/roles` que lo conceda.
   * Un Administrador con los 30 permisos marcados no ve este enlace y recibe 403 si llama a la
   * ruta — el filtrado de aquí sigue siendo solo UX (FR-003), la autoridad es `SuperAdminGuard`.
   */
  soloSuperAdmin?: boolean;
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
  // US33: va junto a Inventario porque la mayoría de las preguntas son sobre existencias — es el
  // atajo a lo que está justo encima, no un módulo aparte.
  { href: '/asistente', etiqueta: 'Asistente', icono: Sparkle, permiso: PERMISOS.ASISTENTE_CONSULTAR },
  { href: '/cotizaciones', etiqueta: 'Cotizaciones', icono: Receipt, permiso: PERMISOS.COTIZACIONES_VER },
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
  // US15: una sola entrada para TODOS los catálogos de apoyo. Se muestra si la sesión puede
  // administrar ALGUNO de ellos; `/administracion` la lleva a la primera que pueda abrir.
  // US36: la mesa de trabajo del dueño del sistema. Va al final porque no es del negocio del
  // inventario, y no lleva permiso porque no hay ninguno que conceder (FR-148).
  { href: '/solicitudes', etiqueta: 'Solicitudes', icono: NotePencil, soloSuperAdmin: true },
  {
    href: '/administracion',
    etiqueta: 'Administración',
    icono: SlidersHorizontal,
    permisosAlternativos: [
      PERMISOS.CATEGORIAS_GESTIONAR,
      PERMISOS.PROVEEDORES_GESTIONAR,
      PERMISOS.UNIDADES_MEDIDA_GESTIONAR,
    ],
  },
];

/**
 * Elementos del menú que la sesión puede abrir, en el orden del mapa (UX, no seguridad).
 *
 * Cuatro casos, en este orden: `soloSuperAdmin` no mira permisos en absoluto —los concedan todos
 * o ninguno, decide el rol (US36, FR-148)—; sin permiso declarado se muestra siempre (hoy solo
 * "Panel"); con `permisosAlternativos` basta con tener UNO de ellos (un módulo con varias
 * secciones); con `permiso` hace falta ese exacto.
 */
export function navegacionPermitida(
  permisos: readonly string[] | undefined | null,
  esSuperAdmin = false,
): ElementoNavegacion[] {
  return ELEMENTOS_NAVEGACION.filter((elemento) => {
    if (elemento.soloSuperAdmin) {
      return esSuperAdmin;
    }
    if (elemento.permisosAlternativos) {
      return elemento.permisosAlternativos.some((clave) => tienePermiso(permisos, clave));
    }
    return !elemento.permiso || tienePermiso(permisos, elemento.permiso);
  });
}
