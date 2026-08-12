/**
 * Controlador `ControladorPermisos` — `GET /api/permisos`, el catálogo de permisos del
 * sistema agrupado por módulo (contracts/api-rest.md § Roles y permisos, FR-056).
 *
 * SOLO LECTURA, y por eso este controlador tiene un único endpoint: cada permiso corresponde
 * a una verificación real del código (`@RequierePermiso('...')`), así que se siembra con el
 * despliegue y se versiona con él. Ofrecer "crear permiso" produciría filas que ningún
 * endpoint consulta — una casilla que el Administrador marca creyendo que concede algo y no
 * concede nada, peor que no ofrecer la opción (research R16). Lo administrable es la MATRIZ
 * rol↔permiso (`/api/roles`).
 *
 * Vive junto a `ControladorRoles` —y no en un módulo propio— porque sirve a la MISMA pantalla:
 * el catálogo es la lista de casillas que el editor de un rol muestra (mismo criterio por el
 * que `ControladorProyectos` vive en el módulo de clientes). Exige el mismo permiso,
 * `roles.gestionar`: es información de administración, no del día a día.
 *
 * La agrupación por módulo se arma AQUÍ, no en el repositorio ni en un caso de uso: es la
 * forma de la respuesta del contrato (`[{modulo, permisos:[…]}]`), no una regla de negocio.
 * El adaptador ya devuelve el catálogo ordenado por módulo y clave, así que agrupar es un
 * recorrido lineal que conserva ese orden.
 *
 * Implementa: FR-054 (los permisos son datos) y FR-056 (catálogo sembrado, de solo lectura
 * desde la interfaz), sirviendo a la pantalla de roles (T107).
 */
import { Controller, Get, Inject } from '@nestjs/common';
import type { ModuloPermisos } from '@trazo/compartido';
import type { Permiso } from '../../../dominio/entidades/permiso';
import { REPOSITORIO_PERMISOS, type RepositorioPermisos } from '../../../dominio/puertos/repositorio-permisos';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';

@Controller('permisos')
export class ControladorPermisos {
  constructor(@Inject(REPOSITORIO_PERMISOS) private readonly repositorioPermisos: RepositorioPermisos) {}

  /** `GET /api/permisos` — catálogo completo agrupado por módulo, sin paginar: es un catálogo
   *  cerrado y pequeño que el Administrador necesita ver entero para marcar casillas (FR-056). */
  @Get()
  @RequierePermiso('roles.gestionar')
  async listar(): Promise<ModuloPermisos[]> {
    const permisos = await this.repositorioPermisos.listar();
    return agruparPorModulo(permisos);
  }
}

/**
 * Agrupa el catálogo en `[{modulo, permisos:[{id, clave, descripcion}]}]` conservando el orden
 * en que llega (módulo asc, clave asc — ver `RepositorioPermisosPrisma.listar`). `modulo` no
 * se repite dentro de cada permiso: ya lo lleva el grupo.
 */
function agruparPorModulo(permisos: Permiso[]): ModuloPermisos[] {
  const grupos = new Map<string, ModuloPermisos>();
  for (const permiso of permisos) {
    const grupo = grupos.get(permiso.modulo) ?? { modulo: permiso.modulo, permisos: [] };
    grupo.permisos.push({ id: permiso.id, clave: permiso.clave, descripcion: permiso.descripcion });
    grupos.set(permiso.modulo, grupo);
  }
  return [...grupos.values()];
}
