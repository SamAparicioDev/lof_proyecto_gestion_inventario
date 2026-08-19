'use client';

/**
 * Formulario de salida (entrega a cliente/proyecto) — cabecera + líneas dinámicas (T054).
 *
 * Reutilizado en dos rutas: alta (`/salidas/nueva`, sin `salidaId`) y edición de una salida
 * `PENDIENTE` (`/salidas/[id]`, con `salidaId` — solo editable en ese estado, filtrado por la
 * página que lo monta, mismo criterio que `IngresoForm`/US1-AS5). Valida para UX con
 * `esquemaCrearSalida` — el MISMO esquema que usa `PUT /api/salidas/:id` como autoridad
 * (contracts/api-rest.md: "mismo esquema" para crear/actualizar).
 *
 * Combobox EN CASCADA cliente → proyecto. Desde US28 (FR-124) los DOS son campos del
 * formulario: `clienteId` es obligatorio y `proyectoId` opcional — hay entregas que son del
 * cliente y no de una obra. Hasta esa historia el cliente era solo un filtro de interfaz que
 * jamás se enviaba, porque la salida lo deducía del proyecto; con el proyecto ya opcional, esa
 * deducción dejaría entregas sin destino.
 *
 * Al elegir cliente se piden sus `proyectos-destino` (`GET /api/clientes/:id/proyectos-destino`,
 * SOLO proyectos ACTIVO de un cliente ACTIVO — FR-038) y se limpia `proyectoId`: el proyecto
 * anterior era de otro cliente, y el servidor lo rechazaría por incoherente.
 *
 * Modo edición: el `clienteId` precargado dispara la carga de sus proyectos-destino al montar.
 * La opción del proyecto ya asignado no existe en la lista hasta que ese efecto asíncrono
 * resuelve, así que `proyectoId` se reasigna con `setValue` DESPUÉS de que `proyectosDelCliente`
 * se pintó (mismo problema y misma solución que la preselección de "producto nuevo" en
 * `ingreso-form.tsx`). Si el proyecto actual ya no es un destino válido (se desactivó mientras
 * la salida seguía PENDIENTE) se agrega igual a la lista para no perder contexto en pantalla —
 * el backend decide si el guardado se rechaza, no este combobox.
 *
 * Líneas dinámicas vía `useFieldArray` (FR-025): cada línea muestra el `disponible` real del
 * producto elegido (`GET /api/productos`, extendido en T052) como texto de ayuda.
 *
 * US31: ese texto es SOLO el número. Hasta esta historia se pintaba en rojo con un "— supera el
 * disponible" cuando la cantidad era mayor, y se estaba leyendo al revés: quien lo veía entendía
 * que el producto no tenía inventario y dejaba de despachar mercancía que sí estaba en la
 * bodega. El aviso nunca fue una garantía —quien decide es la revalidación atómica de
 * `confirmar` (Principio I), intacta—, así que costaba entregas y no evitaba ningún error.
 *
 * El precio unitario se prellena con `ultimoCosto` al elegir el producto y sigue siendo
 * editable (precio de referencia, data-model.md § detalles_salidas). El valor de línea y el
 * total se recalculan en vivo; el total AUTORITATIVO lo recalcula el backend al guardar.
 *
 * Errores de servidor (`ErrorApi.campos`) se pintan junto al campo de cabecera correspondiente
 * (incluida la ruta `clienteId` → "El cliente es obligatorio", US3-AS3 llevado al campo que
 * desde US28 es el obligatorio), o junto al
 * campo de línea si la ruta es `lineas.N.campo`; cualquier ruta desconocida cae al mensaje
 * general (frontend/CLAUDE.md).
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
  esquemaCrearSalida,
  type Cliente,
  type DatosCrearSalida,
  type LineaSalida,
  type ProductoResumen,
  type Proyecto,
  TASA_IVA_POR_DEFECTO,
} from '@trazo/compartido';
import { actualizarSalida, crearSalida } from '@/lib/api/salidas';
import { obtenerProyectosDestino } from '@/lib/api/clientes';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoMoneda } from '@/lib/formato';
import { ResumenTotales, SelectorTasaIva, calcularTotales } from '@/componentes/comunes/campos-iva';
import { SelectorBuscable } from '@/componentes/comunes/selector-buscable';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

/** Ruta `lineas.N.campo` que arma `PipeValidacionZod` para errores de líneas individuales. */
const PATRON_ERROR_LINEA = /^lineas\.(\d+)\.(productoId|cantidad|precioUnitario)$/;
const CAMPOS_CABECERA = new Set<keyof DatosCrearSalida>([
  'clienteId',
  'proyectoId',
  'fechaSalida',
  'observaciones',
]);

