'use client';

/**
 * Formulario de orden de compra — cabecera + líneas dinámicas + panel de sugerencias
 * (US16, T174, FR-094/FR-098).
 *
 * Reutilizado en dos rutas: alta (`/ordenes-compra/nueva`) y edición de una orden en BORRADOR
 * (`/ordenes-compra/[id]`, ya filtrada por la página que lo monta). Valida para UX con
 * `esquemaCrearOrdenCompra` — el MISMO esquema que el backend usa como autoridad.
 *
 * ## El panel de sugerencias, que es lo que da valor a esta pantalla
 *
 * En cuanto se elige el proveedor, se piden sus sugerencias (`GET /sugerencias`) y se muestran
 * ARRIBA de las líneas, con el porqué a la vista: cuánto queda disponible, cuál es el umbral y
 * cuánto se propone pedir. Nada se agrega solo: hay un botón por fila y otro para agregarlas
 * todas. Esa decisión es deliberada — una orden que se llenara sola sería una orden que nadie
 * revisó, y aquí se está comprometiendo dinero con un tercero.
 *
 * Agregar una sugerencia que ya está en las líneas no la duplica (el esquema lo rechazaría, y
 * además el usuario perdería la cantidad que ya hubiera ajustado): se deja la línea como está.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type Path,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Plus, Trash, ArrowsClockwise } from '@phosphor-icons/react/dist/ssr';
import {
  esquemaCrearOrdenCompra,
  type DatosCrearOrdenCompra,
  type LineaOrdenCompra,
  type ProductoResumen,
  type SugerenciaCompra,
} from '@trazo/compartido';
import { actualizarOrdenCompra, crearOrdenCompra, sugerenciasDeCompra } from '@/lib/api/ordenes-compra';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoMoneda } from '@/lib/formato';
import { CampoFecha as CampoFechaBase } from '@/componentes/comunes/campo-fecha';
import { SelectorProveedor } from '@/componentes/proveedores/selector-proveedor';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

/** Ruta `lineas.N.campo` que arma `PipeValidacionZod` para errores de líneas individuales. */
const PATRON_ERROR_LINEA = /^lineas\.(\d+)\.(productoId|cantidad|precioUnitario)$/;
const CAMPOS_CABECERA = new Set<keyof DatosCrearOrdenCompra>([
  'proveedorId',
  'fechaOrden',
  'fechaEntregaEsperada',
  'observaciones',
]);

function crearLineaVacia(): LineaOrdenCompra {
  return { productoId: 0, cantidad: 1, precioUnitario: 0 };
}

interface OrdenCompraFormProps {
  /** Catálogo para el `<select>` de línea (Nocturne no documenta un combobox). */
  productos: ProductoResumen[];
  /** Presente en modo edición; ausente en alta. */
  ordenId?: number;
  valoresIniciales?: DatosCrearOrdenCompra;
  /** Proveedor que la orden ya tiene, para conservarlo aunque esté inactivo. */
  proveedorActual?: { id: number; nombre: string } | null;
}

