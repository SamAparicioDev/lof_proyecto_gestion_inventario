/**
 * `ServicioStock` — servicio de dominio 100% PURO (Principio VI): recibe datos YA LEÍDOS en
 * memoria (el llamador desde infraestructura ya bloqueó las filas con `FOR UPDATE` y las
 * leyó dentro de la transacción — research R4) y devuelve QUÉ escribir, sin tocar Prisma ni
 * la BD directamente. Cero `await`, cero I/O.
 *
 * Por qué es pura (research R10, beneficio de la arquitectura hexagonal): así se prueba con
 * Jest puro, sin levantar PostgreSQL — `backend/test/unit/ingresos.spec.ts` (T038)
 * construye un `Map` en memoria y verifica los resultados exactos, incluidos los casos de
 * error, en milisegundos y sin flakiness de infraestructura.
 *
 * Alcance de US1 (T029): `aplicarEntrada` (ingreso recibido, FR-017/FR-021) y
 * `aplicarReversaEntrada` (anulación de un ingreso RECIBIDO, FR-019).
 *
 * Alcance de US3 (T048): `aplicarSalida` (confirmar una salida, FR-028/FR-029).
 *
 * CORRECCIÓN DE DISEÑO (T056 — bug real encontrado por la prueba de carrera SC-002,
 * `backend/test/integracion/salidas-stock.spec.ts`): la versión original de `aplicarSalida`
 * validaba `cantidad ≤ disponible`, con `disponible = stockActual − comprometido de OTRAS
 * salidas PENDIENTE` calculado por el llamador ANTES de invocar este método. Esa fórmula es
 * correcta para la validación de UX en creación/edición (`aplicacion/salidas/
 * validar-disponibilidad-lineas.ts`, SIN bloqueo de filas), pero es INCORRECTA dentro de la
 * transacción atómica de `confirmar`: con dos salidas `PENDIENTE` que compiten por el mismo
 * producto (cada una cabría sola, pero juntas exceden el stock), al confirmarlas en paralelo
 * CADA transacción calculaba el "comprometido de la OTRA" ANTES de que esa otra hubiera
 * terminado (todavía `PENDIENTE` desde su punto de vista) — así que AMBAS se rechazaban
 * mutuamente y NINGUNA ganaba, violando el requisito "exactamente una gana" (SC-002). La
 * prueba de carrera lo reproducía de forma determinística (no intermitente): siempre 409/409.
 *
 * La corrección: `aplicarSalida` ahora valida contra el `stockActual` REAL, el mismo que
 * `SELECT ... FOR UPDATE` ya bloqueó (research R4) — sin restarle nada más. El propio bloqueo
 * de fila YA ES el mecanismo de serialización correcto: la transacción que adquiere el
 * candado primero ve el stock real y lo descuenta si alcanza; la segunda, al adquirir el
 * candado después, lee (con `READ COMMITTED`) el `stockActual` YA actualizado por la primera
 * y se valida contra ESE valor, no contra la mera intención de un tercero que aún no se
 * materializó. Esto hace que `aplicarSalida` sea, en esencia, la MISMA operación que
 * `aplicarReversaEntrada` ("restar y no dejar negativo") — por eso ambas comparten ahora la
 * implementación privada `restarValidandoStock` (DRY, docs/arquitectura.md §5), aunque se
 * conservan como dos métodos públicos distintos para que cada uno documente su propio
 * `FR-###` y sea trazable por separado (`grep -r "FR-028"` vs `"FR-019"`). El agregado de
 * "comprometido" (`RepositorioSalidas.comprometidoPorProducto`) sigue siendo la señal de UX
 * correcta al crear/editar una salida — simplemente ya NUNCA debe formar parte de la
 * revalidación atómica de `confirmar`.
 */
import { DisponibilidadInsuficiente, ErrorValidacionDominio, NoEncontrado } from '../comunes/errores';

