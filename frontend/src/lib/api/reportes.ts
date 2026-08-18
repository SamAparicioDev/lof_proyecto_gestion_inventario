/**
 * Funciones de reportes del frontend — consumo por cliente y por proyecto (T071/T072,
 * contracts/api-rest.md § Reportes, FR-039/FR-040) y, desde la Tanda 9, inventario actual y
 * movimientos (T082, FR-041/FR-042). Los 4 endpoints de DATOS usan SIEMPRE `api<T>()`
 * (frontend/CLAUDE.md) — nunca `fetch` directo — mismo patrón que `lib/api/salidas.ts`.
 *
 * EXCEPCIÓN documentada para los 4 endpoints `/export`: `api<T>()` solo sabe interpretar JSON
 * (`lib/api/cliente.ts`), pero `/export` devuelve un stream binario (xlsx/pdf) con
 * `Content-Disposition: attachment`. Para poder mostrar el error (403/400/etc.) DENTRO de la
 * página del reporte — en vez de navegar a una URL que solo renderiza el JSON crudo del error,
 * o de perder el filtro ya generado en pantalla — se usa `fetch` nativo aislado en
 * `descargarArchivo()`, con `credentials: 'include'` (mismo criterio de sesión httpOnly que
 * `api<T>()`) y manejo manual de `Blob` + nombre de archivo. Ningún componente llama a `fetch`
 * directo: esto vive únicamente aquí, documentado, tal como exige `frontend/CLAUDE.md`.
 *
 * `construirQueryReporte`/`descargarArchivo` son genéricos a propósito — T082 los reutiliza
 * TAL CUAL para `obtenerReporteInventario`/`obtenerReporteMovimientos` y sus exportaciones,
 * mismos 2+2 endpoints, mismo patrón exacto, sin refactor.
 */
import type {
  FiltroConsumoCliente,
  FiltroConsumoProyecto,
  FiltroReporteInventario,
  FiltroReporteMovimientos,
  FormatoExport,
  ReporteConsumoCliente,
  ReporteConsumoProyecto,
  ReporteInventarioActual,
  ReporteMovimientos,
} from '@trazo/compartido';
import { api, ErrorApi } from './cliente';

/** Arma la query string de un reporte a partir de su filtro ya validado, omitiendo valores
 *  vacíos/`undefined` (p. ej. `desde`/`hasta` sin elegir) — reutilizable por cualquier reporte
 *  de US4/US7, tanto para el endpoint de datos como para su gemelo `/export`. */
function construirQueryReporte(filtros: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtros)) {
    if (valor !== undefined && valor !== '') query.set(clave, String(valor));
  }
  return query.toString();
}

/** `GET /api/reportes/consumo-cliente` — reporte en pantalla (FR-039). */
export function obtenerReporteConsumoCliente(filtros: FiltroConsumoCliente): Promise<ReporteConsumoCliente> {
  return api<ReporteConsumoCliente>(`/api/reportes/consumo-cliente?${construirQueryReporte(filtros)}`);
}

/** `GET /api/reportes/consumo-proyecto` — reporte en pantalla (FR-040). */
export function obtenerReporteConsumoProyecto(filtros: FiltroConsumoProyecto): Promise<ReporteConsumoProyecto> {
  return api<ReporteConsumoProyecto>(`/api/reportes/consumo-proyecto?${construirQueryReporte(filtros)}`);
}

/** `GET /api/reportes/consumo-cliente/export` — MISMOS filtros que ya generaron el reporte en
 *  pantalla (SC-007: exportar = lo que se ve en pantalla, siempre). */
export function exportarConsumoCliente(
  filtros: FiltroConsumoCliente,
  formato: FormatoExport['formato'],
): Promise<void> {
  const query = construirQueryReporte({ ...filtros, formato });
  return descargarArchivo(`/api/reportes/consumo-cliente/export?${query}`, `consumo-cliente.${formato}`);
}

/** `GET /api/reportes/consumo-proyecto/export` — MISMOS filtros que ya generaron el reporte en
 *  pantalla (SC-007). */
