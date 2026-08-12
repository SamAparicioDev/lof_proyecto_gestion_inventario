/**
 * Controlador `ControladorReportes` — endpoints de `/api/reportes` (contracts/api-rest.md §
 * Reportes). Cubre los dos reportes de consumo de US4 (`consumo-cliente`/FR-039,
 * `consumo-proyecto`/FR-040) y, desde la Tanda 9 (US7/T081), los reportes de inventario
 * actual (`inventario`/FR-041) y de movimientos (`movimientos`/FR-042) — los CUATRO con su
 * endpoint de datos (para pantalla) y su endpoint `/export` gemelo (FR-043).
 *
 * Regla dura (SC-007, contracts/api-rest.md § Reportes): "los endpoints de datos y los de
 * exportación comparten esquema de filtros y caso de uso" — cada ruta `/export` valida
 * EXACTAMENTE el mismo esquema Zod que su ruta hermana (mergeado con `esquemaFormatoExport`),
 * invoca el MISMO caso de uso con los MISMOS filtros, y solo agrega un paso de mapeo puro
 * (`mapeadores-documento-reporte.ts`, sin recalcular nada) + la estrategia de exportación
 * (`ExportadorReporte`, patrón Strategy, research R8) elegida por el query param `formato`.
 *
 * Autorización (T103): los 4 endpoints de datos exigen `reportes.ver` y los 4 `/export`
 * exigen `reportes.exportar`. Son permisos DISTINTOS aunque los 3 roles del sistema los
 * tengan iguales (ambos A,G — Operario recibe `403` en los ocho, como antes): consultar en
 * pantalla y llevarse el archivo con todos los datos fuera del sistema son capacidades
 * separables, y tenerlas partidas permite un rol que consulte sin poder exportar sin tocar
 * código (FR-055). La autoridad sigue siendo el guard del servidor en cada petición
 * (FR-003/FR-058) — ocultar el menú en el frontend NO es control de acceso.
 *
 * Controlador delgado: sin try/catch (el filtro global de errores traduce `NoEncontrado` a
 * `404`) — misma convención que `controlador-inventario.ts`. La única razón para usar
 * `@Res({ passthrough: true })` es fijar `Content-Type`/`Content-Disposition` dinámicamente
 * según `formato` antes de devolver el `StreamableFile` (Nest no ofrece un decorador
 * declarativo para headers que dependen del query, a diferencia de `@Header(...)`).
 */
