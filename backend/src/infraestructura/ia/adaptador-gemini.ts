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
 * - **Modelos**: `AI_MODEL`, por defecto la cadena `gemini-3.6-flash`, `gemini-3.5-flash`,
 *   `gemini-flash-latest`. Se prueban EN ORDEN: si el primero está saturado se pregunta al
 *   siguiente, en vez de esperar a que se desahogue el mismo. Reintentar al saturado es esperar;
 *   cambiar de modelo es preguntarle a otro que está libre.
 *
 *   El primero está FIJADO y no es un alias `-latest`, corrigiendo la elección inicial: `-latest`
 *   apunta al modelo más NUEVO, que es justamente el más congestionado y, en el plan gratuito, a
 *   veces el que tiene cuota cero. Medido con la clave real el 2026-08-21: `gemini-3.6-flash`
 *   respondió en 1,6 s y `gemini-flash-latest` en 6,4 s cuando no fallaba con 503.
 *
 *   `AI_MODEL` admite varios separados por coma y sustituye la cadena entera, para poder fijar
 *   otra combinación sin desplegar. Con facturación activada, `gemini-pro-latest` de primero
 *   encadena mejor las preguntas de varios pasos — en el plan gratuito su cuota es CERO.
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

/** Ver el TSDoc de cabecera para el porqué de cada uno y para las medidas que los eligieron. */
const MODELOS_POR_DEFECTO = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
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

/** Espera antes de pasar al modelo siguiente. Corta a propósito: el cambio de modelo es lo que
 *  resuelve la saturación, no la espera. Al otro lado hay alguien mirando la pantalla. */
const ESPERA_ENTRE_MODELOS_MS = 400;

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
    const respuesta = await this.conCadenaDeModelos((modelo) =>
      cliente.models.generateContent({
        model: modelo,
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
   * Recorre la cadena de modelos hasta que uno responda.
   *
   * Por qué cambiar de modelo y no reintentar el mismo: medido contra la API real, un
   * `503 UNAVAILABLE — high demand` es del MODELO, no del servicio. Insistirle al que está
   * saturado es esperar a que se desahogue; preguntarle al siguiente es hablar con uno que está
   * libre — y en la medición el segundo de la cadena respondía mientras el primero fallaba.
   *
   * Solo se pasa al siguiente ante fallos TRANSITORIOS. Un `400`, un `401` o un `403` son
   * configuración equivocada: recorrer la cadena entera con una clave inválida gasta tres veces
   * el tiempo para llegar al mismo sitio, y de paso esconde la causa detrás de una espera.
   *
   * Si TODOS fallan, se propaga el último con su causa ya clasificada y el caso de uso lo convierte
   * en un aviso en español (FR-136).
   */
  private async conCadenaDeModelos<T>(operacion: (modelo: string) => Promise<T>): Promise<T> {
    const modelos = this.modelos();
    for (let indice = 0; indice < modelos.length; indice += 1) {
      const modelo = modelos[indice] as string;
      try {
        return await operacion(modelo);
      } catch (error) {
        const transitorio = error instanceof ApiError && CODIGOS_TRANSITORIOS.includes(error.status);
        const quedanModelos = indice < modelos.length - 1;
        if (!transitorio || !quedanModelos) {
          throw new FalloDelProveedor(causaDe(error), String(error instanceof Error ? error.message : error));
        }
        this.logger.warn(
          `"${modelo}" respondió ${error instanceof ApiError ? error.status : '?'}; pruebo con "${modelos[indice + 1]}".`,
        );
        await new Promise((continuar) => setTimeout(continuar, ESPERA_ENTRE_MODELOS_MS));
      }
    }
    // Inalcanzable: el bucle o devuelve o lanza. Está por exhaustividad del tipo.
    throw new FalloDelProveedor('desconocido', 'La cadena de modelos quedó vacía.');
  }

  /** La cadena configurada, o la de por defecto. `AI_MODEL` admite varios separados por coma. */
  private modelos(): string[] {
    const configurados = (primeraDefinida('AI_MODEL', 'GEMINI_MODELO') ?? '')
      .split(',')
      .map((nombre) => nombre.trim())
      .filter((nombre) => nombre !== '');
    return configurados.length > 0 ? configurados : MODELOS_POR_DEFECTO;
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
