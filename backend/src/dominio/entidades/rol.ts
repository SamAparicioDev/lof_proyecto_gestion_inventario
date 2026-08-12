/**
 * Entidad de dominio `Rol` — TypeScript puro (Principio VI, NO NEGOCIABLE).
 *
 * Un rol es un CONJUNTO DE PERMISOS con nombre. Desde US9 es un dato administrable y no una
 * lista fija en el código: el Administrador crea roles propios además de los tres del
 * sistema y marca qué permisos tiene cada uno (FR-054/FR-055). La autorización de cada
 * endpoint se resuelve contra `permisos` — nunca contra `nombre`, que es una etiqueta para
 * humanos y puede cambiar en los roles no-sistema.
 *
 * Invariantes de negocio que protegen a la organización de quedarse sin quién la administre
 * (FR-057) — se verifican en los casos de uso de `aplicacion/roles/` (T105), no aquí:
 * - un rol con `esSistema = true` no se elimina ni se renombra;
 * - un rol con usuarios asignados no se elimina (se desactiva);
 * - no se puede quitar `roles.gestionar` del ÚLTIMO rol activo que lo tiene.
 *
 * Implementa: FR-054 (permisos como datos), FR-055 (CRUD de roles y su matriz de permisos),
 * FR-057 (invariantes anti-bloqueo) y FR-059 (los tres roles iniciales existen como roles
 * del sistema con exactamente sus permisos previos).
 */
import type { ClavePermiso } from './permiso';

/** Estado de un rol — INACTIVO es baja lógica, nunca se elimina (data-model.md § roles). */
export type EstadoRol = 'ACTIVO' | 'INACTIVO';

/** Rol con sus permisos efectivos. `permisos` son CLAVES (`modulo.accion`), no ids: es lo
 *  que el guard compara en cada petición y lo que viaja al frontend en el perfil (FR-058). */
export interface Rol {
  readonly id: number;
  readonly nombre: string;
  readonly descripcion: string | null;
  /** `true` en Administrador/Gerente/Operario — sembrados por la migración (FR-059). */
  readonly esSistema: boolean;
  readonly estado: EstadoRol;
  readonly permisos: readonly ClavePermiso[];
}
