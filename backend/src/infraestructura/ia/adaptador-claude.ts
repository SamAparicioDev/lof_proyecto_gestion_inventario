/**
 * Adaptador `AdaptadorClaude` — implementa el puerto `ModeloConversacional` con la API de Claude
 * (US33, FR-133/FR-136).
 *
 * ## Qué hace y qué deliberadamente NO hace
 *
 * Traduce la forma de la aplicación a la del proveedor y de vuelta. Un paso de conversación, sin
 * bucle: quién decide si se ejecuta una herramienta —y con qué permiso— es negocio, y vive en
 * `ConsultarAsistenteCasoUso`. Aquí no se sabe qué es un producto ni quién pregunta.
 *
 * ## Decisiones de configuración, con su porqué
 *
 * - **Modelo**: `claude-opus-5`. La pregunta "¿cuánto le vendí a Jumbo este mes?" exige encadenar
 *   consultas, entender que "este mes" es un rango y no confundir stock con disponible. Es
 *   razonamiento, no plantilla.
 * - **Pensamiento adaptativo**: el modelo decide cuánto piensa según la pregunta. Una consulta de
 *   stock no gasta nada; una comparación entre clientes sí.
 * - **Esfuerzo configurable** (`ASISTENTE_ESFUERZO`, por defecto `high`): sube a `xhigh` si las
 *   respuestas se quedan cortas, baja a `medium` si el gasto pesa más que el matiz.
 * - **Caché de prefijo**: las instrucciones y las herramientas son idénticas en cada consulta y no
 *   son pocas. Se marca el bloque estable con `cache_control`, y el contexto volátil —la fecha,
 *   quién pregunta— va DESPUÉS: si fuera al revés, cada pregunta invalidaría la caché entera y se
 *   pagaría el prompt completo todas las veces.
 * - **Sin `stream`**: las respuestas son cortas por diseño y el bucle de herramientas necesita el
 *   mensaje completo antes de decidir. `max_tokens` holgado para que el pensamiento no trunque la
 *   respuesta a media frase.
 *
 * ## Ausencia de clave = apagado, no roto (FR-136)
 *
 * Sin `ANTHROPIC_API_KEY` el adaptador se declara no disponible y el caso de uso responde con un
 * aviso en español. La aplicación arranca igual: esta es la única pieza que depende de un tercero
 * y no puede llevarse por delante al resto.
 *
 * Implementa: FR-133, FR-136.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import type {
  EntradaPasoConversacion,
  LlamadaHerramienta,
  ModeloConversacional,
  PasoConversacion,
  ResultadoHerramienta,
} from '../../aplicacion/asistente/puertos/modelo-conversacional';

/** Ver el TSDoc de cabecera para el porqué de cada uno. */
const MODELO = 'claude-opus-5';
const MAXIMO_TOKENS = 16000;
const ESFUERZOS_VALIDOS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Esfuerzo = (typeof ESFUERZOS_VALIDOS)[number];

@Injectable()
export class AdaptadorClaude implements ModeloConversacional {
  private readonly logger = new Logger(AdaptadorClaude.name);
  private readonly cliente: Anthropic | null;

  constructor() {
    const clave = process.env.ANTHROPIC_API_KEY?.trim();
    this.cliente = clave ? new Anthropic({ apiKey: clave }) : null;
    if (!this.cliente) {
      this.logger.warn(
        'Sin ANTHROPIC_API_KEY: el asistente de consultas queda apagado. El resto de la aplicación ' +
          'funciona con normalidad (FR-136).',
      );
    }
  }

  disponible(): boolean {
    return this.cliente !== null;
  }

  async responder(entrada: EntradaPasoConversacion): Promise<PasoConversacion> {
    if (!this.cliente) {
      // El caso de uso pregunta por `disponible()` antes de llamar; llegar aquí sería un error de
      // programación, no un caso de negocio.
      throw new Error('El asistente no está configurado.');
    }

    const respuesta = await this.cliente.messages.create({
      model: MODELO,
      max_tokens: MAXIMO_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: this.esfuerzo() },
      system: [
        // Bloque ESTABLE: se cachea. Cualquier byte que cambie aquí invalida todo lo que sigue.
        { type: 'text', text: entrada.sistema, cache_control: { type: 'ephemeral' } },
        // Bloque VOLÁTIL: fuera de la caché a propósito.
        { type: 'text', text: entrada.contexto },
      ],
      tools: entrada.herramientas.map((herramienta) => ({
        name: herramienta.nombre,
        description: herramienta.descripcion,
        input_schema: herramienta.esquemaArgumentos as Anthropic.Tool.InputSchema,
      })),
      messages: this.construirMensajes(entrada),
    });

    return {
      texto: respuesta.content
        .filter((bloque): bloque is Anthropic.TextBlock => bloque.type === 'text')
        .map((bloque) => bloque.text)
        .join('\n')
        .trim(),
      llamadas: respuesta.content
        .filter((bloque): bloque is Anthropic.ToolUseBlock => bloque.type === 'tool_use')
        .map(
          (bloque): LlamadaHerramienta => ({
            id: bloque.id,
            nombre: bloque.name,
            // `input` viene tipado como `unknown` a propósito por el SDK: el escapado del JSON
            // varía entre modelos, así que se trata como datos y nunca se compara como texto.
            argumentos: (bloque.input ?? {}) as Record<string, unknown>,
          }),
        ),
      // Se devuelve el contenido tal cual para reenviarlo intacto en el paso siguiente: los
      // bloques de pensamiento deben viajar sin tocar o el modelo pierde el hilo de su propio
      // razonamiento entre vueltas.
      turnoCrudo: respuesta.content,
    };
  }

  /** `ASISTENTE_ESFUERZO` con validación: un valor inventado no debe romper la consulta. */
  private esfuerzo(): Esfuerzo {
    const configurado = process.env.ASISTENTE_ESFUERZO?.trim() as Esfuerzo | undefined;
    return configurado && ESFUERZOS_VALIDOS.includes(configurado) ? configurado : 'high';
  }

  /**
   * Historial de la conversación más el intercambio de herramientas de ESTA consulta.
   *
   * El `intercambio` alterna turnos del asistente (tal como los devolvió el proveedor) y arreglos
   * de resultados. Los resultados de una misma vuelta van TODOS en un solo mensaje de usuario:
   * repartirlos en varios le enseña al modelo a dejar de pedir herramientas en paralelo, y a
   * partir de ahí cada pregunta cuesta el doble de vueltas.
   */
  private construirMensajes(entrada: EntradaPasoConversacion): Anthropic.MessageParam[] {
    const mensajes: Anthropic.MessageParam[] = entrada.mensajes.map((mensaje) => ({
      role: mensaje.rol === 'usuario' ? 'user' : 'assistant',
      content: mensaje.texto,
    }));

    for (const tramo of entrada.intercambio) {
      if (Array.isArray(tramo) && tramo.every((elemento) => esResultado(elemento))) {
        mensajes.push({
          role: 'user',
          content: (tramo as ResultadoHerramienta[]).map((resultado) => ({
            type: 'tool_result' as const,
            tool_use_id: resultado.id,
            content: resultado.contenido,
            is_error: resultado.esError ?? false,
          })),
        });
      } else {
        mensajes.push({ role: 'assistant', content: tramo as Anthropic.ContentBlockParam[] });
      }
    }

    return mensajes;
  }
}

/** ¿Es un resultado de herramienta y no un turno crudo del proveedor? */
function esResultado(valor: unknown): valor is ResultadoHerramienta {
  return typeof valor === 'object' && valor !== null && 'id' in valor && 'contenido' in valor;
}