function crearLineaVacia(): LineaSalida {
  // US20 (FR-109): la línea nueva se propone al 19%, la tasa general.
  return { productoId: 0, cantidad: 1, precioUnitario: 0, tasaIva: TASA_IVA_POR_DEFECTO };
}

const VALORES_INICIALES_VACIOS: DatosCrearSalida = {
  clienteId: 0,
  // US28 (FR-124): `null`, no 0 — "esta entrega no es de una obra" es una respuesta válida
  // desde el primer momento, no un campo a medio llenar.
  proyectoId: null,
  fechaSalida: '',
  observaciones: '',
  lineas: [crearLineaVacia()],
};

interface SalidaFormProps {
  /** Todos los clientes, para el combobox raíz de la cascada (sin paginar — T054). */
  clientes: Cliente[];
  /** Catálogo de productos con `disponible`/`ultimoCosto` (extensión T052) para las líneas. */
  productos: ProductoResumen[];
  /** Presente en modo edición (`/salidas/[id]`); ausente en alta (`/salidas/nueva`). */
  salidaId?: number;
  /** Precarga de edición — mismo shape que `esquemaCrearSalida` (fecha como texto `YYYY-MM-DD`). */
  valoresIniciales?: DatosCrearSalida;
  /** El proyecto ya asignado (modo edición) — da el `clienteId` para preseleccionar la cascada. */
  proyectoInicial?: Proyecto;
}

