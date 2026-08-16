/**
 * Unidad de medida de un producto — catálogo administrable (US17, FR-101…FR-105).
 *
 * Hasta US17 una cantidad del inventario era un número desnudo: "12" no decía si eran 12 sacos,
 * 12 kilos o 12 toneladas, y esa ambigüedad viajaba a los documentos que salen del sistema.
 * Esta entidad le pone nombre a lo que se cuenta.
 *
 * Tercera del patrón que abrieron `Categoria` y `Proveedor`, con una diferencia propia: tiene
 * DOS textos y los dos son únicos. El `nombre` ("Kilogramo") es lo que se lee en un formulario;
 * la `abreviatura` ("kg") es lo que cabe junto a una cantidad en una celda de tabla, que es
 * justo donde la unidad hace falta. Dos unidades con la misma abreviatura serían indistinguibles
 * exactamente ahí, así que la unicidad se exige por separado en cada campo.
 *
 * TypeScript puro: sin NestJS, sin Prisma, sin Zod (regla de dependencia, docs/arquitectura.md).
 */

export type EstadoUnidadMedida = 'ACTIVA' | 'INACTIVA';

export interface UnidadMedida {
  readonly id: number;
  readonly nombre: string;
  readonly abreviatura: string;
  readonly estado: EstadoUnidadMedida;
}

/** Unidad con el número de productos que la usan — lo que necesita la pantalla de administración
 *  para explicar por qué una unidad no se puede eliminar (FR-101 → FR-087). */
export interface UnidadMedidaConUso extends UnidadMedida {
  readonly cantidadProductos: number;
}

/**
 * Forma con la que se COMPARAN nombres y abreviaturas (FR-101).
 *
 * La misma función para los dos campos: son dos unicidades independientes pero el criterio es
 * idéntico. Normaliza mayúsculas y espacios, NO tildes — igual que en categorías y proveedores,
 * y por el mismo motivo: quitar tildes exigiría `unaccent` en PostgreSQL para que los índices
 * funcionales pudieran hacer lo mismo, y una normalización que la base de datos no pueda
 * replicar sería peor que ninguna.
 *
 * Debe coincidir exactamente con los índices `lower(btrim(nombre))` y
 * `lower(btrim(abreviatura))`, que son la red final.
 */
export function normalizarTextoUnidadMedida(valor: string): string {
  return valor.trim().toLocaleLowerCase('es');
}

/** Una unidad solo se ofrece para productos nuevos si está activa. Un producto YA medido con una
 *  inactiva la conserva: esta función decide qué se ofrece, no qué se conserva (mismo criterio
 *  que `puedeClasificar` en categorías). */
export function puedeMedirProductos(unidad: UnidadMedida): boolean {
  return unidad.estado === 'ACTIVA';
}

/** Cómo se muestra una cantidad acompañada de su unidad (FR-105): `12 kg`.
 *
 *  Vive en el dominio y no en cada pantalla porque el backend también la necesita —los
 *  documentos exportados imprimen cantidades— y dos implementaciones del mismo formato
 *  acabarían divergiendo. Sin unidad devuelve la cantidad sola: un producto anterior a US17
 *  sigue mostrándose con normalidad (FR-103). */
export function formatoCantidadConUnidad(cantidad: number, unidad: Pick<UnidadMedida, 'abreviatura'> | null): string {
  return unidad ? `${cantidad} ${unidad.abreviatura}` : String(cantidad);
}
