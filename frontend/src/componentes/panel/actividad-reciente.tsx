/**
 * Actividad reciente del panel de control (T116, US10) — los 10 movimientos de inventario más
 * recientes que devuelve `GET /api/panel` (`movimientosRecientes`), en la misma tabla `.table`
 * de Nocturne que usa el resto de la app.
 *
 * Presentación pura: no calcula ni reordena nada. El backend ya envía el orden (más reciente
 * primero), el producto y el usuario resueltos a texto legible, y el mismo signo de movimiento
 * que muestra la ficha de producto se pinta aquí con los helpers YA existentes
 * (`TipoMovimientoTag`/`signoMovimiento`, `componentes/inventario/tipo-movimiento-tag.tsx`) —
 * no se duplica la traducción de tipos ni el criterio de signo (docs/arquitectura.md §5, DRY).
 *
 * Estado vacío (US10-AS3): con la lista vacía se muestra "Sin movimientos registrados." en
 * español dentro de la propia tabla — nunca una celda en blanco, un "NaN" ni un error.
 *
 * `verTodos` llega solo cuando la sesión puede abrir `/reportes/movimientos` (permiso
 * `reportes.ver`, resuelto por la página): ofrecer el enlace a quien recibiría un `403` sería
 * exactamente lo que frontend/CLAUDE.md prohíbe. Ocultarlo es UX; la autoridad es el guard.
 */
import Link from 'next/link';
import type { PanelMovimientoReciente } from '@trazo/compartido';
import { formatoFechaHora } from '@/lib/formato';
import { signoMovimiento, TipoMovimientoTag } from '@/componentes/inventario/tipo-movimiento-tag';

export interface ActividadRecienteProps {
  movimientos: PanelMovimientoReciente[];
  /** `true` si la sesión puede abrir el reporte de movimientos completo. */
  verTodos: boolean;
}

export function ActividadReciente({ movimientos, verTodos }: ActividadRecienteProps) {
  return (
    <section className="flex flex-col gap-[var(--space-4)]">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <h4 style={{ margin: 0 }}>Actividad reciente</h4>
        {verTodos && (
          <Link href="/reportes/movimientos" style={{ fontSize: 13 }}>
            Ver todos los movimientos
          </Link>
        )}
      </div>

      {/* Contenedor de tabla: `.card` + `overflow:hidden`, igual que los 7 listados de la app.
          SIN el `p-0` que ellos arrastran — `.card` declara `padding` y, al estar sin capa,
          esa utilidad nunca aplicó (docs/diseno-nocturne.md § cascada: queda anotada y sin
          cambiar donde ya existe, pero no se escribe nueva). El render es idéntico. */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    Sin movimientos registrados.
                  </td>
                </tr>
              ) : (
                movimientos.map((movimiento) => (
                  <tr key={movimiento.id}>
                    <td>{formatoFechaHora(movimiento.fechaHora)}</td>
                    <td>
                      <TipoMovimientoTag tipo={movimiento.tipo} />
                    </td>
                    <td>{movimiento.producto}</td>
                    <td>
                      {signoMovimiento(movimiento.tipo) > 0 ? '+' : '-'}
                      {movimiento.cantidad}
                    </td>
                    <td className="text-muted">{movimiento.usuario}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
