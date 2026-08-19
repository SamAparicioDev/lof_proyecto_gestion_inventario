/**
 * Esquemas Zod reutilizables entre módulos — hoy solo paginación, porque
 * `contracts/api-rest.md` fija el MISMO contrato (`pagina`/`porPagina`, con los mismos
 * límites y valores por defecto) para TODOS los listados de la API. Centralizarlo aquí
 * evita repetir los mismos límites y mensajes en cada archivo de filtros (ingresos,
 * clientes, salidas, inventario, reportes…).
 *
 * Implementa: la paginación obligatoria de listados (Restricciones adicionales de la
 * constitución) y FR-016/FR-047 (mensajes de validación en español).
 */
import { z } from 'zod';

/**
 * Mensaje ÚNICO de "esta cantidad no admite decimales" (US26, FR-122).
 *
 * Vive aquí y no en cada archivo de documento porque los cuatro documentos —ingreso, salida,
 * orden de compra y cotización— validan exactamente la misma regla, y un mensaje que se escribe
 * cinco veces termina diciendo cinco cosas parecidas. Es el mismo criterio por el que la
 * paginación de todos los listados se define una sola vez debajo.
 *
 * La regla es sobre UNIDADES, no sobre dinero: los precios siguen admitiendo dos decimales.
 */
export const MENSAJE_CANTIDAD_ENTERA = 'La cantidad debe ser un número entero, sin decimales';

/** Límite superior de `porPagina` — listados sin límite práctico degradan el rendimiento. */
export const POR_PAGINA_MAXIMA = 100;

/** Tamaño de página por defecto cuando el cliente no lo especifica. */
export const POR_PAGINA_POR_DEFECTO = 20;

/**
 * `pagina`/`porPagina` de query string: llegan como texto (`?pagina=2`), por eso se
 * coercionan a número antes de validar los límites del contrato.
 */
export const esquemaPaginacion = z.object({
  pagina: z.coerce
    .number({ invalid_type_error: 'La página debe ser un número' })
    .int('La página debe ser un número entero')
    .min(1, 'La página debe ser mayor o igual a 1')
    .optional()
    .default(1),
  porPagina: z.coerce
    .number({ invalid_type_error: 'El tamaño de página debe ser un número' })
    .int('El tamaño de página debe ser un número entero')
    .min(1, 'El tamaño de página debe ser mayor o igual a 1')
    .max(POR_PAGINA_MAXIMA, `El tamaño de página no puede superar ${POR_PAGINA_MAXIMA}`)
    .optional()
    .default(POR_PAGINA_POR_DEFECTO),
});
export type DatosPaginacion = z.infer<typeof esquemaPaginacion>;

/**
 * Trata como AUSENTE un valor de query string vacío antes de aplicar `esquema` (US13/T130).
 *
 * Por qué existe: los filtros de los listados son `<form method="GET">` nativos, y un HTML form
 * envía SIEMPRE todos sus campos, también los que el usuario dejó en blanco
 * (`/inventario?disponibleMin=&disponibleMax=`). Con `z.coerce.number()` a secas, `''` se
 * convierte en `0` — y "disponible máximo 0" no devuelve nada, mientras que "mínimo 0" se
 * pintaría como un filtro activo que en realidad no filtra. Un campo en blanco significa "no
 * filtres por esto", nunca "filtra por cero".
 *
 * No se aplicó retroactivamente a `clienteId`/`proyectoId` de `esquemaFiltroSalidas` (que con
 * `?clienteId=` responden `400`): esas páginas omiten los parámetros vacíos al construir la
 * query desde T053, así que el caso no ocurre y cambiarlo solo alteraría un comportamiento ya
 * probado sin ningún consumidor que lo pida (Principio V).
 */
function tratandoVacioComoAusente<T extends z.ZodTypeAny>(esquema: T) {
  return z.preprocess((valor) => (valor === '' || valor === null ? undefined : valor), esquema.optional());
}

/**
 * Cantidad OPCIONAL (≥ 0, decimales admitidos) de un filtro de query string — p. ej. el rango
 * de disponible del inventario (`disponibleMin`/`disponibleMax`, US13/FR-077).
 */
export function esquemaCantidadFiltro(mensajeInvalida: string, mensajeNegativa: string) {
  return tratandoVacioComoAusente(
    z.coerce.number({ invalid_type_error: mensajeInvalida }).min(0, mensajeNegativa),
  );
}

/**
 * Identificador OPCIONAL (entero positivo) de un filtro de query string — p. ej. `rolId` del
 * listado de usuarios o `usuarioAutorizaId` del de salidas (US13/FR-075). El mismo mensaje para
 * toda forma inválida: quien filtra elige de un selector, así que no hay nada que corregir campo
 * a campo, solo un valor que no corresponde a ningún registro.
 */
export function esquemaIdFiltro(mensajeInvalido: string) {
  return tratandoVacioComoAusente(
    z.coerce.number({ invalid_type_error: mensajeInvalido }).int(mensajeInvalido).positive(mensajeInvalido),
  );
}

/**
 * Texto libre OPCIONAL de un filtro de query string (categoría, ubicación, ciudad, proveedor —
 * US13/FR-075). Normaliza el campo en blanco a "no filtrar" para que el adaptador no tenga que
 * distinguir `''` de ausente en cada `where`.
 */
export function esquemaTextoFiltro() {
  return z
    .string()
    .trim()
    .optional()
    .transform((valor) => (valor === '' ? undefined : valor));
}

/**
 * Body `{motivo}` de los tres endpoints de anulación/cancelación
 * (`POST /api/ingresos/:id/anular`, `POST /api/salidas/:id/cancelar`,
 * `POST /api/salidas/:id/anular` — contracts/api-rest.md). Antes estos tres controladores
 * leían el campo con `@Body('motivo')` SIN pipe de validación (el contrato no le nombraba un
 * esquema propio); un `motivo` no-string en el JSON del body (número, arreglo, objeto) llegaba
 * intacto hasta el caso de uso, donde `entrada.motivo.trim()` lanzaba un `TypeError` no
 * tipado — el filtro global lo traducía en un `500` genérico en vez del `400` de campo que
 * exige la constitución (Principio IV; hallazgo de auditoría T088, 2026-08-11).
 *
 * El requisito de NO estar vacío ("El motivo de anulación/cancelación es obligatorio") sigue
 * viviendo en cada caso de uso (`AnularIngresoCasoUso`/`CancelarSalidaCasoUso`/
 * `AnularSalidaCasoUso`) — es una regla de negocio con su propio mensaje según la operación,
 * no de forma; este esquema solo garantiza que, si el campo llega, sea texto (o esté ausente,
 * que el caso de uso trata igual que texto vacío).
 */
export const esquemaMotivo = z.object({
  motivo: z.string({ invalid_type_error: 'El motivo debe ser un texto' }).optional(),
});
export type DatosMotivo = z.infer<typeof esquemaMotivo>;
