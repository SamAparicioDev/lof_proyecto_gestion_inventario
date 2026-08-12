/**
 * Endpoint de salud de la API — GET /api/salud
 *
 * Único endpoint sin autenticación junto con el login. Existe para:
 * - Verificar el arranque del esqueleto (tarea T001 de tasks.md).
 * - Monitoreo básico del despliegue (¿el proceso responde?).
 *
 * No consulta la base de datos a propósito: su única responsabilidad es confirmar que el
 * proceso HTTP está vivo (una responsabilidad por clase — SOLID/SRP).
 */
import { Controller, Get } from '@nestjs/common';
import { Public } from '../comunes/public.decorator';

@Controller('salud')
export class ControladorSalud {
  @Public()
  @Get()
  salud(): { estado: 'ok'; fecha: string } {
    return { estado: 'ok', fecha: new Date().toISOString() };
  }
}
