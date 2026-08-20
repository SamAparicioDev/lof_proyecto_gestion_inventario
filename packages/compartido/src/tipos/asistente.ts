/**
 * Forma de la respuesta del ASISTENTE (contracts/api-rest.md § Asistente, US33).
 *
 * `fuentes` es la parte que hace verificable la respuesta (FR-135): dice qué consultó el asistente
 * para contestar, con qué argumentos, y si tuvo permiso. Sin eso, una cifra en un chat es una
 * afirmación sin respaldo — y en un inventario eso vale menos que nada.
 */

/** Una consulta que el asistente hizo para responder. */
export interface FuenteConsultada {
  /** Nombre de la herramienta interna (`consultar_inventario`, `consumo_de_cliente`…). */
  herramienta: string;
  /** Con qué la llamó — es lo que permite reproducir la consulta a mano si algo no cuadra. */
  argumentos: Record<string, unknown>;
  /** `false` cuando el rol de quien pregunta no alcanzaba: la respuesta lo dice, y aquí se ve. */
  permitida: boolean;
}

/** `POST /api/asistente/consulta`. */
export interface RespuestaAsistente {
  respuesta: string;
  fuentes: FuenteConsultada[];
  /** `false` si el servicio no está configurado o falló. La pantalla lo pinta como aviso y no
   *  como dato — un mensaje de indisponibilidad no puede parecer una respuesta (FR-136). */
  disponible: boolean;
}
