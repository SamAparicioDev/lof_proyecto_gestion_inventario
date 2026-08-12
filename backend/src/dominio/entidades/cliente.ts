/**
 * Entidad de dominio `Cliente` — TypeScript puro (Principio VI, NO NEGOCIABLE).
 *
 * Campos espejo de la tabla `clientes` de `data-model.md`, pero como tipo PROPIO del
 * dominio: no importa el modelo/enum generado por Prisma (docs/arquitectura.md §2, regla
 * de dependencia). El adaptador
 * `infraestructura/persistencia/repositorio-clientes.prisma.ts` traduce explícitamente
 * entre el registro Prisma y esta forma.
 *
 * `estado` es el otro insumo (junto al `estado` de `Proyecto`) de la regla de "destino
 * válido de salida" (FR-038) definida como función pura en `entidades/proyecto.ts`.
 *
 * Implementa: FR-034 (registro de cliente con datos de contacto), FR-035 (NIT único —
 * reforzado por la BD y traducido a `Duplicado` en el adaptador) y FR-038 (el cliente debe
 * estar ACTIVO para que cualquiera de sus proyectos sea destino válido de una salida).
 */

/** Estado de un cliente — INACTIVO es baja lógica, nunca se elimina (Principio II/III). */
export type EstadoCliente = 'ACTIVO' | 'INACTIVO';

export interface Cliente {
  readonly id: number;
  readonly nombre: string;
  readonly nit: string;
  readonly telefono: string | null;
  readonly email: string | null;
  readonly direccion: string | null;
  readonly ciudad: string | null;
  readonly fechaRegistro: Date;
  readonly estado: EstadoCliente;
  /**
   * ¿El cliente tiene un logo cargado? (US11, FR-066). Es un BOOLEANO, no los bytes: la
   * entidad viaja en todo listado y toda ficha, y arrastrar hasta 500 KB de imagen en cada
   * fila del JSON sería absurdo. Los bytes se leen aparte, solo cuando se van a usar
   * (`RepositorioClientes.obtenerLogo`, que alimenta tanto `GET /api/clientes/:id/logo` como
   * el logo embebido en un documento exportado).
   */
  readonly tieneLogo: boolean;
}

/**
 * Tipos de imagen admitidos como logo (US11, FR-066, data-model.md § Logo del cliente).
 *
 * PNG y JPEG y NADA MÁS — en particular, NUNCA SVG: un SVG es un documento XML que puede
 * contener scripts, y servirlo desde el mismo origen de la aplicación sería una vía de XSS.
 * Es una lista de PERMITIDOS (no de prohibidos) a propósito: un formato futuro tiene que
 * agregarse aquí explícitamente, nunca colarse por omisión.
 */
export type TipoMimeLogo = 'image/png' | 'image/jpeg';

/** Logo de un cliente ya leído de la persistencia: los bytes y el tipo con el que se sirven.
 *  `Uint8Array` (no `Buffer`) porque el dominio es TypeScript puro y no conoce Node
 *  (Principio VI) — `Buffer` es asignable a `Uint8Array`, así que el adaptador y la capa HTTP
 *  siguen trabajando con el tipo que les resulta natural. */
export interface LogoCliente {
  readonly contenido: Uint8Array;
  readonly tipoMime: TipoMimeLogo;
}
