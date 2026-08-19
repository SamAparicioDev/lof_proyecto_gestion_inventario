/**
 * Esquemas de ingresos (facturas de compra) — cabecera + líneas de producto (FR-013…FR-019).
 *
 * US29 (FR-126): el ingreso tiene TIPO —`FACTURA` o `AJUSTE`— y qué campos son obligatorios
 * depende de él (ver `camposSegunTipo`). Un ajuste no lleva factura, fecha de factura ni
 * proveedor, y a cambio exige MOTIVO.
 *
 * Implementa: FR-014 (líneas con cantidad y precio unitario, base del cálculo de totales),
 * FR-015 (número de factura obligatorio en los ingresos de factura — la unicidad concurrente la
 * refuerza la BD, esto solo valida la forma), FR-126 (ajuste de inventario), FR-016/FR-047 (validación con mensajes en español que indican el
 * campo y la corrección esperada). La regla "sin producto repetido en dos líneas" vive aquí
 * porque es una regla de FORMA del documento (coincide con el `UNIQUE(ingreso_id,
 * producto_id)` de data-model.md), no una regla de disponibilidad de stock — esa vive en
 * `ServicioStock` (dominio, research R4).
 *
 * `esquemaCrearIngreso` y `esquemaActualizarIngreso` comparten exactamente el mismo shape
 * (contracts/api-rest.md: `PUT /api/ingresos/:id` "mismo esquema" que `POST`) — se generan
 * con la misma función interna para no duplicar las reglas.
 *
 * Sigue el patrón de esquemas/autenticacion.ts (archivo ejemplar).
 */
import { z } from 'zod';
import { esquemaTasaIva } from './impuestos';
import { MENSAJE_CANTIDAD_ENTERA, esquemaIdFiltro, esquemaPaginacion } from './comunes';

/** Línea de factura: producto recibido, cantidad y precio de compra unitario. */
const esquemaLineaIngreso = z.object({
  productoId: z
    .number({ required_error: 'El producto es obligatorio', invalid_type_error: 'El producto es obligatorio' })
    .int('El producto no es válido')
    .positive('El producto no es válido'),
  cantidad: z
    .number({ required_error: 'La cantidad es obligatoria', invalid_type_error: 'La cantidad debe ser un número' })
    // US26 (FR-122): entera. `.int()` va ANTES de `.positive()` para que `2.5` se queje de los
    // decimales y no de otra cosa; `0.5` sí caería en el primero de los dos, y cualquiera de los
    // mensajes es correcto ahí.
    .int(MENSAJE_CANTIDAD_ENTERA)
    .positive('La cantidad debe ser mayor a 0'),
  precioUnitario: z
    .number({
      required_error: 'El precio unitario es obligatorio',
      invalid_type_error: 'El precio unitario debe ser un número',
    })
    .positive('El precio unitario debe ser mayor a 0'),
  /** US20 (FR-109): tasa de IVA de ESTA línea. Opcional con defecto 0 — un documento anterior
   *  a US20, o un cliente que no la envíe, vale exactamente lo que valía. */
  tasaIva: esquemaTasaIva,
});
export type LineaIngreso = z.infer<typeof esquemaLineaIngreso>;

/**
 * Rechaza líneas que referencian el mismo producto más de una vez — el documento solo
 * admite un producto por línea (`UNIQUE(ingreso_id, producto_id)`, data-model.md). El error
 * se ancla a `lineas` para que el formulario lo muestre junto a la tabla de líneas.
 */
function sinProductosRepetidos(lineas: LineaIngreso[], ctx: z.RefinementCtx): void {
  const vistos = new Set<number>();
  const hayRepetidos = lineas.some((linea) => {
    if (vistos.has(linea.productoId)) return true;
    vistos.add(linea.productoId);
    return false;
  });
  if (hayRepetidos) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'No repitas el mismo producto en dos líneas',
      path: ['lineas'],
    });
  }
}

/** Fecha (solo día, sin hora — columnas `DATE` de data-model.md) en texto, formato ISO `YYYY-MM-DD`. */
function esquemaFecha(mensajeObligatoria: string, mensajeInvalida: string) {
  return z
    .string({ required_error: mensajeObligatoria })
    .min(1, mensajeObligatoria)
    .refine((valor) => !Number.isNaN(Date.parse(valor)), mensajeInvalida);
}

