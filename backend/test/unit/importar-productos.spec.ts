/**
 * Prueba UNITARIA de `ImportarProductosCasoUso` (US8, T098) — sin NestJS, sin Prisma, sin
 * `exceljs`: inyecta implementaciones FALSAS en memoria de los puertos `RepositorioProductos`,
 * `RepositorioIngresos` y `LectorImportacionProductos` (mismo patrón que
 * `cambiar-mi-password.spec.ts` — el beneficio de la arquitectura hexagonal, research R10).
 *
 * Cubre exactamente lo que pide `tasks.md` T098:
 * 1. Construcción correcta de `ResumenImportacion` (creados/actualizados/conStockInicial y los
 *    `errores` combinando los del lector con los que ocurren fila por fila al procesar el
 *    catálogo — FR-051, procesamiento PARCIAL: una fila inválida no bloquea las demás).
 * 2. Agrupación de las líneas del `Ingreso` sintético SOLO con las filas `cantidadInicial>0`
 *    (FR-050, research R15) — con el `productoId` ya resuelto por el paso de catálogo, y
 *    excluyendo las filas que fallaron en ese paso aunque trajeran stock inicial.
 * 3. Validación condicional `cantidadInicial`/`valorUnitario` de `esquemaFilaImportacionProducto`
 *    (T092, `@trazo/compartido`) — el `superRefine` que exige `valorUnitario > 0` únicamente
 *    cuando `cantidadInicial > 0`.
 *
 * También cubre, por ser barato de probar SOLO con puertos falsos (una fila-límite de 2000
 * requeriría un `.xlsx` real de 2000 filas en integración): el rechazo TOTAL cuando el archivo
 * supera el máximo de filas de datos (US8-AS5), sin tocar ningún producto.
 */
import { esquemaFilaImportacionProducto, type FilaImportacionProducto } from '@trazo/compartido';
import { ImportarProductosCasoUso } from '../../src/aplicacion/productos/importar-productos.caso-uso';
import type {
  ErrorFilaImportacionProducto,
  FilaValidaImportacionProducto,
  LectorImportacionProductos,
  ResultadoLecturaImportacionProductos,
} from '../../src/aplicacion/productos/puertos/lector-importacion-productos';
import { Duplicado, ErrorValidacionDominio } from '../../src/dominio/comunes/errores';
import type { Categoria } from '../../src/dominio/entidades/categoria';
import type { DatosCategoria, RepositorioCategorias } from '../../src/dominio/puertos/repositorio-categorias';
import type { Proveedor } from '../../src/dominio/entidades/proveedor';
import type { RepositorioProveedores } from '../../src/dominio/puertos/repositorio-proveedores';
import type { UnidadMedida } from '../../src/dominio/entidades/unidad-medida';
import type { RepositorioUnidadesMedida } from '../../src/dominio/puertos/repositorio-unidades-medida';
import type { EstadoProducto, Producto } from '../../src/dominio/entidades/producto';
import type {
  ContextoCambioCosto,
  DatosActualizarProducto,
  DatosNuevoProducto,
  FiltrosListarProductos,
  FiltrosListarTodosProductos,
  PaginaProductos,
  RepositorioProductos,
  ValoresClasificacionProductos,
} from '../../src/dominio/puertos/repositorio-productos';
import { aplicarCambioDeCosto } from '../../src/dominio/servicios/servicio-costo-producto';
import type {
  CriteriosIngresos,
  DatosActualizarIngreso,
  DatosNuevoIngreso,
  FiltrosListarIngresos,
  IngresoConDetalles,
  PaginaIngresos,
  RepositorioIngresos,
} from '../../src/dominio/puertos/repositorio-ingresos';
import type { Ingreso } from '../../src/dominio/entidades/ingreso';

/** `Producto` mínimo pero completo, con los campos que el caso de uso no controla (stock,
 *  costo, fecha de movimiento) en su valor "recién creado" — esta suite no ejerce el flujo de
 *  stock del `Ingreso` sintético a través del repositorio de productos, solo a través del
 *  `RepositorioIngresos` falso (ver más abajo). */
