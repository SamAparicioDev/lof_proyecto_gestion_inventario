/**
 * `ControladorMarca` — `/api/marca/logo` (US11, FR-067).
 *
 * Sirve el logotipo de LOF a la aplicación web. Existe para que el logotipo tenga UN solo dueño:
 * el archivo vive en `assets/marca/logo-lof.png` y lo lee el backend, que ya lo necesita para
 * incrustarlo en los exportables. Si el frontend tuviera su propia copia en `public/`, cambiar
 * el logo serían dos archivos y tarde o temprano quedarían distintos.
 *
 * **Es público** (`@Public()`, sin sesión): lo pinta la pantalla de inicio de sesión, que por
 * definición no la tiene. No hay nada que proteger — es la identidad de la empresa, la misma que
 * va impresa en cada documento que sale del sistema.
 *
 * `nosniff` se mantiene aunque los bytes ya no los suba un usuario: es una imagen servida desde
 * el mismo origen que la aplicación, y la cabecera cuesta cero.
 */
import { Controller, Get, Header, NotFoundException, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { LogoInstitucional } from '../../../infraestructura/marca/logo-institucional';
import { Public } from '../comunes/public.decorator';

@Controller('marca')
export class ControladorMarca {
  constructor(private readonly logoInstitucional: LogoInstitucional) {}

  /**
   * `GET /api/marca/logo` — los bytes del logotipo. `404` si el despliegue no lo trae, que es
   * el caso que la web resuelve mostrando el nombre en texto (FR-068).
   *
   * Se cachea agresivamente: es un archivo que cambia con el despliegue, no con la operación.
   */
  @Get('logo')
  @Public()
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Disposition', 'inline')
  obtenerLogo(@Res({ passthrough: true }) respuesta: Response): StreamableFile {
    const logo = this.logoInstitucional.obtener();
    if (!logo) {
      throw new NotFoundException('El despliegue no incluye el logotipo institucional.');
    }
    respuesta.set({ 'Content-Type': logo.tipoMime });
    return new StreamableFile(Buffer.from(logo.contenido));
  }
}
