/**
 * `crearFiltroArchivoDemasiadoGrande` — fábrica del `ExceptionFilter` que normaliza el
 * `PayloadTooLargeException` de Multer al formato de error del contrato.
 *
 * ## Por qué hace falta
 *
 * Cuando `FileInterceptor` declara `limits.fileSize`, Multer/Busboy CORTAN el stream de subida
 * en cuanto se supera el límite, sin bufferizar el archivo completo en memoria (ese es el punto:
 * fue un hallazgo HIGH real en T095, donde el chequeo de `archivo.size` corría DESPUÉS de que
 * `@UploadedFile()` ya había entregado el `Buffer` entero). `@nestjs/platform-express` traduce
 * ese corte en un `PayloadTooLargeException`, cuyo cuerpo por defecto
 * (`{ statusCode, message, error: 'Payload Too Large' }`) NO es el `{ error: { mensaje, campos } }`
 * del contrato ni está en español, así que no puede dejarse caer en `FiltroErroresDominio`.
 *
 * ## Por qué es una FÁBRICA y no una clase suelta
 *
 * Cada ruta que sube archivos tiene su propio límite y, por tanto, su propio mensaje: 5 MB para
 * la carga masiva de inventario (US8) y 500 KB para el logo del cliente (US11). El mensaje viaja
 * como parámetro para que exista UNA sola implementación del filtro y el usuario siga leyendo el
 * límite exacto de la ruta que usó (FR-016/FR-047: en español y accionable).
 *
 * Se registra SIEMPRE con `@UseFilters(...)` a nivel de MÉTODO, nunca global: solo las rutas de
 * subida deben traducir este error.
 */
import {
  Catch,
  HttpStatus,
  PayloadTooLargeException,
  type ArgumentsHost,
  type ExceptionFilter,
  type Type,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Devuelve un `ExceptionFilter` que responde `400 { error: { mensaje, campos } }` con `mensaje`
 * ante cualquier `PayloadTooLargeException` de la ruta donde se registre.
 *
 * `campos` incluye el error anclado a `campo` cuando se indica, para que el formulario lo pinte
 * junto al selector de archivo en vez de solo como aviso general.
 */
export function crearFiltroArchivoDemasiadoGrande(mensaje: string, campo?: string): Type<ExceptionFilter> {
  @Catch(PayloadTooLargeException)
  class FiltroArchivoDemasiadoGrande implements ExceptionFilter {
    catch(_excepcion: PayloadTooLargeException, host: ArgumentsHost): void {
      const respuesta = host.switchToHttp().getResponse<Response>();
      respuesta.status(HttpStatus.BAD_REQUEST).json({
        error: { mensaje, campos: campo ? { [campo]: mensaje } : null },
      });
    }
  }

  return FiltroArchivoDemasiadoGrande;
}