import { Controller, Get, Inject, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import {
  esquemaFiltroConsumoCliente,
  esquemaFiltroConsumoProyecto,
  esquemaFiltroReporteInventario,
  esquemaFiltroReporteMovimientos,
  esquemaFormatoExport,
  type FiltroConsumoCliente,
  type FiltroConsumoProyecto,
  type FiltroReporteInventario,
  type FiltroReporteMovimientos,
  type FormatoExport,
} from '@trazo/compartido';
import type { DocumentoReporte, ExportadorReporte } from '../../../aplicacion/reportes/puertos/exportador-reporte';
import {
  ReporteConsumoClienteCasoUso,
  type ReporteConsumoCliente,
  type ReporteConsumoClienteEntrada,
} from '../../../aplicacion/reportes/reporte-consumo-cliente.caso-uso';
import {
  ReporteConsumoProyectoCasoUso,
  type ReporteConsumoProyecto,
  type ReporteConsumoProyectoEntrada,
} from '../../../aplicacion/reportes/reporte-consumo-proyecto.caso-uso';
import {
  ReporteInventarioActualCasoUso,
  type ReporteInventarioActual,
} from '../../../aplicacion/reportes/reporte-inventario-actual.caso-uso';
import {
  ReporteMovimientosCasoUso,
  type ReporteMovimientos,
  type ReporteMovimientosEntrada,
} from '../../../aplicacion/reportes/reporte-movimientos.caso-uso';
import { ResolverLogoDocumentoCasoUso } from '../../../aplicacion/exportacion/resolver-logo-documento.caso-uso';
import { EXPORTADOR_EXCEL, EXPORTADOR_PDF } from '../../../infraestructura/exportacion/exportacion.module';
import { PipeValidacionZod } from '../comunes/pipe-validacion-zod';
import { RequierePermiso } from '../comunes/requiere-permiso.decorator';
import { fechaHoyIso, responderConArchivoExportado } from '../comunes/respuesta-export';
import {
  mapearConsumoClienteADocumento,
  mapearConsumoProyectoADocumento,
  mapearInventarioADocumento,
  mapearMovimientosADocumento,
} from './mapeadores-documento-reporte';

@Controller('reportes')
export class ControladorReportes {
  constructor(
    private readonly reporteConsumoCliente: ReporteConsumoClienteCasoUso,
    private readonly reporteConsumoProyecto: ReporteConsumoProyectoCasoUso,
    private readonly reporteInventarioActual: ReporteInventarioActualCasoUso,
    private readonly reporteMovimientos: ReporteMovimientosCasoUso,
    /** US11/FR-067: los DOS reportes de consumo corresponden a un único cliente, así que
     *  llevan su logo; inventario y movimientos abarcan varios clientes y no lo piden. */
    private readonly resolverLogo: ResolverLogoDocumentoCasoUso,
    @Inject(EXPORTADOR_EXCEL) private readonly exportadorExcel: ExportadorReporte,
    @Inject(EXPORTADOR_PDF) private readonly exportadorPdf: ExportadorReporte,
  ) {}

  /** `GET /api/reportes/consumo-cliente?clienteId=&desde=&hasta=` — reporte en pantalla (FR-039). */
  @Get('consumo-cliente')
  @RequierePermiso('reportes.ver')
  async consumoCliente(
    @Query(new PipeValidacionZod(esquemaFiltroConsumoCliente)) filtros: FiltroConsumoCliente,
  ): Promise<ReporteConsumoCliente> {
    return this.reporteConsumoCliente.ejecutar(entradaConsumoCliente(filtros));
  }

  /** `GET /api/reportes/consumo-cliente/export?clienteId=&desde=&hasta=&formato=pdf|xlsx` —
   *  MISMO caso de uso y MISMOS filtros que `consumoCliente` (SC-007); solo agrega mapeo +
   *  estrategia de exportación. */
  @Get('consumo-cliente/export')
  @RequierePermiso('reportes.exportar')
  async exportarConsumoCliente(
    @Query(new PipeValidacionZod(esquemaFiltroConsumoCliente.merge(esquemaFormatoExport)))
    filtros: FiltroConsumoCliente & FormatoExport,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const reporte = await this.reporteConsumoCliente.ejecutar(entradaConsumoCliente(filtros));
    const logo = await this.resolverLogo.ejecutar({ clienteId: filtros.clienteId });
    const documento = mapearConsumoClienteADocumento(reporte, logo);
    return this.exportar(documento, filtros.formato, 'consumo-cliente', respuesta);
  }

  /** `GET /api/reportes/consumo-proyecto?proyectoId=&desde=&hasta=` — reporte en pantalla (FR-040). */
  @Get('consumo-proyecto')
  @RequierePermiso('reportes.ver')
  async consumoProyecto(
    @Query(new PipeValidacionZod(esquemaFiltroConsumoProyecto)) filtros: FiltroConsumoProyecto,
  ): Promise<ReporteConsumoProyecto> {
    return this.reporteConsumoProyecto.ejecutar(entradaConsumoProyecto(filtros));
  }

  /** `GET /api/reportes/consumo-proyecto/export?proyectoId=&desde=&hasta=&formato=pdf|xlsx` —
   *  MISMO caso de uso y MISMOS filtros que `consumoProyecto` (SC-007). */
  @Get('consumo-proyecto/export')
  @RequierePermiso('reportes.exportar')
  async exportarConsumoProyecto(
    @Query(new PipeValidacionZod(esquemaFiltroConsumoProyecto.merge(esquemaFormatoExport)))
    filtros: FiltroConsumoProyecto & FormatoExport,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const reporte = await this.reporteConsumoProyecto.ejecutar(entradaConsumoProyecto(filtros));
    // FR-069: un proyecto no tiene logo propio — se usa el del cliente dueño.
    const logo = await this.resolverLogo.ejecutar({ proyectoId: filtros.proyectoId });
    const documento = mapearConsumoProyectoADocumento(reporte, logo);
    return this.exportar(documento, filtros.formato, 'consumo-proyecto', respuesta);
  }

  /** `GET /api/reportes/inventario?buscar=&cantidadMin=&cantidadMax=` — reporte en pantalla
   *  (FR-041). `filtros` ya tiene EXACTAMENTE la forma de `ReporteInventarioActualEntrada`
   *  (ningún campo de fecha que convertir), a diferencia de `entradaConsumoCliente`/
   *  `entradaConsumoProyecto` — se pasa tal cual. */
  @Get('inventario')
  @RequierePermiso('reportes.ver')
  async inventario(
    @Query(new PipeValidacionZod(esquemaFiltroReporteInventario)) filtros: FiltroReporteInventario,
  ): Promise<ReporteInventarioActual> {
    return this.reporteInventarioActual.ejecutar(filtros);
  }

  /** `GET /api/reportes/inventario/export?buscar=&cantidadMin=&cantidadMax=&formato=pdf|xlsx` —
   *  MISMO caso de uso y MISMOS filtros que `inventario` (SC-007). */
  @Get('inventario/export')
  @RequierePermiso('reportes.exportar')
  async exportarInventario(
    @Query(new PipeValidacionZod(esquemaFiltroReporteInventario.merge(esquemaFormatoExport)))
    filtros: FiltroReporteInventario & FormatoExport,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const reporte = await this.reporteInventarioActual.ejecutar(filtros);
    const documento = mapearInventarioADocumento(reporte);
    return this.exportar(documento, filtros.formato, 'inventario', respuesta);
  }

  /** `GET /api/reportes/movimientos?desde=&hasta=&tipo=&usuarioId=&clienteId=&proyectoId=` —
   *  reporte en pantalla (FR-042). */
  @Get('movimientos')
  @RequierePermiso('reportes.ver')
  async movimientos(
    @Query(new PipeValidacionZod(esquemaFiltroReporteMovimientos)) filtros: FiltroReporteMovimientos,
  ): Promise<ReporteMovimientos> {
    return this.reporteMovimientos.ejecutar(entradaReporteMovimientos(filtros));
  }

  /** `GET /api/reportes/movimientos/export?...&formato=pdf|xlsx` — MISMO caso de uso y MISMOS
   *  filtros que `movimientos` (SC-007). */
  @Get('movimientos/export')
  @RequierePermiso('reportes.exportar')
  async exportarMovimientos(
    @Query(new PipeValidacionZod(esquemaFiltroReporteMovimientos.merge(esquemaFormatoExport)))
    filtros: FiltroReporteMovimientos & FormatoExport,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const reporte = await this.reporteMovimientos.ejecutar(entradaReporteMovimientos(filtros));
    const documento = mapearMovimientosADocumento(reporte);
    return this.exportar(documento, filtros.formato, 'movimientos', respuesta);
  }

  /** Elige la estrategia por `formato` (Strategy, research R8), genera el buffer y fija los
   *  headers de descarga: `Content-Disposition: attachment; filename="<reporte>-<fecha
   *  AAAA-MM-DD>.<ext>"` (patrón exacto del contrato). La plomería vive en
   *  `comunes/respuesta-export.ts` desde US11/T120, compartida con los otros dos controladores
   *  que exportan (ingresos y salidas) para que los headers no puedan divergir entre rutas. */
  private async exportar(
    documento: DocumentoReporte,
    formato: FormatoExport['formato'],
    nombreReporte: string,
    respuesta: Response,
  ): Promise<StreamableFile> {
    return responderConArchivoExportado(
      documento,
      formato,
      `${nombreReporte}-${fechaHoyIso()}`,
      { excel: this.exportadorExcel, pdf: this.exportadorPdf },
      respuesta,
    );
  }
}

/** Convierte el filtro ya validado (fechas en texto ISO) a la entrada `Date` que espera el
 *  caso de uso — mismo patrón que `controlador-inventario.ts#movimientos`. */
function entradaConsumoCliente(filtros: FiltroConsumoCliente): ReporteConsumoClienteEntrada {
  return {
    clienteId: filtros.clienteId,
    desde: filtros.desde ? new Date(filtros.desde) : undefined,
    hasta: filtros.hasta ? new Date(filtros.hasta) : undefined,
  };
}

/** Mismo criterio que `entradaConsumoCliente`, para el reporte de proyecto. */
function entradaConsumoProyecto(filtros: FiltroConsumoProyecto): ReporteConsumoProyectoEntrada {
  return {
    proyectoId: filtros.proyectoId,
    desde: filtros.desde ? new Date(filtros.desde) : undefined,
    hasta: filtros.hasta ? new Date(filtros.hasta) : undefined,
  };
}

/** Mismo criterio que `entradaConsumoCliente` para `desde`, pero `hasta` NO puede convertirse
 *  con el mismo `new Date(texto)` ingenuo: `movimientos_inventario.fecha_hora` es `timestamptz`
 *  (data-model.md línea 161), a diferencia de `salidas.fecha_salida`, que es `DATE` (por eso
 *  `entradaConsumoCliente`/`entradaConsumoProyecto` sí pueden hacerlo sin ajuste). `new
 *  Date('2026-08-11')` da medianoche UTC de ese día, que en hora de Bogotá (UTC-5, spec.md §
 *  Moneda y localización) cae la TARDE-NOCHE del día ANTERIOR — un filtro "hasta: hoy" excluiría
 *  entonces prácticamente todo el día de hoy. `hasta` se ancla al FIN de ese día en hora de
 *  Bogotá (ver `finDeDiaBogota`); `desde` no lo necesita (el `gte` de medianoche UTC ya cae
 *  ANTES del inicio real del día en Bogotá, así que nunca excluye el día solicitado). */
function entradaReporteMovimientos(filtros: FiltroReporteMovimientos): ReporteMovimientosEntrada {
  return {
    desde: filtros.desde ? new Date(filtros.desde) : undefined,
    hasta: filtros.hasta ? finDeDiaBogota(filtros.hasta) : undefined,
    tipo: filtros.tipo,
    usuarioId: filtros.usuarioId,
    clienteId: filtros.clienteId,
    proyectoId: filtros.proyectoId,
  };
}

/** Convierte una fecha-solo-día `AAAA-MM-DD` (ya validada por `esquemaFechaOpcional`) al
 *  INSTANTE de fin de ese día en hora de Bogotá (`America/Bogota`, UTC-5 fijo, sin horario de
 *  verano — spec.md § Moneda y localización) — ver TSDoc de `entradaReporteMovimientos` para
 *  el porqué. El offset `-05:00` en el literal ISO deja que el motor de JavaScript calcule el
 *  instante UTC correcto sin depender de la zona horaria del proceso que ejecuta el backend. */
function finDeDiaBogota(fechaIso: string): Date {
  return new Date(`${fechaIso}T23:59:59.999-05:00`);
}
