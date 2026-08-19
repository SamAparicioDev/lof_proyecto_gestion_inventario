/**
 * Genera los DOS archivos Excel descargables de la carga masiva de inventario, con la MISMA
 * hoja, los MISMOS encabezados y la misma hoja "Instrucciones" — por eso viven en el mismo
 * archivo y comparten constantes: si divergieran, uno de los dos dejaría de poder subirse por
 * `POST /api/productos/importar`.
 *
 * 1. `generarPlantillaProductos` (US8, T093) → `GET /api/productos/plantilla-importacion`:
 *    plantilla VACÍA con una fila de ejemplo marcada para borrar. Sirve para empezar de cero.
 * 2. `generarCatalogoProductos` (Phase 13, T112) → `GET /api/productos/catalogo-importacion`:
 *    el catálogo ACTUAL, una fila por producto ya existente. Sirve para editar en Excel lo que
 *    ya está en el sistema y volver a subirlo como actualización masiva (FR-049 ya actualiza
 *    por SKU, así que el flujo de subida no cambia).
 *
 * Los encabezados van en el MISMO orden que `esquemaFilaImportacionProducto`
 * (`@trazo/compartido`) — ese orden es el contrato implícito entre estos archivos y
 * `leerFilasImportacionProductos`, que lee las columnas por posición, no por texto de
 * encabezado (así el usuario puede traducir/ajustar el título de una columna sin romper la
 * carga). La hoja "Instrucciones" explica el significado de cada columna, para que un
 * Administrador/Gerente sin acompañamiento técnico pueda llenarla sin ayuda externa.
 *
 * ## Por qué el catálogo exportado NO lleva stock (invariante crítica de FR-053)
 *
 * "Cantidad inicial" y "Valor unitario" NO son "el stock que tiene hoy el producto": son un
 * INGRESO de mercancía. `ImportarProductosCasoUso` agrupa toda fila con `cantidadInicial > 0`
 * en un `Ingreso` sintético que se recibe con el mismo flujo atómico que un ingreso manual
 * (FR-050) — es decir, SUMA esa cantidad al stock actual. Si el catálogo exportado llevara el
 * `stockActual` de cada producto en esa columna, volver a subir el archivo (que es justo para
 * lo que se descarga) duplicaría el inventario completo. Por eso ambas columnas viajan VACÍAS,
 * y por eso `FilaCatalogoImportacion` ni siquiera tiene campos donde meter un stock: la
 * invariante la sostiene el TIPO, no la disciplina de quien edite este archivo mañana.
 *
 * Implementa: FR-048 (plantilla vacía), FR-053 (catálogo actual en formato de plantilla).
 */
import ExcelJS from 'exceljs';
import type { Producto } from '../../dominio/entidades/producto';

/** Nombre de la hoja de datos — DEBE coincidir con el que lee `leerFilasImportacionProductos`. */
export const HOJA_PRODUCTOS_IMPORTACION = 'Productos';

/**
 * Encabezados de la hoja "Productos", en el mismo orden posicional que
 * `esquemaFilaImportacionProducto`: sku, descripcion, categoria, ubicacion,
 * umbralStockBajo, cantidadInicial, valorUnitario, unidadMedida.
 *
 * Se exporta para que `leer-filas-importacion-productos.ts` pueda NOMBRAR una columna al
 * explicar por qué rechazó una celda ("la columna «Valor unitario»"). Eso NO cambia la forma de
 * leer: el lector sigue mapeando por POSICIÓN, así que el usuario puede traducir o ajustar el
 * título de una columna sin romper la carga; el título solo se usa para redactar el mensaje.
 */
export const ENCABEZADOS_PRODUCTOS_IMPORTACION = [
  'SKU',
  'Descripción',
  'Categoría',
  'Ubicación',
  'Umbral stock bajo',
  'Cantidad inicial',
  'Valor unitario',
  // Columna 8 (US17, FR-104): va AL FINAL de las importables y no junto a "Categoría", que es
  // donde encajaría por sentido. El lector mapea las columnas por POSICIÓN, así que insertarla
  // en medio habría corrido "Ubicación" y todo lo siguiente un puesto: los archivos que el
  // usuario ya tiene guardados se leerían mal —la ubicación entendida como unidad— y fallarían
  // fila a fila. Al final, esos archivos siguen funcionando: no traen la columna, así que las
  // filas que ACTUALIZAN conservan su unidad y solo las que crean un producto nuevo se rechazan,
  // que es exactamente la regla nueva.
  'Unidad de medida',
  // Columna 9: SOLO INFORMATIVA. El lector (`leer-filas-importacion-productos.ts`) mapea las
  // columnas por POSICIÓN 1..8, así que todo lo que venga después lo ignora — por eso se puede
  // mostrar el stock aquí sin ningún riesgo de que al re-subir el archivo se sume al inventario.
  // Responde a una petición concreta del dueño del proyecto: al descargar el catálogo quería
  // VER cuánto tiene de cada producto, no solo poder editar sus datos.
  'Stock actual (informativo, no se importa)',
] as const;

