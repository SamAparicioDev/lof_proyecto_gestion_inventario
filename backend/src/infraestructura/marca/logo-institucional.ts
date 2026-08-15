/**
 * `LogoInstitucional` — el logotipo de LOF, leído UNA vez del disco y conservado en memoria
 * (US11, FR-067/FR-068).
 *
 * Es el único logotipo del sistema: lo pinta la aplicación web y va impreso en todos los
 * archivos exportados. Vive en `assets/marca/logo-lof.png` del repositorio y no en la base de
 * datos, porque es parte del DESPLIEGUE —cambia cuando cambia la imagen de la empresa, no
 * cuando el negocio opera— y así viaja con el código en vez de exigir un dato semilla más.
 *
 * ## Nunca falla hacia arriba (FR-068)
 *
 * Si el archivo falta, está corrupto o no es un PNG/JPEG real, `obtener()` devuelve `null` y el
 * sistema sigue: los exportables se generan sin logotipo y la web muestra el nombre en texto.
 * Un despliegue al que se le olvidó copiar una imagen no puede dejar sin documentos a quien los
 * necesita — el contenido de datos manda sobre la decoración. El aviso se registra UNA sola vez,
 * al arrancar, para que el problema se vea en los logs sin inundarlos con una línea por
 * exportación.
 *
 * ## Por qué se valida por los bytes
 *
 * Se reutiliza `detectarTipoDeImagenLogo` (dominio, puro). Aquí el archivo no lo sube un usuario
 * sino que lo pone quien despliega, así que la validación no defiende de un atacante: defiende
 * de una equivocación silenciosa. Renombrar `logo.svg` a `logo-lof.png` produciría un archivo
 * que ni `pdfmake` ni `exceljs` saben incrustar, y el fallo aparecería mucho más tarde y en un
 * sitio que no explica nada. Aquí se detecta al arrancar y se dice por qué.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogoDocumento } from '../../aplicacion/reportes/puertos/exportador-reporte';
import { detectarTipoDeImagenLogo } from '../../dominio/servicios/servicio-imagen-logo';

/** Ruta del logotipo, relativa a la raíz del monorepo. */
const RUTA_LOGO = join('assets', 'marca', 'logo-lof.png');

/**
 * Niveles que se suben desde `process.cwd()` buscando `assets/marca/`.
 *
 * Hace falta porque el directorio de trabajo NO es el mismo en todos los arranques, y darlo por
 * supuesto ya salió mal una vez: `npm run dev:backend` es `npm run start:dev -w backend`, y npm
 * ejecuta los scripts de un workspace DENTRO de su carpeta, así que ahí `cwd` es `backend/` —
 * igual que en `npm run test:integracion -w backend`. En el contenedor, en cambio, `WORKDIR` es
 * `/app`, la raíz. Buscar hacia arriba cubre los dos sin que nadie tenga que acordarse de cuál
 * es cuál, y sin depender de `__dirname` (que apunta a `src/` en desarrollo y a `dist/` en
 * producción, con distinta profundidad).
 */
const NIVELES_HACIA_LA_RAIZ = 3;

@Injectable()
export class LogoInstitucional implements OnModuleInit {
  private readonly logger = new Logger(LogoInstitucional.name);
  private logo: LogoDocumento | null = null;

  /** Se carga al arrancar, no bajo demanda: así el aviso de "falta el logotipo" aparece en el
   *  arranque —donde quien despliega lo está mirando— y no en la primera exportación. */
  async onModuleInit(): Promise<void> {
    this.logo = await this.cargar();
  }

  /** El logotipo listo para incrustar, o `null` si el despliegue no lo trae (FR-068). */
  obtener(): LogoDocumento | null {
    return this.logo;
  }

  private async cargar(): Promise<LogoDocumento | null> {
    const candidatas = Array.from({ length: NIVELES_HACIA_LA_RAIZ }, (_, nivel) =>
      join(process.cwd(), ...Array<string>(nivel).fill('..'), RUTA_LOGO),
    );

    let contenido: Buffer | null = null;
    let ruta = candidatas[0] as string;
    for (const candidata of candidatas) {
      try {
        contenido = await readFile(candidata);
        ruta = candidata;
        break;
      } catch {
        // Sigue buscando en el nivel de arriba.
      }
    }

    if (!contenido) {
      this.logger.warn(
        `No se encontró el logotipo (se buscó ${RUTA_LOGO} desde ${process.cwd()} y ` +
          `${NIVELES_HACIA_LA_RAIZ - 1} niveles arriba). La aplicación funciona igual: los ` +
          'archivos exportados se generarán sin logo (FR-068). Ver assets/marca/LEEME.md.',
      );
      return null;
    }

    try {
      const tipoMime = detectarTipoDeImagenLogo(contenido);
      this.logger.log(`Logotipo institucional cargado (${tipoMime}, ${contenido.length} bytes).`);
      return { contenido, tipoMime };
    } catch (error) {
      this.logger.warn(
        `El archivo ${ruta} existe pero no es una imagen PNG o JPEG válida: ` +
          `${error instanceof Error ? error.message : String(error)} ` +
          'Los archivos exportados se generarán sin logo (FR-068).',
      );
      return null;
    }
  }
}