export function exportarConsumoProyecto(
  filtros: FiltroConsumoProyecto,
  formato: FormatoExport['formato'],
): Promise<void> {
  const query = construirQueryReporte({ ...filtros, formato });
  return descargarArchivo(`/api/reportes/consumo-proyecto/export?${query}`, `consumo-proyecto.${formato}`);
}

/** `GET /api/reportes/inventario` — reporte en pantalla (FR-041). */
export function obtenerReporteInventario(filtros: FiltroReporteInventario): Promise<ReporteInventarioActual> {
  return api<ReporteInventarioActual>(`/api/reportes/inventario?${construirQueryReporte(filtros)}`);
}

/** `GET /api/reportes/movimientos` — reporte en pantalla (FR-042). */
export function obtenerReporteMovimientos(filtros: FiltroReporteMovimientos): Promise<ReporteMovimientos> {
  return api<ReporteMovimientos>(`/api/reportes/movimientos?${construirQueryReporte(filtros)}`);
}

/** `GET /api/reportes/inventario/export` — MISMOS filtros que ya generaron el reporte en
 *  pantalla (SC-007). */
export function exportarReporteInventario(
  filtros: FiltroReporteInventario,
  formato: FormatoExport['formato'],
): Promise<void> {
  const query = construirQueryReporte({ ...filtros, formato });
  return descargarArchivo(`/api/reportes/inventario/export?${query}`, `inventario.${formato}`);
}

/** `GET /api/reportes/movimientos/export` — MISMOS filtros que ya generaron el reporte en
 *  pantalla (SC-007). */
export function exportarReporteMovimientos(
  filtros: FiltroReporteMovimientos,
  formato: FormatoExport['formato'],
): Promise<void> {
  const query = construirQueryReporte({ ...filtros, formato });
  return descargarArchivo(`/api/reportes/movimientos/export?${query}`, `movimientos.${formato}`);
}

/** Nombre de archivo tomado del header `Content-Disposition: attachment; filename="..."` del
 *  contrato — con un nombre por defecto de respaldo si el header no llega (defensivo, no
 *  debería ocurrir: el backend siempre lo fija, `controlador-reportes.ts`). */
function nombreDesdeContentDisposition(encabezado: string | null, porDefecto: string): string {
  const coincidencia = encabezado ? /filename="([^"]+)"/.exec(encabezado) : null;
  return coincidencia?.[1] ?? porDefecto;
}

/** Descarga un reporte exportado como archivo (ver EXCEPCIÓN de `fetch` nativo en el
 *  encabezado del archivo). Si la API respondió con error lo traduce a `ErrorApi` — MISMO
 *  formato que `api<T>()` — para que el componente que llama lo muestre igual que cualquier
 *  otro error (incluido un `403` de Operario, ver `componentes/reportes/*`). Si respondió
 *  bien, dispara la descarga del navegador con el nombre exacto que fijó el backend. */
async function descargarArchivo(ruta: string, nombrePorDefecto: string): Promise<void> {
  const respuesta = await fetch(ruta, { credentials: 'include' });

  if (!respuesta.ok) {
    let mensaje = 'No fue posible generar el archivo. Intenta de nuevo.';
    let campos: Record<string, string> | null = null;
    try {
      const cuerpo = (await respuesta.json()) as { error: { mensaje: string; campos: Record<string, string> | null } };
      mensaje = cuerpo.error.mensaje;
      campos = cuerpo.error.campos;
    } catch {
      // Cuerpo no-JSON: se conserva el mensaje genérico de arriba.
    }
    throw new ErrorApi(respuesta.status, mensaje, campos);
  }

  const blob = await respuesta.blob();
  const nombreArchivo = nombreDesdeContentDisposition(respuesta.headers.get('Content-Disposition'), nombrePorDefecto);
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

/**
 * `GET /api/reportes/movimientos/usuarios` — quiénes han movido inventario (US25, FR-121).
 *
 * Alimenta el filtro por persona del reporte. NO es el listado de usuarios del sistema: ese
 * exige `usuarios.gestionar`, que el Gerente no tiene aunque sí vea este reporte.
 */
export function usuariosConMovimientos(): Promise<{ id: number; nombre: string }[]> {
  return api<{ id: number; nombre: string }[]>('/api/reportes/movimientos/usuarios');
}