/** Fila de ejemplo de la hoja "Productos" — deliberadamente marcada para que el usuario la borre. */
const FILA_EJEMPLO_PRODUCTOS_IMPORTACION = [
  'EJEMPLO-001',
  'Tornillo hexagonal 1/2 pulgada — BORRA ESTA FILA',
  'Ferretería',
  'Estante A-3',
  10,
  100,
  2500,
  'kg', // Unidad de medida — se escribe por nombre o por abreviatura (FR-104).
  null, // Stock actual — informativa: en la plantilla vacía no hay stock que mostrar.
];

/**
 * Fila de la hoja "Productos" del CATÁLOGO exportado (FR-053/FR-070).
 *
 * Incluye `stockActual` y `ultimoCosto` porque el usuario necesita VERLOS al revisar su
 * catálogo (petición explícita del dueño del proyecto, repetida). Que estén en el tipo NO
 * significa que se escriban en las columnas de ingreso: `generarCatalogoProductos` decide
 * dónde va cada uno, y esa decisión es la que importa —
 *
 *   - `ultimoCosto`  → columna 7 "Valor unitario". SEGURO: el importador solo consume esa
 *     columna cuando "Cantidad inicial" es mayor a 0, así que con la cantidad vacía se ignora.
 *   - `stockActual`  → columna 9 "Stock actual (informativo)", FUERA del rango 1..8 que lee el
 *     importador. NUNCA a la columna 6 "Cantidad inicial": eso sí volvería a sumarlo al
 *     inventario al re-subir el archivo, que es precisamente para lo que se descarga.
 */
export type FilaCatalogoImportacion = Pick<
  Producto,
  | 'sku'
  | 'descripcion'
  | 'categoria'
  | 'unidadMedida'
  | 'ubicacion'
  | 'umbralStockBajo'
  | 'stockActual'
  | 'ultimoCosto'
>;

/** Una fila de la hoja "Instrucciones": qué significa una columna de la hoja "Productos". */
interface InstruccionColumna {
  readonly columna: string;
  readonly significado: string;
}

/**
 * Aviso destacado que abre la hoja "Instrucciones" del CATÁLOGO exportado (FR-053) — no
 * aparece en la plantilla vacía. Es la traducción a lenguaje de usuario de la invariante
 * explicada en la cabecera de este archivo: lo que sostiene el inventario cuando alguien
 * decide "completar" las dos columnas vacías antes de volver a subir el archivo.
 */
const NOTA_CATALOGO_INSTRUCCIONES =
  'Este archivo es una FOTO del catálogo actual de Trazo: una fila por producto ya registrado. ' +
  'Edita descripción, categoría, ubicación y umbral, y vuelve a subirlo en "Importar desde Excel": ' +
  'cada fila ACTUALIZA el producto que tenga ese SKU, nunca lo duplica. ' +
  'IMPORTANTE — la columna "Cantidad inicial" viene VACÍA A PROPÓSITO y debes dejarla así: NO es el ' +
  'stock que el producto tiene hoy (ese lo ves en la última columna, "Stock actual"), es una ENTRADA ' +
  'de mercancía nueva. Si escribes una cantidad ahí, al subir el archivo esa cantidad se SUMA al ' +
  'stock actual y el inventario queda inflado. Para corregir el stock de un producto usa un ingreso ' +
  'o una salida, nunca este archivo. ' +
  'El archivo también incluye los productos dados de baja (inactivos): volver a subirlo actualiza ' +
  'sus datos, pero NO los reactiva — eso se hace desde la ficha del producto.';

/** Significado de las 5 columnas de catálogo — IDÉNTICO en la plantilla vacía y en el catálogo
 *  exportado (las dos se suben por el mismo endpoint, así que se leen igual). */
