/**
 * Las herramientas que el asistente puede usar (US33, FR-133/FR-134/FR-135).
 *
 * ## Este archivo ES la garantía de "solo lectura"
 *
 * No hay una comprobación que impida escribir: no hay NADA que escriba. El modelo solo puede
 * invocar lo que aparece en esta lista, y esta lista contiene consultas. Es una garantía
 * estructural y no una regla que alguien tenga que recordar — para que el asistente registre una
 * salida habría que añadir aquí una herramienta que lo haga, y eso es una decisión visible en una
 * revisión de código, no un descuido posible.
 *
 * ## Cada herramienta declara SU permiso (FR-134)
 *
 * Preguntarle al asistente no puede ser una forma de esquivar el menú. Cada entrada dice qué
 * permiso exige, y `ConsultarAsistenteCasoUso` lo comprueba contra los permisos efectivos de
 * quien pregunta ANTES de ejecutarla: un Operario que pregunte por costos recibe exactamente lo
 * que recibiría en pantalla — nada — y el modelo se entera de que no pudo, para poder decirlo.
 *
 * Las herramientas llaman a los MISMOS casos de uso que los controladores. Ninguna consulta la
 * base por su cuenta: eso se saltaría toda la capa que decide qué puede ver cada quien, y
 * convertiría el asistente en una fuga con forma de chat.
 *
 * ## Por qué devuelven JSON y no prosa
 *
 * El modelo redacta; los datos los pone el sistema. Devolver texto ya redactado invitaría a
 * reescribirlo, y ahí es donde una cifra cambia de valor sin que nadie lo note (FR-135).
 *
 * Implementa: FR-133, FR-134, FR-135.
 */
import { ErrorValidacionDominio } from '../../dominio/comunes/errores';
import type { ClavePermiso } from '../../dominio/entidades/permiso';
import type { Usuario } from '../../dominio/entidades/usuario';
import type { HerramientaOfrecida } from './puertos/modelo-conversacional';

/** Todo lo que una herramienta necesita para ejecutarse: los casos de uso que consulta. */
export interface DependenciasHerramientas {
  readonly listarInventario: {
    ejecutar(entrada: {
      buscar?: string;
      soloStockBajo?: boolean;
      pagina: number;
      porPagina: number;
    }): Promise<unknown>;
  };
  readonly historialProducto: {
    ejecutar(entrada: { productoId: number; pagina: number; porPagina: number }): Promise<unknown>;
  };
  readonly consumoCliente: {
    ejecutar(entrada: { clienteId: number; desde?: Date; hasta?: Date }): Promise<unknown>;
  };
  readonly resumenPanel: { ejecutar(entrada: { usuario: Usuario }): Promise<unknown> };
  readonly repositorioClientes: {
    listar(filtros: { buscar?: string; pagina: number; porPagina: number }): Promise<unknown>;
  };
}

/** Una herramienta de consulta: qué es, qué permiso exige y cómo se ejecuta. */
export interface HerramientaConsulta extends HerramientaOfrecida {
  /** Permiso que exige, o `null` si la operación ya se recorta sola por rol (el panel). */
  readonly permiso: ClavePermiso | null;
  ejecutar(argumentos: Record<string, unknown>, usuario: Usuario): Promise<unknown>;
}

/** Lee un argumento de texto sin confiar en el tipo: el modelo escribe JSON, no TypeScript. */
function texto(argumentos: Record<string, unknown>, clave: string): string | undefined {
  const valor = argumentos[clave];
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}

/** Íd. para números — `"12"` y `12` llegan indistintamente según cómo lo escriba el modelo. */
function numero(argumentos: Record<string, unknown>, clave: string): number | undefined {
  const valor = argumentos[clave];
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '' && Number.isFinite(Number(valor))) {
    return Number(valor);
  }
  return undefined;
}

/** Íd. para fechas ISO (`YYYY-MM-DD`); devuelve `undefined` ante cualquier cosa no parseable. */
function fecha(argumentos: Record<string, unknown>, clave: string): Date | undefined {
  const valor = texto(argumentos, clave);
  if (!valor) return undefined;
  const parseada = new Date(valor);
  return Number.isNaN(parseada.getTime()) ? undefined : parseada;
}

/** Tope de filas que una herramienta devuelve al modelo. No es una decisión de rendimiento sino
 *  de contexto: mil productos en una respuesta empujan fuera lo que el usuario preguntó. Cuando
 *  se alcanza, la propia herramienta lo dice, para que el modelo no presente un recorte como si
 *  fuera el total (FR-135). */
const MAXIMO_FILAS = 25;

/**
 * Construye el catálogo de herramientas. Es una función y no una constante porque cada
 * herramienta cierra sobre los casos de uso que consulta.
 */