function crearProductoExistente(datos: { id: number; sku: string; estado?: EstadoProducto }): Producto {
  return {
    id: datos.id,
    sku: datos.sku,
    descripcion: `Descripción previa de ${datos.sku}`,
    categoria: null,
    unidadMedida: { id: 50, nombre: 'Kilogramo', abreviatura: 'kg' },
    ubicacion: null,
    umbralStockBajo: 0,
    stockActual: 0,
    ultimoCosto: 0,
    fechaUltimoMovimiento: null,
    estado: datos.estado ?? 'ACTIVO',
  };
}

/**
 * `RepositorioProductos` falso en memoria: solo implementa lo que
 * `ImportarProductosCasoUso` realmente usa (`buscarPorSku`/`crear`/`actualizar`/
 * `actualizarCosto`) y registra cada llamada (patrón spy manual, sin librería de mocking —
 * Principio V, YAGNI). Permite configurar SKUs que deben fallar al crear/actualizar, para
 * simular una fila que se cae en el paso de catálogo sin detener el resto del archivo (FR-051).
 *
 * `actualizarCosto` (US12) delega en el MISMO servicio de dominio puro que usa el adaptador
 * Prisma real (`aplicarCambioDeCosto`) en vez de reimplementar la comparación: así esta suite
 * verifica el conteo de `costosActualizados` contra la regla de verdad de FR-074 y no contra
 * una copia del falso que podría divergir. Lo único que simula es la persistencia (un `Map`).
 */
/**
 * Catálogo de categorías en memoria (US15). Las pruebas de este archivo no ejercitan el
 * catálogo —sus filas no traen categoría—, así que basta con que responda "no existe": el
 * caso de uso solo lo consulta cuando la fila SÍ trae un nombre. Las categorías que sí
 * conoce se cargan con `registrar`, para la prueba de categoría desconocida.
 */
class RepositorioCategoriasFalso implements RepositorioCategorias {
  private readonly porNombreNormalizado = new Map<string, Categoria>();

  registrar(categoria: Categoria): void {
    this.porNombreNormalizado.set(categoria.nombre.trim().toLocaleLowerCase('es'), categoria);
  }

  async buscarPorNombreNormalizado(nombreNormalizado: string): Promise<Categoria | null> {
    return this.porNombreNormalizado.get(nombreNormalizado) ?? null;
  }

