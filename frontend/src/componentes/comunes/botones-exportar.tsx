/**
 * Botones "Exportar Excel" / "Exportar PDF" de los listados y documentos de ingresos y salidas
 * (T122, US11 — FR-064/FR-065).
 *
 * ## Por qué son ENLACES y no botones con `fetch`
 *
 * Los paneles de reporte (US4/US7) descargan con `fetch` porque son Client Components que ya
 * tienen el filtro en memoria y necesitan mostrar un `403` DENTRO de la pantalla sin perder el
 * reporte generado. Aquí el contexto es el opuesto: los listados de `/ingresos` y `/salidas` y
 * las fichas de documento son SERVER Components cuyo filtro vive en la URL, y quien está viendo
 * la pantalla ya tiene el permiso que exige la exportación (es el MISMO `ingresos.ver` /
 * `salidas.ver` del listado). Un `<a href>` hace exactamente lo que hace falta —el navegador
 * descarga con el nombre que fija `Content-Disposition`— sin convertir la página en Client
 * Component ni duplicar el filtro en JavaScript. Es el mismo patrón que los dos botones de
 * descarga de la carga masiva (US8, contracts/rutas-frontend.md).
 *
 * `href` llega COMPLETO desde la página (con sus filtros vigentes) y aquí solo se le añade
 * `formato`, para que el archivo no pueda salir con filtros distintos de los que están en
 * pantalla (SC-007).
 *
 * Regla de cascada (docs/diseno-nocturne.md): `.btn` reclama `display`, `align-items`, `gap`,
 * `padding` y `border-radius`; por eso el layout en fila vive en el `<div>` contenedor —que no
 * lleva ninguna clase de Nocturne— y los `<a>` solo llevan `.btn`.
 */
import { FilePdf, FileXls } from '@phosphor-icons/react/dist/ssr';

interface PropiedadesBotonesExportar {
  /** Ruta del endpoint `/export` YA con sus filtros, sin `formato` (ej.
   *  `/api/salidas/export?clienteId=3`). */
  hrefBase: string;
  /** Texto accesible que distingue QUÉ se exporta cuando hay varios grupos en la misma página
   *  (ej. "el listado de salidas", "esta salida"). */
  descripcion: string;
}

export function BotonesExportar({ hrefBase, descripcion }: PropiedadesBotonesExportar) {
  return (
    <div className="flex flex-wrap items-center gap-2 no-imprimir">
      <a className="btn btn-secondary" href={conFormato(hrefBase, 'xlsx')} aria-label={`Exportar ${descripcion} a Excel`}>
        <FileXls size={16} /> Exportar Excel
      </a>
      <a className="btn btn-secondary" href={conFormato(hrefBase, 'pdf')} aria-label={`Exportar ${descripcion} a PDF`}>
        <FilePdf size={16} /> Exportar PDF
      </a>
    </div>
  );
}

/** Añade `formato` respetando si `hrefBase` ya traía query string. */
function conFormato(hrefBase: string, formato: 'xlsx' | 'pdf'): string {
  return `${hrefBase}${hrefBase.includes('?') ? '&' : '?'}formato=${formato}`;
}
