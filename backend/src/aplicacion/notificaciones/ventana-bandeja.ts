/**
 * Desde cuándo se muestran los avisos de una sesión (US35, FR-147).
 *
 * Dos límites, y se aplica el MÁS RECIENTE de los dos:
 *
 *  1. **El alta del usuario.** Quien entra por primera vez no hereda pendientes ajenos. Abrir la
 *     campana el primer día y encontrarse cuarenta avisos de cosas que uno no vivió es la forma
 *     más rápida de que la campana deje de mirarse — y a partir de ahí también se pierden los
 *     que sí importaban.
 *  2. **La ventana de la bandeja.** Un aviso viejo ya no es un aviso: o se atendió, o el hecho
 *     está en el documento y en los movimientos, que es donde vive la historia de verdad
 *     (FR-046/FR-045). La bandeja no es un archivo.
 *
 * Se calcula en la aplicación y no en el adaptador porque es una regla de producto, no una de
 * consulta: cambiarla es una decisión, y este archivo es donde se busca.
 */

/** Cuántos días atrás llega la bandeja. 30 = "el mes pasado", que es como la gente habla. */
export const DIAS_DE_VENTANA = 30;

/**
 * La fecha desde la cual esta sesión ve avisos: la más reciente entre su alta y el inicio de la
 * ventana. `ahora` se recibe en vez de leerse aquí para que las pruebas puedan fijarlo.
 */
export function inicioDeLaBandeja(fechaAltaDelUsuario: Date, ahora: Date = new Date()): Date {
  const inicioDeVentana = new Date(ahora.getTime() - DIAS_DE_VENTANA * 24 * 60 * 60 * 1000);
  return fechaAltaDelUsuario > inicioDeVentana ? fechaAltaDelUsuario : inicioDeVentana;
}
