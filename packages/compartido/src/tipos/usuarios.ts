/**
 * Forma de la API REST de usuarios consumida por el frontend (contracts/api-rest.md §
 * Usuarios, T075/T077). Refleja la entidad de dominio `backend/src/dominio/entidades/
 * usuario.ts` SERIALIZADA a JSON — mismo criterio que `tipos/clientes.ts`: el frontend
 * nunca importa la entidad de dominio directamente (docs/arquitectura.md §2).
 *
 * Implementa: FR-005 (forma de lectura de un usuario para el listado/detalle de
 * administración), FR-007 (esta forma NUNCA incluye `passwordHash` — el backend proyecta la
 * entidad `Usuario` de dominio, que ya no tiene ese campo) y FR-008 (estado de baja
 * lógica ACTIVO/INACTIVO, nunca eliminación).
 */
import type { RolAsignado } from './roles';

/** Estado de acceso del usuario — INACTIVO es baja lógica, nunca se elimina (FR-008). */
export type EstadoUsuario = 'ACTIVO' | 'INACTIVO';

export interface Usuario {
  id: number;
  nombreCompleto: string;
  email: string;
  login: string;
  /**
   * Rol asignado, IDENTIFICADO (US9/T106 — antes era el texto `ADMINISTRADOR|GERENTE|OPERARIO`).
   * El `id` es lo que la pantalla de edición precarga en `rolId`; el `nombre` es lo que la
   * tabla muestra, y puede ser el de un rol propio ("Bodeguero") que ningún enum del código
   * conoce (FR-054).
   *
   * NO viajan los permisos del rol: existen para que el servidor autorice cada petición
   * (FR-058), no para publicarse fila por fila en un listado. Los del usuario de la SESIÓN sí
   * viajan, en `PerfilSesion.permisos`, para que la interfaz sepa qué ofrecer.
   */
  rol: RolAsignado;
  estado: EstadoUsuario;
  debeCambiarPassword: boolean;
}
