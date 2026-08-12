/**
 * Filtro global de excepciones — traduce errores a la respuesta ÚNICA del contrato:
 *   { error: { mensaje: string, campos: Record<string,string> | null } }
 *
 * Es la frontera entre el mundo del dominio (errores tipados, sin HTTP) y el mundo REST
 * (códigos de estado). Gracias a este filtro, NINGÚN controlador maneja errores a mano:
 * los casos de uso lanzan errores de dominio y aquí se convierten en la respuesta en
 * español que el frontend sabe pintar (contracts/api-rest.md; FR-016/FR-047).
 *
 * Mapa de traducción:
 *   ErrorValidacionDominio → 400 · Duplicado → 400 (con campo) · NoEncontrado → 404
 *   EstadoInvalido / DisponibilidadInsuficiente → 409 · HttpException de Nest → su código
 *   Cualquier otro error → 500 con mensaje genérico (el detalle interno NUNCA se filtra
 *   al cliente; queda en el log del servidor).
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import {
  DisponibilidadInsuficiente,
  Duplicado,
  ErrorDominio,
  ErrorValidacionDominio,
  EstadoInvalido,
  NoEncontrado,
} from '../../../dominio/comunes/errores';

interface CuerpoError {
  error: { mensaje: string; campos: Record<string, string> | null };
}

@Catch()
export class FiltroErroresDominio implements ExceptionFilter {
  private readonly logger = new Logger(FiltroErroresDominio.name);

  catch(excepcion: unknown, host: ArgumentsHost): void {
    const respuesta = host.switchToHttp().getResponse<Response>();
    const { codigo, cuerpo } = this.traducir(excepcion);
    respuesta.status(codigo).json(cuerpo);
  }

  private traducir(excepcion: unknown): { codigo: number; cuerpo: CuerpoError } {
    if (excepcion instanceof ErrorValidacionDominio) {
      return this.cuerpo(HttpStatus.BAD_REQUEST, excepcion.message, excepcion.campos);
    }
    if (excepcion instanceof Duplicado) {
      return this.cuerpo(HttpStatus.BAD_REQUEST, excepcion.message, {
        [excepcion.campo]: excepcion.message,
      });
    }
    if (excepcion instanceof NoEncontrado) {
      return this.cuerpo(HttpStatus.NOT_FOUND, excepcion.message, null);
    }
    if (excepcion instanceof EstadoInvalido || excepcion instanceof DisponibilidadInsuficiente) {
      return this.cuerpo(HttpStatus.CONFLICT, excepcion.message, null);
    }
    if (excepcion instanceof ErrorDominio) {
      // Red de seguridad para futuros errores de dominio sin mapeo explícito.
      return this.cuerpo(HttpStatus.BAD_REQUEST, excepcion.message, null);
    }
    if (excepcion instanceof HttpException) {
      // Errores propios de Nest (401/403 de guards, y el 400 del PipeValidacionZod) que YA
      // vienen con el formato del contrato en su "response" (los guards y el pipe los
      // construyen a mano con `throw new XException({ error: { mensaje, campos } })`).
      // OJO: el cuerpo POR DEFECTO de Nest para CUALQUIER HttpException sin personalizar
      // (p. ej. las que lanza Multer/Busboy al parsear un multipart mal formado) tiene la
      // forma `{ statusCode, message, error: 'Bad Request' }` — con `error` como STRING de
      // motivo, no como objeto. Un `'error' in cuerpoNest` a secas confundía ambos casos y
      // dejaba pasar ese cuerpo crudo en inglés al cliente (hallazgo de revisión adversarial,
      // tanda US8) — por eso aquí se exige además que `error` sea un objeto con `mensaje`.
      const cuerpoNest = excepcion.getResponse();
      if (typeof cuerpoNest === 'object' && cuerpoNest !== null && 'error' in cuerpoNest) {
        const posibleError = (cuerpoNest as { error?: unknown }).error;
        if (typeof posibleError === 'object' && posibleError !== null && 'mensaje' in posibleError) {
          return { codigo: excepcion.getStatus(), cuerpo: cuerpoNest as CuerpoError };
        }
      }
      return this.cuerpo(excepcion.getStatus(), this.mensajeHttpEnEspanol(excepcion.getStatus()), null);
    }
    // Error inesperado: log completo en servidor, mensaje genérico al cliente.
    this.logger.error('Error no controlado', excepcion instanceof Error ? excepcion.stack : String(excepcion));
    return this.cuerpo(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Ocurrió un error inesperado. Intenta de nuevo o contacta al administrador.',
      null,
    );
  }

  private cuerpo(
    codigo: number,
    mensaje: string,
    campos: Record<string, string> | null,
  ): { codigo: number; cuerpo: CuerpoError } {
    return { codigo, cuerpo: { error: { mensaje, campos } } };
  }

  private mensajeHttpEnEspanol(codigo: number): string {
    switch (codigo) {
      case HttpStatus.UNAUTHORIZED:
        return 'Debes iniciar sesión para continuar.';
      case HttpStatus.FORBIDDEN:
        return 'No tienes permisos para realizar esta acción.';
      case HttpStatus.NOT_FOUND:
        return 'El recurso solicitado no existe.';
      default:
        return 'No fue posible procesar la solicitud.';
    }
  }
}
