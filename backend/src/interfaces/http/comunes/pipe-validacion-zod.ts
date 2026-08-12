/**
 * Pipe de validación con Zod — la AUTORIDAD de validación de entrada de la API.
 *
 * Patrón Adapter (research R7): adapta los esquemas Zod de @trazo/compartido — los MISMOS
 * que usa el frontend para feedback inmediato — al mecanismo de pipes de NestJS. Así la
 * validación es idéntica en ambos lados con una sola fuente de verdad (Principio IV), y
 * sin depender de librerías wrapper de terceros (Principio V).
 *
 * Uso en un controlador:
 *   @Post()
 *   crear(@Body(new PipeValidacionZod(esquemaCrearIngreso)) datos: CrearIngreso) { ... }
 *
 * Si la entrada no cumple el esquema, responde 400 con el formato del contrato
 * ({ error: { mensaje, campos } }) y los mensajes en español definidos en el esquema
 * (FR-016/FR-047). El primer error de cada campo es el que se muestra.
 */
import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

@Injectable()
export class PipeValidacionZod<T> implements PipeTransform<unknown, T> {
  constructor(private readonly esquema: ZodSchema<T>) {}

  transform(valor: unknown): T {
    const resultado = this.esquema.safeParse(valor);
    if (resultado.success) {
      return resultado.data;
    }

    // Agrupa los errores por campo (ruta del esquema) tomando el primero de cada uno.
    const campos: Record<string, string> = {};
    for (const problema of resultado.error.issues) {
      const campo = problema.path.join('.') || '_general';
      if (!(campo in campos)) {
        campos[campo] = problema.message;
      }
    }

    throw new BadRequestException({
      error: {
        mensaje: 'Revisa los campos marcados: hay datos faltantes o inválidos.',
        campos,
      },
    });
  }
}
