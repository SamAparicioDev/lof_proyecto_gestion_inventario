'use client';

/**
 * Formulario de subida de la carga masiva de inventario (T096) — `/inventario/importar`. Sube
 * un archivo `.xlsx` vía `POST /api/productos/importar` (`importarProductos`,
 * `lib/api/productos.ts`) y muestra el `ResumenImportacion` COMPLETO en pantalla: cifras
 * grandes de creados/actualizados/con stock inicial (mismo patrón `dt`/`dd` que
 * `CifraInventario` de `componentes/inventario/panel-producto.tsx`) y una tabla con las filas
 * que fallaron (número de fila REAL del Excel + mensaje en español) — nunca solo un mensaje
 * genérico de éxito, aunque también haya filas creadas/actualizadas en la misma respuesta
 * (procesamiento parcial, FR-051, contracts/rutas-frontend.md).
 *
 * Client Component: necesita estado interactivo para el archivo elegido, el envío y el
 * resultado — `app/(app)/inventario/importar/page.tsx` (Server Component) solo compone
 * (docs/arquitectura.md §7). El acceso por rol ya lo resolvió esa página (A,G) antes de
 * renderizar este componente; aquí no se repite esa comprobación.
 *
 * Error general (archivo ausente/no es `.xlsx`/vacío/supera 5&nbsp;MB, red) en un
 * `<div role="alert">` dentro de la propia tarjeta — no hay sistema de toasts (frontend/CLAUDE.md).
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ResumenImportacion } from '@trazo/compartido';
import { importarProductos } from '@/lib/api/productos';
import { ErrorApi } from '@/lib/api/cliente';
import { BarraFiltros, CampoFiltro } from '@/componentes/comunes/barra-filtros';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const MENSAJE_SIN_ARCHIVO = 'Selecciona un archivo Excel (.xlsx) para continuar.';

export function FormularioImportacion() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [resumen, setResumen] = useState<ResumenImportacion | null>(null);

  async function alEnviar(evento: React.FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (!archivo) {
      setErrorGeneral(MENSAJE_SIN_ARCHIVO);
      return;
    }

    setErrorGeneral(null);
    setEnviando(true);
    try {
      const datos = await importarProductos(archivo);
      setResumen(datos);
      setArchivo(null);
      if (inputRef.current) inputRef.current.value = '';
      // El inventario (stock/catálogo) cambió del lado del servidor: si el usuario vuelve a
      // /inventario tras esto, `router.refresh()` evita que Next sirva una copia en caché de
      // antes de subir el archivo (mismo criterio que `PanelProducto` tras editar/activar).
      router.refresh();
    } catch (error) {
      setResumen(null);
      setErrorGeneral(error instanceof ErrorApi ? error.mensaje : MENSAJE_ERROR_RED);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <BarraFiltros onSubmit={alEnviar} noValidate>
        <CampoFiltro ancho="largo">
          <label htmlFor="archivo-importacion">Archivo Excel (.xlsx)</label>
          <input
            id="archivo-importacion"
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="input"
            onChange={(evento) => setArchivo(evento.target.files?.[0] ?? null)}
          />
        </CampoFiltro>
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {enviando ? 'Subiendo…' : 'Subir archivo'}
        </button>
      </BarraFiltros>

      {errorGeneral && (
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {errorGeneral}
        </div>
      )}

      {resumen && <PanelResumenImportacion resumen={resumen} />}
    </div>
  );
}

/** Cifras + tabla de errores del resultado de la importación (FR-051). */
function PanelResumenImportacion({ resumen }: { resumen: ResumenImportacion }) {
  return (
    <div className="card gap-4 p-5">
      <h5 style={{ margin: 0 }}>Resultado de la importación</h5>

      <dl className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', margin: 0 }}>
        <Cifra etiqueta="Creados" valor={resumen.creados} />
        <Cifra etiqueta="Actualizados" valor={resumen.actualizados} />
        <Cifra etiqueta="Con stock inicial" valor={resumen.conStockInicial} />
        {/* US12/FR-074: cuántos PRECIOS cambió realmente el archivo. Va aquí, junto al resto
            del resultado, porque es la pregunta con la que se descarga el catálogo para
            corregir precios a escala — y una fila con el mismo costo no suma. */}
        <Cifra etiqueta="Costos actualizados" valor={resumen.costosActualizados} />
        <Cifra etiqueta="Filas con error" valor={resumen.errores.length} destacar={resumen.errores.length > 0} />
      </dl>

      {resumen.costosActualizados > 0 && (
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
          Los cambios de costo quedaron registrados en el historial de costos de cada producto (con tu nombre y la
          fecha). El stock no se modificó por ellos.
        </p>
      )}

      {resumen.errores.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Fila</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {resumen.errores.map((error, indice) => (
                // La misma fila del Excel puede aparecer solo una vez, pero el índice evita
                // colisiones de key si dos filas distintas produjeran el mismo número por un
                // dato inesperado del backend — nunca debería ocurrir, es defensivo.
                <tr key={`${error.fila}-${indice}`}>
                  <td>{error.fila}</td>
                  <td>{error.mensaje}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Cifra({ etiqueta, valor, destacar }: { etiqueta: string; valor: number; destacar?: boolean }) {
  return (
    <div>
      <dt className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {etiqueta}
      </dt>
      <dd
        style={{
          margin: '2px 0 0',
          fontFamily: 'var(--font-heading)',
          fontSize: 28,
          color: destacar ? 'var(--color-accent-300)' : undefined,
        }}
      >
        {valor}
      </dd>
    </div>
  );
}
