/**
 * Esquemas de salidas (entrega de mercancía a cliente/proyecto) — cabecera + líneas de
 * producto (FR-025…FR-033).
 *
 * Implementa: FR-027 y FR-124 (destino obligatorio: `clienteId` — el mensaje es EXACTO "El
 * cliente es obligatorio" para toda forma de dato inválido, US3-AS3 llevado al campo que desde
 * US28 es el obligatorio; `proyectoId` es opcional), FR-016/FR-047 (mensajes en español que
 * indican el campo). La regla
 * "sin producto repetido en dos líneas" vive aquí porque es una regla de FORMA del
 * documento (coincide con `UNIQUE(salida_id, producto_id)` de data-model.md), no una regla
 * de disponibilidad de stock — esa vive en `ServicioStock` (dominio, research R4).
 *
 * A diferencia de `esquemas/ingresos.ts`, `precioUnitario` admite 0 (es un precio de
 * REFERENCIA editable — data-model.md § detalles_salidas: `CHECK precio_unitario >= 0`, no
 * `> 0` como en `detalles_ingresos`).
 *
 * `esquemaCrearSalida` y `esquemaActualizarSalida` comparten exactamente el mismo shape
 * (contracts/api-rest.md: `PUT /api/salidas/:id` "mismo esquema" que `POST`) — se generan
 * con la misma función interna para no duplicar las reglas (patrón de `esquemas/ingresos.ts`).
 */
import { z } from 'zod';
import { esquemaTasaIva } from './impuestos';
import { MENSAJE_CANTIDAD_ENTERA, esquemaIdFiltro, esquemaPaginacion } from './comunes';
import { esquemaFormatoExport } from './reportes';

/** Línea de salida: producto entregado, cantidad y precio unitario de referencia. */
const esquemaLineaSalida = z.object({
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
    .min(0, 'El precio unitario no puede ser negativo'),
  /** US20 (FR-109): tasa de IVA de ESTA línea. Opcional con defecto 0 — un documento anterior
   *  a US20, o un cliente que no la envíe, vale exactamente lo que valía. */
  tasaIva: esquemaTasaIva,
});
export type LineaSalida = z.infer<typeof esquemaLineaSalida>;

/**
 * Rechaza líneas que referencian el mismo producto más de una vez — el documento solo
 * admite un producto por línea (`UNIQUE(salida_id, producto_id)`, data-model.md). El error
 * se ancla a `lineas` para que el formulario lo muestre junto a la tabla de líneas.
 */
