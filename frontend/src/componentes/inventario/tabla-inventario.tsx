'use client';

/**
 * Tabla del listado de inventario con acciones por fila (T111, FR-010/FR-012) — hasta esta
 * tanda `/inventario` era solo de lectura: el catálogo se veía pero no se administraba desde su
 * propia pantalla (había que entrar a la ficha de cada producto para editarlo, y no había
 * ninguna forma de darlo de alta). Client Component recibido por
 * `app/(app)/inventario/page.tsx` (Server Component, que sigue resolviendo el listado paginado
 * vía `apiServidor`) porque editar y activar/desactivar necesitan estado local — mismo reparto
 * que `componentes/usuarios/tabla-usuarios.tsx` (T077) con `app/(app)/usuarios/page.tsx`.
 *
 * La columna "Estado" es el otro hueco que cerró T111: un producto dado de baja (`INACTIVO`,
 * FR-012) seguía apareciendo en el listado —correcto, conserva su historial (Principio II)—
 * pero indistinguible de uno activo. Reúne el `EstadoProductoTag` y la `AlertaStockBajo` que
 * antes iba sola en una columna sin encabezado, tal como ya conviven en la cabecera de la ficha
 * (`panel-producto.tsx`).
 *
 * Activar/desactivar es un botón directo, SIN diálogo de confirmación: es el criterio ya
 * establecido para clientes y productos (`panel-cliente.tsx`/`panel-producto.tsx`) porque la
 * baja es lógica y reversible con un clic; el diálogo de confirmación de
 * `tabla-usuarios.tsx` existe por un motivo que aquí no aplica (desactivar un usuario le corta
 * el acceso de inmediato). El error de un cambio fallido se muestra en un `<div role="alert">`
 * sobre la tabla, nunca un toast (frontend/CLAUDE.md).
 *
 * Permisos (T108): cada acción se renderiza según SU permiso — `productos.editar` para el
 * diálogo de edición y `productos.cambiar_estado` para activar/desactivar, los mismos que
 * exigen `PUT /api/productos/:id` y `PUT /api/productos/:id/estado`. Antes ambas compartían un
 * único booleano `esGerencial` porque los dos endpoints coincidían en roles (A,G); con los
 * permisos como dato eso ya no tiene por qué cumplirse (un rol puede corregir descripciones sin
 * poder dar de baja un producto), así que se separan. La columna "Acciones" solo aparece si la
 * sesión tiene al menos una de las dos.
 *
 * Los permisos se leen con `usePuede()` del contexto de sesión, no por prop: es un Client
 * Component bajo `<ProveedorSesion>` (T026), que ya tiene el perfil resuelto — pasarlos como
 * prop obligaría a la página a pedir el perfil solo para reenviarlo. Criterio uniforme de
 * T108: los Server Components gatean con `tienePermiso(perfil?.permisos, …)` porque no pueden
 * usar hooks; los Client Components usan `usePuede()`. Recuerda que ocultar la columna es solo
 * UX: la autoridad real es `PermisosGuard`, que responde `403` a quien llame el endpoint por su
 * cuenta.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DatosActualizarProducto, FilaInventario } from '@trazo/compartido';
import { cambiarEstadoProducto } from '@/lib/api/productos';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoFechaHora } from '@/lib/formato';
import { mensajeListadoVacio } from '@/lib/filtros';
import { PERMISOS } from '@/lib/permisos';
import { usePuede } from '@/lib/sesion';
import { AlertaStockBajo } from './alerta-stock-bajo';
import { EstadoProductoTag } from './estado-producto-tag';
import { ProductoForm } from './producto-form';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

/** Valores con los que se precarga el diálogo de edición desde la fila (`PUT /api/productos/:id`). */
function aValoresFormulario(fila: FilaInventario): DatosActualizarProducto {
  return {
    descripcion: fila.producto.descripcion,
    categoria: fila.producto.categoria ?? '',
    ubicacion: fila.producto.ubicacion ?? '',
    umbralStockBajo: fila.producto.umbralStockBajo,
    // US12: mismo criterio que `panel-producto.tsx` — el costo viaja precargado con el vigente
    // para que editar otra cosa no lo borre; reenviarlo igual no registra nada (FR-074).
    ultimoCosto: fila.producto.ultimoCosto,
  };
}

