/**
 * Carga masiva de inventario desde plantilla Excel (T096) — `/inventario/importar`, exige el
 * permiso `productos.importar` (`contracts/rutas-frontend.md`, US8 FR-048…FR-052).
 *
 * Server Component: mismo patrón de control de acceso que `app/(app)/usuarios/page.tsx`
 * (corrección de revisión adversarial, Tanda 7, hallazgo HIGH) — el PERMISO se resuelve
 * PRIMERO (`obtenerPerfilServidor`, T108: `productos.importar`, el mismo que exigen los tres
 * endpoints de esta pantalla con `@RequierePermiso`, ya no un nombre de rol fijo — FR-058) y
 * solo entonces se muestran las descargas y el formulario de subida; quien entre por URL
 * directa (el botón de `app/(app)/inventario/page.tsx` ya está oculto, pero eso es solo UX) ve
 * un aviso claro en español (`role="alert"`) SIN llegar a golpear `GET /api/productos/
 * {plantilla,catalogo}-importacion` ni `POST /api/productos/importar` — la autoridad real es
 * `PermisosGuard` en el backend.
 *
 * Las DOS descargas son enlaces nativos (sin JavaScript, sin pasar por `api<T>()`, que solo
 * interpreta JSON): el navegador las descarga directo gracias al `Content-Disposition:
 * attachment` que fija el backend (contracts/rutas-frontend.md: "el botón 'Descargar plantilla'
 * navega a..."). No usan el `descargarArchivo()` de `lib/api/reportes.ts` porque ese `fetch`
 * aislado existe para poder pintar el error DENTRO de una página de reporte sin perder el
 * filtro ya generado en pantalla; aquí no hay estado que perder y ninguna de las dos rutas
 * recibe parámetros, así que un `<a href>` es la opción simple y correcta.
 *
 * T112 (Phase 13, FR-053) agrega la SEGUNDA descarga: el catálogo actual en la misma estructura
 * de columnas, para editar en Excel lo que ya existe y volver a subirlo como actualización
 * masiva. Se presentan como dos tarjetas hermanas con su propio título y texto de ayuda —
 * "empezar de cero" vs. "actualizar lo que ya existe"— porque la queja del dueño del proyecto
 * era justamente que la única descarga disponible servía solo para lo primero.
 *
 * El formulario de subida sí necesita estado interactivo (archivo elegido, envío, resultado) y
 * vive en el Client Component `componentes/inventario/formulario-importacion.tsx` — esta página
 * solo compone (docs/arquitectura.md §7).
 */
import { DownloadSimple } from '@phosphor-icons/react/dist/ssr';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { mensajeSinPermiso, PERMISOS, tienePermiso } from '@/lib/permisos';
import { FormularioImportacion } from '@/componentes/inventario/formulario-importacion';

const MENSAJE_SIN_PERMISO = mensajeSinPermiso('importar inventario');

export default async function PaginaImportarInventario() {
  const perfil = await obtenerPerfilServidor();
  const puedeImportar = tienePermiso(perfil?.permisos, PERMISOS.PRODUCTOS_IMPORTAR);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Almacén</h6>
        <h2 style={{ margin: 0 }}>Importar desde Excel</h2>
      </div>

      {!puedeImportar ? (
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {MENSAJE_SIN_PERMISO}
        </div>
      ) : (
        <>
          <p className="text-muted" style={{ margin: 0, maxWidth: 720, fontSize: 13 }}>
            Descarga uno de los dos archivos, complétalo y súbelo abajo. Una fila con SKU nuevo crea
            el producto; una fila con SKU que ya existe lo actualiza, nunca lo duplica. Si una fila
            trae cantidad inicial, esa cantidad queda registrada como entrada de inventario trazable.
          </p>

          {/* Contenedor (`.card`, Nocturne) y layout (utilidades de Tailwind) en elementos
              DISTINTOS: `.card` está sin capa CSS y gana siempre sobre `@layer utilities`, así
              que una rejilla o un `flex` escritos sobre el propio `.card` no se aplicarían —
              misma regla y mismo bug que la barra de filtros (T110, ver
              `componentes/comunes/barra-filtros.tsx` y docs/diseno-nocturne.md). Aquí la rejilla
              vive en el elemento PADRE de las tarjetas, que no lleva ninguna clase de Nocturne. */}
          <div className="grid gap-[var(--space-4)] md:grid-cols-2">
            <OpcionDescarga
              kicker="Empezar de cero"
              titulo="Plantilla vacía"
              ayuda={
                'Archivo con las columnas y una fila de ejemplo para borrar. Úsalo para dar de alta ' +
                'productos que todavía no existen en LOF, con su cantidad inicial si además quieres ' +
                'cargarles stock.'
              }
              href="/api/productos/plantilla-importacion"
              textoBoton="Descargar plantilla vacía"
            />
            <OpcionDescarga
              kicker="Actualizar lo que ya existe"
              titulo="Catálogo actual"
              ayuda={
                'Tus productos de hoy, con las mismas columnas. Corrige descripciones, categorías, ' +
                'ubicaciones o umbrales en Excel y vuelve a subir el archivo: cada fila actualiza su ' +
                'producto por SKU. Las columnas de cantidad y valor llegan vacías a propósito — déjalas ' +
                'así y el stock no cambia.'
              }
              href="/api/productos/catalogo-importacion"
              textoBoton="Descargar catálogo actual"
            />
          </div>

          <FormularioImportacion />
        </>
      )}
    </div>
  );
}

/** Una de las dos descargas de la página (FR-048 / FR-053). `.card` ya apila sus hijos en
 *  columna con su propio `gap`, así que dentro NO hay utilidades de layout que puedan chocar con
 *  él; el botón va envuelto en un `<div>` para que quede a su ancho natural en vez de estirarse
 *  al ancho de la tarjeta (los hijos de un flex column se estiran por defecto). `.card-body`
 *  trae `flex: 1`, así que con textos de ayuda de distinto largo los dos botones siguen
 *  quedando alineados al pie de sus tarjetas. */
function OpcionDescarga({
  kicker,
  titulo,
  ayuda,
  href,
  textoBoton,
}: {
  kicker: string;
  titulo: string;
  ayuda: string;
  href: string;
  textoBoton: string;
}) {
  return (
    <div className="card">
      <span className="card-kicker">{kicker}</span>
      <h3 className="card-title" style={{ margin: 0 }}>
        {titulo}
      </h3>
      <p className="card-body">{ayuda}</p>
      <div>
        <a href={href} className="btn btn-secondary">
          <DownloadSimple size={16} /> {textoBoton}
        </a>
      </div>
    </div>
  );
}
