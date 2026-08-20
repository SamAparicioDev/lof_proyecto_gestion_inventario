/**
 * Cliente del ASISTENTE DE CONSULTAS (US33, FR-133).
 *
 * Una sola operación, y a propósito: el asistente pregunta y responde. No hay aquí —ni puede
 * haber— una función que registre o corrija nada; el backend tampoco expone la ruta.
 */
import type { DatosConsultaAsistente, RespuestaAsistente } from '@trazo/compartido';
import { api } from './cliente';

/**
 * `POST /api/asistente/consulta`.
 *
 * Puede tardar bastante más que el resto de la API: por dentro el asistente encadena consultas y
 * el modelo piensa entre ellas. La pantalla muestra estado de espera en vez de fingir instantáneo
 * — y el propio cuerpo trae `disponible: false` cuando el servicio no está, para distinguir "no
 * pude" de "no hay dato" (FR-136).
 */
export function consultarAsistente(datos: DatosConsultaAsistente): Promise<RespuestaAsistente> {
  return api<RespuestaAsistente>('/api/asistente/consulta', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}
