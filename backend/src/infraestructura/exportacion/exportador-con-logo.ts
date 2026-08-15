/**
 * `ExportadorConLogo` — decorador que le pone el logotipo de LOF a TODO lo que se exporta
 * (US11, FR-067).
 *
 * ## Por qué un decorador y no un parámetro más
 *
 * "Todos los exportables llevan el logo" se puede implementar de dos formas: pidiéndole a cada
 * endpoint que lo adjunte, o poniéndolo en el camino por el que todos pasan. La primera funciona
 * hasta que alguien agrega el módulo número trece y se le olvida — y nadie lo nota, porque un
 * PDF sin logotipo se ve perfectamente bien.
 *
 * Este decorador envuelve las DOS estrategias del puerto `ExportadorReporte` y es lo que
 * `ExportacionModule` publica bajo `EXPORTADOR_PDF`/`EXPORTADOR_EXCEL`. Como los controladores
 * solo conocen esos tokens, no existe forma de exportar sin pasar por aquí: la garantía es
 * ESTRUCTURAL, no una convención que haya que recordar. Un `grep` de `logo` en los controladores
 * no devuelve nada, y esa ausencia es justamente el objetivo.
 *
 * Respeta un `logo` que el documento ya traiga: hoy nadie lo hace, pero si mañana un documento
 * necesitara otra imagen, decidirlo es de quien lo arma, no de esta capa.
 *
 * Si no hay logotipo cargado (`LogoInstitucional.obtener()` devuelve `null`), el documento pasa
 * intacto y el archivo se genera sin él — FR-068, el contenido manda sobre la decoración.
 */
import { Injectable } from '@nestjs/common';
import type { DocumentoReporte, ExportadorReporte } from '../../aplicacion/reportes/puertos/exportador-reporte';
import { LogoInstitucional } from '../marca/logo-institucional';
import { ExportadorExcel } from './exportador-excel';
import { ExportadorPdf } from './exportador-pdf';

/** Base común de los dos decoradores: añade el logotipo y delega en la estrategia real. */
abstract class ExportadorConLogo implements ExportadorReporte {
  protected constructor(
    private readonly estrategia: ExportadorReporte,
    private readonly logoInstitucional: LogoInstitucional,
  ) {}

  async generar(documento: DocumentoReporte): Promise<Buffer> {
    const logo = documento.logo ?? this.logoInstitucional.obtener() ?? undefined;
    return this.estrategia.generar(logo ? { ...documento, logo } : documento);
  }
}

@Injectable()
export class ExportadorPdfConLogo extends ExportadorConLogo {
  constructor(estrategia: ExportadorPdf, logoInstitucional: LogoInstitucional) {
    super(estrategia, logoInstitucional);
  }
}

@Injectable()
export class ExportadorExcelConLogo extends ExportadorConLogo {
  constructor(estrategia: ExportadorExcel, logoInstitucional: LogoInstitucional) {
    super(estrategia, logoInstitucional);
  }
}