export function TablaInventario({ filas, hayFiltros }: { filas: FilaInventario[]; hayFiltros: boolean }) {
  const router = useRouter();
  const puedeEditar = usePuede(PERMISOS.PRODUCTOS_EDITAR);
  const puedeCambiarEstado = usePuede(PERMISOS.PRODUCTOS_CAMBIAR_ESTADO);
  const [filaEditando, setFilaEditando] = useState<FilaInventario | null>(null);
  const [productoCambiando, setProductoCambiando] = useState<number | null>(null);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const hayAcciones = puedeEditar || puedeCambiarEstado;
  const columnas = hayAcciones ? 9 : 8;

  async function alternarEstado(fila: FilaInventario): Promise<void> {
    setErrorEstado(null);
    setProductoCambiando(fila.producto.id);
    try {
      await cambiarEstadoProducto(fila.producto.id, fila.producto.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO');
      router.refresh();
    } catch (error) {
      setErrorEstado(error instanceof ErrorApi ? error.mensaje : MENSAJE_ERROR_RED);
    } finally {
      // `router.refresh()` vuelve a pedir los datos del Server Component padre, pero este
      // Client Component NO se remonta: su estado local sobrevive al refresh y hay que
      // limpiarlo a mano o la fila queda en "Procesando…" para siempre (mismo detalle ya
      // documentado en `panel-producto.tsx`).
      setProductoCambiando(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {errorEstado && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
          {errorEstado}
        </div>
      )}

      {/* Sin `p-0`: `.card` (Nocturne, sin capa CSS) impone su propio `padding` y esa utilidad
          de Tailwind nunca aplicó — docs/diseno-nocturne.md § regla de cascada. El `overflow`
          sí es un `style` inline porque `.card` no declara la propiedad: recorta las esquinas
          de la tabla al radio de la tarjeta. */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Descripción</th>
                <th>Stock</th>
                <th>Comprometido</th>
                <th>Disponible</th>
                <th>Ubicación</th>
                <th>Último movimiento</th>
                <th>Estado</th>
                {hayAcciones && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={columnas} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    {mensajeListadoVacio('productos', hayFiltros)}
                  </td>
                </tr>
              ) : (
                filas.map((fila) => (
                  <tr key={fila.producto.id}>
                    <td>
                      <Link href={`/inventario/${fila.producto.id}`}>{fila.producto.sku}</Link>
                    </td>
                    <td>{fila.producto.descripcion}</td>
                    <td>{fila.stock}</td>
                    <td>{fila.comprometido}</td>
                    <td>{fila.disponible}</td>
                    <td className="text-muted">{fila.producto.ubicacion ?? '—'}</td>
                    <td className="text-muted">
                      {fila.producto.fechaUltimoMovimiento ? formatoFechaHora(fila.producto.fechaUltimoMovimiento) : '—'}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <EstadoProductoTag estado={fila.producto.estado} />
                        {fila.stockBajo && <AlertaStockBajo />}
                      </div>
                    </td>
                    {hayAcciones && (
                      <td>
                        <div className="flex flex-wrap gap-2">
                          {puedeEditar && (
                            <button type="button" className="btn btn-secondary" onClick={() => setFilaEditando(fila)}>
                              Editar
                            </button>
                          )}
                          {puedeCambiarEstado && (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={productoCambiando === fila.producto.id}
                              onClick={() => alternarEstado(fila)}
                            >
                              {productoCambiando === fila.producto.id
                                ? 'Procesando…'
                                : fila.producto.estado === 'ACTIVO'
                                  ? 'Desactivar'
                                  : 'Activar'}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {filaEditando && (
        <ProductoForm
          productoId={filaEditando.producto.id}
          sku={filaEditando.producto.sku}
          valoresIniciales={aValoresFormulario(filaEditando)}
          onCerrar={() => setFilaEditando(null)}
          onGuardado={() => router.refresh()}
        />
      )}
    </div>
  );
}
