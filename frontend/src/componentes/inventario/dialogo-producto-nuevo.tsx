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
 *
 * ## `pideExistenciasIniciales` — lo ÚNICO que distingue a las dos puertas (US18, FR-107)
 *
 * Desde el CATÁLOGO, el alta puede traer proveedor, cantidad y valor unitario: un producto que
 * ya está en la bodega se da de alta con su stock en una sola gestión, y el backend registra el
 * ingreso que lo respalda (FR-106).
 *
 * Desde un INGRESO, esos tres campos NO se piden, y no es una simplificación: la cantidad y el
 * precio los pone la línea del ingreso que se está registrando, así que pedirlos también aquí
 * registraría la misma mercancía dos veces —una por el ingreso del alta y otra por el que el
 * usuario está escribiendo—. El proveedor, además, ya está elegido en la cabecera de ese
 * formulario.
 */
import { SelectorCategoria } from '@/componentes/categorias/selector-categoria';
import { SelectorProveedor } from '@/componentes/proveedores/selector-proveedor';
import { SelectorUnidadMedida } from '@/componentes/unidades-medida/selector-unidad-medida';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { esquemaCrearProducto, type DatosCrearProducto, type ProductoResumen } from '@trazo/compartido';
import { crearProducto } from '@/lib/api/productos';
import { ErrorApi } from '@/lib/api/cliente';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

/**
 * Campo numérico vacío → `undefined`, no `NaN` (US18).
 *
 * `valueAsNumber` convierte "" en `NaN`, y un `NaN` en `cantidadInicial` haría que el esquema
 * pidiera proveedor y valor unitario a quien dejó las existencias en blanco a propósito. Aquí
 * "vacío" tiene que significar "no informado", que es lo que FR-106 llama no traer el bloque.
 */
function aNumeroOpcional(valor: unknown): number | undefined {
  if (valor === '' || valor === null || valor === undefined) return undefined;
  const numero = Number(valor);
  return Number.isNaN(numero) ? undefined : numero;
}
const CAMPOS_VALIDOS = new Set([
  'sku',
  'descripcion',
  'categoriaId',
  'unidadMedidaId',
  'ubicacion',
  'umbralStockBajo',
  'proveedorId',
  'cantidadInicial',
  'valorUnitario',
]);

interface DialogoProductoNuevoProps {
  /** `true` desde el catálogo: el alta ofrece existencias iniciales. `false`/ausente desde un
   *  ingreso, donde la cantidad la pone la línea que se está registrando (ver TSDoc). */
  pideExistenciasIniciales?: boolean;
  onCerrar: () => void;
  onCreado: (producto: ProductoResumen) => void;
}

export function DialogoProductoNuevo({
  pideExistenciasIniciales = false,
  onCerrar,
  onCreado,
}: DialogoProductoNuevoProps) {
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosCrearProducto>({
    resolver: zodResolver(esquemaCrearProducto),
    // `unidadMedidaId: 0` no es elegible: el esquema exige un entero POSITIVO, así que enviar
    // el formulario sin tocar el selector marca el campo en vez de crear el producto (FR-102).
    defaultValues: {
      sku: '',
      descripcion: '',
      categoriaId: null,
      unidadMedidaId: 0,
      ubicacion: '',
      umbralStockBajo: 0,
      // US18: `undefined`, no 0 — "no informado" es un valor distinto de "cero", y el esquema
      // solo exige proveedor y valor unitario cuando la cantidad es mayor que cero (FR-106).
      proveedorId: undefined,
      cantidadInicial: undefined,
      valorUnitario: undefined,
    },
  });

  async function alEnviar(datos: DatosCrearProducto): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      const { id } = await crearProducto(datos);
      // Un producto recién creado nace en cero, salvo que el alta trajera existencias iniciales
      // (US18): entonces el backend registró un ingreso y el producto ya tiene ese stock y ese
      // costo. Se reflejan aquí para que el llamador reciba los MISMOS valores que leería de
      // `GET /api/productos` justo después (T052, sin comprometido aún).
      const conExistencias = (datos.cantidadInicial ?? 0) > 0;
      onCreado({
        id,
        sku: datos.sku,
        descripcion: datos.descripcion,
        ultimoCosto: conExistencias ? (datos.valorUnitario ?? 0) : 0,
        disponible: conExistencias ? (datos.cantidadInicial ?? 0) : 0,
      });
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
            <Controller
              name="categoriaId"
              control={control}
              render={({ field }) => (
                <SelectorCategoria id="producto-nuevo-categoria" value={field.value} onChange={field.onChange} />
              )}
            />
          </div>

          <div className="field">
            <label htmlFor="producto-nuevo-unidad">Unidad de medida</label>
            <Controller
              name="unidadMedidaId"
              control={control}
              render={({ field }) => (
                <SelectorUnidadMedida
                  id="producto-nuevo-unidad"
                  value={field.value}
                  onChange={field.onChange}
                  ariaInvalid={!!errors.unidadMedidaId}
                />
              )}
            />
            {errors.unidadMedidaId && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.unidadMedidaId.message}
              </p>
            )}
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
              // US26 (FR-122): es una cantidad, como el stock que vigila.
              step="1"
              min={0}
              className="input"
              {...register('umbralStockBajo', { valueAsNumber: true })}
            />
          </div>

          {pideExistenciasIniciales && (
            <fieldset
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
                margin: 0,
              }}
              className="flex flex-col gap-3"
            >
              <legend style={{ padding: '0 6px', fontSize: 12, color: 'var(--color-accent)' }}>
                Existencias iniciales (opcional)
              </legend>
              <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
                Si el producto ya está en la bodega, dilo aquí y se registrará el ingreso que
                respalda ese stock. Déjalo vacío para darlo de alta en cero.
              </p>

              <div className="field">
                <label htmlFor="producto-nuevo-proveedor">Proveedor</label>
                <Controller
                  name="proveedorId"
                  control={control}
                  render={({ field }) => (
                    <SelectorProveedor
                      id="producto-nuevo-proveedor"
                      value={field.value}
                      onChange={field.onChange}
                      ariaInvalid={!!errors.proveedorId}
                    />
                  )}
                />
                {errors.proveedorId && (
                  <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                    {errors.proveedorId.message}
                  </p>
                )}
              </div>

              <div className="field">
                <label htmlFor="producto-nuevo-cantidad">Cantidad inicial</label>
                <input
                  id="producto-nuevo-cantidad"
                  type="number"
                  // US26 (FR-122): estas existencias generan un ingreso real (FR-106).
                  step="1"
                  min={0}
                  className="input"
                  aria-invalid={!!errors.cantidadInicial}
                  {...register('cantidadInicial', { setValueAs: aNumeroOpcional })}
                />
                {errors.cantidadInicial && (
                  <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                    {errors.cantidadInicial.message}
                  </p>
                )}
              </div>

              <div className="field">
                <label htmlFor="producto-nuevo-valor">Valor unitario</label>
                <input
                  id="producto-nuevo-valor"
                  type="number"
                  step="0.01"
                  min={0}
                  className="input"
                  aria-invalid={!!errors.valorUnitario}
                  {...register('valorUnitario', { setValueAs: aNumeroOpcional })}
                />
                {errors.valorUnitario && (
                  <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                    {errors.valorUnitario.message}
                  </p>
                )}
              </div>
            </fieldset>
          )}

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
