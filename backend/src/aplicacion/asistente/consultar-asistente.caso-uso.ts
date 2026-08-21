/**
 * Caso de uso `ConsultarAsistenteCasoUso` — responde una pregunta en español sobre los datos que
 * ya existen (`POST /api/asistente/consulta`, US33, FR-133…FR-136).
 *
 * ## El bucle vive aquí, no en el adaptador
 *
 * El modelo pide herramientas, este caso de uso las ejecuta y le devuelve el resultado, hasta que
 * el modelo redacta su respuesta. Ese bucle es capa de APLICACIÓN porque cada vuelta toma dos
 * decisiones de negocio: qué herramientas existen (FR-133, solo lectura) y si quien pregunta
 * tiene permiso para esa consulta (FR-134). Si viviera en el adaptador del proveedor, la
 * infraestructura estaría decidiendo quién puede ver qué.
 *
 * ## Los permisos se comprueban aquí, herramienta a herramienta
 *
 * Contra `usuario.rolAsignado.permisos` — los mismos que resolvió el guard en esta petición. Un
 * Operario que pregunte por consumo recibe una negativa que el modelo VE, así que puede
 * explicarla en vez de inventar la cifra. Preguntar nunca es un atajo para saltarse el menú.
 *
 * ## Nada se propaga como 500
 *
 * Si el servicio no está configurado, falla o se agota, la respuesta lo dice en español y la
 * pantalla sigue viva (FR-136). Es la primera pieza del sistema que depende de un tercero y no
 * puede arrastrar al resto: el inventario no deja de funcionar porque un chat no responda.
 *
 * Implementa: FR-133, FR-134, FR-135, FR-136.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import type { Usuario } from '../../dominio/entidades/usuario';
import { construirHerramientasConsulta, type DependenciasHerramientas } from './herramientas-consulta';
import { INSTRUCCIONES_ASISTENTE, contextoDeLaConsulta } from './instrucciones-asistente';
import {
  FalloDelProveedor,
  MODELO_CONVERSACIONAL,
  type CausaFalloProveedor,
  type ModeloConversacional,
  type ResultadoHerramienta,
} from './puertos/modelo-conversacional';

/** Entrada: la pregunta y el hilo previo. El usuario viene del token, nunca del cuerpo. */
export interface ConsultarAsistenteEntrada {
  readonly pregunta: string;
  /** Turnos anteriores de ESTA conversación, para que "¿y el mes pasado?" tenga sentido. */
  readonly historial: readonly { rol: 'usuario' | 'asistente'; texto: string }[];
  readonly usuario: Usuario;
}

/** Una consulta que el asistente hizo para responder — es la CITA que exige FR-135. */
export interface FuenteConsultada {
  readonly herramienta: string;
  readonly argumentos: Record<string, unknown>;
  readonly permitida: boolean;
}

export interface RespuestaAsistente {
  readonly respuesta: string;
  readonly fuentes: FuenteConsultada[];
  /** `false` cuando el servicio no está configurado o falló: la pantalla lo distingue de una
   *  respuesta normal para no presentar un aviso técnico como si fuera un dato. */
  readonly disponible: boolean;
}

/**
 * Tope de vueltas del bucle. No es un límite de inteligencia sino de gasto: una pregunta razonable
 * se resuelve en dos o tres consultas, y sin tope un modelo que se atasca reintentando la misma
 * herramienta gastaría hasta agotar la cuota sin que nadie lo vea. Al alcanzarlo se responde con
 * lo que haya, nunca con una excepción.
 */
const MAXIMO_VUELTAS = 6;

const AVISO_NO_CONFIGURADO =
  'El asistente no está disponible en este momento porque el servicio de consultas no está ' +
  'configurado en el servidor. El resto de la aplicación funciona con normalidad: puedes consultar ' +
  'lo mismo desde Inventario y Reportes.';

/**
 * Un aviso por CAUSA, y no uno solo para todas.
 *
 * "Vuelve a intentarlo en un momento" solo es cierto cuando el servicio está saturado. Con una
 * clave rechazada es una instrucción falsa: se puede reintentar un día entero sin que cambie nada,
 * y nadie va a mirar los logs del servidor por un chat que no responde. Cada mensaje dice qué pasó
 * y quién puede arreglarlo, y todos señalan dónde está el dato mientras tanto.
 */
const AVISOS: Record<CausaFalloProveedor, string> = {
  credencial:
    'El servicio de consultas rechazó la clave configurada en el servidor, así que el asistente no ' +
    'puede responder. Esto NO se arregla reintentando: avísale a quien administra el despliegue para ' +
    'que revise la clave del asistente. Mientras tanto, el dato está en Inventario y Reportes.',
  cuota:
    'Se agotó por ahora la cuota del servicio de consultas. Vuelve a intentarlo más tarde — si pasa ' +
    'a menudo, quien administra el despliegue puede ampliar el plan. Mientras tanto, el dato está en ' +
    'Inventario y Reportes.',
  saturado:
    'El servicio de consultas está saturado en este momento. Vuelve a intentarlo en un minuto; ' +
    'mientras tanto, el dato está disponible en Inventario y Reportes.',
  desconocido:
    'No pude completar la consulta porque el servicio de asistencia falló. Vuelve a intentarlo en un ' +
    'momento; mientras tanto, el dato está disponible en Inventario y Reportes.',
};

