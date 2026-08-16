'use client';

/**
 * Diálogo de edición de un producto del catálogo (T062, convertido a diálogo en T111) —
 * descripción, categoría, ubicación, umbral de stock bajo y, desde US12 (T128), COSTO
 * UNITARIO (`PUT /api/productos/:id`, FR-010/FR-071). No tiene modo alta: crear vive en
 * `dialogo-producto-nuevo.tsx` (FR-011), que usa
 * otro esquema (`esquemaCrearProducto` incluye `sku`) y otro endpoint — misma separación que
 * `componentes/usuarios/usuario-form.tsx` hace entre `UsuarioForm` y `EditarUsuarioForm`.
 *
 * **Por qué es un diálogo y ya no una tarjeta inline** (T111): T062 lo montaba reemplazando la
 * tarjeta de la ficha (`<form className="card …">`, patrón de `panel-cliente.tsx`), lo que solo
 * funciona donde existe una tarjeta que reemplazar. T111 necesita editar TAMBIÉN desde una fila
 * del listado (`tabla-inventario.tsx`), donde no hay tal tarjeta, y el requisito era reutilizar
 * este formulario, no clonarlo. Un `.dialog` sirve a los dos llamadores sin ramas de estilo, y
 * es lo que ya hace la otra pantalla de administración con acciones por fila (`/usuarios`).
 *
 * El SKU se muestra deshabilitado como referencia de qué producto se está editando (importante
 * al abrirlo desde una fila) pero NO se envía: `esquemaActualizarProducto` lo excluye a
 * propósito — es el identificador de negocio del producto y no se edita tras el alta (ver su
 * TSDoc en `packages/compartido/src/esquemas/productos.ts`). Mismo criterio que el campo
 * `login` de `EditarUsuarioForm`.
 *
 * **El campo de costo (US12/T128)** llega SIEMPRE precargado con el costo vigente (`fila.
 * producto.ultimoCosto`) y se envía siempre, incluso sin tocarlo: eso es seguro porque el
 * backend solo registra un cambio cuando el valor difiere del actual (FR-074), así que
 * guardar una corrección de descripción no ensucia el historial de precios. Cambiarlo SÍ deja
 * rastro permanente (quién, cuándo, de cuánto a cuánto — FR-072), y por eso la etiqueta del
 * campo lo dice: quien lo edita debe saber que no es un cambio anónimo.
 *
 * Errores de servidor (`ErrorApi.campos`) se pintan junto al campo correspondiente; el
 * `mensaje` general va en un `<div role="alert">` dentro del diálogo (frontend/CLAUDE.md, no
 * hay sistema de toasts).
 */
