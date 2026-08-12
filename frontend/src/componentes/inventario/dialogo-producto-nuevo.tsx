'use client';

/**
 * Diálogo de alta de producto (T035/FR-011, movido aquí en T111) — reutiliza
 * `esquemaCrearProducto` y `POST /api/productos` en un formulario mínimo dentro de `.dialog`
 * (Nocturne).
 *
 * Vivía en `componentes/ingresos/` cuando su ÚNICA puerta de entrada era el formulario de
 * ingresos (alta rápida sin interrumpir el registro de una factura). T111 le agregó la segunda
 * puerta —el botón "Nuevo producto" del listado de inventario, que es donde se administra el
 * catálogo (FR-010)— así que el componente pasó al módulo dueño del concepto (`inventario/`) y
 * `ingreso-form.tsx` lo importa cruzando de módulo. Sigue habiendo UNA sola implementación: el
 * alta rápida desde ingresos y el alta desde el catálogo son literalmente el mismo diálogo,
 * el mismo esquema y el mismo endpoint.
 *
 * `onCreado` entrega el producto recién creado y NO cierra el diálogo por su cuenta: cada
 * llamador decide qué hacer con él y cuándo cerrar.
 * - `componentes/ingresos/ingreso-form.tsx`: lo agrega a las opciones del selector y lo
 *   preselecciona en la línea que abrió el diálogo ("la línea actual" del enunciado de T035).
 * - `componentes/inventario/boton-nuevo-producto.tsx`: ignora el producto y hace
 *   `router.refresh()` para que el listado del Server Component lo muestre.
 *
 * Roles: `POST /api/productos` es A,G,O (contracts/api-rest.md § Productos) — a diferencia de
 * la edición y del cambio de estado, que son A,G. Por eso este diálogo NO se oculta al
 * Operario en ninguna de sus dos entradas: es una acción que sí puede ejecutar.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { esquemaCrearProducto, type DatosCrearProducto, type ProductoResumen } from '@trazo/compartido';
import { crearProducto } from '@/lib/api/productos';
import { ErrorApi } from '@/lib/api/cliente';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const CAMPOS_VALIDOS = new Set(['sku', 'descripcion', 'categoria', 'ubicacion', 'umbralStockBajo']);

interface DialogoProductoNuevoProps {
  onCerrar: () => void;
  onCreado: (producto: ProductoResumen) => void;
}

export function DialogoProductoNuevo({ onCerrar, onCreado }: DialogoProductoNuevoProps) {
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosCrearProducto>({
    resolver: zodResolver(esquemaCrearProducto),
    defaultValues: { sku: '', descripcion: '', categoria: '', ubicacion: '', umbralStockBajo: 0 },
  });

  async function alEnviar(datos: DatosCrearProducto): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      const { id } = await crearProducto(datos);
      // Un producto recién creado nace con stock/costo en 0 (backend/prisma/schema.prisma —
      // valores DEFAULT de `productos`): mismos valores que tendría si se leyera de
      // `GET /api/productos` inmediatamente después de crearlo (T052, sin comprometido aún).
      onCreado({ id, sku: datos.sku, descripcion: datos.descripcion, ultimoCosto: 0, disponible: 0 });
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrorGeneral(error.mensaje);
        for (const [campo, mensaje] of Object.entries(error.campos ?? {})) {
          if (CAMPOS_VALIDOS.has(campo)) {
            setError(campo as keyof DatosCrearProducto, { message: mensaje });
          }
        }
      } else {
        setErrorGeneral(MENSAJE_ERROR_RED);
      }
      setEnviando(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => !enviando && onCerrar()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-producto-nuevo"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-title" id="titulo-producto-nuevo">
          Producto nuevo
        </div>
        <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-3" noValidate>
          <div className="field">
            <label htmlFor="producto-nuevo-sku">SKU</label>
            <input
              id="producto-nuevo-sku"
              className="input"
              aria-invalid={!!errors.sku}
              aria-describedby={errors.sku ? 'producto-nuevo-sku-error' : undefined}
              {...register('sku')}
            />
            {errors.sku && (
              <p id="producto-nuevo-sku-error" role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.sku.message}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="producto-nuevo-descripcion">Descripción</label>
            <input
              id="producto-nuevo-descripcion"
              className="input"
              aria-invalid={!!errors.descripcion}
              aria-describedby={errors.descripcion ? 'producto-nuevo-descripcion-error' : undefined}
              {...register('descripcion')}
            />
            {errors.descripcion && (
              <p
                id="producto-nuevo-descripcion-error"
                role="alert"
                style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}
              >
                {errors.descripcion.message}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="producto-nuevo-categoria">Categoría (opcional)</label>
            <input id="producto-nuevo-categoria" className="input" {...register('categoria')} />
          </div>

          <div className="field">
            <label htmlFor="producto-nuevo-ubicacion">Ubicación (opcional)</label>
            <input id="producto-nuevo-ubicacion" className="input" {...register('ubicacion')} />
          </div>

          <div className="field">
            <label htmlFor="producto-nuevo-umbral">Umbral de stock bajo (opcional)</label>
            <input
              id="producto-nuevo-umbral"
              type="number"
              step="0.01"
              min={0}
              className="input"
              {...register('umbralStockBajo', { valueAsNumber: true })}
            />
          </div>

          {errorGeneral && (
            <div role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>
              {errorGeneral}
            </div>
          )}

          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={enviando}>
              {enviando ? 'Creando…' : 'Crear producto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
