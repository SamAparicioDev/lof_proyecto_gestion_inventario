/**
 * Adaptador `AdaptadorGemini` — implementa el puerto `ModeloConversacional` con Google AI Studio
 * (US33, FR-133/FR-136).
 *
 * ## Por qué cambiar de proveedor costó un archivo
 *
 * Todo lo que define al asistente —qué puede consultar, con qué permiso, el bucle de herramientas,
 * lo que sabe del negocio— vive en la capa de APLICACIÓN y no se tocó al migrar desde Claude. Esto
 * de aquí solo traduce dos formas: la del puerto a la de Google y la de vuelta. Era el objetivo de
 * declarar un puerto en vez de llamar al SDK desde el caso de uso, y esta migración es la prueba
 * de que servía.
 *
 * ## Decisiones de configuración, con su porqué
 *
 * - **Modelo**: `AI_MODEL`, por defecto `gemini-flash-latest`. El alias `-latest` apunta siempre al
 *   Flash más reciente de la cuenta: el catálogo de Google se mueve mucho más rápido que este
 *   repositorio, y fijar una versión obligaría a un despliegue cada vez que saliera una mejor. A
 *   cambio el comportamiento puede cambiar sin avisar, y para eso existe `AI_MODEL`: para CLAVAR
 *   una versión el día que haga falta reproducir algo.
 *
 *   **Por qué Flash y no Pro**, que sería lo esperable para un asistente que razona: en el nivel
 *   GRATUITO de AI Studio la cuota de los modelos Pro no es baja, es CERO — la API responde 429 con
 *   `limit: 0` (comprobado con la clave real el 2026-08-20). Un Pro por defecto significa un
 *   asistente que no funciona para nadie que no tenga facturación activada, que es justo el caso de
 *   quien acaba de sacar su clave. Con facturación, `AI_MODEL=gemini-pro-latest` encadena mejor las
 *   preguntas de varios pasos y es el cambio de una variable.
 * - **Pensamiento dinámico** (`thinkingBudget: -1`): el modelo decide cuánto piensa según la
 *   pregunta. Una consulta de stock no gasta nada; comparar clientes sí. `0` lo apagaría y las
 *   preguntas de varios pasos empezarían a fallar en silencio.
 * - **`parametersJsonSchema`** y no `parameters`: acepta JSON Schema estándar, que es exactamente
 *   lo que ya declaran las herramientas. La alternativa obligaba a traducir cada esquema al tipo
 *   `Schema` de Google, es decir, a mantener la misma verdad escrita dos veces.
 *
 * ## Los identificadores de llamada son opcionales en esta API
 *
 * A diferencia de otros proveedores, Gemini puede no devolver `id` en una llamada a función: la
 * correlación se hace entonces por NOMBRE. El bucle de la aplicación sí necesita un id, así que el
 * adaptador inventa uno que vive solo dentro de esa vuelta y NUNCA se le devuelve al modelo. Al
 * responder, el nombre y el id reales se recuperan del turno anterior del propio intercambio
 * (`llamadasDe`), que es donde la API ya dejó esa correspondencia — en vez de codificarla dentro
 * de una cadena, que es lo que se rompe el día que una herramienta lleve dos puntos en el nombre.
 *
 * ## Ausencia de clave = apagado, no roto (FR-136)
 *
 * Sin clave el adaptador se declara no disponible y el caso de uso responde con un aviso en
 * español. La aplicación arranca igual.
 *
 * Implementa: FR-133, FR-136.
 */
import { ApiError, GoogleGenAI, type Content, type FunctionCall, type Part } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import {
  FalloDelProveedor,
  type CausaFalloProveedor,
  type EntradaPasoConversacion,
  type LlamadaHerramienta,
  type ModeloConversacional,
  type PasoConversacion,
  type ResultadoHerramienta,
} from '../../aplicacion/asistente/puertos/modelo-conversacional';

/** Ver el TSDoc de cabecera para el porqué de cada uno. */
const MODELO_POR_DEFECTO = 'gemini-flash-latest';
const MAXIMO_TOKENS = 16000;
/** `-1` = presupuesto de pensamiento AUTOMÁTICO: lo decide el modelo según la pregunta. */
const PENSAMIENTO_AUTOMATICO = -1;

/** Prefijo de los ids que inventa el adaptador cuando la API no los devuelve (ver cabecera). */
const PREFIJO_ID_SINTETICO = 'sin-id:';

/**
 * Códigos que se reintentan, y solo esos: servicio saturado y cuota por minuto agotada. Ambos se
 * resuelven solos en segundos. Un `400`, un `401` o un `403` son configuración equivocada —
 * reintentarlos gasta tiempo y cuota, y de paso esconde la causa real detrás de una espera.
 */
