/**
 * Entidad `SolicitudFuncionalidad` — un pedido de algo que al sistema le falta, anotado por el
 * super administrador (US36, FR-148…FR-157).
 *
 * ## Qué NO es
 *
 * No es un documento del negocio. No mueve stock, no tiene correlativo, no se exporta y nada del
 * inventario la referencia. Es la lista de trabajo del sistema sobre SÍ MISMO, y vive en el
 * dominio solo porque tiene una regla propia que merece una prueba: qué significa cada estado y
 * qué transiciones tienen sentido (FR-154).
 *
 * ## Dos textos que jamás se mezclan
 *
 * `descripcion` es lo que escribió una persona; `promptRefinado` es cómo lo interpretó un modelo
 * (FR-152). Mantenerlos separados no es redundancia: es la única forma de notar que el modelo
 * entendió otra cosa. Una entidad que los fusionara borraría la evidencia justo cuando hace falta.
 *
 * ## Por qué las transiciones son libres
 *
 * Los tres estados se alcanzan desde cualquier otro, incluida la vuelta de COMPLETADA a PENDIENTE
 * cuando lo mismo vuelve a hacer falta. Aquí no hay stock ni dinero que proteger: una transición
 * prohibida solo conseguiría que el dueño del sistema tenga que crear una fila nueva y pierda la
 * historia de que ya lo había pedido una vez. Lo que sí se comprueba es que el estado EXISTA —
 * eso lo garantiza el tipo, y el esquema Zod en la frontera.
 *
 * Implementa: FR-149 (texto libre del autor), FR-150 (nace PENDIENTE), FR-152 (el original nunca
 * se sobrescribe), FR-153 (refinar es opcional y repetible), FR-154 (los tres estados).
 */

/** Los tres estados. Espeja `ESTADOS_SOLICITUD` de `@trazo/compartido`, que el frontend usa para
 *  validar antes de enviar; el dominio no importa el paquete compartido (regla de dependencia). */
export const ESTADOS_SOLICITUD_FUNCIONALIDAD = ['PENDIENTE', 'COMPLETADA', 'DESCARTADA'] as const;
export type EstadoSolicitudFuncionalidad = (typeof ESTADOS_SOLICITUD_FUNCIONALIDAD)[number];

/** Quién hizo algo, en la forma mínima que este módulo necesita mostrar. */
export interface AutorDeSolicitud {
  readonly id: number;
  readonly nombreCompleto: string;
}

export interface SolicitudFuncionalidad {
  readonly id: number;
  readonly titulo: string;
  /** El texto del autor, TAL CUAL. Refinar no lo toca (FR-152). */
  readonly descripcion: string;
  /** `null` mientras no se haya refinado nunca (FR-153). */
  readonly promptRefinado: string | null;
  readonly refinadoEn: Date | null;
  readonly estado: EstadoSolicitudFuncionalidad;
  readonly creadaPor: AutorDeSolicitud;
  readonly creadaEn: Date;
  readonly estadoCambiadoPor: AutorDeSolicitud | null;
  readonly estadoCambiadoEn: Date | null;
}

/** Lo que hace falta para dar de alta una solicitud. El estado no viaja: siempre nace PENDIENTE
 *  (FR-150), y dejar que el alta lo eligiera solo abriría la puerta a crear una ya completada. */
export interface NuevaSolicitudFuncionalidad {
  readonly titulo: string;
  readonly descripcion: string;
  readonly creadaPorId: number;
}

/**
 * ¿Este pedido cuenta como trabajo esperando? Es la pregunta que responde el contador de la lista
 * y la razón por la que DESCARTADA existe: sin ella, todo lo que se abandona sigue sumando aquí y
 * el número deja de significar nada en dos meses (FR-154).
 */
export function estaPendiente(solicitud: Pick<SolicitudFuncionalidad, 'estado'>): boolean {
  return solicitud.estado === 'PENDIENTE';
}

/**
 * ¿Vale la pena refinar esta solicitud?
 *
 * Solo las PENDIENTES. Refinar una completada gastaría una llamada al modelo para producir un
 * prompt de algo que ya está hecho, y refinar una descartada, de algo que se decidió no hacer.
 * No es una restricción de seguridad —no hay daño posible— sino la diferencia entre un botón que
 * significa algo y uno que está siempre encendido.
 */
export function admiteRefinado(solicitud: Pick<SolicitudFuncionalidad, 'estado'>): boolean {
  return solicitud.estado === 'PENDIENTE';
}