/** Estado de stock de un producto ya bloqueado (`SELECT ... FOR UPDATE`) por el llamador —
 *  usado por `aplicarEntrada`, `aplicarReversaEntrada` Y `aplicarSalida` (las tres operan
 *  sobre el `stockActual` real, nunca sobre un "disponible" neto de terceros; ver TSDoc de
 *  cabecera). `descripcion` es opcional: solo se necesita para mensajes de error más claros;
 *  si el llamador no la trae (p. ej. una consulta que solo pidió `id, stock_actual`), se usa
 *  un texto de respaldo con el id. */
export interface InfoProductoStock {
  readonly id: number;
  readonly stockActual: number;
  readonly descripcion?: string;
}

/** Línea de un movimiento de entrada/reversa/salida: qué producto y cuánta cantidad. */
export interface LineaMovimientoStock {
  readonly productoId: number;
  readonly cantidad: number;
}

/** Nuevo `stock_actual` que el llamador debe persistir para un producto. */
export interface ProductoActualizadoStock {
  readonly id: number;
  readonly stockActualNuevo: number;
}

/** Movimiento de inventario que el llamador debe insertar (una fila por línea procesada). */
export interface MovimientoStockGenerado {
  readonly productoId: number;
  readonly cantidad: number;
  readonly stockResultante: number;
}

/**
 * Resultado de CORREGIR la cantidad de un producto (US31, FR-130): qué stock persistir y qué
 * movimiento insertar. Un solo producto y un solo movimiento, a diferencia de las operaciones por
 * líneas — una corrección es siempre sobre un producto concreto que alguien acaba de contar.
 */
export interface ResultadoCorreccionStock {
  readonly stockActualNuevo: number;
  /** `AJUSTE_ENTRADA` si el conteo superó al registrado, `AJUSTE_SALIDA` si fue menor. */
  readonly tipoMovimiento: 'AJUSTE_ENTRADA' | 'AJUSTE_SALIDA';
  /** SIEMPRE positiva: el signo lo lleva `tipoMovimiento`, igual que en el resto de la tabla. */
  readonly cantidadMovimiento: number;
}

/** Resultado de aplicar un conjunto de líneas: qué actualizar en `productos` y qué insertar
 *  en `movimientos_inventario`, en el mismo orden que las líneas de entrada. */
export interface ResultadoAplicarStock {
  readonly productosActualizados: ProductoActualizadoStock[];
  readonly movimientos: MovimientoStockGenerado[];
}

export class ServicioStock {
  /**
   * Aplica una ENTRADA de mercancía: suma `cantidad` al stock de cada producto referenciado
   * por las líneas. Una entrada SIEMPRE puede sumar — no hay restricción de disponibilidad
   * (a diferencia de una salida o de una reversa de entrada).
   *
   * Implementa: FR-017 (recibir un ingreso sube el stock) y FR-021 (el movimiento resultante
   * queda con el `stock_resultante` exacto tras aplicar la línea — snapshot de auditoría).
   *
   * @throws NoEncontrado si una línea referencia un `productoId` que no está en `productos`
   *   (el llamador debió bloquear/leer TODOS los productos de las líneas antes de invocar
   *   este método — si falta uno, es un error de programación en el adaptador, no un caso de
   *   negocio silencioso).
   */
  aplicarEntrada(
    productos: ReadonlyMap<number, InfoProductoStock>,
    lineas: readonly LineaMovimientoStock[],
  ): ResultadoAplicarStock {
    return this.acumularLineas(productos, lineas, (stockPrevio, cantidad) => stockPrevio + cantidad);
  }