const CODIGOS_TRANSITORIOS = [429, 503];

/** Esperas entre reintentos. Dos bastan: medido contra la API real, los 503 de "high demand" duran
 *  segundos, no minutos. Más reintentos solo alargarían la espera de quien mira la pantalla. */
const ESPERAS_MS = [700, 2500];

@Injectable()
export class AdaptadorGemini implements ModeloConversacional {
  private readonly logger = new Logger(AdaptadorGemini.name);
  private readonly cliente: GoogleGenAI | null;

  constructor() {
    const clave = primeraDefinida(
      // El nombre que usa el despliegue de LOF: dice de dónde sale la clave, que es lo que uno
      // quiere poder leer de un vistazo en un panel con veinte variables.
      'API_KEY_GOOGLE_AI_STUDIO',
      // Los nombres que documenta Google, por si alguien llega con ellos.
      'GEMINI_API_KEY',
      'GOOGLE_AI_API_KEY',
    );
    this.cliente = clave ? new GoogleGenAI({ apiKey: clave }) : null;
    if (!this.cliente) {
      this.logger.warn(
        'Sin API_KEY_GOOGLE_AI_STUDIO (ni GEMINI_API_KEY): el asistente de consultas queda apagado. ' +
          'El resto de la aplicación funciona con normalidad (FR-136).',
      );
    }
  }

  disponible(): boolean {
    return this.cliente !== null;
  }

  async responder(entrada: EntradaPasoConversacion): Promise<PasoConversacion> {
    if (!this.cliente) {
      // El caso de uso consulta `disponible()` antes de llamar; llegar aquí sería un error de
      // programación, no un caso de negocio.
      throw new Error('El asistente no está configurado.');
    }

    const cliente = this.cliente;
    const respuesta = await this.conReintentos(() =>
      cliente.models.generateContent({
        model: primeraDefinida('AI_MODEL', 'GEMINI_MODELO') ?? MODELO_POR_DEFECTO,
        contents: this.construirContenidos(entrada),
        config: {
          // Las instrucciones estables y el contexto volátil (fecha, quién pregunta) van juntos aquí:
          // esta API no expone puntos de caché por bloque, así que la separación que el puerto
          // conserva no cuesta nada mantenerla y sirve si algún día vuelve a haber un proveedor que
          // la aproveche.
          systemInstruction: `${entrada.sistema}\n\n${entrada.contexto}`,
          maxOutputTokens: MAXIMO_TOKENS,
          thinkingConfig: { thinkingBudget: PENSAMIENTO_AUTOMATICO },
          tools: [
            {
              functionDeclarations: entrada.herramientas.map((herramienta) => ({
                name: herramienta.nombre,
                description: herramienta.descripcion,
                parametersJsonSchema: herramienta.esquemaArgumentos,
              })),
            },
          ],
        },
      }),
    );

    const llamadas = respuesta.functionCalls ?? [];
    return {
      texto: (respuesta.text ?? '').trim(),
      llamadas: llamadas.map(
        (llamada, indice): LlamadaHerramienta => ({
          // El bucle de la aplicación necesita un id para emparejar resultados; esta API puede no
          // darlo. El sintético solo vive dentro de esa vuelta — nunca se le devuelve al modelo.
          id: llamada.id ?? `${PREFIJO_ID_SINTETICO}${indice}`,
          nombre: llamada.name ?? '',
          argumentos: llamada.args ?? {},
        }),
      ),
      // El turno del modelo se reenvía TAL CUAL en el paso siguiente: si se reconstruyera a mano se
      // perderían las partes de pensamiento, y con ellas el hilo del propio razonamiento del modelo
      // entre una vuelta y la siguiente.
      turnoCrudo: respuesta.candidates?.[0]?.content ?? { role: 'model', parts: [] },
    };
  }