  async listar(): Promise<never[]> {
    throw new Error('no usado en estas pruebas');
  }
  async buscarPorId(): Promise<Categoria | null> {
    throw new Error('no usado en estas pruebas');
  }
  async crear(_datos: DatosCategoria, _usuarioId: number): Promise<number> {
    throw new Error('no usado en estas pruebas');
  }
  async actualizar(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
  async cambiarEstado(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
  /** US31: la carga masiva no corrige cantidades a mano — registra un ingreso (FR-106). */
  async corregirCantidad(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
  async contarProductos(): Promise<number> {
    throw new Error('no usado en estas pruebas');
  }
  async eliminar(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
}

/**
 * `RepositorioProveedores` falso: solo tiene que resolver el proveedor del sistema por nombre
 * (US15, FR-093), que es lo único que la importación le pide. Nace con esa fila ya sembrada
 * porque en el sistema real la crean la migración y la semilla, no la importación.
 */
class RepositorioProveedoresFalso implements RepositorioProveedores {
  private readonly porNombreNormalizado = new Map<string, Proveedor>();

  constructor(conProveedorDelSistema = true) {
    if (conProveedorDelSistema) {
      this.registrar({
        id: 900,
        nombre: 'Carga masiva de inventario',
        nit: null,
        telefono: null,
        email: null,
        estado: 'ACTIVO',
        esSistema: true,
      });
    }
  }

  registrar(proveedor: Proveedor): void {
    this.porNombreNormalizado.set(proveedor.nombre.trim().toLocaleLowerCase('es'), proveedor);
  }

  async buscarPorNombreNormalizado(nombreNormalizado: string): Promise<Proveedor | null> {
    return this.porNombreNormalizado.get(nombreNormalizado) ?? null;
  }

  async listar(): Promise<never[]> {
    throw new Error('no usado en estas pruebas');
  }
  async buscarPorId(): Promise<Proveedor | null> {
    throw new Error('no usado en estas pruebas');
  }
  async crear(): Promise<number> {
    throw new Error('no usado en estas pruebas');
  }
  async actualizar(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
  async cambiarEstado(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
  /** US31: la carga masiva no corrige cantidades a mano — registra un ingreso (FR-106). */
  async corregirCantidad(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
  async contarIngresos(): Promise<number> {
    throw new Error('no usado en estas pruebas');
  }
  async eliminar(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
}

/**
 * `RepositorioUnidadesMedida` falso: resuelve "kg"/"Kilogramo" y nada más, que es lo único que
 * la importación le pide (FR-104 — el mismo texto se prueba contra nombre y abreviatura).
 */
class RepositorioUnidadesMedidaFalso implements RepositorioUnidadesMedida {
  private readonly porTexto = new Map<string, UnidadMedida>();

  constructor() {
    const kilogramo: UnidadMedida = { id: 50, nombre: 'Kilogramo', abreviatura: 'kg', estado: 'ACTIVA' };
    this.porTexto.set('kilogramo', kilogramo);
    this.porTexto.set('kg', kilogramo);
  }

  async buscarPorTexto(nombreNormalizado: string, abreviaturaNormalizada: string) {
    const unidad = this.porTexto.get(nombreNormalizado) ?? this.porTexto.get(abreviaturaNormalizada);
    if (!unidad) return null;
    return { unidad, campo: 'nombre' as const };
  }

  async buscarPorId(id: number): Promise<UnidadMedida | null> {
    return [...this.porTexto.values()].find((unidad) => unidad.id === id) ?? null;
  }

  async listar(): Promise<never[]> {
    throw new Error('no usado en estas pruebas');
  }
  async crear(): Promise<number> {
    throw new Error('no usado en estas pruebas');
  }
  async actualizar(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
  async cambiarEstado(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
  /** US31: la carga masiva no corrige cantidades a mano — registra un ingreso (FR-106). */
  async corregirCantidad(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
  async contarProductos(): Promise<number> {
    throw new Error('no usado en estas pruebas');
  }
  async eliminar(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
}

class RepositorioProductosFalso implements RepositorioProductos {
  private readonly productosPorSku = new Map<string, Producto>();
  private siguienteId = 100;
  readonly skusQueFallan = new Set<string>();
  readonly llamadasCrear: DatosNuevoProducto[] = [];
  readonly llamadasActualizar: Array<{ id: number; datos: DatosActualizarProducto }> = [];
  readonly cambiosDeCosto: Array<{ id: number; costoNuevo: number; contexto: ContextoCambioCosto }> = [];

  sembrar(producto: Producto): void {
    this.productosPorSku.set(producto.sku, producto);
    this.siguienteId = Math.max(this.siguienteId, producto.id + 1);
  }

  async buscarPorSku(sku: string): Promise<Producto | null> {
    return this.productosPorSku.get(sku) ?? null;
  }

  /** US31: la carga masiva no corrige cantidades a mano — registra un ingreso (FR-106). */
  async corregirCantidad(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }

  async crear(datos: DatosNuevoProducto): Promise<Producto> {
    this.llamadasCrear.push(datos);
    if (this.skusQueFallan.has(datos.sku)) {
      throw new Duplicado('sku', `Ya existe un producto con el SKU "${datos.sku}"`);
    }
    const producto = crearProductoExistente({ id: this.siguienteId++, sku: datos.sku });
    this.productosPorSku.set(datos.sku, producto);
    return producto;
  }

  async actualizar(id: number, datos: DatosActualizarProducto): Promise<void> {
    this.llamadasActualizar.push({ id, datos });
    const existente = [...this.productosPorSku.values()].find((producto) => producto.id === id);
    if (existente && this.skusQueFallan.has(existente.sku)) {
      throw new Duplicado('sku', `No se pudo actualizar el producto "${existente.sku}"`);
    }
  }

  /** US12: aplica el costo con la regla REAL del dominio (FR-074) y devuelve si cambió. */
  async actualizarCosto(id: number, costoNuevo: number, contexto: ContextoCambioCosto): Promise<boolean> {
    this.cambiosDeCosto.push({ id, costoNuevo, contexto });
    const existente = [...this.productosPorSku.values()].find((producto) => producto.id === id);
    if (!existente) return false;

    const registro = aplicarCambioDeCosto({
      productoId: id,
      costoAnterior: existente.ultimoCosto,
      costoNuevo,
      origen: contexto.origen,
      usuarioId: contexto.usuarioId,
      documentoId: contexto.documentoId,
    });
    if (!registro) return false;

    this.productosPorSku.set(existente.sku, { ...existente, ultimoCosto: registro.costoNuevo });
    return true;
  }

  // Ajenos a `ImportarProductosCasoUso` (FR-049 solo usa buscarPorSku/crear/actualizar) —
  // implementación mínima que revienta si algo los llama por error, para detectar desvíos.
  async buscarPorId(_id: number): Promise<Producto | null> {
    throw new Error('RepositorioProductosFalso.buscarPorId no está soportado en esta suite');
  }

  async buscarPorIds(_ids: readonly number[]): Promise<Producto[]> {
    throw new Error('RepositorioProductosFalso.buscarPorIds no está soportado en esta suite');
  }

  async cambiarEstado(_id: number, _estado: EstadoProducto, _usuarioModificacionId: number): Promise<void> {
    throw new Error('RepositorioProductosFalso.cambiarEstado no está soportado en esta suite');
  }

  async listar(_filtros: FiltrosListarProductos): Promise<PaginaProductos> {
    throw new Error('RepositorioProductosFalso.listar no está soportado en esta suite');
  }

  async listarTodos(_filtros?: FiltrosListarTodosProductos): Promise<Producto[]> {
    throw new Error('RepositorioProductosFalso.listarTodos no está soportado en esta suite');
  }

  async valoresDeClasificacion(): Promise<ValoresClasificacionProductos> {
    throw new Error('RepositorioProductosFalso.valoresDeClasificacion no está soportado en esta suite');
  }
}

/**
 * `RepositorioIngresos` falso en memoria: registra la ÚNICA llamada a `crear` (el `Ingreso`
 * sintético, FR-050) y a `recibir`, para verificar exactamente qué líneas se agruparon sin
 * levantar Postgres ni ejercer `FOR UPDATE`/movimientos `ENTRADA` reales (eso lo cubre la
 * integración, T097).
 */
class RepositorioIngresosFalso implements RepositorioIngresos {
  llamadaCrear: DatosNuevoIngreso | null = null;
  llamadaRecibir: { id: number; usuarioId: number } | null = null;
  private siguienteId = 500;

  async crear(datos: DatosNuevoIngreso): Promise<Ingreso> {
    this.llamadaCrear = datos;
    const id = this.siguienteId++;
    return {
      id,
      // US29: la carga masiva registra ingresos de FACTURA (hay proveedor del sistema y hay
      // costo); el doble refleja eso y no una forma inventada.
      tipo: 'FACTURA',
      numeroFactura: datos.numeroFactura,
      numeroAjuste: null,
      fechaFactura: datos.fechaFactura,
      proveedor: datos.proveedorId === null ? null : { id: datos.proveedorId, nombre: 'Carga masiva de inventario' },
      fechaRecepcion: datos.fechaRecepcion,
      observaciones: datos.observaciones,
      estado: 'PENDIENTE',
      valorTotal: datos.lineas.reduce((acumulado, linea) => acumulado + linea.cantidad * linea.precioUnitario, 0),
      // US20: la carga masiva no captura impuestos, así que su ingreso sintético va sin IVA.
      valorIva: 0,
      usuarioRegistraId: datos.usuarioId,
      motivoAnulacion: null,
      ordenCompraId: datos.ordenCompraId,
    };
  }

  async recibir(id: number, usuarioId: number): Promise<void> {
    this.llamadaRecibir = { id, usuarioId };
  }

  // Ajenos a `ImportarProductosCasoUso` (solo usa crear/recibir) — implementación mínima.
  async buscarPorId(_id: number): Promise<IngresoConDetalles | null> {
    throw new Error('RepositorioIngresosFalso.buscarPorId no está soportado en esta suite');
  }

  async listar(_filtros: FiltrosListarIngresos): Promise<PaginaIngresos> {
    throw new Error('RepositorioIngresosFalso.listar no está soportado en esta suite');
  }

  async listarTodos(_criterios: CriteriosIngresos): Promise<Ingreso[]> {
    throw new Error('RepositorioIngresosFalso.listarTodos no está soportado en esta suite');
  }

  async actualizar(_id: number, _datos: DatosActualizarIngreso, _usuarioId: number): Promise<void> {
    throw new Error('RepositorioIngresosFalso.actualizar no está soportado en esta suite');
  }

  async verificar(_id: number, _usuarioId: number): Promise<void> {
    throw new Error('RepositorioIngresosFalso.verificar no está soportado en esta suite');
  }

  async anular(_id: number, _usuarioId: number, _motivo: string): Promise<void> {
    throw new Error('RepositorioIngresosFalso.anular no está soportado en esta suite');
  }
}

/** `LectorImportacionProductos` falso: devuelve un `ResultadoLecturaImportacionProductos`
 *  precocinado por el test, sin tocar `exceljs` ni el `Buffer` recibido (T093/T094 ya se
 *  prueban en integración con archivos `.xlsx` reales — T097). */
class LectorImportacionProductosFalso implements LectorImportacionProductos {
  constructor(private readonly resultado: ResultadoLecturaImportacionProductos) {}

  async leer(_archivo: Buffer): Promise<ResultadoLecturaImportacionProductos> {
    return this.resultado;
  }
}

/** Construye una `FilaImportacionProducto` completa a partir de overrides mínimos — evita
 *  repetir los campos irrelevantes a cada test (mismo espíritu que los builders de fixtures
 *  de otras suites del proyecto). */
function filaDatos(overrides: Partial<FilaImportacionProducto> & { sku: string }): FilaImportacionProducto {
  return {
    descripcion: `Producto ${overrides.sku}`,
    umbralStockBajo: 0,
    // US17 (FR-102): desde esta historia una fila que CREA un producto sin unidad se rechaza,
    // así que el caso base de estas pruebas la trae. La ausencia se ejercita en su propia
    // prueba, más abajo.
    unidadMedida: 'kg',
    ...overrides,
  };
}

function filaValida(numeroFila: number, datos: FilaImportacionProducto): FilaValidaImportacionProducto {
  return { numeroFila, datos };
}

const USUARIO_ID = 7;

describe('ImportarProductosCasoUso — construcción de ResumenImportacion (T098, FR-051)', () => {
  it('cuenta creados/actualizados/conStockInicial y agrega los errores del lector, sin agrupar filas sin stock', async () => {
    const repositorioProductos = new RepositorioProductosFalso();
    const repositorioCategorias = new RepositorioCategoriasFalso();
    repositorioProductos.sembrar(crearProductoExistente({ id: 1, sku: 'EXIST-1' }));
    const repositorioIngresos = new RepositorioIngresosFalso();
    const erroresIniciales: ErrorFilaImportacionProducto[] = [{ fila: 5, mensaje: 'El SKU es obligatorio' }];
    const lector = new LectorImportacionProductosFalso({
      erroresIniciales,
      filasValidas: [
        filaValida(2, filaDatos({ sku: 'NEW-1' })), // crea, sin stock
        filaValida(3, filaDatos({ sku: 'NEW-2', cantidadInicial: 10, valorUnitario: 500 })), // crea, con stock
        filaValida(4, filaDatos({ sku: 'EXIST-1' })), // actualiza, sin stock
      ],
    });
    const casoUso = new ImportarProductosCasoUso(
      repositorioProductos,
      repositorioIngresos,
      lector,
      repositorioCategorias,
      new RepositorioProveedoresFalso(),
      new RepositorioUnidadesMedidaFalso(),
    );

    const resumen = await casoUso.ejecutar({ archivo: Buffer.from(''), usuarioId: USUARIO_ID });

    expect(resumen).toEqual({
      creados: 2,
      actualizados: 1,
      conStockInicial: 1,
      // Solo NEW-2 traía "Valor unitario" (500, contra el costo 0 de un producto recién
      // creado): las otras dos filas llegan sin costo, así que no cuentan (US12, FR-074).
      costosActualizados: 1,
      errores: erroresIniciales,
    });
  });

  it('cuenta en costosActualizados SOLO las filas cuyo valor unitario difiere del costo vigente (US12, FR-074)', async () => {
    const repositorioProductos = new RepositorioProductosFalso();
    const repositorioCategorias = new RepositorioCategoriasFalso();
    repositorioProductos.sembrar({ ...crearProductoExistente({ id: 1, sku: 'MISMO-COSTO' }), ultimoCosto: 1200 });
    repositorioProductos.sembrar({ ...crearProductoExistente({ id: 2, sku: 'COSTO-NUEVO' }), ultimoCosto: 1200 });
    repositorioProductos.sembrar({ ...crearProductoExistente({ id: 3, sku: 'SIN-COSTO' }), ultimoCosto: 1200 });
    const repositorioIngresos = new RepositorioIngresosFalso();
    const lector = new LectorImportacionProductosFalso({
      erroresIniciales: [],
      filasValidas: [
        filaValida(2, filaDatos({ sku: 'MISMO-COSTO', valorUnitario: 1200 })), // igual → no cuenta
        filaValida(3, filaDatos({ sku: 'COSTO-NUEVO', valorUnitario: 1500 })), // cambia → cuenta
        filaValida(4, filaDatos({ sku: 'SIN-COSTO' })), // columna vacía → no cuenta
      ],
    });
    const casoUso = new ImportarProductosCasoUso(
      repositorioProductos,
      repositorioIngresos,
      lector,
      repositorioCategorias,
      new RepositorioProveedoresFalso(),
      new RepositorioUnidadesMedidaFalso(),
    );

    const resumen = await casoUso.ejecutar({ archivo: Buffer.from(''), usuarioId: USUARIO_ID });

    expect(resumen.costosActualizados).toBe(1);
    expect(resumen.actualizados).toBe(3); // las tres actualizaron el catálogo
    // La fila sin "Valor unitario" ni siquiera consulta al repositorio de costos: `undefined`
    // significa "no lo toques", nunca "ponlo en cero" (FR-074).
    expect(repositorioProductos.cambiosDeCosto.map((cambio) => cambio.id)).toEqual([1, 2]);
    expect(repositorioProductos.cambiosDeCosto.every((cambio) => cambio.contexto.origen === 'IMPORTACION')).toBe(true);
    // Un cambio de costo NO mueve inventario (FR-073): no hay Ingreso sintético que crear.
    expect(repositorioIngresos.llamadaCrear).toBeNull();
  });

  it('una fila que falla al crear/actualizar el producto se reporta con su número de fila SIN detener el resto del archivo (FR-051)', async () => {
    const repositorioProductos = new RepositorioProductosFalso();
    const repositorioCategorias = new RepositorioCategoriasFalso();
    repositorioProductos.skusQueFallan.add('DUP-1');
    const repositorioIngresos = new RepositorioIngresosFalso();
    const lector = new LectorImportacionProductosFalso({
      erroresIniciales: [],
      filasValidas: [
        filaValida(2, filaDatos({ sku: 'DUP-1', cantidadInicial: 5, valorUnitario: 100 })), // falla en catálogo
        filaValida(3, filaDatos({ sku: 'OK-1', cantidadInicial: 3, valorUnitario: 50 })), // éxito
      ],
    });
    const casoUso = new ImportarProductosCasoUso(
      repositorioProductos,
      repositorioIngresos,
      lector,
      repositorioCategorias,
      new RepositorioProveedoresFalso(),
      new RepositorioUnidadesMedidaFalso(),
    );

    const resumen = await casoUso.ejecutar({ archivo: Buffer.from(''), usuarioId: USUARIO_ID });

    expect(resumen.creados).toBe(1);
    expect(resumen.actualizados).toBe(0);
    expect(resumen.conStockInicial).toBe(1); // solo OK-1: DUP-1 nunca llegó a tener productoId
    expect(resumen.errores).toEqual([{ fila: 2, mensaje: 'Ya existe un producto con el SKU "DUP-1"' }]);
    // La fila que falló en catálogo NO entra al Ingreso sintético aunque traía cantidadInicial>0.
    expect(repositorioIngresos.llamadaCrear?.lineas).toHaveLength(1);
    expect(repositorioIngresos.llamadaCrear?.lineas[0]).toMatchObject({ cantidad: 3, precioUnitario: 50 });
  });

  it('rechaza el archivo COMPLETO sin tocar ningún producto cuando supera el máximo de filas de datos (US8-AS5)', async () => {
    const repositorioProductos = new RepositorioProductosFalso();
    const repositorioCategorias = new RepositorioCategoriasFalso();
    const repositorioIngresos = new RepositorioIngresosFalso();
    const filasValidas = Array.from({ length: 2001 }, (_valor, indice) =>
      filaValida(indice + 2, filaDatos({ sku: `SKU-${indice}` })),
    );
    const lector = new LectorImportacionProductosFalso({ erroresIniciales: [], filasValidas });
    const casoUso = new ImportarProductosCasoUso(
      repositorioProductos,
      repositorioIngresos,
      lector,
      repositorioCategorias,
      new RepositorioProveedoresFalso(),
      new RepositorioUnidadesMedidaFalso(),
    );

    await expect(casoUso.ejecutar({ archivo: Buffer.from(''), usuarioId: USUARIO_ID })).rejects.toThrow(
      ErrorValidacionDominio,
    );

    expect(repositorioProductos.llamadasCrear).toHaveLength(0);
    expect(repositorioProductos.llamadasActualizar).toHaveLength(0);
    expect(repositorioIngresos.llamadaCrear).toBeNull();
  });
});

describe('ImportarProductosCasoUso — agrupación del Ingreso sintético (T098, FR-050)', () => {
  it('agrupa en UN solo Ingreso SOLO las filas con cantidadInicial>0, con el productoId ya resuelto', async () => {
    const repositorioProductos = new RepositorioProductosFalso();
    const repositorioCategorias = new RepositorioCategoriasFalso();
    repositorioProductos.sembrar(crearProductoExistente({ id: 42, sku: 'EXIST-STOCK' }));
    const repositorioIngresos = new RepositorioIngresosFalso();
    const lector = new LectorImportacionProductosFalso({
      erroresIniciales: [],
      filasValidas: [
        filaValida(2, filaDatos({ sku: 'SIN-STOCK-1' })), // sin cantidadInicial
        filaValida(3, filaDatos({ sku: 'CON-STOCK-1', cantidadInicial: 8, valorUnitario: 250 })),
        filaValida(4, filaDatos({ sku: 'SIN-STOCK-2', cantidadInicial: 0 })), // cantidadInicial=0 no cuenta
        filaValida(5, filaDatos({ sku: 'EXIST-STOCK', cantidadInicial: 15, valorUnitario: 1000 })), // actualiza + stock
      ],
    });
    const casoUso = new ImportarProductosCasoUso(
      repositorioProductos,
      repositorioIngresos,
      lector,
      repositorioCategorias,
      new RepositorioProveedoresFalso(),
      new RepositorioUnidadesMedidaFalso(),
    );

    const resumen = await casoUso.ejecutar({ archivo: Buffer.from(''), usuarioId: USUARIO_ID });

    expect(resumen.conStockInicial).toBe(2);
    expect(repositorioIngresos.llamadaCrear).not.toBeNull();
    expect(repositorioIngresos.llamadaCrear?.proveedorId).toBe(900); // el del sistema, resuelto por nombre (FR-093)
    expect(repositorioIngresos.llamadaCrear?.numeroFactura).toMatch(/^IMPORTACION-/);
    expect(repositorioIngresos.llamadaCrear?.usuarioId).toBe(USUARIO_ID);
    expect(repositorioIngresos.llamadaCrear?.lineas).toHaveLength(2);
    expect(repositorioIngresos.llamadaCrear?.lineas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cantidad: 8, precioUnitario: 250 }),
        expect.objectContaining({ productoId: 42, cantidad: 15, precioUnitario: 1000 }),
      ]),
    );
    // Se recibe (PENDIENTE → RECIBIDO) el MISMO ingreso creado (id 500, el primero que asigna
    // el falso), con el usuario que subió el archivo.
    expect(repositorioIngresos.llamadaRecibir).toEqual({ id: 500, usuarioId: USUARIO_ID });
  });

  it('no crea ningún Ingreso sintético cuando ninguna fila válida trae cantidadInicial>0', async () => {
    const repositorioProductos = new RepositorioProductosFalso();
    const repositorioCategorias = new RepositorioCategoriasFalso();
    const repositorioIngresos = new RepositorioIngresosFalso();
    const lector = new LectorImportacionProductosFalso({
      erroresIniciales: [],
      filasValidas: [filaValida(2, filaDatos({ sku: 'SOLO-CATALOGO-1' })), filaValida(3, filaDatos({ sku: 'SOLO-CATALOGO-2' }))],
    });
    const casoUso = new ImportarProductosCasoUso(
      repositorioProductos,
      repositorioIngresos,
      lector,
      repositorioCategorias,
      new RepositorioProveedoresFalso(),
      new RepositorioUnidadesMedidaFalso(),
    );

    const resumen = await casoUso.ejecutar({ archivo: Buffer.from(''), usuarioId: USUARIO_ID });

    expect(resumen.conStockInicial).toBe(0);
    expect(repositorioIngresos.llamadaCrear).toBeNull();
    expect(repositorioIngresos.llamadaRecibir).toBeNull();
  });
});

describe('esquemaFilaImportacionProducto — validación condicional cantidadInicial/valorUnitario (T092)', () => {
  const filaBase = { sku: 'SKU-1', descripcion: 'Producto de prueba' };

  it('rechaza cantidadInicial > 0 sin valorUnitario, con el mensaje anclado a valorUnitario', () => {
    const resultado = esquemaFilaImportacionProducto.safeParse({ ...filaBase, cantidadInicial: 5 });

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      const problema = resultado.error.issues.find((issue) => issue.path.join('.') === 'valorUnitario');
      expect(problema?.message).toBe('La cantidad inicial requiere un valor unitario mayor a 0');
    }
  });

  it('rechaza cantidadInicial > 0 con valorUnitario = 0 (no es "mayor a 0")', () => {
    const resultado = esquemaFilaImportacionProducto.safeParse({ ...filaBase, cantidadInicial: 5, valorUnitario: 0 });

    expect(resultado.success).toBe(false);
  });

  it('acepta cantidadInicial > 0 con valorUnitario > 0', () => {
    const resultado = esquemaFilaImportacionProducto.safeParse({ ...filaBase, cantidadInicial: 5, valorUnitario: 100 });

    expect(resultado.success).toBe(true);
  });

  it('acepta cantidadInicial ausente, con o sin valorUnitario (se ignora si viene)', () => {
    expect(esquemaFilaImportacionProducto.safeParse({ ...filaBase }).success).toBe(true);
    expect(esquemaFilaImportacionProducto.safeParse({ ...filaBase, valorUnitario: 999 }).success).toBe(true);
  });

  it('acepta cantidadInicial = 0, con o sin valorUnitario (se ignora si viene)', () => {
    expect(esquemaFilaImportacionProducto.safeParse({ ...filaBase, cantidadInicial: 0 }).success).toBe(true);
    expect(
      esquemaFilaImportacionProducto.safeParse({ ...filaBase, cantidadInicial: 0, valorUnitario: 999 }).success,
    ).toBe(true);
  });
});
