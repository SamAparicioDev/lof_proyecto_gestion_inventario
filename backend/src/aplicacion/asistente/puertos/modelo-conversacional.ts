/**
 * Puerto `ModeloConversacional` — hablar con un modelo de lenguaje, visto desde la aplicación
 * (US33, FR-133). Implementado por `infraestructura/ia/adaptador-claude.ts`.
 *
 * ## Qué hace este puerto, y qué NO hace
 *
 * Hace UN paso de conversación: recibe el historial y las herramientas disponibles, y devuelve o
 * bien texto final, o bien qué herramientas quiere ejecutar. **El bucle no vive aquí.** Vive en
 * `ConsultarAsistenteCasoUso`, y esa separación no es estética:
 *
 * - QUÉ se puede consultar y CON QUÉ PERMISO es una regla de negocio (FR-134). Si el bucle
 *   viviera en el adaptador, la infraestructura estaría ejecutando casos de uso — justo al revés
 *   de la regla de dependencia (docs/arquitectura.md §2).
 * - Así el caso de uso es testeable con un modelo falso que devuelva llamadas fijas, sin red y
 *   sin clave de API.
 *
 * El adaptador solo sabe traducir esta forma a la del proveedor y volver. No sabe qué es un
 * producto, ni quién pregunta, ni qué permisos tiene.
 *
 * Implementa: FR-133 (asistente de consultas), FR-136 (su ausencia o su fallo nunca tumban el
 * resto de la aplicación — ver `disponible`).
 */

/** Turno de la conversación tal como lo entiende la aplicación (sin tipos del proveedor). */
export interface MensajeConversacion {
  readonly rol: 'usuario' | 'asistente';
  readonly texto: string;
}

/** Herramienta ofrecida al modelo: qué es y qué argumentos admite (JSON Schema). */
export interface HerramientaOfrecida {
  readonly nombre: string;
  readonly descripcion: string;
  readonly esquemaArgumentos: Record<string, unknown>;
}

/** Lo que el modelo pide ejecutar. `id` lo devuelve el proveedor y hay que citarlo al responder. */
export interface LlamadaHerramienta {
  readonly id: string;
  readonly nombre: string;
  readonly argumentos: Record<string, unknown>;
}

/** Resultado de una herramienta, listo para devolvérselo al modelo. */
export interface ResultadoHerramienta {
  readonly id: string;
  readonly contenido: string;
  /** `true` cuando la herramienta falló o el permiso no alcanzaba — el modelo debe saberlo para
   *  decirlo, no para reintentar a ciegas. */
  readonly esError?: boolean;
}

/** Un paso de conversación: o el modelo terminó (`texto`), o quiere herramientas (`llamadas`). */
export interface PasoConversacion {
  readonly texto: string;
  readonly llamadas: readonly LlamadaHerramienta[];
  /** Turno del asistente tal cual lo devolvió el proveedor, para reenviarlo en el paso siguiente.
   *  Es opaco a propósito: la aplicación lo transporta, no lo interpreta. */
  readonly turnoCrudo: unknown;
}

/** Entrada de un paso. `sistema` va aparte del historial porque es lo que se cachea (prefijo
 *  estable) y porque no es un turno de nadie. */
export interface EntradaPasoConversacion {
  readonly sistema: string;
  /** Contexto volátil (fecha de hoy, quién pregunta) — separado de `sistema` para no invalidar
   *  la caché de prefijo en cada petición. */
  readonly contexto: string;
  readonly mensajes: readonly MensajeConversacion[];
  /** Turnos crudos y resultados acumulados del bucle de herramientas de ESTA consulta. */
  readonly intercambio: readonly (unknown | ResultadoHerramienta[])[];
  readonly herramientas: readonly HerramientaOfrecida[];
}

export interface ModeloConversacional {
  /**
   * ¿Está configurado el servicio? Si devuelve `false`, el caso de uso responde con un aviso en
   * español en vez de intentar la llamada (FR-136). Un despliegue sin clave de API tiene el
   * asistente apagado, no roto.
   */
  disponible(): boolean;

  /**
   * Un paso de conversación. Puede lanzar lo que lance el proveedor (red, cuota, clave inválida):
   * quien lo captura es `ConsultarAsistenteCasoUso`, que responde con un aviso en español en vez
   * de propagar un 500 (FR-136). Este puerto no traduce esos fallos a errores de dominio porque
   * no son estados de negocio — son la ausencia de un servicio externo.
   */
  responder(entrada: EntradaPasoConversacion): Promise<PasoConversacion>;
}

/** Token de inyección de NestJS para el puerto. */
export const MODELO_CONVERSACIONAL = 'ModeloConversacional';
