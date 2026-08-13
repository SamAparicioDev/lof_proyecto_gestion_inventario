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
 * Combobox EN CASCADA cliente → proyecto: `proyectoId` es el único campo que el esquema
 * valida (`esquemas/salidas.ts` — data-model.md: guardar `clienteId` en la salida duplicaría
 * la verdad, el proyecto ya pertenece a un único cliente). El cliente es SOLO un filtro de UI
 * — vive en estado local `clienteSeleccionado`, NUNCA se envía al backend. Al elegir un
 * cliente se piden sus `proyectos-destino` (`GET /api/clientes/:id/proyectos-destino`, SOLO
 * proyectos ACTIVO de un cliente ACTIVO — FR-038) y se resetea `proyectoId` a 0 para forzar
 * una elección válida para el cliente recién elegido.
 *
 * Modo edición: `proyectoInicial` (el proyecto ya asignado, con su `clienteId`) permite
 * preseleccionar el cliente y disparar la carga de sus proyectos-destino en un efecto al
 * montar. Igual que la preselección de "producto nuevo" en `ingreso-form.tsx`, el `<select>`
 * de proyecto es un campo NO controlado (`register`): la opción con el valor precargado no
 * existe en el DOM hasta que el efecto asíncrono resuelve, así que `proyectoId` se reasigna
 * con `setValue` en un efecto que corre DESPUÉS de que `proyectosDelCliente` ya se pintó. Si
 * el proyecto actual ya no es un destino válido (se desactivó mientras la salida seguía
 * PENDIENTE) se agrega igual a la lista para no perder contexto en pantalla — el backend es
 * quien decide si el guardado se rechaza (409), no este combobox.
 *
 * Líneas dinámicas vía `useFieldArray` (FR-025): cada línea muestra el `disponible` real del
 * producto elegido (`GET /api/productos`, extendido en T052) como texto de ayuda, con una
 * advertencia visual (no bloqueante — la autoridad es el backend) si la cantidad lo supera;
 * el precio unitario se prellena con `ultimoCosto` al elegir el producto y sigue siendo
 * editable (precio de referencia, data-model.md § detalles_salidas). El valor de línea y el
 * total se recalculan en vivo; el total AUTORITATIVO lo recalcula el backend al guardar.
 *
 * Errores de servidor (`ErrorApi.campos`) se pintan junto al campo de cabecera correspondiente
 * (incluida la ruta `proyectoId` → "El cliente/proyecto es obligatorio", US3-AS3), o junto al
 * campo de línea si la ruta es `lineas.N.campo`; cualquier ruta desconocida cae al mensaje
 * general (frontend/CLAUDE.md).
 */
import { useEffect, useState } from 'react';
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
} from '@trazo/compartido';
import { actualizarSalida, crearSalida } from '@/lib/api/salidas';
import { obtenerProyectosDestino } from '@/lib/api/clientes';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoMoneda } from '@/lib/formato';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';

/** Ruta `lineas.N.campo` que arma `PipeValidacionZod` para errores de líneas individuales. */
const PATRON_ERROR_LINEA = /^lineas\.(\d+)\.(productoId|cantidad|precioUnitario)$/;
const CAMPOS_CABECERA = new Set<keyof DatosCrearSalida>(['proyectoId', 'fechaSalida', 'observaciones']);

function crearLineaVacia(): LineaSalida {
  return { productoId: 0, cantidad: 1, precioUnitario: 0 };
}

const VALORES_INICIALES_VACIOS: DatosCrearSalida = {
  proyectoId: 0,
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
  const [clienteSeleccionado, setClienteSeleccionado] = useState<number | null>(proyectoInicial?.clienteId ?? null);
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

  function alCambiarCliente(valor: string): void {
    const clienteId = Number(valor) || null;
    setClienteSeleccionado(clienteId);
    setValue('proyectoId', 0);
  }

  function alCambiarProducto(indice: number, productoId: number): void {
    const producto = productos.find((p) => p.id === productoId);
    if (producto) {
      setValue(`lineas.${indice}.precioUnitario`, producto.ultimoCosto);
    }
  }

  const total = lineasEnVivo.reduce(
    (acumulado, linea) => acumulado + (Number(linea.cantidad) || 0) * (Number(linea.precioUnitario) || 0),
    0,
  );

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
            <label htmlFor="cliente">Cliente</label>
            <select
              id="cliente"
              className="input"
              value={clienteSeleccionado ?? ''}
              onChange={(evento) => alCambiarCliente(evento.target.value)}
            >
              <option value="">Selecciona un cliente…</option>
              {clientes.map((cliente) => (
                <option key={cliente.id} value={cliente.id}>
                  {cliente.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="proyectoId">Proyecto</label>
            <select
              id="proyectoId"
              className="input"
              aria-invalid={!!errors.proyectoId}
              disabled={clienteSeleccionado === null || cargandoProyectos || proyectosDelCliente.length === 0}
              {...register('proyectoId', { valueAsNumber: true })}
            >
              <option value={0}>{cargandoProyectos ? 'Cargando…' : 'Selecciona un proyecto…'}</option>
              {proyectosDelCliente.map((proyecto) => (
                <option key={proyecto.id} value={proyecto.id}>
                  {proyecto.nombre}
                </option>
              ))}
            </select>
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
                const superaDisponible = !!producto && cantidad > producto.disponible;
                const registroProducto = register(`lineas.${indice}.productoId`, { valueAsNumber: true });
                return (
                  <tr key={campo.id}>
                    <td style={{ minWidth: 240 }}>
                      <select
                        className="input"
                        aria-label={`Producto de la línea ${indice + 1}`}
                        aria-invalid={!!lineaErrores?.productoId}
                        {...registroProducto}
                        onChange={(evento) => {
                          registroProducto.onChange(evento);
                          alCambiarProducto(indice, Number(evento.target.value));
                        }}
                      >
                        <option value={0}>Selecciona un producto…</option>
                        {productos.map((productoOpcion) => (
                          <option key={productoOpcion.id} value={productoOpcion.id}>
                            {productoOpcion.sku} — {productoOpcion.descripcion}
                          </option>
                        ))}
                      </select>
                      {producto && (
                        <p
                          className="text-muted"
                          style={{
                            fontSize: 12,
                            marginTop: 5,
                            color: superaDisponible ? 'var(--color-accent-300)' : undefined,
                          }}
                        >
                          Disponible: {producto.disponible}
                          {superaDisponible ? ' — supera el disponible' : ''}
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
          Total: {formatoMoneda(total)}
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
