/**
 * Módulo del ASISTENTE DE CONSULTAS (US33).
 *
 * Aquí se ve de un vistazo la garantía de solo lectura: las dependencias que se le entregan al
 * registro de herramientas son los casos de uso de CONSULTA y el repositorio de clientes en modo
 * lectura. Ningún caso de uso que escriba entra en este módulo, así que el asistente no tiene
 * forma de alcanzar uno aunque el modelo lo pidiera (FR-133).
 *
 * El puerto `ModeloConversacional` se cablea al adaptador de Google AI Studio; sustituirlo por otro
 * proveedor —o por un doble en pruebas— es cambiar esta línea y nada más.
 */
import { Module } from '@nestjs/common';
import { ConsultarAsistenteCasoUso } from '../../../aplicacion/asistente/consultar-asistente.caso-uso';
import type { DependenciasHerramientas } from '../../../aplicacion/asistente/herramientas-consulta';
import { MODELO_CONVERSACIONAL } from '../../../aplicacion/asistente/puertos/modelo-conversacional';
import { HistorialProductoCasoUso } from '../../../aplicacion/inventario/historial-producto.caso-uso';
import { ListarInventarioCasoUso } from '../../../aplicacion/inventario/listar-inventario.caso-uso';
import { ResumenPanelCasoUso } from '../../../aplicacion/panel/resumen-panel.caso-uso';
import { ReporteConsumoClienteCasoUso } from '../../../aplicacion/reportes/reporte-consumo-cliente.caso-uso';
import { ReporteInventarioActualCasoUso } from '../../../aplicacion/reportes/reporte-inventario-actual.caso-uso';
import { REPOSITORIO_CLIENTES, type RepositorioClientes } from '../../../dominio/puertos/repositorio-clientes';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../../dominio/puertos/repositorio-usuarios';
import { AdaptadorGemini } from '../../../infraestructura/ia/adaptador-gemini';
import { AuthModule } from '../auth/auth.module';
import { ControladorAsistente } from './controlador-asistente';

@Module({
  imports: [AuthModule],
  controllers: [ControladorAsistente],
  providers: [
    ConsultarAsistenteCasoUso,
    ListarInventarioCasoUso,
    HistorialProductoCasoUso,
    ReporteConsumoClienteCasoUso,
    ResumenPanelCasoUso,
    // `ResumenPanelCasoUso` compone el reporte de inventario para su tarjeta de valorización.
    ReporteInventarioActualCasoUso,
    { provide: MODELO_CONVERSACIONAL, useClass: AdaptadorGemini },
    {
      provide: 'DEPENDENCIAS_HERRAMIENTAS_ASISTENTE',
      useFactory: (
        listarInventario: ListarInventarioCasoUso,
        historialProducto: HistorialProductoCasoUso,
        consumoCliente: ReporteConsumoClienteCasoUso,
        resumenPanel: ResumenPanelCasoUso,
        repositorioClientes: RepositorioClientes,
        inventarioValorizado: ReporteInventarioActualCasoUso,
        repositorioUsuarios: RepositorioUsuarios,
      ): DependenciasHerramientas => ({
        listarInventario,
        historialProducto,
        consumoCliente,
        resumenPanel,
        repositorioClientes,
        inventarioValorizado,
        repositorioUsuarios,
      }),
      inject: [
        ListarInventarioCasoUso,
        HistorialProductoCasoUso,
        ReporteConsumoClienteCasoUso,
        ResumenPanelCasoUso,
        REPOSITORIO_CLIENTES,
        ReporteInventarioActualCasoUso,
        REPOSITORIO_USUARIOS,
      ],
    },
  ],
})
export class AsistenteModule {}
