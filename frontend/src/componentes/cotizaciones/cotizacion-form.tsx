'use client';

/**
 * Formulario de cotización — cabecera + líneas dinámicas (US21, T204, FR-112/FR-114).
 *
 * Reutilizado en dos rutas: alta (`/cotizaciones/nueva`) y edición de una cotización en BORRADOR
 * (`/cotizaciones/[id]/editar`, ya filtrada por la página que lo monta). Valida para UX con
 * `esquemaCrearCotizacion` — el MISMO esquema que el backend usa como autoridad.
 *
 * ## El cliente SÍ es un campo, a diferencia de las salidas
 *
 * En `salida-form.tsx` el cliente es solo un filtro de interfaz y nunca viaja al backend: una
 * salida guarda el proyecto, y el proyecto ya pertenece a un único cliente. Aquí el cliente se
 * ENVÍA porque la cotización lo guarda —el módulo se lista y se filtra por cliente, que es su
 * pregunta natural ("¿qué le ofrecí a este cliente?")— y el backend comprueba que el proyecto
 * elegido le pertenezca. La cascada cliente → proyecto funciona igual en los dos.
 *
 * ## Las dos fechas
 *
 * `fechaValidez` no puede ser anterior a `fecha`; lo comprueba el esquema compartido, así que el
 * error aparece sin viaje al servidor y el backend lo exige igual. Por defecto se propone un mes
 * de validez: es el plazo con el que se trabaja habitualmente y evita que alguien envíe una
 * oferta sin caducidad por no haber pensado en ella.
 */
import { useEffect, useState, useMemo } from 'react';
import { Controller, useFieldArray, useForm, useWatch, type Control, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import {
  esquemaCrearCotizacion,
  TASA_IVA_POR_DEFECTO,
  type Cliente,
  type DatosCrearCotizacion,
  type LineaCotizacion,
  type ProductoResumen,
  type Proyecto,
} from '@trazo/compartido';
import { actualizarCotizacion, crearCotizacion } from '@/lib/api/cotizaciones';
import { obtenerProyectosDestino } from '@/lib/api/clientes';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoMoneda } from '@/lib/formato';
import { ResumenTotales, SelectorTasaIva, calcularTotales } from '@/componentes/comunes/campos-iva';
import { SelectorBuscable } from '@/componentes/comunes/selector-buscable';
import { CampoFecha as CampoFechaBase } from '@/componentes/comunes/campo-fecha';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

/** Ruta `lineas.N.campo` que arma `PipeValidacionZod` para errores de líneas individuales. */
const PATRON_ERROR_LINEA = /^lineas\.(\d+)\.(productoId|cantidad|precioUnitario|tasaIva)$/;
const CAMPOS_CABECERA = new Set<keyof DatosCrearCotizacion>([
  'clienteId',
  'proyectoId',
  'fecha',
  'fechaValidez',
  'observaciones',
]);

function crearLineaVacia(): LineaCotizacion {
  // US20 (FR-109): la línea nueva se propone al 19%, la tasa general.
  return { productoId: 0, cantidad: 1, precioUnitario: 0, tasaIva: TASA_IVA_POR_DEFECTO };
}

/** Validez propuesta: un mes desde hoy (ver TSDoc de cabecera). */
function validezPorDefecto(): string {
  const fecha = new Date();
  fecha.setMonth(fecha.getMonth() + 1);
  return fecha.toISOString().slice(0, 10);
}

interface CotizacionFormProps {
  /** Todos los clientes, para el combobox raíz de la cascada. */
  clientes: Cliente[];
  /** Catálogo para el `<select>` de línea (Nocturne no documenta un combobox). */
  productos: ProductoResumen[];
  /** Presente en modo edición; ausente en alta. */
  cotizacionId?: number;
  valoresIniciales?: DatosCrearCotizacion;
  /** El proyecto ya asignado (modo edición), para precargar la cascada. */
  proyectoInicial?: Proyecto;
}

