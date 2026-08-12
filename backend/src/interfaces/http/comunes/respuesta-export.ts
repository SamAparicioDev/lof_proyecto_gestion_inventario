/**
 * Plomería HTTP compartida por TODOS los endpoints `/export` del sistema: elegir la estrategia
 * de `ExportadorReporte` según el query param `formato` (patrón Strategy, research R8), generar
 * el archivo y fijar los headers de descarga del contrato.
 *
 * Existe como módulo propio desde US11/T120: hasta esta tanda solo `controlador-reportes.ts`
 * exportaba (4 rutas) y esta lógica era un método privado suyo; ahora son OCHO rutas repartidas
 * en tres controladores, y el patrón exacto de `Content-Type`/`Content-Disposition` tiene que
 * ser el MISMO en todas — el frontend lee el nombre del archivo de ese header
 * (`lib/api/reportes.ts#nombreDesdeContentDisposition`).
 *
 * Sigue el criterio ya establecido en `controlador-reportes.ts`: la única razón para usar
 * `@Res({ passthrough: true })` es fijar headers que dependen del QUERY (`formato`), algo que
 * `@Header(...)` no puede hacer por ser declarativo.
 */
import { StreamableFile } from '@nestjs/common';
import type { FormatoExport } from '@trazo/compartido';
import type { Response } from 'express';
import type { DocumentoReporte, ExportadorReporte } from '../../../aplicacion/reportes/puertos/exportador-reporte';

/** `Content-Type` por formato de exportación (contracts/api-rest.md § Reportes). */
const CONTENT_TYPE_POR_FORMATO: Record<FormatoExport['formato'], string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** Las dos estrategias registradas por `ExportacionModule`, tal como las inyecta cada
 *  controlador que exporta. */
export interface EstrategiasDeExportacion {
  readonly excel: ExportadorReporte;
  readonly pdf: ExportadorReporte;
}

/**
 * Genera el archivo con la estrategia que corresponde a `formato` y devuelve el
 * `StreamableFile` con los headers de descarga ya fijados:
 * `Content-Disposition: attachment; filename="<nombreBase>.<formato>"` (más `filename*` cuando
 * el nombre no es ASCII — ver `cabeceraDeDescarga`).
 *
 * `nombreBase` llega COMPLETO (sin extensión) porque cada endpoint lo compone distinto según
 * el contrato: `inventario-2026-08-12` para un reporte, `ingreso-FAC-001` para un documento
 * individual. La extensión es siempre el propio `formato`.
 */
export async function responderConArchivoExportado(
  documento: DocumentoReporte,
  formato: FormatoExport['formato'],
  nombreBase: string,
  estrategias: EstrategiasDeExportacion,
  respuesta: Response,
): Promise<StreamableFile> {
  const exportador = formato === 'xlsx' ? estrategias.excel : estrategias.pdf;
  const buffer = await exportador.generar(documento);
  respuesta.set({
    'Content-Type': CONTENT_TYPE_POR_FORMATO[formato],
    'Content-Disposition': cabeceraDeDescarga(nombreBase, formato),
  });
  return new StreamableFile(buffer);
}

/**
 * Caracteres que NO pueden viajar en el `filename` de un `Content-Disposition`: comillas
 * dobles (cierran el valor del parámetro), retornos de carro y saltos de línea (permitirían
 * inyectar cabeceras HTTP adicionales), y las barras de ruta.
 *
 * Importa porque parte del nombre viene de DATOS DEL USUARIO: el `numeroFactura` de un ingreso
 * es texto libre de 50 caracteres (`esquemaCrearIngreso`), así que una factura llamada
 * `A"/../x` no puede convertirse en un header malformado. Se reemplazan por `-` en vez de
 * rechazar: el nombre del archivo es una comodidad, nunca un motivo para no entregar el
 * documento.
 */
