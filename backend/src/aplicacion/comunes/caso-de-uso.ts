/**
 * Contrato base de los casos de uso de Trazo.
 *
 * Cada operación de negocio de la spec (crear ingreso, confirmar salida, generar
 * reporte…) es UNA clase que implementa esta interfaz — una responsabilidad por clase
 * (SOLID/SRP) y un lugar único donde buscar cada proceso (requisito de trazabilidad del
 * dueño del proyecto).
 *
 * Convenciones (docs/arquitectura.md):
 * - Nombre: verbo-en-infinitivo + sustantivo → `ConfirmarSalidaCasoUso`.
 * - TSDoc obligatorio en la clase indicando QUÉ hace y QUÉ requisito implementa (FR-###).
 * - `Entrada` ya viene VALIDADA por el esquema Zod compartido (el pipe HTTP la valida);
 *   el caso de uso aplica las reglas de NEGOCIO (disponibilidad, estados, permisos de
 *   dato) y lanza errores de dominio tipados si fallan.
 * - `usuarioId` del ejecutor SIEMPRE llega como parte de la entrada — la auditoría
 *   (FR-045) no es opcional.
 * - Dependencias: SOLO puertos del dominio, inyectados por constructor (DIP). Nunca
 *   Prisma, nunca clases de infraestructura.
 */
export interface CasoDeUso<Entrada, Salida> {
  ejecutar(entrada: Entrada): Promise<Salida>;
}