export function CotizacionForm({
  clientes,
  productos,
  cotizacionId,
  valoresIniciales,
  proyectoInicial,
}: CotizacionFormProps) {
  const router = useRouter();
  const [proyectosDelCliente, setProyectosDelCliente] = useState<Proyecto[]>([]);
  const [cargandoProyectos, setCargandoProyectos] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<DatosCrearCotizacion>({
    resolver: zodResolver(esquemaCrearCotizacion),
    defaultValues: valoresIniciales ?? {
      clienteId: 0,
      proyectoId: 0,
      fecha: new Date().toISOString().slice(0, 10),
      fechaValidez: validezPorDefecto(),
      observaciones: '',
      lineas: [crearLineaVacia()],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' });
  const lineasEnVivo = useWatch({ control, name: 'lineas' });
  const clienteSeleccionado = useWatch({ control, name: 'clienteId' });

  /** Opciones del selector de producto (US23, FR-119): además del SKU y la descripción, se
   *  busca por la ubicación, que es como se pregunta por algo cuyo nombre no se recuerda. */
  /** US23 (FR-119): cliente y proyecto también son listas que crecen. El cliente se busca
   *  además por su NIT y su ciudad, igual que en el buscador del listado de clientes. */
  const opcionesCliente = useMemo(
    () =>
      clientes.map((cliente) => ({
        valor: cliente.id,
        etiqueta: cliente.nombre,
        detalle: [cliente.nit, cliente.ciudad].filter(Boolean).join(' · ') || undefined,
        textosBuscables: [cliente.nombre, cliente.nit, cliente.ciudad],
      })),
    [clientes],
  );
  const opcionesProyecto = useMemo(
    () => proyectosDelCliente.map((proyecto) => ({ valor: proyecto.id, etiqueta: proyecto.nombre })),
    [proyectosDelCliente],
  );

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

  // Carga (y recarga al cambiar de cliente) los proyectos-destino del cliente elegido. Mismo
  // endpoint y mismo criterio que `salida-form.tsx`: solo proyectos ACTIVO de cliente ACTIVO.
  useEffect(() => {
    if (!clienteSeleccionado || clienteSeleccionado <= 0) {
      setProyectosDelCliente([]);
      return;
    }
    let cancelado = false;
    setCargandoProyectos(true);
    obtenerProyectosDestino(clienteSeleccionado)
      .then((proyectos) => {
        if (cancelado) return;
        // El proyecto que la cotización ya tiene se conserva aunque el backend no lo devuelva
        // entre los destinos válidos (se desactivó después): editar las líneas no puede
        // obligar a cambiarle el destino.
        const yaIncluido = proyectoInicial && proyectos.some((proyecto) => proyecto.id === proyectoInicial.id);
        setProyectosDelCliente(
          proyectoInicial && proyectoInicial.clienteId === clienteSeleccionado && !yaIncluido
            ? [...proyectos, proyectoInicial]
            : proyectos,
        );
      })
      .catch(() => {
        if (!cancelado) setProyectosDelCliente([]);
      })
      .finally(() => {
        if (!cancelado) setCargandoProyectos(false);
      });
    return () => {
      cancelado = true;
    };
  }, [clienteSeleccionado, proyectoInicial]);

  // Reasigna `proyectoId` DESPUÉS de que la opción precargada exista en el DOM (modo edición) —
  // mismo problema y solución que en `salida-form.tsx`.
  useEffect(() => {
    if (!proyectoInicial || proyectosDelCliente.length === 0) return;
    setValue('proyectoId', proyectoInicial.id);
  }, [proyectosDelCliente, proyectoInicial, setValue]);

  function alCambiarProducto(indice: number, productoId: number): void {
    const producto = productos.find((p) => p.id === productoId);
    // El precio de referencia es el último costo conocido: es un punto de partida para ofertar,
    // no el precio de venta. Quien cotiza le agrega su margen.
    if (producto) setValue(`lineas.${indice}.precioUnitario`, producto.ultimoCosto);
  }

  function aplicarErroresServidor(campos: Record<string, string>): void {
    for (const [campo, mensaje] of Object.entries(campos)) {
      if (CAMPOS_CABECERA.has(campo as keyof DatosCrearCotizacion)) {
        setError(campo as keyof DatosCrearCotizacion, { message: mensaje });
        continue;
      }
      const coincidencia = PATRON_ERROR_LINEA.exec(campo);
      if (coincidencia) {
        const [, indice, subcampo] = coincidencia;
        setError(`lineas.${indice}.${subcampo}` as Path<DatosCrearCotizacion>, { message: mensaje });
      }
    }
  }

  async function alEnviar(datos: DatosCrearCotizacion): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      if (cotizacionId) {
        await actualizarCotizacion(cotizacionId, datos);
        router.push(`/cotizaciones/${cotizacionId}`);
      } else {
        const { id } = await crearCotizacion(datos);
        router.push(`/cotizaciones/${id}`);
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
  const sinProyectosActivos =
    !!clienteSeleccionado && clienteSeleccionado > 0 && !cargandoProyectos && proyectosDelCliente.length === 0;

  return (
    <form onSubmit={handleSubmit(alEnviar)} className="flex flex-col gap-5" noValidate>
      <div className="card gap-4 p-5">
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="field">
            <label htmlFor="clienteId">Cliente</label>
            <Controller
              name="clienteId"
              control={control}
              render={({ field }) => (
                <SelectorBuscable
                  id="clienteId"
                  opciones={opcionesCliente}
                  value={field.value}
                  onChange={(clienteId) => {
                    field.onChange(clienteId);
                    // Cambiar de cliente invalida el proyecto elegido: son de otro.
                    setValue('proyectoId', 0);
                  }}
                  ariaInvalid={!!errors.clienteId}
                  placeholder="Escribe para buscar un cliente…"
                />
              )}
            />
            {errors.clienteId && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.clienteId.message}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="proyectoId">Proyecto</label>
            <Controller
              name="proyectoId"
              control={control}
              render={({ field }) => (
                <SelectorBuscable
                  id="proyectoId"
                  opciones={opcionesProyecto}
                  value={field.value}
                  onChange={field.onChange}
                  disabled={!clienteSeleccionado || cargandoProyectos || proyectosDelCliente.length === 0}
                  ariaInvalid={!!errors.proyectoId}
                  placeholder={cargandoProyectos ? 'Cargando…' : 'Escribe para buscar un proyecto…'}
                />
              )}
            />
            {sinProyectosActivos && (
              <p className="text-muted" style={{ fontSize: 12, marginTop: 5 }}>
                Este cliente no tiene proyectos activos.
              </p>
            )}
            {errors.proyectoId && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.proyectoId.message}
              </p>
            )}
          </div>

          <CampoFecha id="fecha" label="Fecha" error={errors.fecha?.message} control={control} name="fecha" />
          <CampoFecha
            id="fechaValidez"
            label="Válida hasta"
            error={errors.fechaValidez?.message}
            control={control}
            name="fechaValidez"
          />
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
                const registroProducto = register(`lineas.${indice}.productoId`, { valueAsNumber: true });
                return (
                  <tr key={campo.id}>
                    <td style={{ minWidth: 240 }}>
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
                              alCambiarProducto(indice, productoId);
                            }}
                            ariaInvalid={!!lineaErrores?.productoId}
                          />
                        )}
                      />
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
          {enviando ? 'Guardando…' : cotizacionId ? 'Guardar cambios' : 'Crear cotización'}
        </button>
      </div>
    </form>
  );
}

/** Envoltorio de `CampoFecha` para `react-hook-form` — mismo patrón (y mismo motivo) que en
 *  `orden-compra-form.tsx`: el campo de fecha es CONTROLADO, así que va con `Controller` y no
 *  con `register`, y esta función evita repetir ese cableado en cada una de las dos fechas. */
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
  control: Control<DatosCrearCotizacion>;
  name: Path<DatosCrearCotizacion>;
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
