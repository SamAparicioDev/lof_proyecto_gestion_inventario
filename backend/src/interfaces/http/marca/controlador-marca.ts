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
   * ## Por qué NO se cachea agresivamente
   *
   * La primera versión respondía `max-age=86400, immutable`, razonando que el logotipo cambia
   * con el despliegue y no con la operación. Es cierto y aun así estaba mal: la URL es FIJA, así
   * que `immutable` le promete al navegador que el contenido DE ESA URL no va a cambiar — y sí
   * cambia, exactamente cuando se reemplaza el logo. El resultado es que quien haya abierto la
   * aplicación sigue viendo el logotipo viejo durante un día entero, sin forma de arreglarlo
   * salvo un refresco forzado. (Pasó de verdad: una imagen de prueba se quedó pegada en el
   * navegador del dueño del proyecto después de haberla borrado del servidor.)
   *
   * `max-age` corto y sin `immutable`: el navegador la reutiliza mientras navega —que es donde
   * importa, aparece en todas las pantallas— y un cambio de logotipo se propaga en minutos.
   * Para una imagen de unos pocos KB servida por el mismo origen, es el equilibrio correcto.
   */
  @Get('logo')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
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