/** Los dos tipos de entrada de mercancía (US29, FR-126). */
export const TIPOS_INGRESO = ['FACTURA', 'AJUSTE'] as const;
export type TipoIngreso = (typeof TIPOS_INGRESO)[number];

/** `''` cuenta como ausente: un formulario que cambia de tipo deja atrás el texto que ya se
 *  había escrito, y eso no es "el usuario mandó un número de factura en un ajuste". */
function vacio(valor: string | undefined): boolean {
  return valor === undefined || valor.trim() === '';
}

/**
 * Reglas de FORMA que dependen del TIPO (US29, FR-126).
 *
 * Se resuelven con un `superRefine` sobre un objeto único y no con `z.discriminatedUnion`
 * porque las dos variantes comparten casi todos los campos y difieren solo en cuáles son
 * obligatorios: una unión obligaría a declarar dos objetos casi idénticos —y a mantenerlos
 * sincronizados— y convertiría `DatosCrearIngreso` en un tipo unido que ningún formulario
 * puede manejar con un solo `useForm`.
 *
 * Los campos PROHIBIDOS se rechazan explícitamente en vez de ignorarse: quien envía un
 * `proveedorId` en un ajuste cree estar guardando algo que no se va a guardar, y enterarse al
 * releer el documento es peor que un `400` inmediato. Cada mensaje va anclado a SU campo, para
 * que el formulario lo marque donde está (FR-047).
 */
function camposSegunTipo(
  datos: {
    tipo: TipoIngreso;
    numeroFactura?: string;
    fechaFactura?: string;
    proveedorId?: number;
    ordenCompraId?: number;
    observaciones?: string;
  },
  ctx: z.RefinementCtx,
): void {
  const exigir = (condicion: boolean, path: string, message: string): void => {
    if (condicion) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
  };

  if (datos.tipo === 'FACTURA') {
    exigir(vacio(datos.numeroFactura), 'numeroFactura', 'El número de factura es obligatorio');
    exigir(vacio(datos.fechaFactura), 'fechaFactura', 'La fecha de la factura es obligatoria');
    exigir(datos.proveedorId === undefined, 'proveedorId', 'El proveedor es obligatorio');
    return;
  }

  exigir(!vacio(datos.numeroFactura), 'numeroFactura', 'Un ajuste de inventario no lleva número de factura');
  exigir(!vacio(datos.fechaFactura), 'fechaFactura', 'Un ajuste de inventario no lleva fecha de factura');
  exigir(datos.proveedorId !== undefined, 'proveedorId', 'Un ajuste de inventario no lleva proveedor');
  exigir(datos.ordenCompraId !== undefined, 'ordenCompraId', 'Un ajuste de inventario no surte ninguna orden de compra');
  // El motivo es lo único que justifica un ajuste: sin factura detrás, es la causa registrada
  // que exige la trazabilidad (Principio II / FR-046).
  exigir(vacio(datos.observaciones), 'observaciones', 'El motivo del ajuste es obligatorio');
}

/** Construye el esquema de cabecera+líneas de un ingreso — reutilizado por crear y actualizar. */
function construirEsquemaIngreso() {
  return z
    .object({
      /**
       * US29 (FR-126): `FACTURA` (una compra) o `AJUSTE` (ajuste de inventario). Con defecto,
       * para que un cliente anterior a la historia —o el propio frontend en el caso normal—
       * siga enviando el mismo body de siempre y signifique exactamente lo mismo.
       */
      tipo: z
        .enum(TIPOS_INGRESO, { errorMap: () => ({ message: 'El tipo de ingreso no es válido' }) })
        .default('FACTURA'),
      /**
       * Opcionales EN LA FORMA y obligatorios según el tipo (`camposSegunTipo`): en un ingreso
       * de factura los tres siguen siendo exigibles con los mismos mensajes de siempre; en un
       * ajuste, mandarlos es un error, no un dato de más.
       */
      numeroFactura: z
        .string()
        .trim()
        .max(50, 'El número de factura no puede superar 50 caracteres')
        .optional(),
      fechaFactura: z
        .string()
        .optional()
        .refine((valor) => valor === undefined || valor === '' || !Number.isNaN(Date.parse(valor)), {
          message: 'La fecha de la factura no es válida',
        }),
      /**
       * US15 (FR-091): el proveedor dejó de escribirse y pasó a elegirse del catálogo. En un
       * ingreso de FACTURA es obligatorio —una factura sin saber a quién se le compró no es
       * trazable—; en un AJUSTE no existe, porque no hay a quién comprarle (US29, FR-126).
       */
      proveedorId: z
        .number({ invalid_type_error: 'El proveedor es obligatorio' })
        .int('El proveedor no es válido')
        .positive('El proveedor no es válido')
        .optional(),
      fechaRecepcion: esquemaFecha(
        'La fecha de recepción es obligatoria',
        'La fecha de recepción no es válida',
      ),
      observaciones: z.string().trim().optional(),
      /**
       * US16 (FR-099): la orden de compra que este ingreso surte, si nació de una. Opcional a
       * propósito — registrar un ingreso sin orden previa es como funcionó el sistema hasta
       * esta historia y sigue siendo válido. El servidor comprueba que la orden esté ENVIADA y
       * sea del MISMO proveedor: eso es una regla de negocio, no de forma, y no vive aquí.
       */
      ordenCompraId: z
        .number({ invalid_type_error: 'La orden de compra no es válida' })
        .int('La orden de compra no es válida')
        .positive('La orden de compra no es válida')
        .optional(),
      lineas: z.array(esquemaLineaIngreso).min(1, 'Agrega al menos un producto'),
    })
    .superRefine((datos, ctx) => sinProductosRepetidos(datos.lineas, ctx))
    .superRefine(camposSegunTipo);
}

