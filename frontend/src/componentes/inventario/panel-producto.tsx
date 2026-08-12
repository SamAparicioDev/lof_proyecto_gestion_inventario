'use client';

/**
 * Panel de datos de la ficha de producto (T062) — cifras de inventario (stock/comprometido/
 * disponible, resaltando cuando `stockBajo`), datos de catálogo (ubicación, umbral) y estado.
 * "Editar" abre `ProductoForm` precargado (`PUT /api/productos/:id`) y "Activar"/"Desactivar"
 * cambia el estado (baja lógica, FR-012 — un producto `INACTIVO` deja de poder recibirse/
 * despacharse en documentos nuevos, pero conserva su historial de movimientos, Principio II).
 *
 * T111: `ProductoForm` pasó de tarjeta inline (que reemplazaba este panel, patrón de
 * `panel-cliente.tsx`) a `.dialog` sobre la ficha, porque ahora la MISMA implementación se abre
 * también desde una fila del listado (`tabla-inventario.tsx`), donde no hay tarjeta que
 * reemplazar — ver su TSDoc. La ficha y el listado editan con el mismo diálogo.
 *
 * Cada botón de escritura se muestra según SU permiso (T108): "Editar" con `productos.editar`
 * y "Activar/Desactivar" con `productos.cambiar_estado`, los mismos que exigen
 * `PUT /api/productos/:id` y `PUT /api/productos/:id/estado` — mismo criterio y mismos
 * permisos que las acciones por fila de `tabla-inventario.tsx`. Se leen con `usePuede()` del
 * contexto de sesión, no por prop (frontend/CLAUDE.md: ocultar UI es solo UX, la autoridad
 * real es `PermisosGuard` en el backend).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DatosActualizarProducto, FilaInventario } from '@trazo/compartido';
import { cambiarEstadoProducto } from '@/lib/api/productos';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoFechaHora, formatoMoneda } from '@/lib/formato';
import { PERMISOS } from '@/lib/permisos';
import { usePuede } from '@/lib/sesion';
import { AlertaStockBajo } from './alerta-stock-bajo';
import { EstadoProductoTag } from './estado-producto-tag';
import { ProductoForm } from './producto-form';
const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

function aValoresFormulario(fila: FilaInventario): DatosActualizarProducto {
  return {
    descripcion: fila.producto.descripcion,
    categoria: fila.producto.categoria ?? '',
    ubicacion: fila.producto.ubicacion ?? '',
    umbralStockBajo: fila.producto.umbralStockBajo,
    // US12: el costo se precarga con el vigente para que una edición de otro campo no lo
    // envíe vacío. Reenviarlo igual no registra nada (FR-074) — ver TSDoc de `ProductoForm`.
    ultimoCosto: fila.producto.ultimoCosto,
  };
}

export function PanelProducto({ fila }: { fila: FilaInventario }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const puedeEditar = usePuede(PERMISOS.PRODUCTOS_EDITAR);
  const puedeCambiarEstado = usePuede(PERMISOS.PRODUCTOS_CAMBIAR_ESTADO);

  async function alternarEstado(): Promise<void> {
    setErrorEstado(null);
    setCambiandoEstado(true);
    try {
      await cambiarEstadoProducto(fila.producto.id, fila.producto.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO');
      router.refresh();
      // `router.refresh()` vuelve a pedir los datos del Server Component padre, pero esta
      // instancia de `PanelProducto` (Client Component) no se remonta — su propio estado
      // local sobrevive al refresh. Sin este reset explícito, el botón queda deshabilitado en
      // "Procesando…" para siempre tras un cambio de estado exitoso (confirmado en vivo,
      // T062): el único código de error lo reseteaba, nunca el de éxito.
      setCambiandoEstado(false);
    } catch (error) {
      setErrorEstado(error instanceof ErrorApi ? error.mensaje : MENSAJE_ERROR_RED);
      setCambiandoEstado(false);
    }
  }

  return (
    <div className="card gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3" style={{ gap: 12 }}>
          <div>
            <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>SKU</h6>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 18 }}>{fila.producto.sku}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {fila.stockBajo && <AlertaStockBajo />}
          <EstadoProductoTag estado={fila.producto.estado} />
        </div>
      </div>

      <dl className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', margin: 0 }}>
        <CifraInventario etiqueta="Stock" valor={fila.stock} />
        <CifraInventario etiqueta="Comprometido" valor={fila.comprometido} />
        <CifraInventario etiqueta="Disponible" valor={fila.disponible} destacar={fila.stockBajo} />
      </dl>

      <dl className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', margin: 0 }}>
        <DatoSoloLectura etiqueta="Descripción" valor={fila.producto.descripcion} />
        <DatoSoloLectura etiqueta="Categoría" valor={fila.producto.categoria ?? '—'} />
        <DatoSoloLectura etiqueta="Ubicación" valor={fila.producto.ubicacion ?? '—'} />
        <DatoSoloLectura etiqueta="Umbral de stock bajo" valor={String(fila.producto.umbralStockBajo)} />
        {/* Costo de referencia vigente (US12/FR-071): editable desde "Editar", y su procedencia
            completa está en la sección "Historial de costos" de esta misma ficha. */}
        <DatoSoloLectura etiqueta="Costo unitario" valor={formatoMoneda(fila.producto.ultimoCosto)} />
        <DatoSoloLectura
          etiqueta="Último movimiento"
          valor={fila.producto.fechaUltimoMovimiento ? formatoFechaHora(fila.producto.fechaUltimoMovimiento) : '—'}
        />
      </dl>

      {(puedeEditar || puedeCambiarEstado) && (
        <div className="flex flex-wrap items-center gap-2">
          {puedeEditar && (
            <button type="button" className="btn btn-secondary" onClick={() => setEditando(true)}>
              Editar
            </button>
          )}
          {puedeCambiarEstado && (
            <button type="button" className="btn btn-ghost" disabled={cambiandoEstado} onClick={alternarEstado}>
              {cambiandoEstado
                ? 'Procesando…'
                : fila.producto.estado === 'ACTIVO'
                  ? 'Desactivar producto'
                  : 'Activar producto'}
            </button>
          )}
        </div>
      )}

      {errorEstado && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
          {errorEstado}
        </div>
      )}

      {editando && (
        <ProductoForm
          productoId={fila.producto.id}
          sku={fila.producto.sku}
          valoresIniciales={aValoresFormulario(fila)}
          onCerrar={() => setEditando(false)}
          onGuardado={() => router.refresh()}
        />
      )}
    </div>
  );
}

function CifraInventario({ etiqueta, valor, destacar }: { etiqueta: string; valor: number; destacar?: boolean }) {
  return (
    <div>
      <dt className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {etiqueta}
      </dt>
      <dd
        style={{
          margin: '2px 0 0',
          fontFamily: 'var(--font-heading)',
          fontSize: 22,
          color: destacar ? 'var(--color-accent-300)' : undefined,
        }}
      >
        {valor}
      </dd>
    </div>
  );
}

function DatoSoloLectura({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {etiqueta}
      </dt>
      <dd style={{ margin: '2px 0 0' }}>{valor}</dd>
    </div>
  );
}
