/**
 * Tipos del contrato REST — deben coincidir 1:1 con contracts/api-rest.md.
 *
 * Implementa: formato único de error y paginación de la API (FR-016, FR-047 — mensajes
 * en español; Restricciones adicionales de la constitución — paginación obligatoria).
 */
import type { RolAsignado } from './roles';

/**
 * Formato ÚNICO de error de toda la API.
 *
 * - `mensaje`: texto en español listo para mostrar al usuario (toast / banner).
 * - `campos`: cuando el error pertenece a campos concretos del formulario
 *   (p. ej. "numeroFactura": "El número de factura ya existe"), el frontend lo pinta
 *   junto al campo correspondiente. `null` cuando es un error general.
 *
 * Producido por: FiltroErroresDominio y PipeValidacionZod en el backend
 * (backend/src/interfaces/http/comunes). Consumido por: frontend/src/lib/api/cliente.ts.
 */
export interface ApiError {
  error: {
    mensaje: string;
    campos: Record<string, string> | null;
  };
}

/**
 * Respuesta estándar de TODOS los listados paginados de la API.
 * `pagina` inicia en 1; `porPagina` tiene tope 100 en el backend.
 */
export interface Paginado<T> {
  datos: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

/**
 * Roles del sistema (FR-002) — los tres que la migración de US9 sembró como roles del
 * sistema (`es_sistema = true`, FR-059).
 *
 * Desde US9 este union YA NO es el mecanismo de autorización: los permisos son datos
 * (`roles` ⋈ `roles_permisos` ⋈ `permisos`, research R16) y quien decide es
 * `PerfilSesion.permisos`, no este nombre.
 *
 * RESIDUAL desde T106: el contrato ya NO publica el rol como este texto — `PerfilSesion.rol`
 * y `Usuario.rol` son `RolAsignado` (`{id, nombre}`, contracts/api-rest.md § Roles y
 * permisos), porque un rol propio como "Bodeguero" no tiene representación en este union y
 * su nombre, a diferencia de su id, puede cambiar. Sobrevive únicamente porque varias
 * pantallas del frontend todavía lo declaran como tipo de sus props; T108 lo retira al
 * terminar de filtrar por PERMISO. Nada nuevo debe compararse contra estos valores para
 * decidir qué se puede hacer (FR-058) — se compara contra `permisos`.
 */
export type Rol = 'ADMINISTRADOR' | 'GERENTE' | 'OPERARIO';

/**
 * Perfil de sesión que expone GET /api/auth/perfil.
 * El frontend lo usa para filtrar la navegación por PERMISO y para forzar el cambio de
 * contraseña inicial (contracts/rutas-frontend.md). Nunca incluye datos sensibles.
 */
export interface PerfilSesion {
  id: number;
  nombreCompleto: string;
  /**
   * Correo del propio usuario (US14/FR-080). Se incorporó para poder precargar la pantalla de
   * datos personales sin pedir otro endpoint: es un dato de uno mismo, y quien recibe este
   * perfil es exactamente esa persona. No expone información de terceros — el correo de OTROS
   * usuarios sigue viviendo solo en `/api/usuarios`, que exige `usuarios.gestionar`.
   */
  email: string;
  /** Nombre de usuario propio (US14): se muestra en solo lectura en la pantalla de datos
   *  personales — identifica los registros históricos de esa persona y por eso no se edita. */
  login: string;
  /**
   * Rol del usuario IDENTIFICADO (`{id, nombre}`, T106): un rol propio puede renombrarse, así
   * que su nombre no es un identificador estable, y su id es lo que el formulario de usuarios
   * envía como `rolId`. Es una ETIQUETA para la interfaz — quién puede qué lo dicen
   * `permisos` (abajo) y, con autoridad, el guard del servidor.
   */
  rol: RolAsignado;
  /**
   * Claves de permiso efectivas del rol del usuario (`modulo.accion`), resueltas en el
   * servidor en ESTA petición (US9-AS3: quitarle un permiso a un rol aplica sin re-login).
   *
   * Es información para la UI —qué enlaces y botones tiene sentido mostrar—, NUNCA control
   * de acceso: la autoridad es `PermisosGuard` en cada endpoint (FR-003/FR-058). Ocultar
   * un botón con esta lista no protege nada; el backend responde 403 igual.
   */
  permisos: string[];
  debeCambiarPassword: boolean;
}