const INSTRUCCIONES_COLUMNAS_CATALOGO: ReadonlyArray<InstruccionColumna> = [
  {
    columna: 'Unidad de medida',
    significado:
      'En qué se mide el producto. Escríbela por su nombre ("Kilogramo") o por su abreviatura ("kg"), como prefieras: ' +
      'da igual mayúsculas y espacios. Debe existir en Administración → Unidades de medida. ' +
      'OBLIGATORIA para dar de alta un producto NUEVO. Si la fila actualiza un producto que ya existe y dejas la ' +
      'celda vacía, el producto conserva la unidad que ya tenía.',
  },
  {
    columna: 'SKU',
    significado:
      'Código único del producto. Obligatorio. Si el SKU ya existe en el catálogo, la fila ACTUALIZA ese producto; ' +
      'si no existe, lo CREA. Máximo 50 caracteres. Un SKU repetido dentro del mismo archivo se reporta como fila inválida.',
  },
  {
    columna: 'Descripción',
    significado: 'Nombre o descripción del producto. Obligatorio. Máximo 300 caracteres.',
  },
  {
    columna: 'Categoría',
    significado: 'Categoría del producto, texto libre. Opcional. Máximo 100 caracteres.',
  },
  {
    columna: 'Ubicación',
    significado: 'Ubicación física en el almacén, texto libre. Opcional. Máximo 100 caracteres.',
  },
  {
    columna: 'Umbral stock bajo',
    significado:
      'Cantidad mínima antes de marcar el producto en stock bajo. Número ENTERO, sin decimales (US26). ' +
      'Opcional; si se deja vacía, queda en 0.',
  },
];

/** Significado de las 2 columnas de stock EN LA PLANTILLA VACÍA (FR-048): ahí sí se llenan,
 *  porque el archivo se usa para dar de alta productos que todavía no existen. */
const INSTRUCCIONES_COLUMNAS_STOCK_PLANTILLA: ReadonlyArray<InstruccionColumna> = [
  {
    columna: 'Cantidad inicial',
    significado:
      'Cantidad de stock a ingresar para este producto en esta carga. Número ENTERO, sin decimales (US26). ' +
      'Opcional: déjala vacía o en 0 si la fila es solo para crear/actualizar el catálogo, sin mover stock.',
  },
  {
    columna: 'Valor unitario',
    significado:
      'Costo unitario de la cantidad inicial. OBLIGATORIO y mayor a 0 cuando "Cantidad inicial" es mayor a 0; ' +
      'se ignora si "Cantidad inicial" está vacía o en 0.',
  },
];

/** Significado de las 3 columnas de stock/costo EN EL CATÁLOGO EXPORTADO (FR-053/FR-070) —
 *  ver `NOTA_CATALOGO_INSTRUCCIONES` y la cabecera del archivo. */
const INSTRUCCIONES_COLUMNAS_STOCK_CATALOGO: ReadonlyArray<InstruccionColumna> = [
  {
    columna: 'Cantidad inicial',
    significado:
      'DÉJALA VACÍA salvo que quieras INGRESAR mercancía nueva. NO es el stock actual del producto (ese lo ves ' +
      'en la última columna): es la cantidad que se SUMARÍA al stock al subir el archivo. Escribir aquí el stock ' +
      'que ya tienes lo duplicaría. Número ENTERO, sin decimales (US26).',
  },
  {
    columna: 'Valor unitario',
    significado:
      'Costo actual del producto, para que puedas consultarlo. Solo se aplica si escribes una "Cantidad inicial" ' +
      '(sería el costo de esa entrada de mercancía); si dejas la cantidad vacía, esta columna se ignora al subir.',
  },
  {
    columna: 'Stock actual (informativo, no se importa)',
    significado:
      'Cuánto tienes hoy de este producto. Es solo para que lo veas al revisar tu catálogo: el sistema NO lee ' +
      'esta columna al subir el archivo, así que editarla no cambia nada.',
  },
];

/** Genera el libro `.xlsx` completo de la plantilla VACÍA de carga masiva (FR-048). */
export async function generarPlantillaProductos(): Promise<Buffer> {
  const libro = crearLibro();

  const hoja = crearHojaProductos(libro);
  hoja.addRow(FILA_EJEMPLO_PRODUCTOS_IMPORTACION);
  hoja.getRow(2).font = { italic: true, color: { argb: 'FF808080' } };

  agregarHojaInstrucciones(libro, [...INSTRUCCIONES_COLUMNAS_CATALOGO, ...INSTRUCCIONES_COLUMNAS_STOCK_PLANTILLA]);

  return escribirLibro(libro);
}

