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
  /** Reporte de inventario valorizado: trae TODAS las filas con su valor, sin paginar. Es lo que
   *  permite responder "¿cuál vale más?" con una consulta en vez de con seis tanteos. */
  readonly inventarioValorizado: {
    ejecutar(entrada: { buscar?: string }): Promise<{
      productos: { producto: { sku: string; descripcion: string }; valorLinea: number; stock: number }[];
      valorTotalInventario: number;
    }>;
  };
  readonly repositorioUsuarios: {
    listar(filtros: { pagina: number; porPagina: number }): Promise<unknown>;
  };
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
 *  de contexto: mil productos en una respuesta empujan fuera lo que el usuario preguntó. */
const MAXIMO_FILAS = 50;

/**
 * Envuelve una página diciendo CUÁNTAS filas hay en total y si lo devuelto es un recorte.
 *
 * Sin esto, el modelo recibe 50 filas de 300 y no tiene forma de saberlo: o presenta el recorte
 * como si fuera todo —que es exactamente lo que FR-135 prohíbe— o se pone a tantear búsquedas al
 * azar para adivinar qué falta. Lo segundo fue lo que ocurrió con "¿cuál es el producto que vale
 * más?": seis consultas y ninguna respuesta.
 *
 * La nota va en español y como INSTRUCCIÓN, no como metadato: el modelo la lee y actúa sobre ella.
 */
function conNotaDeRecorte(pagina: { datos: unknown[]; total: number }): Record<string, unknown> {
  const recortado = pagina.total > pagina.datos.length;
  return {
    filas: pagina.datos,
    totalQueCumplenElFiltro: pagina.total,
    devueltas: pagina.datos.length,
    ...(recortado
      ? {
          aviso:
            `Esto es un RECORTE: hay ${pagina.total} filas que cumplen el filtro y solo se devuelven ` +
            `${pagina.datos.length}. NO presentes esta lista como si fuera el total. Si la pregunta ` +
            'exige el conjunto completo (un máximo, un total, un conteo), acota más la búsqueda o usa ' +
            'una herramienta que agregue, y si aun así no puedes, dilo.',
        }
      : {}),
  };
}

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
      ejecutar: async (argumentos) =>
        conNotaDeRecorte(
          (await dependencias.listarInventario.ejecutar({
            buscar: texto(argumentos, 'buscar'),
            soloStockBajo: argumentos.soloStockBajo === true,
            pagina: 1,
            porPagina: MAXIMO_FILAS,
          })) as { datos: unknown[]; total: number },
        ),
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
      nombre: 'productos_por_valor',
      descripcion:
        'Ordena los productos por lo que VALE su existencia (cantidad × costo unitario) y devuelve ' +
        'los de arriba, más el valor total del inventario. Es la herramienta para "¿qué producto vale ' +
        'más?", "¿dónde tengo el dinero metido?" o "¿cuánto vale el inventario?". Recorre TODO el ' +
        'catálogo, no una página: su respuesta SÍ es concluyente para preguntas de máximo o de total.',
      esquemaArgumentos: {
        type: 'object',
        properties: {
          buscar: { type: 'string', description: 'Acota a los productos que coincidan. Opcional.' },
          cuantos: { type: 'number', description: 'Cuántos devolver, de mayor a menor valor. Por defecto 10.' },
        },
      },
      // El mismo permiso que el reporte equivalente en pantalla: expone dinero.
      permiso: 'reportes.ver',
      ejecutar: async (argumentos) => {
        const reporte = await dependencias.inventarioValorizado.ejecutar({ buscar: texto(argumentos, 'buscar') });
        const cuantos = Math.min(Math.max(numero(argumentos, 'cuantos') ?? 10, 1), MAXIMO_FILAS);
        const ordenados = [...reporte.productos].sort((a, b) => b.valorLinea - a.valorLinea);
        return {
          // Se dice explícitamente que el orden abarca todo: es lo que convierte "el primero de la
          // lista" en "el que más vale" sin que el modelo tenga que suponerlo.
          criterio: 'Ordenado por valor de existencia (cantidad × costo unitario) sobre TODO el catálogo filtrado.',
          productosEvaluados: reporte.productos.length,
          valorTotalInventario: reporte.valorTotalInventario,
          masValiosos: ordenados.slice(0, cuantos),
        };
      },
    },

    {
      nombre: 'listar_usuarios',
      descripcion:
        'Usuarios del sistema con su rol y su estado. Responde "¿cuántos usuarios hay?", "¿quién es ' +
        'gerente?" o "¿quién está inactivo?". No devuelve contraseñas ni nada parecido: solo lo que ya ' +
        'se ve en la pantalla de usuarios.',
      esquemaArgumentos: { type: 'object', properties: {} },
      // El mismo permiso que la pantalla: quien no administra usuarios tampoco los cuenta por chat.
      permiso: 'usuarios.gestionar',
      ejecutar: async () =>
        conNotaDeRecorte(
          (await dependencias.repositorioUsuarios.listar({ pagina: 1, porPagina: MAXIMO_FILAS })) as {
            datos: unknown[];
            total: number;
          },
        ),
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
