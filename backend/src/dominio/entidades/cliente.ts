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
}

/**
 * Tipos de imagen admitidos como logotipo (data-model.md, `backend/assets/marca/LEEME.md`).
 *
 * Vive aquí por herencia del logo por cliente que US11 introdujo y el 2026-08-15 se retiró
 * (FR-066). Hoy su único consumidor es el LOGOTIPO INSTITUCIONAL, que valida sus bytes con el
 * mismo servicio de dominio (`servicio-imagen-logo.ts`). NUNCA SVG: es XML capaz de contener
 * scripts, y se sirve desde el mismo origen que la aplicación.
 */
export type TipoMimeLogo = 'image/png' | 'image/jpeg';

