/**
 * Entidad de dominio `Usuario` — TypeScript puro (Principio VI, NO NEGOCIABLE).
 *
 * El dominio define sus PROPIOS tipos en vez de importar los generados por Prisma: no
 * conoce Prisma ni ningún framework (docs/arquitectura.md §2, regla de dependencia). El
 * adaptador `infraestructura/persistencia/repositorio-usuarios.prisma.ts` traduce
 * explícitamente entre la fila de `usuarios` (que desde US9 lleva `rol_id` → `roles`) y
 * esta entidad.
 *
 * PUENTE DE US9 RETIRADO (T106): hasta esta tarea el usuario llevaba, además de su rol, el
 * campo `rol: NombreRol` con el texto `ADMINISTRADOR|GERENTE|OPERARIO` que el contrato
 * publicaba. Se eliminó junto con el mapa que lo derivaba del nombre del rol: los roles son
 * datos administrables (FR-054), así que un rol propio como "Bodeguero" no tenía
 * representación en ese union y su usuario habría roto el perfil. El contrato publica ahora
 * `rol: {id, nombre}` (contracts/api-rest.md § Roles y permisos) y la autorización se resuelve
 * —desde T103— exclusivamente contra `rolAsignado.permisos`.
 *
 * Implementa: FR-002 (cada usuario tiene exactamente un rol) y FR-006 (estado
 * ACTIVO/INACTIVO que gobierna si el usuario puede autenticarse — Principio III, Control de
 * Acceso por Roles).
 */
import type { Rol } from './rol';

/** Estado de acceso del usuario — INACTIVO es baja lógica, nunca se elimina (FR-008). */
export type EstadoUsuario = 'ACTIVO' | 'INACTIVO';

/**
 * Usuario del sistema, sin datos sensibles de credenciales: el hash de password NUNCA
 * viaja en esta forma (FR-007). Para el único caso en que el hash es necesario —
 * verificar el login o la contraseña actual al cambiarla — el puerto `RepositorioUsuarios`
 * expone `UsuarioAutenticable`, que extiende esta entidad solo en esos flujos puntuales.
 */
export interface Usuario {
  readonly id: number;
  readonly nombreCompleto: string;
  readonly email: string;
  readonly login: string;
  /**
   * Rol COMPLETO del usuario con sus permisos efectivos (FR-058), y ÚNICA fuente de
   * autorización del sistema desde T103. Se resuelve SIEMPRE desde la BD al revalidar la
   * sesión (`RepositorioUsuarios.buscarPorId`, en el mismo `include` que ya traía el rol) y
   * NUNCA desde un claim del JWT — así, quitarle un permiso a un rol aplica en la petición
   * siguiente sin que el usuario vuelva a iniciar sesión (US9-AS3, research R16).
   */
  readonly rolAsignado: Rol;
  readonly estado: EstadoUsuario;
  readonly debeCambiarPassword: boolean;
}
