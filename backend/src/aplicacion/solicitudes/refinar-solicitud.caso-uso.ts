/**
 * Caso de uso `RefinarSolicitudCasoUso` — convierte lo que el super administrador dictó en un
 * prompt de implementación copiable (`POST /api/solicitudes/:id/refinar`, US36, FR-151…FR-155).
 *
 * ## Reutiliza el puerto del asistente, y no el asistente
 *
 * Depende de `ModeloConversacional` —el mismo puerto que US33— pero de NADA de US33: ni de sus
 * instrucciones, ni de sus herramientas, ni de su bucle. Aquí no hay bucle porque no hay
 * herramientas que ofrecer: es UNA vuelta, texto entra y texto sale. Compartir el puerto es
 * compartir "hablar con un modelo"; compartir el caso de uso sería confundir dos trabajos que solo
 * se parecen en que ambos escriben en español.
 *
 * ## El refinado NUNCA toca lo que escribió la persona
 *
 * Escribe por `guardarRefinado`, que solo alcanza `promptRefinado` y `refinadoEn` (FR-152). La
 * descripción original queda intacta por construcción, no por disciplina de quien programa.
 *
 * ## Fallar no rompe el buzón
 *
 * Sin clave, con el proveedor caído o saturado, esto devuelve `disponible: false` con un aviso en
 * español y la solicitud SIGUE INTACTA (FR-155). El resto del módulo —crear, listar, filtrar,
 * cambiar de estado— nunca pasa por aquí, así que sigue funcionando entero. Un buzón que no deja
 * anotar porque el modelo no responde es peor que no tener buzón: la idea se pierde igual.
 *
 * Implementa: FR-151, FR-152, FR-153, FR-155.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { NoEncontrado } from '../../dominio/comunes/errores';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { admiteRefinado } from '../../dominio/entidades/solicitud-funcionalidad';
import {
  REPOSITORIO_SOLICITUDES,
  type RepositorioSolicitudes,
} from '../../dominio/puertos/repositorio-solicitudes';
import {
  FalloDelProveedor,
  MODELO_CONVERSACIONAL,
  type CausaFalloProveedor,
  type ModeloConversacional,
} from '../asistente/puertos/modelo-conversacional';
import { INSTRUCCIONES_REFINADO, contextoDelPedido } from './instrucciones-refinado';

export interface RefinarSolicitudEntrada {
  readonly id: number;
}

export interface ResultadoRefinado {
  readonly prompt: string | null;
  readonly generadoEn: Date | null;
  readonly disponible: boolean;
  /** Ya redactado en español; `null` cuando salió bien. Nunca lleva detalle técnico. */
  readonly aviso: string | null;
}

const AVISO_NO_CONFIGURADO =
  'El refinado no está disponible porque el servicio de redacción no está configurado en el ' +
  'servidor. La solicitud quedó guardada tal como la escribiste y puedes usarla así.';

const AVISO_NO_PENDIENTE =
  'Solo se refinan las solicitudes pendientes. Esta ya está cerrada: si vuelve a hacer falta, ' +
  'reábrela y refínala entonces.';

/**
 * Un aviso por CAUSA, mismo criterio que el asistente (FR-136): "vuelve a intentarlo" solo es
 * cierto cuando el servicio está saturado. Con una clave rechazada es una instrucción falsa —se
 * puede reintentar un día entero sin que cambie nada— y nadie va a mirar los logs del servidor
 * por un botón que no responde.
 */
const AVISOS: Record<CausaFalloProveedor, string> = {
  credencial:
    'El servicio de redacción rechazó la clave configurada en el servidor. Esto NO se arregla ' +
    'reintentando: hay que revisar la clave en el despliegue. La solicitud quedó guardada igual.',
  cuota:
    'Se agotó por ahora la cuota del servicio de redacción. Vuelve a intentarlo más tarde; la ' +
    'solicitud quedó guardada igual.',
  saturado:
    'El servicio de redacción está saturado en este momento. Vuelve a intentarlo en un minuto; la ' +
    'solicitud quedó guardada igual.',
  desconocido:
    'No pude refinar la solicitud porque el servicio de redacción falló. Vuelve a intentarlo en un ' +
    'momento; la solicitud quedó guardada igual.',
};

@Injectable()
export class RefinarSolicitudCasoUso implements CasoDeUso<RefinarSolicitudEntrada, ResultadoRefinado> {
  private readonly logger = new Logger(RefinarSolicitudCasoUso.name);

  constructor(
    @Inject(REPOSITORIO_SOLICITUDES) private readonly repositorio: RepositorioSolicitudes,
    @Inject(MODELO_CONVERSACIONAL) private readonly modelo: ModeloConversacional,
  ) {}

  async ejecutar(entrada: RefinarSolicitudEntrada): Promise<ResultadoRefinado> {
    const solicitud = await this.repositorio.buscarPorId(entrada.id);
    if (!solicitud) {
      throw new NoEncontrado('La solicitud');
    }

    // Los dos rechazos que NO son fallos del proveedor van antes de gastar una llamada.
    if (!admiteRefinado(solicitud)) {
      return { prompt: null, generadoEn: null, disponible: false, aviso: AVISO_NO_PENDIENTE };
    }
    if (!this.modelo.disponible()) {
      return { prompt: null, generadoEn: null, disponible: false, aviso: AVISO_NO_CONFIGURADO };
    }

    try {
      const paso = await this.modelo.responder({
        sistema: INSTRUCCIONES_REFINADO,
        contexto: contextoDelPedido(solicitud.titulo, solicitud.descripcion),
        mensajes: [{ rol: 'usuario', texto: 'Redacta el prompt de implementación.' }],
        intercambio: [],
        // Sin herramientas: aquí no hay nada que consultar. Texto entra, texto sale.
        herramientas: [],
      });

      const prompt = paso.texto.trim();
      if (prompt.length === 0) {
        // El modelo respondió vacío. No es un fallo del proveedor —la llamada fue bien—, así que
        // no lleva aviso de reintento por causa: se dice lo que pasó y se deja la puerta abierta.
        this.logger.warn(`El refinado de la solicitud ${entrada.id} devolvió texto vacío.`);
        return {
          prompt: null,
          generadoEn: null,
          disponible: false,
          aviso: 'El servicio de redacción devolvió una respuesta vacía. Prueba a describir la solicitud con algo más de detalle y vuelve a refinar.',
        };
      }

      const generadoEn = new Date();
      await this.repositorio.guardarRefinado(entrada.id, prompt, generadoEn);
      return { prompt, generadoEn, disponible: true, aviso: null };
    } catch (error) {
      const causa: CausaFalloProveedor = error instanceof FalloDelProveedor ? error.causa : 'desconocido';
      const detalle = error instanceof FalloDelProveedor ? error.detalleTecnico : String(error);
      // El detalle técnico va al log y NUNCA al usuario: puede traer configuración del servidor.
      this.logger.error(`Fallo al refinar la solicitud ${entrada.id} [${causa}]: ${detalle}`);
      return { prompt: null, generadoEn: null, disponible: false, aviso: AVISOS[causa] };
    }
  }
}