/** Body de `POST /api/ingresos` (contracts/api-rest.md). */
export const esquemaCrearIngreso = construirEsquemaIngreso();
export type DatosCrearIngreso = z.infer<typeof esquemaCrearIngreso>;

/** Body de `PUT /api/ingresos/:id` — mismo esquema que crear; solo editable en PENDIENTE (US1-AS5). */
export const esquemaActualizarIngreso = construirEsquemaIngreso();
export type DatosActualizarIngreso = z.infer<typeof esquemaActualizarIngreso>;

/**
 * Query de `GET /api/ingresos?buscar=&estado=&desde=&hasta=&proveedorId=` — filtros de listado
 * (FR-018) más la paginación común a todos los listados (`esquemas/comunes.ts`). Las
 * fechas son opcionales aquí (a diferencia de la cabecera del documento): un filtro de
 * rango vacío simplemente no acota la búsqueda.
 *
 * `proveedorId` nació en US13 (FR-075) como subcadena sobre la columna de texto y en US15 pasó
 * a ser una igualdad por id del CATÁLOGO: es lo que exige FR-091 al extender FR-088 (los filtros
 * se alimentan del catálogo) y lo que hace el resultado reproducible — se elige de un selector,
 * así que ya no hay nada que "escribir parecido".
 *
 * NO es redundante con `buscar`, que sigue cruzando `numero_factura` OR el NOMBRE del proveedor
 * y por eso trae también las facturas cuyo NÚMERO contiene "3M". Los dos se combinan con Y
 * lógico, y como vive en `CriteriosIngresos` (backend) también acota la exportación del listado
 * sin trabajo adicional (FR-064/SC-007).
 */
export const esquemaFiltroIngresos = z
  .object({
    buscar: z.string().trim().optional(),
    proveedorId: esquemaIdFiltro('El proveedor no es válido'),
    /** US29 (FR-126): mirar solo las compras, o solo los ajustes. */
    tipo: z
      .enum(TIPOS_INGRESO, { errorMap: () => ({ message: 'El tipo de ingreso no es válido' }) })
      .optional(),
    estado: z.enum(['PENDIENTE', 'RECIBIDO', 'VERIFICADO', 'ANULADO'], {
      errorMap: () => ({ message: 'El estado no es válido' }),
    }).optional(),
    desde: z
      .string()
      .optional()
      .refine((valor) => valor === undefined || !Number.isNaN(Date.parse(valor)), 'La fecha "desde" no es válida'),
    hasta: z
      .string()
      .optional()
      .refine((valor) => valor === undefined || !Number.isNaN(Date.parse(valor)), 'La fecha "hasta" no es válida'),
  })
  .merge(esquemaPaginacion);
export type FiltroIngresos = z.infer<typeof esquemaFiltroIngresos>;

/** Formato de presentación del correlativo de un ajuste — "AJU-000042" (US29, FR-126). El
 *  número es un entero en la base; esto es solo cómo se lee, mismo criterio que
 *  `formatoNumeroOrdenCompra` y `formatoNumeroCotizacion`. */
export function formatoNumeroAjuste(numero: number): string {
  return `AJU-${String(numero).padStart(6, '0')}`;
}