/**
 * Genera el libro `.xlsx` del CATÁLOGO ACTUAL (FR-053): MISMA hoja y MISMOS encabezados que la
 * plantilla vacía, pero con una fila por producto recibido y SIN la fila de ejemplo (aquí los
 * ejemplos son los datos reales del usuario).
 *
 * Reparto de las columnas sensibles (FR-053/FR-070) — la única que DEBE ir vacía es la
 * cantidad:
 *   - "Cantidad inicial" (col. 6) → SIEMPRE `null`. Es la columna que dispara una entrada de
 *     mercancía: si trajera el stock actual, re-subir el archivo lo sumaría otra vez y
 *     duplicaría el inventario. El stock se muestra, pero en la columna informativa 9.
 *   - "Valor unitario" (col. 7) → el costo actual del producto. Se puede mostrar sin riesgo
 *     porque el importador solo lo consume acompañado de una cantidad; y si el usuario decide
 *     escribir una cantidad en esa fila, el costo correcto ya está puesto.
 *   - "Unidad de medida" (col. 8) → la abreviatura actual; vacía en los productos anteriores
 *     a US17, que al re-subir el archivo conservan la que tengan (FR-104).
 *   - "Stock actual" (col. 9) → informativa, fuera del rango que lee el importador.
 */
export async function generarCatalogoProductos(productos: readonly FilaCatalogoImportacion[]): Promise<Buffer> {
  const libro = crearLibro();

  const hoja = crearHojaProductos(libro);
  for (const producto of productos) {
    hoja.addRow([
      producto.sku,
      producto.descripcion,
      // El NOMBRE, no el objeto: desde US15 `Producto.categoria` es `{ id, nombre } | null`, y
      // escribirlo tal cual dejaba `{"id":1,"nombre":"Construcción"}` en la celda — un archivo
      // que además fallaba fila a fila al volver a subirse, porque la importación resuelve la
      // categoría por nombre (FR-090). Lo detectó T156.
      producto.categoria?.nombre ?? null,
      producto.ubicacion,
      producto.umbralStockBajo,
      null, // Cantidad inicial — VACÍA SIEMPRE: evita duplicar el inventario al re-subir.
      producto.ultimoCosto, // Valor unitario — costo actual (FR-070); se ignora sin cantidad.
      // La ABREVIATURA, que es lo más corto de escribir y el importador acepta las dos formas
      // (FR-104). Vacía en los productos anteriores a US17: al re-subir el archivo esa fila
      // ACTUALIZA y conserva lo que tenga, así que el catálogo sigue siendo re-subible entero.
      producto.unidadMedida?.abreviatura ?? null,
      producto.stockActual, // Stock actual — informativa, el importador no lee esta columna.
    ]);
  }

  agregarHojaInstrucciones(
    libro,
    [...INSTRUCCIONES_COLUMNAS_CATALOGO, ...INSTRUCCIONES_COLUMNAS_STOCK_CATALOGO],
    NOTA_CATALOGO_INSTRUCCIONES,
  );

  return escribirLibro(libro);
}

function crearLibro(): ExcelJS.Workbook {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Trazo';
  libro.created = new Date();
  return libro;
}

async function escribirLibro(libro: ExcelJS.Workbook): Promise<Buffer> {
  const bufferGenerado = await libro.xlsx.writeBuffer();
  return Buffer.from(bufferGenerado);
}

/** Hoja "Productos" con sus encabezados y sin filas de datos — el punto exacto en el que la
 *  plantilla vacía y el catálogo exportado comparten estructura (mismo nombre de hoja, mismo
 *  orden posicional de columnas), que es lo que permite subir cualquiera de los dos por el
 *  mismo `POST /api/productos/importar`. */
function crearHojaProductos(libro: ExcelJS.Workbook): ExcelJS.Worksheet {
  const hoja = libro.addWorksheet(HOJA_PRODUCTOS_IMPORTACION);
  hoja.columns = ENCABEZADOS_PRODUCTOS_IMPORTACION.map((encabezado) => ({ header: encabezado, width: 24 }));
  hoja.getRow(1).font = { bold: true };
  return hoja;
}

/** Hoja "Instrucciones" con una fila por columna de la hoja "Productos", más —solo en el
 *  catálogo exportado— la `nota` de apertura que advierte sobre las columnas de stock. */
function agregarHojaInstrucciones(
  libro: ExcelJS.Workbook,
  instrucciones: ReadonlyArray<InstruccionColumna>,
  nota?: string,
): void {
  const hoja = libro.addWorksheet('Instrucciones');
  hoja.columns = [
    { header: 'Columna', key: 'columna', width: 22 },
    { header: 'Significado', key: 'significado', width: 90 },
  ];
  hoja.getRow(1).font = { bold: true };

  if (nota) {
    const filaNota = hoja.addRow({ columna: 'ANTES DE EDITAR', significado: nota });
    filaNota.font = { bold: true, color: { argb: 'FFB00020' } };
    filaNota.alignment = { wrapText: true, vertical: 'top' };
  }

  for (const fila of instrucciones) {
    const filaAgregada = hoja.addRow(fila);
    filaAgregada.alignment = { wrapText: true, vertical: 'top' };
  }
}
