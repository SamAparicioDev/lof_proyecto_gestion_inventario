/**
 * Claves de permiso que el frontend consulta para decidir QUÉ MOSTRAR (T108, US9).
 *
 * Desde US9 el control de acceso del sistema es un dato: cada endpoint declara
 * `@RequierePermiso('modulo.accion')` y el guard del backend lo resuelve contra los permisos
 * efectivos del rol del usuario en CADA petición (FR-058, research R16). Este archivo es el
 * único sitio del frontend donde esas claves se escriben como texto: navegación, páginas y
 * botones importan de aquí en vez de repetir literales sueltos, para que una clave mal
 * escrita se corrija en un solo lugar (y para que `grep PERMISOS.SALIDAS_ANULAR` responda
 * "¿dónde se muestra el botón de anular?").
 *
 * ## Esto NO es control de acceso (FR-003, docs/arquitectura.md §7)
 *
 * Ocultar un enlace o un botón es UX: evita ofrecerle al usuario algo que va a terminar en un
 * `403`. La autoridad es SIEMPRE `PermisosGuard` en el servidor — quien llame al endpoint a
 * mano recibe `403` aunque el botón nunca se haya renderizado, y ese `403` se muestra como
 * cualquier otro error de la API.
 *
 * ## Fuente de verdad y por qué no están las 31
 *
 * El catálogo completo (31 permisos en 9 módulos) lo siembra `backend/prisma/seed.ts` y lo
 * publica `GET /api/permisos`; la pantalla de roles lo pinta desde ahí, nunca desde esta
 * lista. Aquí solo viven las claves que ALGUNA pieza de interfaz consulta hoy: agregar las
 * demás sería una constante sin consumidor (Principio V). Falta a propósito `productos.ver`
 * (ningún elemento de UI se muestra u oculta por él: alimenta los selectores de producto de
 * los formularios de ingresos y salidas, cuya visibilidad ya depende de `ingresos.crear` /
 * `salidas.crear`).
 */

/**
 * Claves de permiso (`modulo.accion`) consumidas por la interfaz. Los nombres replican la
 * clave en mayúsculas para que la traducción constante↔clave sea mecánica y verificable.
 */
export const PERMISOS = {
  INVENTARIO_VER: 'inventario.ver',
  INVENTARIO_VER_COSTOS: 'inventario.ver_costos',

  PRODUCTOS_CREAR: 'productos.crear',
  PRODUCTOS_EDITAR: 'productos.editar',
  PRODUCTOS_CAMBIAR_ESTADO: 'productos.cambiar_estado',
  PRODUCTOS_IMPORTAR: 'productos.importar',

  CLIENTES_VER: 'clientes.ver',
  CLIENTES_CREAR: 'clientes.crear',
  CLIENTES_EDITAR: 'clientes.editar',
  CLIENTES_CAMBIAR_ESTADO: 'clientes.cambiar_estado',

  PROYECTOS_CREAR: 'proyectos.crear',
  PROYECTOS_EDITAR: 'proyectos.editar',
  PROYECTOS_CAMBIAR_ESTADO: 'proyectos.cambiar_estado',

  INGRESOS_VER: 'ingresos.ver',
  INGRESOS_CREAR: 'ingresos.crear',
  INGRESOS_EDITAR: 'ingresos.editar',
  INGRESOS_RECIBIR: 'ingresos.recibir',
  INGRESOS_VERIFICAR: 'ingresos.verificar',
  INGRESOS_ANULAR: 'ingresos.anular',

  SALIDAS_VER: 'salidas.ver',
  SALIDAS_CREAR: 'salidas.crear',
  SALIDAS_EDITAR: 'salidas.editar',
  SALIDAS_CONFIRMAR: 'salidas.confirmar',
  SALIDAS_COMPLETAR: 'salidas.completar',
  SALIDAS_CANCELAR: 'salidas.cancelar',
  SALIDAS_ANULAR: 'salidas.anular',

  REPORTES_VER: 'reportes.ver',
  REPORTES_EXPORTAR: 'reportes.exportar',

  USUARIOS_GESTIONAR: 'usuarios.gestionar',

  ROLES_GESTIONAR: 'roles.gestionar',
} as const;

/**
 * Una de las claves de `PERMISOS` — impide pasar un literal inventado a `tienePermiso`.
 *
 * Es deliberadamente MÁS ESTRECHO que el `ClavePermiso` de `@trazo/compartido` (que es
 * `string`, porque el catálogo es un dato de la BD y el contrato no puede enumerarlo): aquí
 * queremos que `tienePermiso(perfil.permisos, 'salidas.anualr')` no compile. El sufijo `UI`
 * evita confundir los dos tipos al leer un import.
 */
export type ClavePermisoUI = (typeof PERMISOS)[keyof typeof PERMISOS];

/**
 * ¿La sesión concede este permiso?
 *
 * Función pura sobre `PerfilSesion.permisos` (las claves efectivas que el servidor resolvió
 * en esta misma petición): sirve igual en Server Components —donde no se pueden usar
 * hooks— y como base de `usePuede()` de `lib/sesion.tsx`. Trata la ausencia de perfil o de
 * lista como "no concedido" (fail-closed): si no sabemos qué puede el usuario, no se le
 * ofrece la acción.
 */
export function tienePermiso(permisos: readonly string[] | undefined | null, clave: ClavePermisoUI): boolean {
  return permisos?.includes(clave) ?? false;
}

/**
 * Mensaje del `<div role="alert">` de una página a la que la sesión no tiene acceso.
 *
 * Un solo texto para todas las pantallas restringidas (antes cada página escribía el suyo,
 * nombrando roles fijos: "Contacta a un administrador o gerente"). Con los permisos como
 * dato ya no hay un rol concreto al que remitir —quién puede conceder algo depende de la
 * matriz de esa organización—, así que el mensaje nombra la acción y a quién administra los
 * roles, sin prometer qué rol es (FR-016: español, claro y accionable).
 */
export function mensajeSinPermiso(accion: string): string {
  return `No tienes permiso para ${accion}. Solicítalo a quien administra los roles del sistema.`;
}
