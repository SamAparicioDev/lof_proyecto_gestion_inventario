'use client';

/**
 * Formulario de ingreso (factura de compra) — cabecera + líneas dinámicas (T035/T036).
 *
 * Reutilizado en dos rutas: alta (`/ingresos/nuevo`, sin `ingresoId`) y edición de un
 * ingreso `PENDIENTE` (`/ingresos/[id]`, con `ingresoId` — solo editable en ese estado,
 * US1-AS5, ya filtrado por la página que lo monta). Valida para UX con `esquemaCrearIngreso`
 * — el MISMO esquema que usa `PUT /api/ingresos/:id` como autoridad (contracts/api-rest.md:
 * "mismo esquema" para crear/actualizar), así que no hace falta un resolver distinto.
 *
 * Líneas dinámicas vía `useFieldArray` (FR-014): cada línea calcula su valor en vivo
 * (`cantidad × precioUnitario`) y el total del ingreso es la suma de esos valores — solo
 * feedback inmediato en pantalla; el total AUTORITATIVO lo recalcula el backend
 * (`RepositorioIngresosPrisma`, T030) al guardar.
 *
 * "Producto nuevo" (FR-011) se abre DESDE la línea que lo invoca, no desde un botón global:
 * al crear el producto, se agrega a las opciones del selector y se preselecciona en esa
 * misma línea — "la línea actual" del enunciado de T035. El diálogo es
 * `componentes/inventario/dialogo-producto-nuevo.tsx` (vivía en esta carpeta hasta T111, que le
 * dio su segunda entrada desde el listado de inventario y lo movió al módulo dueño del
 * catálogo — una sola implementación para las dos puertas, ver su TSDoc).
 *
 * Errores de servidor (`ErrorApi.campos`) se pintan junto al campo de cabecera
 * correspondiente, o junto al campo de línea si la ruta es `lineas.N.campo` (formato que
 * arma `PipeValidacionZod` con la ruta del esquema Zod); cualquier ruta desconocida cae al
 * mensaje general (frontend/CLAUDE.md).
 */
import { useEffect, useState, useMemo } from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type Path,
  type UseFormRegisterReturn,
} from 'react-hook-form';
import { CampoFecha as CampoFechaBase } from '@/componentes/comunes/campo-fecha';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import {
  esquemaCrearIngreso,
  TASA_IVA_POR_DEFECTO,
  type DatosCrearIngreso,
  type LineaIngreso,
  type ProductoResumen,
} from '@trazo/compartido';
import { actualizarIngreso, crearIngreso } from '@/lib/api/ingresos';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoMoneda } from '@/lib/formato';
import { ResumenTotales, SelectorTasaIva, calcularTotales } from '@/componentes/comunes/campos-iva';
import { SelectorBuscable } from '@/componentes/comunes/selector-buscable';
import { DialogoProductoNuevo } from '@/componentes/inventario/dialogo-producto-nuevo';
import { SelectorProveedor } from '@/componentes/proveedores/selector-proveedor';
import { formatoNumeroOrdenCompra } from '@trazo/compartido';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

/** Ruta `lineas.N.campo` que arma `PipeValidacionZod` para errores de líneas individuales. */
const PATRON_ERROR_LINEA = /^lineas\.(\d+)\.(productoId|cantidad|precioUnitario)$/;
const CAMPOS_CABECERA = new Set<keyof DatosCrearIngreso>([
  'numeroFactura',
  'fechaFactura',
  'proveedorId',
  'fechaRecepcion',
  'observaciones',
]);

function crearLineaVacia(): LineaIngreso {
  // US20 (FR-109): la línea nueva se propone al 19%, la tasa general.
  return { productoId: 0, cantidad: 1, precioUnitario: 0, tasaIva: TASA_IVA_POR_DEFECTO };
}

const VALORES_INICIALES_VACIOS: DatosCrearIngreso = {
  numeroFactura: '',
  fechaFactura: '',
  // 0 = "sin elegir": el esquema exige un entero positivo, así que un ingreso sin proveedor no
  // pasa la validación (US15, FR-091 — el proveedor es obligatorio).
  proveedorId: 0,
  fechaRecepcion: '',
  observaciones: '',
  lineas: [crearLineaVacia()],
};