  /**
   * Corrige la cantidad de UN producto al valor CONTADO (US31, FR-130) — la operación del
   * inventario que cuadra el sistema con la bodega cuando el conteo físico no coincide.
   *
   * Recibe la cantidad contada, no la diferencia: es lo que la persona tiene delante al terminar
   * de contar, y pedirle el delta es pedirle justo la resta en la que se equivoca. La diferencia
   * la calcula esta función, y con su signo decide el tipo de movimiento.
   *
   * Reglas que verifica, ambas de negocio y por eso aquí y no en el adaptador:
   *
   * - **No se corrige a la misma cantidad**: un movimiento de cero no dice nada y ensucia el
   *   historial del producto, que es justo donde alguien va a buscar por qué cambió una cifra.
   * - **No se corrige a un valor negativo**: Principio I, la última línea la tiene el `CHECK` de
   *   la base, pero el rechazo con mensaje en español se da aquí.
   *
   * Lo que NO verifica, deliberadamente: que el resultado siga cubriendo lo COMPROMETIDO por
   * salidas PENDIENTE. Si el conteo dice que hay menos de lo prometido, el sistema debe reflejar
   * lo que hay — esas salidas fallarán al confirmarse con el mensaje de disponibilidad de
   * siempre, que es la respuesta correcta. Bloquear la corrección para que cuadre un documento
   * sería mantener el inventario mintiendo a favor de una promesa.
   *
   * Implementa: FR-130.
   */
  aplicarCorreccion(producto: InfoProductoStock, cantidadContada: number): ResultadoCorreccionStock {
    if (cantidadContada < 0) {
      throw new ErrorValidacionDominio('La cantidad no puede ser negativa', {
        cantidad: 'La cantidad no puede ser negativa',
      });
    }

    const diferencia = cantidadContada - producto.stockActual;
    if (diferencia === 0) {
      const mensaje = `El producto ya tiene ${cantidadContada} en existencia: no hay nada que corregir`;
      throw new ErrorValidacionDominio(mensaje, { cantidad: mensaje });
    }

    return {
      stockActualNuevo: cantidadContada,
      tipoMovimiento: diferencia > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA',
      cantidadMovimiento: Math.abs(diferencia),
    };
  }

  /**
   * Revierte una ENTRADA previamente aplicada (anulación de un ingreso `RECIBIDO`, FR-019):
   * resta `cantidad` del stock de cada producto. A diferencia de `aplicarEntrada`, SÍ exige
   * disponibilidad suficiente — no se puede dejar `stock_actual` negativo (Principio I) ni
   * "devolver" más de lo que hay comprometido en existencia física.
   *
   * Delegación directa a `restarValidandoStock` (ver TSDoc de cabecera: comparte
   * implementación con `aplicarSalida`, misma regla de "restar y no dejar negativo").
   *
   * @throws NoEncontrado si una línea referencia un `productoId` fuera de `productos`.
   * @throws DisponibilidadInsuficiente si alguna línea dejaría el stock negativo.
   */
  aplicarReversaEntrada(
    productos: ReadonlyMap<number, InfoProductoStock>,
    lineas: readonly LineaMovimientoStock[],
  ): ResultadoAplicarStock {
    return this.restarValidandoStock(productos, lineas);
  }

  /**
   * Aplica una SALIDA de mercancía (confirmar, FR-028/FR-029): resta `cantidad` del
   * `stockActual` REAL de cada producto — el mismo valor que el llamador ya bloqueó con
   * `SELECT ... FOR UPDATE` (research R4) — y valida contra ESE valor, nunca contra un
   * "disponible" neto de compromiso ajeno (ver TSDoc de cabecera para el porqué: esa fórmula
   * causaba que dos confirmaciones concurrentes se rechazaran MUTUAMENTE, violando SC-002).
   *
   * Delegación directa a `restarValidandoStock`, la MISMA implementación que
   * `aplicarReversaEntrada` — ambas son, en el fondo, "restar y no dejar negativo"; lo único
   * que cambia es el evento de negocio que las dispara (FR-019 vs FR-028/FR-029).
   *
   * @throws NoEncontrado si una línea referencia un `productoId` fuera de `productos`.
   * @throws DisponibilidadInsuficiente si alguna línea excede el `stockActual` bloqueado.
   */
  aplicarSalida(
    productos: ReadonlyMap<number, InfoProductoStock>,
    lineas: readonly LineaMovimientoStock[],
  ): ResultadoAplicarStock {
    return this.restarValidandoStock(productos, lineas);
  }