export function construirHerramientasConsulta(dependencias: DependenciasHerramientas): HerramientaConsulta[] {
  return [
    {
      nombre: 'consultar_inventario',
      descripcion:
        'Busca productos y devuelve sus existencias: stock físico, cantidad comprometida por salidas ' +
        'pendientes, disponible real y si está bajo el umbral de alerta. Úsala para "¿cuánto hay de X?", ' +
        '"¿qué está por acabarse?" o para encontrar el id de un producto por su nombre o SKU.',
      esquemaArgumentos: {
        type: 'object',
        properties: {
          buscar: {
            type: 'string',
            description: 'Texto libre: SKU, descripción, ubicación o categoría. Omítelo para traer todo.',
          },
          soloStockBajo: {
            type: 'boolean',
            description: 'true para traer únicamente lo que está por debajo de su umbral de alerta.',
          },
        },
      },
      permiso: 'inventario.ver',
      ejecutar: (argumentos) =>
        dependencias.listarInventario.ejecutar({
          buscar: texto(argumentos, 'buscar'),
          soloStockBajo: argumentos.soloStockBajo === true,
          pagina: 1,
          porPagina: MAXIMO_FILAS,
        }),
    },

    {
      nombre: 'movimientos_de_producto',
      descripcion:
        'Historial de movimientos de UN producto: entradas, salidas y ajustes, con su fecha, documento, ' +
        'cantidad, quién lo hizo y el stock que quedó. Úsala para "¿por qué cambió esta cantidad?" o ' +
        '"¿cuándo entró esto?". Necesita el id del producto: obtenlo antes con consultar_inventario.',
      esquemaArgumentos: {
        type: 'object',
        properties: { productoId: { type: 'number', description: 'Id del producto.' } },
        required: ['productoId'],
      },
      permiso: 'inventario.ver',
      ejecutar: (argumentos) => {
        const productoId = numero(argumentos, 'productoId');
        if (productoId === undefined) {
          throw new ErrorValidacionDominio('Falta el id del producto: búscalo antes con consultar_inventario');
        }
        return dependencias.historialProducto.ejecutar({ productoId, pagina: 1, porPagina: MAXIMO_FILAS });
      },
    },

    {
      nombre: 'buscar_clientes',
      descripcion:
        'Busca clientes por nombre, NIT o ciudad y devuelve su id y sus datos. Es el paso previo para ' +
        'cualquier pregunta sobre un cliente concreto, porque los reportes se piden por id, no por nombre.',
      esquemaArgumentos: {
        type: 'object',
        properties: { buscar: { type: 'string', description: 'Nombre, NIT o ciudad del cliente.' } },
      },
      permiso: 'clientes.ver',
      ejecutar: (argumentos) =>
        dependencias.repositorioClientes.listar({
          buscar: texto(argumentos, 'buscar'),
          pagina: 1,
          porPagina: MAXIMO_FILAS,
        }),
    },

    {
      nombre: 'consumo_de_cliente',
      descripcion:
        'Qué material consumió un cliente, desglosado por proyecto y producto, con cantidades y valores. ' +
        'Cuenta SOLO salidas confirmadas o completadas — lo pendiente no se consumió todavía. Lo entregado ' +
        'sin proyecto aparece agrupado como "Sin proyecto". Necesita el id del cliente (buscar_clientes).',
      esquemaArgumentos: {
        type: 'object',
        properties: {
          clienteId: { type: 'number', description: 'Id del cliente.' },
          desde: { type: 'string', description: 'Fecha inicial en formato AAAA-MM-DD. Opcional.' },
          hasta: { type: 'string', description: 'Fecha final en formato AAAA-MM-DD. Opcional.' },
        },
        required: ['clienteId'],
      },
      permiso: 'reportes.ver',
      ejecutar: (argumentos) => {
        const clienteId = numero(argumentos, 'clienteId');
        if (clienteId === undefined) {
          throw new ErrorValidacionDominio('Falta el id del cliente: búscalo antes con buscar_clientes');
        }
        return dependencias.consumoCliente.ejecutar({
          clienteId,
          desde: fecha(argumentos, 'desde'),
          hasta: fecha(argumentos, 'hasta'),
        });
      },
    },

    {
      nombre: 'resumen_general',
      descripcion:
        'Las cifras de cabecera del negocio: valor del inventario, cuántos productos están bajo umbral, ' +
        'documentos pendientes, consumo del mes en curso y últimos movimientos. Úsala para preguntas ' +
        'amplias del tipo "¿cómo vamos?" antes de bajar al detalle.',
      esquemaArgumentos: { type: 'object', properties: {} },
      // Sin permiso propio: el propio caso de uso recorta las secciones según lo que el usuario
      // pueda ver, así que preguntar por él nunca devuelve de más.
      permiso: null,
      ejecutar: (_argumentos, usuario) => dependencias.resumenPanel.ejecutar({ usuario }),
    },
  ];
}