  /**
   * Ejecuta la llamada reintentando los fallos TRANSITORIOS del proveedor.
   *
   * Por qué hace falta: medido contra la API real, de tres consultas seguidas dos cayeron con
   * `503 UNAVAILABLE — high demand` y una respondió perfectamente. Sin reintento, el asistente
   * parecería roto dos de cada tres veces por algo que se arregla solo en segundos.
   *
   * Se reintenta poco y rápido a propósito: al otro lado hay una persona esperando una respuesta
   * en pantalla, y una espera larga es tan mala respuesta como un fallo. Si tras los intentos sigue
   * fallando, el error se propaga y el caso de uso lo convierte en un aviso en español (FR-136).
   */
  private async conReintentos<T>(operacion: () => Promise<T>): Promise<T> {
    for (let intento = 0; ; intento += 1) {
      try {
        return await operacion();
      } catch (error) {
        const transitorio = error instanceof ApiError && CODIGOS_TRANSITORIOS.includes(error.status);
        if (!transitorio || intento >= ESPERAS_MS.length) {
          throw new FalloDelProveedor(causaDe(error), String(error instanceof Error ? error.message : error));
        }
        this.logger.warn(
          `El proveedor respondió ${error.status}; reintento ${intento + 1} de ${ESPERAS_MS.length}.`,
        );
        await new Promise((continuar) => setTimeout(continuar, ESPERAS_MS[intento]));
      }
    }
  }

  /**
   * Historial de la conversación más el intercambio de herramientas de ESTA consulta.
   *
   * Los resultados de una misma vuelta van TODOS en un solo mensaje: repartirlos en varios le
   * enseña al modelo a dejar de pedir herramientas en paralelo, y a partir de ahí cada pregunta
   * cuesta el doble de vueltas.
   */
  private construirContenidos(entrada: EntradaPasoConversacion): Content[] {
    const contenidos: Content[] = entrada.mensajes.map((mensaje) => ({
      role: mensaje.rol === 'usuario' ? 'user' : 'model',
      parts: [{ text: mensaje.texto }],
    }));

    for (const tramo of entrada.intercambio) {
      if (Array.isArray(tramo) && tramo.every(esResultado)) {
        // El turno que PIDIÓ estas herramientas es el anterior en el intercambio. De él salen el
        // nombre y el id reales de cada llamada, en el mismo orden en que se ejecutaron: la API ya
        // trae esa correspondencia y no hace falta inventarse una.
        const llamadasDelTurno = llamadasDe(contenidos[contenidos.length - 1]);
        contenidos.push({
          role: 'user',
          parts: (tramo as ResultadoHerramienta[]).map((resultado, indice): Part => {
            const original = llamadasDelTurno[indice];
            return {
              functionResponse: {
                // El id solo viaja si fue el modelo quien lo dio: devolver uno inventado rompe la
                // correlación que esta API hace por nombre cuando no hay id.
                ...(original?.id ? { id: original.id } : {}),
                name: original?.name ?? '',
                // La API exige un objeto, no una cadena: el JSON de la herramienta viaja bajo una
                // clave, y el error —cuando lo hay— bajo la suya, para que el modelo lo distinga
                // de un dato y pueda decir "no pude" en vez de inventarse la cifra.
                response: resultado.esError
                  ? { error: resultado.contenido }
                  : { resultado: resultado.contenido },
              },
            };
          }),
        });
      } else {
        contenidos.push(tramo as Content);
      }
    }

    return contenidos;
  }
}

/** Las llamadas a función de un turno del modelo, en orden. */
function llamadasDe(contenido: Content | undefined): FunctionCall[] {
  return (contenido?.parts ?? [])
    .map((parte) => parte.functionCall)
    .filter((llamada): llamada is FunctionCall => llamada !== undefined);
}

/** ¿Es un resultado de herramienta y no un turno crudo del proveedor? */
function esResultado(valor: unknown): valor is ResultadoHerramienta {
  return typeof valor === 'object' && valor !== null && 'id' in valor && 'contenido' in valor;
}

/**
 * El primer valor no vacío de una lista de variables de entorno.
 *
 * Existe porque la misma configuración puede llegar con varios nombres: el del despliegue de LOF
 * y los que documenta Google. Aceptar los tres cuesta esta función y ahorra el rato de "la clave
 * está puesta y el asistente sigue apagado".
 */
function primeraDefinida(...nombres: readonly string[]): string | undefined {
  for (const nombre of nombres) {
    const valor = process.env[nombre]?.trim();
    if (valor) return valor;
  }
  return undefined;
}

/**
 * Traduce el código HTTP del proveedor al vocabulario del puerto.
 *
 * `400` entra en `credencial` junto a `401` y `403` porque es lo que devuelve esta API cuando la
 * clave es inválida (`API_KEY_INVALID`), no solo cuando el cuerpo está mal formado — y una clave
 * rechazada es, con diferencia, el fallo más probable de los que llegan como 400 en una integración
 * que ya funcionó alguna vez.
 */
function causaDe(error: unknown): CausaFalloProveedor {
  if (!(error instanceof ApiError)) return 'desconocido';
  if ([400, 401, 403].includes(error.status)) return 'credencial';
  if (error.status === 429) return 'cuota';
  if (error.status >= 500) return 'saturado';
  return 'desconocido';
}