import { useState } from 'react';
import { Controller, useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { esquemaActualizarProducto, type DatosActualizarProducto } from '@trazo/compartido';
import { SelectorCategoria } from '@/componentes/categorias/selector-categoria';
import { SelectorUnidadMedida } from '@/componentes/unidades-medida/selector-unidad-medida';
import { actualizarProducto } from '@/lib/api/productos';
import { ErrorApi } from '@/lib/api/cliente';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const CAMPOS_VALIDOS = new Set<keyof DatosActualizarProducto>([
  'descripcion',
  'categoriaId',
  'unidadMedidaId',
  'ubicacion',
  'umbralStockBajo',
  'ultimoCosto',
]);

interface ProductoFormProps {
  productoId: number;
  /** Solo lectura: identifica el producto que se edita; el SKU no es editable (ver TSDoc). */
  sku: string;
  valoresIniciales: DatosActualizarProducto;
  /** Categoría que el producto ya tiene, para no perderla si fue desactivada (FR-086). */
  categoriaActual?: { id: number; nombre: string } | null;
  /** Unidad que el producto ya tiene, para conservarla aunque esté inactiva. `null` en los
   *  productos anteriores a US17: el formulario abre el campo vacío y exige completarlo. */
  unidadActual?: { id: number; nombre: string; abreviatura: string } | null;
  /** Cierra el diálogo sin guardar (botón "Cancelar", clic en el fondo). */
  onCerrar: () => void;
  /** Tras guardar con éxito, antes de cerrar — el llamador hace `router.refresh()`. */
  onGuardado: () => void;
}

export function ProductoForm({
  productoId,
  sku,
  valoresIniciales,
  categoriaActual,
  unidadActual,
  onCerrar,
  onGuardado,
}: ProductoFormProps) {
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosActualizarProducto>({
    resolver: zodResolver(esquemaActualizarProducto),
    defaultValues: valoresIniciales,
  });

  async function alEnviar(datos: DatosActualizarProducto): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      await actualizarProducto(productoId, datos);
      onGuardado();
      onCerrar();
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrorGeneral(error.mensaje);
        for (const [campo, mensaje] of Object.entries(error.campos ?? {})) {
          if (CAMPOS_VALIDOS.has(campo as keyof DatosActualizarProducto)) {
            setError(campo as keyof DatosActualizarProducto, { message: mensaje });
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
        aria-labelledby="titulo-producto-editar"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-title" id="titulo-producto-editar">
          Editar producto
        </div>
        <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-3" noValidate>
          <div className="field">
            <label htmlFor="producto-editar-sku">SKU</label>
            <input id="producto-editar-sku" className="input" value={sku} disabled readOnly />
          </div>
          <CampoTexto
            id="producto-editar-descripcion"
            label="Descripción"
            error={errors.descripcion?.message}
            registro={register('descripcion')}
          />
          <div className="field">
            <label htmlFor="producto-editar-categoria">Categoría (opcional)</label>
            <Controller
              name="categoriaId"
              control={control}
              render={({ field }) => (
                <SelectorCategoria
                  id="producto-editar-categoria"
                  value={field.value}
                  onChange={field.onChange}
                  categoriaActual={categoriaActual}
                />
              )}
            />
            {errors.categoriaId && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.categoriaId.message}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="producto-editar-unidad">Unidad de medida</label>
            <Controller
              name="unidadMedidaId"
              control={control}
              render={({ field }) => (
                <SelectorUnidadMedida
                  id="producto-editar-unidad"
                  value={typeof field.value === 'number' ? field.value : undefined}
                  onChange={field.onChange}
                  unidadActual={unidadActual}
                  ariaInvalid={!!errors.unidadMedidaId}
                />
              )}
            />
            {errors.unidadMedidaId && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.unidadMedidaId.message}
              </p>
            )}
            {!unidadActual && (
              <p className="text-muted" style={{ fontSize: 12, marginTop: 5 }}>
                Este producto es anterior a que existieran las unidades de medida: elige la suya
                para poder guardar.
              </p>
            )}
          </div>
          <CampoTexto
            id="producto-editar-ubicacion"
            label="Ubicación (opcional)"
            error={errors.ubicacion?.message}
            registro={register('ubicacion')}
          />
          <div className="field">
            <label htmlFor="producto-editar-umbral">Umbral de stock bajo</label>
            <input
              id="producto-editar-umbral"
              type="number"
              step="0.01"
              min={0}
              className="input"
              aria-invalid={!!errors.umbralStockBajo}
              aria-describedby={errors.umbralStockBajo ? 'producto-editar-umbral-error' : undefined}
              {...register('umbralStockBajo', { valueAsNumber: true })}
            />
            {errors.umbralStockBajo && (
              <p
                id="producto-editar-umbral-error"
                role="alert"
                style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}
              >
                {errors.umbralStockBajo.message}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="producto-editar-costo">Costo unitario</label>
            <input
              id="producto-editar-costo"
              type="number"
              step="0.01"
              min={0}
              className="input"
              aria-invalid={!!errors.ultimoCosto}
              aria-describedby={
                errors.ultimoCosto ? 'producto-editar-costo-error' : 'producto-editar-costo-ayuda'
              }
              {...register('ultimoCosto', { valueAsNumber: true })}
            />
            {errors.ultimoCosto ? (
              <p
                id="producto-editar-costo-error"
                role="alert"
                style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}
              >
                {errors.ultimoCosto.message}
              </p>
            ) : (
              <p id="producto-editar-costo-ayuda" className="text-muted" style={{ fontSize: 12, marginTop: 5 }}>
                Cambiarlo queda registrado en el historial de costos del producto, con tu nombre y la fecha. No
                modifica el stock.
              </p>
            )}
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
              {enviando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CampoTexto({
  id,
  label,
  error,
  registro,
}: {
  id: string;
  label: string;
  error?: string;
  registro: UseFormRegisterReturn;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} {...registro} />
      {error && (
        <p id={`${id}-error`} role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          {error}
        </p>
      )}
    </div>
  );
}