  /**
   * Núcleo compartido de `aplicarReversaEntrada` (FR-019) y `aplicarSalida` (FR-028/FR-029,
   * ver TSDoc de cabecera — corrección de diseño T056): resta `cantidad` del stock de trabajo
   * de cada línea, SIEMPRE contra el `stockActual` real bloqueado, y valida que el resultado
   * no quede negativo (Principio I).
   *
   * Si una o más líneas dejarían el stock negativo, NO aplica ningún cambio parcial: junta
   * el detalle de TODAS las líneas insuficientes (con el disponible REAL de cada una) y
   * lanza una única `DisponibilidadInsuficiente`, para que el mensaje al usuario sea completo
   * en un solo intento en vez de fallar línea por línea (US3-AS2).
   *
   * Se mantienen DOS métodos públicos (en vez de exponer este método directamente) para que
   * cada uno documente su propio `FR-###` y sea trazable por separado — el requisito de
   * comentarios del dueño del proyecto pide encontrar cada PROCESO DE NEGOCIO, no cada
   * función técnica (docs/arquitectura.md §6).
   */
  private restarValidandoStock(
    productos: ReadonlyMap<number, InfoProductoStock>,
    lineas: readonly LineaMovimientoStock[],
  ): ResultadoAplicarStock {
    const insuficientes: {
      productoId: number;
      descripcion: string;
      solicitado: number;
      disponible: number;
    }[] = [];

    const resultado = this.acumularLineas(productos, lineas, (stockPrevio, cantidad, producto) => {
      const stockNuevo = stockPrevio - cantidad;
      if (stockNuevo < 0) {
        insuficientes.push({
          productoId: producto.id,
          descripcion: producto.descripcion ?? `Producto ${producto.id}`,
          solicitado: cantidad,
          disponible: stockPrevio,
        });
      }
      return stockNuevo;
    });

    if (insuficientes.length > 0) {
      throw new DisponibilidadInsuficiente(insuficientes);
    }
    return resultado;
  }

  /**
   * Recorre `lineas` en orden, manteniendo un stock "de trabajo" por producto (soporta,
   * aunque hoy no ocurra por el `UNIQUE(ingreso_id, producto_id)` de data-model.md, que un
   * mismo producto aparezca en más de una línea sin perder acumulaciones anteriores) y
   * delega en `calcularNuevoStock` el signo de la operación (suma en entrada, resta en
   * reversa). Único punto que arma `productosActualizados`/`movimientos` — evita repetir el
   * recorrido en cada método público (DRY).
   */
  private acumularLineas(
    productos: ReadonlyMap<number, InfoProductoStock>,
    lineas: readonly LineaMovimientoStock[],
    calcularNuevoStock: (stockPrevio: number, cantidad: number, producto: InfoProductoStock) => number,
  ): ResultadoAplicarStock {
    const stockDeTrabajo = new Map<number, number>();
    const movimientos: MovimientoStockGenerado[] = [];

    for (const linea of lineas) {
      const producto = productos.get(linea.productoId);
      if (!producto) {
        throw new NoEncontrado(`Producto ${linea.productoId}`);
      }
      const stockPrevio = stockDeTrabajo.get(linea.productoId) ?? producto.stockActual;
      const stockNuevo = calcularNuevoStock(stockPrevio, linea.cantidad, producto);
      stockDeTrabajo.set(linea.productoId, stockNuevo);
      movimientos.push({ productoId: linea.productoId, cantidad: linea.cantidad, stockResultante: stockNuevo });
    }

    const productosActualizados: ProductoActualizadoStock[] = [...stockDeTrabajo.entries()].map(
      ([id, stockActualNuevo]) => ({ id, stockActualNuevo }),
    );
    return { productosActualizados, movimientos };
  }
}
