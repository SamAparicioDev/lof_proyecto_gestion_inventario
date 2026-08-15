/**
 * Módulo de la marca (US11, FR-067) — sirve el logotipo de LOF a la aplicación web.
 *
 * `LogoInstitucional` se registra AQUÍ y se exporta, para que `ExportacionModule` reciba la
 * MISMA instancia: el archivo se lee del disco una sola vez por proceso, y no una por cada
 * módulo que lo necesite.
 *
 * No importa `AuthModule`: su única ruta es `@Public()`.
 */
import { Module } from '@nestjs/common';
import { LogoInstitucional } from '../../../infraestructura/marca/logo-institucional';
import { ControladorMarca } from './controlador-marca';

@Module({
  controllers: [ControladorMarca],
  providers: [LogoInstitucional],
  exports: [LogoInstitucional],
})
export class MarcaModule {}