const CARACTERES_INVALIDOS_EN_NOMBRE_ARCHIVO = /["\\/\r\n\t]+/g;

/**
 * Todo lo que NO es ASCII imprimible (espacio … `~`). Node RECHAZA cualquier code point fuera de
 * Latin-1 en el contenido de una cabecera (`TypeError [ERR_INVALID_CHAR]`), y lo que sí es
 * Latin-1 pero no ASCII (`Ñ`, `º`) llega mal a los navegadores, porque `filename=` solo está
 * definido sobre ASCII. Se sustituye una RACHA completa por un solo `-` para que un emoji (dos
 * unidades de código) no deje dos guiones.
 */
const CARACTERES_NO_ASCII = /[^\x20-\x7E]+/g;

/** Marcas diacríticas combinantes que deja `normalize('NFD')` al separar `Ñ` en `N` + tilde. */
const MARCAS_DIACRITICAS = /[\u0300-\u036f]/g;

/**
 * Caracteres que `encodeURIComponent` deja pasar pero NO son `attr-char` de RFC 5987 (`'`, `(`,
 * `)`, `*`) — hay que porcentar-codificarlos a mano para que `filename*` sea válido.
 */
const NO_PERMITIDOS_EN_RFC5987 = /['()*]/g;

/**
 * Valor completo del `Content-Disposition` de una descarga (RFC 6266).
 *
 * Parte del nombre son DATOS DEL USUARIO (`ingreso-<numeroFactura>`, `esquemaCrearIngreso` acepta
 * 50 caracteres de texto libre sin restricción de juego de caracteres), así que puede traer
 * cualquier code point: un guion largo `–` o una comilla tipográfica `’` —los que Word/Excel
 * insertan solos al pegar— o directamente `Ω`/`中文`/un emoji. Node rechaza todo lo que esté
 * fuera de Latin-1 en una cabecera, así que fijarlo tal cual reventaba con un `500` genérico y el
 * documento NO se podía exportar en ningún formato (FR-065 incumplido para ese registro, y
 * respuesta fuera del contrato de errores). El nombre del archivo es una comodidad: nunca puede
 * ser el motivo por el que no se entrega el documento.
 *
 * Por eso se emiten los DOS parámetros que define RFC 6266, en este orden:
 *   1. `filename="..."` con el nombre transliterado a ASCII — el respaldo que entiende cualquier
 *      cliente (incluido el `fetch` + `Blob` del frontend, `lib/api/reportes.ts`).
 *   2. `filename*=UTF-8''...` con el nombre REAL porcentar-codificado, que los navegadores
 *      prefieren sobre el anterior — así el usuario recibe `ingreso-REV-Ω-2026.pdf` de verdad.
 *
 * El segundo parámetro se añade SOLO cuando el nombre pierde algo al pasar a ASCII: con un nombre
 * ya ASCII (el caso normal: `ingresos-<fecha>`, `salida-<numero>`, `ingreso-FAC-001`) la cabecera
 * queda byte a byte como antes de esta corrección.
 */
function cabeceraDeDescarga(nombreBase: string, formato: FormatoExport['formato']): string {
  const saneado = nombreArchivoSeguro(nombreBase);
  const nombre = `${saneado}.${formato}`;
  const nombreAscii = `${transliterarAAscii(saneado)}.${formato}`;
  const cabecera = `attachment; filename="${nombreAscii}"`;
  return nombreAscii === nombre ? cabecera : `${cabecera}; filename*=UTF-8''${porcentarCodificar(nombre)}`;
}

/** Nombre de archivo saneado para el header — ver `CARACTERES_INVALIDOS_EN_NOMBRE_ARCHIVO`. */
function nombreArchivoSeguro(nombreBase: string): string {
  const limpio = nombreBase.replace(CARACTERES_INVALIDOS_EN_NOMBRE_ARCHIVO, '-').trim();
  return limpio || 'documento';
}

/** Respaldo ASCII del nombre: conserva las letras acentuadas como su letra base (`Ñ` → `N`) y
 *  reduce a `-` lo que no tiene equivalente (`Ω`, `–`, `中文`, emojis). */
function transliterarAAscii(nombre: string): string {
  const ascii = nombre.normalize('NFD').replace(MARCAS_DIACRITICAS, '').replace(CARACTERES_NO_ASCII, '-').trim();
  return ascii || 'documento';
}

/** Porcentar-codificación del valor de `filename*` (RFC 5987), en UTF-8. */
function porcentarCodificar(nombre: string): string {
  return encodeURIComponent(nombre).replace(
    NO_PERMITIDOS_EN_RFC5987,
    (caracter) => `%${caracter.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Fecha de hoy en texto `AAAA-MM-DD` para los nombres de archivo de LISTADOS y reportes
 *  (contracts/api-rest.md: patrón `<listado>-<fecha>.<ext>`). Los documentos individuales usan
 *  su propio número en vez de la fecha, porque identifican a un documento concreto. */
export function fechaHoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}