function sinProductosRepetidos(lineas: LineaSalida[], ctx: z.RefinementCtx): void {
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

/**
 * `clienteId` obligatorio con el MISMO mensaje exacto sin importar la forma del error (ausente,
 * texto, cero, negativo o decimal) — US3-AS3 exigía un único mensaje reconocible, y desde US28
 * (FR-124) el campo que lo lleva es el cliente, no el proyecto.
 */
const MENSAJE_CLIENTE_OBLIGATORIO = 'El cliente es obligatorio';

/** Construye el esquema de cabecera+líneas de una salida — reutilizado por crear y actualizar. */
function construirEsquemaSalida() {
  return z
    .object({
      clienteId: z
        .number({
          required_error: MENSAJE_CLIENTE_OBLIGATORIO,
          invalid_type_error: MENSAJE_CLIENTE_OBLIGATORIO,
        })
        .int(MENSAJE_CLIENTE_OBLIGATORIO)
        .positive(MENSAJE_CLIENTE_OBLIGATORIO),
      /**
       * US28 (FR-124): opcional. `null` y ausente significan lo mismo — "esta entrega no es de
       * una obra concreta"— y se admiten los dos porque un formulario que limpia un selector
       * envía `null`, mientras que un cliente de API sencillamente omite el campo.
       *
       * Que el proyecto sea DE ESE cliente y esté activo es una regla de negocio contra la base
       * de datos (FR-038), no de forma: vive en `validar-destino-salida.ts`, no aquí.
       */
      proyectoId: z
        .number({ invalid_type_error: 'El proyecto no es válido' })
        .int('El proyecto no es válido')
        .positive('El proyecto no es válido')
        .nullable()
        .optional(),
      fechaSalida: esquemaFecha('La fecha de salida es obligatoria', 'La fecha de salida no es válida'),
      observaciones: z.string().trim().optional(),
      lineas: z.array(esquemaLineaSalida).min(1, 'Agrega al menos un producto'),
    })
    .superRefine((datos, ctx) => sinProductosRepetidos(datos.lineas, ctx));
}

/** Body de `POST /api/salidas` (contracts/api-rest.md). */
export const esquemaCrearSalida = construirEsquemaSalida();
export type DatosCrearSalida = z.infer<typeof esquemaCrearSalida>;

/** Body de `PUT /api/salidas/:id` — mismo esquema que crear; solo editable en PENDIENTE. */
export const esquemaActualizarSalida = construirEsquemaSalida();
export type DatosActualizarSalida = z.infer<typeof esquemaActualizarSalida>;

/**
 * Query de `GET /api/salidas?clienteId=&proyectoId=&estado=&desde=&hasta=` — filtros del
 * listado (FR-033) más la paginación común a todos los listados (`esquemas/comunes.ts`),
 * mismo patrón que `esquemaFiltroIngresos`. `clienteId`/`proyectoId` llegan como texto de
 * query string (`?clienteId=3`), por eso se coercionan a número igual que la paginación —
 * `clienteId` NO es una columna de `salidas` (el adaptador lo traduce a un filtro sobre
 * `proyecto.clienteId`, ver TSDoc de `FiltrosListarSalidas` en el backend), pero para el
 * frontend es un parámetro de query como cualquier otro.
 *
 * Filtros agregados en US13 (FR-075):
 * - `numero`: el correlativo de NEGOCIO de la salida (FR-026), no el `id` técnico — es el número
 *   que el usuario tiene escrito en el papel que sostiene. Un número inexistente devuelve una
 *   página vacía, no un `404`: sigue siendo un listado filtrado.
 * - `usuarioAutorizaId`: quién autorizó la salida (FR-030). Las PENDIENTE no tienen autorizante,
 *   así que nunca aparecen bajo este filtro — es la semántica correcta de "qué autorizó esta
 *   persona", no una omisión.
 */
export const esquemaFiltroSalidas = z
  .object({
    numero: esquemaIdFiltro('El número de salida no es válido'),
    usuarioAutorizaId: esquemaIdFiltro('El usuario que autoriza no es válido'),
    clienteId: z.coerce
      .number({ invalid_type_error: 'El cliente no es válido' })
      .int('El cliente no es válido')
      .positive('El cliente no es válido')
      .optional(),
    proyectoId: z.coerce
      .number({ invalid_type_error: 'El proyecto no es válido' })
      .int('El proyecto no es válido')
      .positive('El proyecto no es válido')
      .optional(),
    estado: z
      .enum(['PENDIENTE', 'CONFIRMADA', 'COMPLETADA', 'ANULADA'], {
        errorMap: () => ({ message: 'El estado no es válido' }),
      })
      .optional(),
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
export type FiltroSalidas = z.infer<typeof esquemaFiltroSalidas>;

/**
 * Query de `GET /api/salidas/:id/export` (US27, FR-123) — el ÚNICO `/export` del sistema con
 * parámetros propios, porque su archivo no es un informe sino el soporte de una entrega que
 * alguien firma en papel.
 *
 * NO extiende `esquemaFiltroSalidas`: `valores` y `recibe` no son filtros. No deciden QUÉ filas
 * salen —eso lo fija el `:id` de la ruta— sino cómo se presentan, así que mezclarlos con los
 * criterios del listado (que sí viajan a `CriteriosSalidas` y acotan datos) confundiría dos
 * cosas distintas. Por eso parte de `esquemaFormatoExport`, que es lo único que sí comparte con
 * el resto de exportaciones.
 *
 * `recibe` es obligatorio en AMBAS variantes: un comprobante de entrega que no dice quién
 * recibió no comprueba nada. Se recorta y se limita a 120 caracteres — va impreso en una línea
 * bajo la firma, no es un campo de observaciones.
 */
export const esquemaExportDocumentoSalida = esquemaFormatoExport.extend({
  // Un solo `errorMap` y no `required_error`: Zod no admite las dos formas a la vez, y el mapa
  // ya cubre los dos casos (ausente y valor desconocido) con el mismo texto.
  valores: z.enum(['con', 'sin'], {
    errorMap: () => ({ message: 'Indica si el documento va con o sin valores' }),
  }),
  recibe: z
    .string({ required_error: 'El nombre de quien recibe es obligatorio' })
    .trim()
    .min(1, 'El nombre de quien recibe es obligatorio')
    .max(120, 'El nombre de quien recibe no puede superar 120 caracteres'),
});
export type ExportDocumentoSalida = z.infer<typeof esquemaExportDocumentoSalida>;
