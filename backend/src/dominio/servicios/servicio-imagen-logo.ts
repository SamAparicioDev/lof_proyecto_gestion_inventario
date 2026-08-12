/**
 * `detectarTipoDeImagenLogo` — servicio de dominio 100% PURO (Principio VI): decide si un
 * conjunto de bytes ES una imagen admitida como logo de cliente, mirando ÚNICAMENTE los bytes.
 * Cero `await`, cero I/O, cero dependencias de framework — mismo criterio que `ServicioStock` y
 * `aplicarCambioDeCosto` (research R10: se prueba con Jest puro, sin levantar nada).
 *
 * ## Por qué se valida por los BYTES y no por la extensión ni por el `Content-Type`
 *
 * En una subida `multipart/form-data`, TANTO el nombre del archivo COMO el `Content-Type` de la
 * parte los escribe el CLIENTE: son datos de entrada, no hechos verificados. Un atacante sube
 * `logo.png` declarando `image/png` y dentro manda cualquier cosa. Lo único que no puede
 * falsificar es el contenido, porque el contenido ES lo que después se sirve. Por eso la única
 * pregunta que responde este servicio es "¿los primeros bytes son los de un PNG o un JPEG
 * real?" (números mágicos del formato, data-model.md § Logo del cliente).
 *
 * ## Por qué SVG se rechaza y además se NOMBRA
 *
 * Un SVG es un documento XML que puede contener `<script>` y manejadores de evento; servirlo
 * desde el mismo origen de la aplicación (`GET /api/clientes/:id/logo`) sería XSS ejecutándose
 * con la sesión del usuario. La lista de PERMITIDOS ya lo deja fuera —basta con que no sea PNG
 * ni JPEG—, así que `detectarInicioDeXml` NO es la defensa: la defensa es el allowlist. Existe
 * solo para poder decirle al usuario "los logos en SVG no se admiten" en vez del genérico "el
 * archivo no es una imagen válida" (FR-016/FR-047: mensajes en español que explican qué
 * corregir); si alguien la borrara, el SVG se seguiría rechazando igual.
 *
 * Implementa: FR-066 (solo imágenes válidas dentro del tamaño máximo — el TAMAÑO lo corta el
 * transporte, ver `FileInterceptor` en `controlador-clientes.ts`; el FORMATO se decide aquí).
 */
import { ErrorValidacionDominio } from '../comunes/errores';
import type { TipoMimeLogo } from '../entidades/cliente';

/** Campo del formulario al que se anclan los errores, para que la ficha del cliente los pinte
 *  junto al selector de archivo (contrato de error: `{ error: { mensaje, campos } }`). */
const CAMPO_LOGO = 'logo';

/** Firma de un PNG: `\x89PNG\r\n\x1a\n` (8 bytes, RFC 2083 § 3.1). */
const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Firma de un JPEG: marcador SOI `FF D8` seguido del primer marcador (`FF`) — JFIF/Exif y
 *  cualquier otra variante empiezan igual (ISO/IEC 10918-1). */
const FIRMA_JPEG = [0xff, 0xd8, 0xff] as const;

/** Bytes mínimos que hay que ver para poder decidir (la firma más larga es la del PNG). */
const BYTES_MINIMOS_PARA_DECIDIR = FIRMA_PNG.length;

/**
 * Devuelve el `TipoMimeLogo` real de `contenido`, o lanza `ErrorValidacionDominio` (→ `400`,
 * contrato) con un mensaje en español que dice exactamente qué pasa con el archivo.
 *
 * Nunca devuelve un tipo "por defecto" ni confía en nada externo a `contenido`: si los bytes no
 * son los de un PNG o un JPEG, el archivo NO se guarda y el logo anterior del cliente queda
 * intacto (US11-AS6) — quien llama simplemente no llega a escribir.
 */
export function detectarTipoDeImagenLogo(contenido: Uint8Array): TipoMimeLogo {
  if (contenido.length === 0) {
    throw new ErrorValidacionDominio('El archivo del logo está vacío.', {
      [CAMPO_LOGO]: 'El archivo del logo está vacío.',
    });
  }

  if (contenido.length >= BYTES_MINIMOS_PARA_DECIDIR) {
    if (empiezaCon(contenido, FIRMA_PNG)) return 'image/png';
    if (empiezaCon(contenido, FIRMA_JPEG)) return 'image/jpeg';
  }

  if (pareceDocumentoXml(contenido)) {
    throw new ErrorValidacionDominio(
      'Los logos en formato SVG no se admiten por seguridad. Sube el logo en PNG o JPEG.',
      { [CAMPO_LOGO]: 'Los logos en formato SVG no se admiten. Usa PNG o JPEG.' },
    );
  }

  throw new ErrorValidacionDominio('El archivo no es una imagen PNG o JPEG válida.', {
    [CAMPO_LOGO]: 'El archivo no es una imagen PNG o JPEG válida.',
  });
}

/** ¿`contenido` empieza EXACTAMENTE con esta secuencia de bytes? */
function empiezaCon(contenido: Uint8Array, firma: readonly number[]): boolean {
  return firma.every((byte, indice) => contenido[indice] === byte);
}

/** Caracteres que un archivo XML/SVG puede llevar delante del primer `<` (BOM UTF-8, espacios,
 *  tabuladores y saltos de línea) — se saltan antes de mirar el primer carácter real. */
const BYTES_IGNORABLES_ANTES_DEL_XML = new Set([0xef, 0xbb, 0xbf, 0x20, 0x09, 0x0a, 0x0d]);

/** Bytes que se inspeccionan buscando el inicio de un documento XML — un prólogo con espacios
 *  o comentarios cabe de sobra; más allá de eso el archivo no es un SVG "normal" y cae en el
 *  mensaje genérico, que sigue siendo un rechazo (ver TSDoc de cabecera). */
const BYTES_A_INSPECCIONAR_PARA_XML = 512;

/**
 * ¿Los primeros bytes parecen el inicio de un documento XML (`<?xml`, `<svg`, `<!DOCTYPE`)?
 * SOLO decide el MENSAJE de error, nunca si el archivo se acepta (ver TSDoc de cabecera).
 */
function pareceDocumentoXml(contenido: Uint8Array): boolean {
  let inicio = 0;
  while (inicio < contenido.length && BYTES_IGNORABLES_ANTES_DEL_XML.has(contenido[inicio] as number)) {
    inicio += 1;
  }
  if (contenido[inicio] !== 0x3c) return false; // '<'

  const textoInicial = String.fromCharCode(
    ...contenido.subarray(inicio, inicio + BYTES_A_INSPECCIONAR_PARA_XML),
  ).toLowerCase();
  return textoInicial.startsWith('<?xml') || textoInicial.startsWith('<svg') || textoInicial.startsWith('<!doctype');
}