export function OrdenCompraForm({ productos, ordenId, valoresIniciales, proveedorActual }: OrdenCompraFormProps) {
  const router = useRouter();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [sugerencias, setSugerencias] = useState<SugerenciaCompra[]>([]);
  const [cargandoSugerencias, setCargandoSugerencias] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DatosCrearOrdenCompra>({
    resolver: zodResolver(esquemaCrearOrdenCompra),
    defaultValues: valoresIniciales ?? {
      proveedorId: 0,
      fechaOrden: new Date().toISOString().slice(0, 10),
      fechaEntregaEsperada: undefined,
      observaciones: '',
      lineas: [crearLineaVacia()],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' });
  const lineasEnVivo = useWatch({ control, name: 'lineas' });
  const proveedorSeleccionado = useWatch({ control, name: 'proveedorId' });

  const total = lineasEnVivo.reduce(
    (acumulado, linea) => acumulado + (Number(linea.cantidad) || 0) * (Number(linea.precioUnitario) || 0),
    0,
  );

  const cargarSugerencias = useCallback(async (proveedorId: number) => {
    setCargandoSugerencias(true);
    try {
      setSugerencias(await sugerenciasDeCompra(proveedorId));
    } catch {
      // Que no haya sugerencias NO puede impedir armar la orden a mano: el panel simplemente
      // no se muestra. Es una ayuda, no un paso obligatorio del flujo.
      setSugerencias([]);
    } finally {
      setCargandoSugerencias(false);
    }
  }, []);

  useEffect(() => {
    if (!proveedorSeleccionado || proveedorSeleccionado <= 0) {
      setSugerencias([]);
      return;
    }
    void cargarSugerencias(proveedorSeleccionado);
  }, [proveedorSeleccionado, cargarSugerencias]);

  /** Agrega la sugerencia como línea, salvo que ese producto ya esté: no se duplica ni se pisa
   *  la cantidad que el usuario hubiera ajustado a mano. */
  function agregarSugerencia(sugerencia: SugerenciaCompra): void {
    const yaEsta = (lineasEnVivo ?? []).some((linea) => Number(linea.productoId) === sugerencia.productoId);
    if (yaEsta) return;

    // La primera línea nace vacía (`productoId: 0`): si sigue sin tocar, se reemplaza en vez de
    // dejar una línea inválida colgando encima de las que el usuario acaba de agregar.
    const indiceVacia = (lineasEnVivo ?? []).findIndex((linea) => !linea.productoId);
    const nueva: LineaOrdenCompra = {
      productoId: sugerencia.productoId,
      cantidad: sugerencia.cantidadSugerida,
      precioUnitario: sugerencia.precioSugerido,
    };
    if (indiceVacia >= 0) remove(indiceVacia);
    append(nueva);
  }

  function aplicarErroresServidor(campos: Record<string, string>): void {
    for (const [campo, mensaje] of Object.entries(campos)) {
      if (CAMPOS_CABECERA.has(campo as keyof DatosCrearOrdenCompra)) {
        setError(campo as keyof DatosCrearOrdenCompra, { message: mensaje });
        continue;
      }
      const coincidencia = PATRON_ERROR_LINEA.exec(campo);
      if (coincidencia) {
        const [, indice, subcampo] = coincidencia;
        setError(`lineas.${indice}.${subcampo}` as Path<DatosCrearOrdenCompra>, { message: mensaje });
      }
    }
  }

  async function alEnviar(datos: DatosCrearOrdenCompra): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      if (ordenId) {
        await actualizarOrdenCompra(ordenId, datos);
        router.push(`/ordenes-compra/${ordenId}`);
      } else {
        const { id } = await crearOrdenCompra(datos);
        router.push(`/ordenes-compra/${id}`);
      }
      router.refresh();
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrorGeneral(error.mensaje);
        if (error.campos) aplicarErroresServidor(error.campos);
      } else {
        setErrorGeneral(MENSAJE_ERROR_RED);
      }
      setEnviando(false);
    }
  }

  const mensajeErrorLineas = errors.lineas && 'message' in errors.lineas ? errors.lineas.message : undefined;
  const sugerenciasPendientes = sugerencias.filter(
    (sugerencia) => !(lineasEnVivo ?? []).some((linea) => Number(linea.productoId) === sugerencia.productoId),
  );

  return (
    <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-5" noValidate>
      <div className="card gap-4 p-5">
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="field">
            <label htmlFor="proveedorId">Proveedor</label>
            <Controller
              name="proveedorId"
              control={control}
              render={({ field }) => (
                <SelectorProveedor
                  id="proveedorId"
                  value={typeof field.value === 'number' ? field.value : undefined}
                  onChange={field.onChange}
                  proveedorActual={proveedorActual}
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
          <CampoFecha id="fechaOrden" label="Fecha de la orden" error={errors.fechaOrden?.message} control={control} name="fechaOrden" />
          <CampoFecha
            id="fechaEntregaEsperada"
            label="Entrega esperada (opcional)"
            error={errors.fechaEntregaEsperada?.message}
            control={control}
            name="fechaEntregaEsperada"
          />
        </div>
        <div className="field">
          <label htmlFor="observaciones">Observaciones (opcional)</label>
          <textarea id="observaciones" className="input" rows={2} {...register('observaciones')} />
        </div>
      </div>

      {/* Panel de sugerencias (FR-098) — solo cuando hay proveedor y algo que proponer. */}
      {proveedorSeleccionado > 0 && (cargandoSugerencias || sugerenciasPendientes.length > 0) && (
        <div className="card gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h5 style={{ margin: 0 }}>Sugerencias para este proveedor</h5>
              <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                Productos bajo su umbral de stock que este proveedor ya te ha suministrado. Las
                cantidades son una propuesta: cámbialas al agregarlas.
              </p>
            </div>
            {sugerenciasPendientes.length > 1 && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => sugerenciasPendientes.forEach(agregarSugerencia)}
              >
                <ArrowsClockwise size={14} /> Agregar todas
              </button>
            )}
          </div>

          {cargandoSugerencias ? (
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
              Buscando qué te hace falta…
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th style={{ textAlign: 'right' }}>Disponible</th>
                    <th style={{ textAlign: 'right' }}>Umbral</th>
                    <th style={{ textAlign: 'right' }}>Sugerido</th>
                    <th aria-label="Agregar" />
                  </tr>
                </thead>
                <tbody>
                  {sugerenciasPendientes.map((sugerencia) => (
                    <tr key={sugerencia.productoId}>
                      <td>
                        {sugerencia.sku} — {sugerencia.descripcion}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--color-accent-300)' }}>{sugerencia.disponible}</td>
                      <td style={{ textAlign: 'right' }} className="text-muted">
                        {sugerencia.umbralStockBajo}
                      </td>
                      <td style={{ textAlign: 'right' }}>{sugerencia.cantidadSugerida}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className="btn btn-secondary" onClick={() => agregarSugerencia(sugerencia)}>
                          <Plus size={14} /> Agregar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card gap-3 p-5">
        <div className="flex items-center justify-between">
          <h5 style={{ margin: 0 }}>Productos que se piden</h5>
          <button type="button" className="btn btn-secondary" onClick={() => append(crearLineaVacia())}>
            <Plus size={16} /> Agregar producto
          </button>
        </div>

        {mensajeErrorLineas && (
          <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', margin: 0 }}>
            {mensajeErrorLineas}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Precio estimado</th>
                <th>Valor de línea</th>
                <th aria-label="Quitar" />
              </tr>
            </thead>
            <tbody>
              {fields.map((campo, indice) => {
                const lineaErrores = errors.lineas?.[indice];
                const linea = lineasEnVivo[indice];
                const valorLinea = (Number(linea?.cantidad) || 0) * (Number(linea?.precioUnitario) || 0);
                return (
                  <tr key={campo.id}>
                    <td style={{ minWidth: 240 }}>
                      <select
                        className="input"
                        aria-label={`Producto de la línea ${indice + 1}`}
                        aria-invalid={!!lineaErrores?.productoId}
                        {...register(`lineas.${indice}.productoId`, { valueAsNumber: true })}
                      >
                        <option value={0}>Selecciona un producto…</option>
                        {productos.map((producto) => (
                          <option key={producto.id} value={producto.id}>
                            {producto.sku} — {producto.descripcion}
                          </option>
                        ))}
                      </select>
                      {lineaErrores?.productoId && (
                        <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                          {lineaErrores.productoId.message}
                        </p>
                      )}
                    </td>
                    <td style={{ width: 130 }}>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        className="input"
                        aria-label={`Cantidad de la línea ${indice + 1}`}
                        aria-invalid={!!lineaErrores?.cantidad}
                        {...register(`lineas.${indice}.cantidad`, { valueAsNumber: true })}
                      />
                      {lineaErrores?.cantidad && (
                        <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                          {lineaErrores.cantidad.message}
                        </p>
                      )}
                    </td>
                    <td style={{ width: 160 }}>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        className="input"
                        aria-label={`Precio estimado de la línea ${indice + 1}`}
                        aria-invalid={!!lineaErrores?.precioUnitario}
                        {...register(`lineas.${indice}.precioUnitario`, { valueAsNumber: true })}
                      />
                      {lineaErrores?.precioUnitario && (
                        <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                          {lineaErrores.precioUnitario.message}
                        </p>
                      )}
                    </td>
                    <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>
                      {formatoMoneda(valorLinea)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        title="Quitar línea"
                        aria-label={`Quitar línea ${indice + 1}`}
                        disabled={fields.length <= 1}
                        onClick={() => remove(indice)}
                      >
                        <Trash size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end" style={{ fontSize: 16, fontFamily: 'var(--font-heading)' }}>
          Total estimado: {formatoMoneda(total)}
        </div>
      </div>

      {errorGeneral && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>
          {errorGeneral}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => router.back()} disabled={enviando}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {enviando ? 'Guardando…' : ordenId ? 'Guardar cambios' : 'Crear orden'}
        </button>
      </div>
    </form>
  );
}

/** Campo de fecha del formulario — delega en `CampoFechaBase` (dd/mm/aaaa). Va con `Controller`
 *  porque es un componente controlado: entrega el ISO ya armado, no un evento nativo. */
function CampoFecha({
  id,
  label,
  error,
  control,
  name,
}: {
  id: string;
  label: string;
  error?: string;
  control: Control<DatosCrearOrdenCompra>;
  name: Path<DatosCrearOrdenCompra>;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <CampoFechaBase
            id={id}
            value={typeof field.value === 'string' ? field.value : ''}
            onChange={field.onChange}
            ariaInvalid={!!error}
          />
        )}
      />
      {error && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          {error}
        </p>
      )}
    </div>
  );
}
