/**
 * Puerto `RepositorioPermisos` — lectura del catálogo de permisos del sistema (patrón
 * Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-permisos.prisma.ts`.
 *
 * Tiene UN SOLO método a propósito: el catálogo es de SOLO LECTURA desde la aplicación
 * (FR-056). Cada fila corresponde a una verificación real del código
 * (`@RequierePermiso('clave')`), así que se siembra con el despliegue y no existe forma de
 * crear, editar ni borrar permisos desde la API — un permiso que ningún endpoint consulta
 * sería una casilla que concede la nada (research R16).
 *
 * Un solo método le alcanza también a T105, que lo consume por dos vías: `ActualizarRolCasoUso`
 * resuelve aquí el id de `roles.gestionar` (el invariante de FR-057 razona en CLAVES y el cuerpo
 * de la petición viaja por ids), y la validación "permiso inexistente" al crear/editar un rol
 * (`400`, contracts/api-rest.md) NO necesita consulta alguna: la FK de `roles_permisos` la
 * detecta y el adaptador la traduce a un error de campo. Buscar por ids contra ~30 filas
 * versionadas con el código no justificaría un método más (Principio V).
 *
 * Implementa: FR-054 (permisos como datos) y FR-056 (catálogo sembrado, no administrable
 * desde la interfaz), sirviendo a `GET /api/permisos`.
 */
import type { Permiso } from '../entidades/permiso';

export interface RepositorioPermisos {
  /**
   * Catálogo completo, ordenado por módulo y luego por clave — el orden en que la pantalla de
   * roles (T107) lo agrupa. Sin paginar: es un catálogo cerrado y pequeño que el
   * Administrador necesita ver entero para marcar casillas (`GET /api/permisos`, FR-056).
   */
  listar(): Promise<Permiso[]>;
}

/** Token de inyección de NestJS para el puerto `RepositorioPermisos`. */
export const REPOSITORIO_PERMISOS = 'RepositorioPermisos';