@Injectable()
export class ConsultarAsistenteCasoUso implements CasoDeUso<ConsultarAsistenteEntrada, RespuestaAsistente> {
  private readonly logger = new Logger(ConsultarAsistenteCasoUso.name);

  constructor(
    @Inject(MODELO_CONVERSACIONAL) private readonly modelo: ModeloConversacional,
    @Inject('DEPENDENCIAS_HERRAMIENTAS_ASISTENTE') private readonly dependencias: DependenciasHerramientas,
  ) {}

  async ejecutar(entrada: ConsultarAsistenteEntrada): Promise<RespuestaAsistente> {
    if (!this.modelo.disponible()) {
      return { respuesta: AVISO_NO_CONFIGURADO, fuentes: [], disponible: false };
    }

    const herramientas = construirHerramientasConsulta(this.dependencias);
    const fuentes: FuenteConsultada[] = [];
    const intercambio: unknown[] = [];

    try {
      for (let vuelta = 0; vuelta < MAXIMO_VUELTAS; vuelta += 1) {
        const paso = await this.modelo.responder({
          sistema: INSTRUCCIONES_ASISTENTE,
          contexto: contextoDeLaConsulta(entrada.usuario),
          mensajes: [...entrada.historial, { rol: 'usuario', texto: entrada.pregunta }],
          intercambio,
          herramientas: herramientas.map(({ nombre, descripcion, esquemaArgumentos }) => ({
            nombre,
            descripcion,
            esquemaArgumentos,
          })),
        });

        if (paso.llamadas.length === 0) {
          return { respuesta: paso.texto, fuentes, disponible: true };
        }

        intercambio.push(paso.turnoCrudo);
        const resultados: ResultadoHerramienta[] = [];
        for (const llamada of paso.llamadas) {
          const { resultado, permitida } = await this.ejecutarHerramienta(llamada, herramientas, entrada.usuario);
          fuentes.push({ herramienta: llamada.nombre, argumentos: llamada.argumentos, permitida });
          resultados.push(resultado);
        }
        intercambio.push(resultados);
      }

      // Se agotaron las vueltas: se responde con lo último que dijo el modelo antes que con un
      // error. Que la respuesta sea incompleta lo dirá ella misma; un 500 no diría nada.
      this.logger.warn(`Consulta al asistente agotó las ${MAXIMO_VUELTAS} vueltas sin respuesta final.`);
      return {
        respuesta:
          'La consulta resultó más larga de lo que puedo resolver de una vez. Prueba a preguntarla ' +
          'por partes, o consúltala directamente en Inventario o Reportes.',
        fuentes,
        disponible: true,
      };
    } catch (error) {
      const causa: CausaFalloProveedor = error instanceof FalloDelProveedor ? error.causa : 'desconocido';
      // El detalle técnico NUNCA llega al usuario — puede traer configuración y no le dice nada a
      // quien solo quería un dato. Al log sí, entero y con la causa delante para poder buscarla.
      const detalle = error instanceof FalloDelProveedor ? error.detalleTecnico : String(error);
      this.logger.error(`Fallo del servicio de asistencia [${causa}]: ${detalle}`);
      return { respuesta: AVISOS[causa], fuentes, disponible: false };
    }
  }

  /**
   * Ejecuta una herramienta comprobando ANTES el permiso (FR-134).
   *
   * Un fallo de la herramienta —o un permiso que no alcanza— vuelve al modelo como resultado de
   * error, no como excepción: el modelo tiene que ENTERARSE para poder decir "no tengo acceso a
   * eso" en vez de inventarse la respuesta. Esa es la diferencia entre un asistente honesto y uno
   * que rellena huecos.
   */
  private async ejecutarHerramienta(
    llamada: { id: string; nombre: string; argumentos: Record<string, unknown> },
    herramientas: ReturnType<typeof construirHerramientasConsulta>,
    usuario: Usuario,
  ): Promise<{ resultado: ResultadoHerramienta; permitida: boolean }> {
    const herramienta = herramientas.find((candidata) => candidata.nombre === llamada.nombre);
    if (!herramienta) {
      return {
        resultado: { id: llamada.id, contenido: `No existe la herramienta "${llamada.nombre}".`, esError: true },
        permitida: false,
      };
    }

    if (herramienta.permiso !== null && !usuario.rolAsignado.permisos.includes(herramienta.permiso)) {
      return {
        resultado: {
          id: llamada.id,
          contenido:
            `Sin permiso: quien pregunta no tiene "${herramienta.permiso}". Dile que esa información ` +
            'no está disponible para su rol y que la solicite a quien administra los permisos.',
          esError: true,
        },
        permitida: false,
      };
    }

    try {
      const datos = await herramienta.ejecutar(llamada.argumentos, usuario);
      return { resultado: { id: llamada.id, contenido: JSON.stringify(datos) }, permitida: true };
    } catch (error) {
      return {
        resultado: {
          id: llamada.id,
          contenido: error instanceof Error ? error.message : 'La consulta falló.',
          esError: true,
        },
        permitida: true,
      };
    }
  }
}