export function SalidaForm({ clientes, productos, salidaId, valoresIniciales, proyectoInicial }: SalidaFormProps) {
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
  } = useForm<DatosCrearSalida>({
    resolver: zodResolver(esquemaCrearSalida),
    defaultValues: valoresIniciales ?? VALORES_INICIALES_VACIOS,
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' });
  const lineasEnVivo = useWatch({ control, name: 'lineas' });
  /** US28: el cliente ya no es estado local — es un campo del formulario, y la cascada se
   *  alimenta de ÉL para que no puedan discrepar. */
  const clienteSeleccionado = useWatch({ control, name: 'clienteId' }) || null;

  // Carga (y recarga al cambiar de cliente) los proyectos-destino del cliente elegido —
  // ver TSDoc de cabecera para el porqué de agregar `proyectoInicial` si el backend no lo
  // devuelve entre los destinos válidos.
  useEffect(() => {
    if (clienteSeleccionado === null) {
      setProyectosDelCliente([]);
      return;
    }
    let cancelado = false;
    setCargandoProyectos(true);
    obtenerProyectosDestino(clienteSeleccionado)
      .then((proyectos) => {
        if (cancelado) return;
        const yaIncluido = proyectoInicial && proyectos.some((proyecto) => proyecto.id === proyectoInicial.id);
        const conProyectoActual =
          proyectoInicial && proyectoInicial.clienteId === clienteSeleccionado && !yaIncluido
            ? [...proyectos, proyectoInicial]
            : proyectos;
        setProyectosDelCliente(conProyectoActual);
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

  // Reasigna `proyectoId` DESPUÉS de que la opción precargada ya exista en el DOM (modo
  // edición) — mismo problema y solución que la preselección de producto nuevo en
  // `ingreso-form.tsx`.
  useEffect(() => {
    if (!proyectoInicial || proyectosDelCliente.length === 0) return;
    setValue('proyectoId', proyectoInicial.id);
  }, [proyectosDelCliente, proyectoInicial, setValue]);

  function alCambiarCliente(clienteId: number): void {
    setValue('clienteId', clienteId);
    // El proyecto elegido era de otro cliente: mantenerlo dejaría en pantalla una combinación
    // que el servidor rechaza por incoherente (FR-124).
    setValue('proyectoId', null);
  }

  function alCambiarProducto(indice: number, productoId: number): void {
    const producto = productos.find((p) => p.id === productoId);
    if (producto) {
      setValue(`lineas.${indice}.precioUnitario`, producto.ultimoCosto);
    }
  }


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

  function aplicarErroresServidor(campos: Record<string, string>): void {
    for (const [campo, mensaje] of Object.entries(campos)) {
      if (CAMPOS_CABECERA.has(campo as keyof DatosCrearSalida)) {
        setError(campo as keyof DatosCrearSalida, { message: mensaje });
        continue;
      }
      const coincidencia = PATRON_ERROR_LINEA.exec(campo);
      if (coincidencia) {
        const [, indice, subcampo] = coincidencia;
        setError(`lineas.${indice}.${subcampo}` as Path<DatosCrearSalida>, { message: mensaje });
      }
      // Ruta desconocida: queda cubierta solo por el mensaje general (errorGeneral abajo).
    }
  }

  async function alEnviar(datos: DatosCrearSalida): Promise<void> {
    setErrorGeneral(null);
    setEnviando(true);
    try {
      if (salidaId) {
        await actualizarSalida(salidaId, datos);
        router.push(`/salidas/${salidaId}`);
      } else {
        const { id } = await crearSalida(datos);
        router.push(`/salidas/${id}`);
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
  const sinProyectosActivos = clienteSeleccionado !== null && !cargandoProyectos && proyectosDelCliente.length === 0;

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
                  onChange={alCambiarCliente}
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
            <label htmlFor="proyectoId">Proyecto (opcional)</label>
            <Controller
              name="proyectoId"
              control={control}
              render={({ field }) => (
                <SelectorBuscable
                  id="proyectoId"
                  opciones={opcionesProyecto}
                  value={field.value ?? 0}
                  // `0` es "ninguna" en `SelectorBuscable`; en el modelo eso es `null` (FR-124).
                  onChange={(proyectoId) => field.onChange(proyectoId === 0 ? null : proyectoId)}
                  disabled={clienteSeleccionado === null || cargandoProyectos}
                  ariaInvalid={!!errors.proyectoId}
                  placeholder={cargandoProyectos ? 'Cargando…' : 'Sin proyecto — escribe para buscar uno…'}
                  etiquetaVacia="Sin proyecto específico"
                />
              )}
            />
            {sinProyectosActivos && (
              <p className="text-muted" style={{ fontSize: 12, marginTop: 5 }}>
                Este cliente no tiene proyectos activos: la salida quedará a su nombre, sin proyecto.
              </p>
            )}
            {errors.proyectoId && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                {errors.proyectoId.message}
              </p>
            )}
          </div>

          <CampoFecha id="fechaSalida" label="Fecha de salida" error={errors.fechaSalida?.message} control={control} name="fechaSalida" />
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
                const producto = productos.find((p) => p.id === linea?.productoId);
                const cantidad = Number(linea?.cantidad) || 0;
                const valorLinea = cantidad * (Number(linea?.precioUnitario) || 0);
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
                      {producto && (
                        <p className="text-muted" style={{ fontSize: 12, marginTop: 5 }}>
                          Disponible: {producto.disponible}
                        </p>
                      )}
                      {lineaErrores?.productoId && (
                        <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
                          {lineaErrores.productoId.message}
                        </p>
                      )}
                    </td>
                    <td style={{ width: 130 }}>
                      <input
                        type="number"
                        // US26 (FR-122): entera — las flechas suben de uno en uno y el navegador
                        // rechaza los decimales antes de que el esquema tenga que hacerlo.
                        step="1"
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
          {enviando ? 'Guardando…' : salidaId ? 'Guardar cambios' : 'Registrar salida'}
        </button>
      </div>
    </form>
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
  control: Control<DatosCrearSalida>;
  name: Path<DatosCrearSalida>;
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