interface IngresoFormProps {
  /** Catálogo inicial para el `<select>` de línea (Nocturne no documenta un combobox — `docs/diseno-nocturne.md`). */
  productos: ProductoResumen[];
  /** Presente en modo edición (`/ingresos/[id]`, US1-AS5); ausente en alta (`/ingresos/nuevo`). */
  ingresoId?: number;
  /** Precarga de edición — mismo shape que `esquemaCrearIngreso` (fechas como texto `YYYY-MM-DD`). */
  valoresIniciales?: DatosCrearIngreso;
  /** Proveedor que el ingreso ya tiene (US15): el selector lo conserva aunque esté inactivo. */
  proveedorActual?: { id: number; nombre: string } | null;
  /** Orden de compra que este ingreso va a surtir (US16, FR-099). Solo se muestra: el dato que
   *  viaja es `ordenCompraId` dentro de `valoresIniciales`. */
  ordenVinculada?: { id: number; numero: number } | null;
}

export function IngresoForm({
  productos,
  ingresoId,
  valoresIniciales,
  proveedorActual,
  ordenVinculada,
}: IngresoFormProps) {
  const router = useRouter();
  const [productosDisponibles, setProductosDisponibles] = useState(productos);
  const [lineaParaAltaRapida, setLineaParaAltaRapida] = useState<number | null>(null);
  // Preselección diferida: `<select>` es un campo NO controlado (`register`), así que
  // `setValue` solo puede fijar un valor que ya exista como `<option>` en el DOM. Si se
  // llamara en el mismo evento que agrega el producto a `productosDisponibles`, el navegador
  // ignoraría la asignación porque React todavía no pintó la opción nueva (confirmado en
  // vivo: el producto se creaba y aparecía en el `<select>`, pero la línea seguía en "Selecciona
  // un producto…"). Por eso la asignación se guarda aquí y se aplica en un `useEffect` que
  // corre DESPUÉS de que el re-render con la opción nueva ya se confirmó en el DOM.
  const [asignacionPendiente, setAsignacionPendiente] = useState<{ indice: number; productoId: number } | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<DatosCrearIngreso>({
    resolver: zodResolver(esquemaCrearIngreso),
    defaultValues: valoresIniciales ?? VALORES_INICIALES_VACIOS,
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' });
  const lineasEnVivo = useWatch({ control, name: 'lineas' });

  useEffect(() => {
    if (!asignacionPendiente) return;
    setValue(`lineas.${asignacionPendiente.indice}.productoId`, asignacionPendiente.productoId);
    setAsignacionPendiente(null);
  }, [asignacionPendiente, productosDisponibles, setValue]);


  /** Opciones del selector de producto (US23, FR-119): además del SKU y la descripción, se
   *  busca por la ubicación, que es como se pregunta por algo cuyo nombre no se recuerda. */
  const opcionesProducto = useMemo(
    () =>
      productos.map((producto) => ({
        valor: producto.id,
        etiqueta: `${producto.sku} — ${producto.descripcion}`,
        textosBuscables: [producto.sku, producto.descripcion],
      })),
    [productos],
  );

  const totales = calcularTotales(lineasEnVivo);

  function aplicarErroresServidor(campos: Record<string, string>): void {
    for (const [campo, mensaje] of Object.entries(campos)) {
      if (CAMPOS_CABECERA.has(campo as keyof DatosCrearIngreso)) {
        setError(campo as keyof DatosCrearIngreso, { message: mensaje });
        continue;
      }
      const coincidencia = PATRON_ERROR_LINEA.exec(campo);
      if (coincidencia) {
        const [, indice, subcampo] = coincidencia;
        setError(`lineas.${indice}.${subcampo}` as Path<DatosCrearIngreso>, { message: mensaje });
      }
      // Ruta desconocida: queda cubierta solo por el mensaje general (errorGeneral abajo).
    }
  }

  async function alEnviar(datos: DatosCrearIngreso): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      if (ingresoId) {
        await actualizarIngreso(ingresoId, datos);
        router.push(`/ingresos/${ingresoId}`);
      } else {
        const { id } = await crearIngreso(datos);
        router.push(`/ingresos/${id}`);
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

  function alCrearProductoNuevo(producto: ProductoResumen): void {
    setProductosDisponibles((actuales) => (actuales.some((p) => p.id === producto.id) ? actuales : [...actuales, producto]));
    if (lineaParaAltaRapida !== null) {
      setAsignacionPendiente({ indice: lineaParaAltaRapida, productoId: producto.id });
    }
    setLineaParaAltaRapida(null);
  }

  const mensajeErrorLineas = errors.lineas && 'message' in errors.lineas ? errors.lineas.message : undefined;

  return (
    <>
      <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-5" noValidate>
        {/* US16 (FR-099): el vínculo con la orden es invisible en el body, así que se enseña
            aquí — quien registra debe poder confirmar que está surtiendo la orden correcta, y
            saber que al recibir este ingreso la orden se cerrará sola. */}
        {ordenVinculada && (
          <div className="card p-4" style={{ borderColor: 'var(--color-accent)' }}>
            <p style={{ margin: 0, fontSize: 13 }}>
              Este ingreso surte la orden <strong>{formatoNumeroOrdenCompra(ordenVinculada.numero)}</strong>. Su
              proveedor y sus líneas ya vienen cargados; completa la factura y, al recibirlo, la
              orden quedará marcada como recibida.
            </p>
          </div>
        )}

        <div className="card gap-4 p-5">
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <CampoTexto id="numeroFactura" label="Número de factura" error={errors.numeroFactura?.message} registro={register('numeroFactura')} />
            {/* US15 (FR-091): el proveedor se elige del catálogo. Va con `Controller` y no con
                `register` porque `SelectorProveedor` es controlado — entrega un número, no el
                evento de un `<input>` nativo (mismo criterio que `CampoFecha`). */}
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
            <CampoFecha id="fechaFactura" label="Fecha de la factura" error={errors.fechaFactura?.message} control={control} name="fechaFactura" />
            <CampoFecha id="fechaRecepcion" label="Fecha de recepción" error={errors.fechaRecepcion?.message} control={control} name="fechaRecepcion" />
          </div>
          <div className="field">
            <label htmlFor="observaciones">Observaciones (opcional)</label>
            <textarea id="observaciones" className="input" rows={2} {...register('observaciones')} />
          </div>
        </div>

        <div className="card gap-3 p-5">
          <div className="flex items-center justify-between">
            <h5 style={{ margin: 0 }}>Productos</h5>
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
                  <th>Precio unitario</th>
                  <th>IVA</th>
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
                        <div className="flex items-center gap-1.5">
                          <Controller
                            name={`lineas.${indice}.productoId`}
                            control={control}
                            render={({ field }) => (
                              <SelectorBuscable
                                id={`linea-${indice}-producto`}
                                ariaLabel={`Producto de la línea ${indice + 1}`}
                                opciones={opcionesProducto}
                                value={field.value}
                                onChange={(productoId) => {
                                  field.onChange(productoId);
                                  
                                }}
                                ariaInvalid={!!lineaErrores?.productoId}
                              />
                            )}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            title="Producto nuevo"
                            aria-label={`Crear producto nuevo para la línea ${indice + 1}`}
                            onClick={() => setLineaParaAltaRapida(indice)}
                          >
                            <Plus size={16} />
                          </button>
                        </div>
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
                          aria-label={`Precio unitario de la línea ${indice + 1}`}
                          aria-invalid={!!lineaErrores?.precioUnitario}
                          {...register(`lineas.${indice}.precioUnitario`, { valueAsNumber: true })}
                        />
                        {lineaErrores?.precioUnitario && (
                          <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                            {lineaErrores.precioUnitario.message}
                          </p>
                        )}
                      </td>
                      <td style={{ width: 130 }}>
                        <SelectorTasaIva
                          indice={indice}
                          registro={register(`lineas.${indice}.tasaIva`, { valueAsNumber: true })}
                        />
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

          <ResumenTotales totales={totales} />
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
            {enviando ? 'Guardando…' : ingresoId ? 'Guardar cambios' : 'Registrar ingreso'}
          </button>
        </div>
      </form>

      {lineaParaAltaRapida !== null && (
        <DialogoProductoNuevo onCerrar={() => setLineaParaAltaRapida(null)} onCreado={alCrearProductoNuevo} />
      )}
    </>
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

/**
 * Campo de fecha del formulario. Delega en `CampoFechaBase` (componentes/comunes), que muestra
 * y acepta `dd/mm/aaaa` en vez del formato que imponga el idioma del navegador — ver el TSDoc
 * de ese componente. Va con `Controller` y no con `register` porque `CampoFechaBase` es
 * controlado: entrega el ISO ya armado, no un evento de un `<input>` nativo.
 */
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
  control: Control<DatosCrearIngreso>;
  name: Path<DatosCrearIngreso>;
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
        <p id={`${id}-error`} role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
          {error}
        </p>
      )}
    </div>
  );
}
