'use client';

/**
 * Panel del reporte de movimientos de inventario (T082) — filtro combinable (fecha, tipo,
 * usuario, cliente→proyecto en cascada), tabla de movimientos con documento/producto/
 * cantidad/usuario/cliente/proyecto, exportar PDF/Excel e imprimir (FR-042, FR-043). Client
 * Component: `app/(app)/reportes/movimientos/page.tsx` (Server Component) solo compone y hace
 * el control de acceso por rol (docs/arquitectura.md §7).
 *
 * Igual que `PanelReporteInventario` (y a diferencia de los reportes de consumo de US4), TODOS
 * los filtros son opcionales (FR-042: "sin filtro" = todos los movimientos) — el reporte se
 * genera una vez al montar el componente y de nuevo al enviar el formulario, mismo caso de uso
 * (`obtenerReporteMovimientos`, `lib/api/reportes.ts`) en ambos casos.
 *
 * Cascada cliente→proyecto: MISMO patrón que `PanelConsumoProyecto`
 * (`componentes/reportes/reporte-consumo-proyecto.tsx`) — `obtenerCliente` (TODOS los
 * proyectos del cliente, cualquier estado) al cambiar el cliente elegido, con una diferencia
 * deliberada: en `PanelConsumoProyecto` el cliente es puro estado local (el reporte de
 * consumo por proyecto no filtra por cliente, solo lo usa para acotar el combobox de
 * proyecto), pero aquí `clienteId` SÍ es un filtro real del reporte (FR-042) — por eso el
 * `<select>` de cliente queda FUERA de react-hook-form (controlado con
 * `clienteSeleccionado`, para que su `onChange` también dispare la cascada de proyectos) y
 * `alEnviar` lo agrega al filtro validado por Zod justo antes de pedir el reporte, en vez de
 * registrarlo como un campo más del formulario.
 *
 * Filtro de usuario: un campo numérico (id), NO un combobox — `GET /api/usuarios` (el único
 * listado disponible) es EXCLUSIVO de Administrador (contracts/api-rest.md § Usuarios), pero
 * este reporte es Administrador+Gerente (FR-042); precargar ese listado para un Gerente
 * respondería `403` y rompería la página. No existe hoy un endpoint de usuarios accesible a
 * ambos roles — inventar uno es una extensión de backend fuera del alcance de esta tarea
 * (Principio V, YAGNI); el campo numérico es la única forma de filtrar por usuario sin tocar
 * el backend.
 *
 * `TipoMovimientoTag`/`ETIQUETA_TIPO_MOVIMIENTO` (`componentes/inventario/tipo-movimiento-tag.tsx`)
 * se reutilizan tal cual para la tabla y el `<select>` de tipo — misma fuente de verdad que el
 * historial de producto (T062) y que el propio backend replica en `mapeadores-documento-reporte.ts`
 * (SC-007: mismo texto en pantalla y en el archivo exportado).
 *
 * Exportar Excel/PDF (`exportarReporteMovimientos`, misma excepción de `fetch` nativo
 * documentada en `lib/api/reportes.ts`) usa EXACTAMENTE los filtros que ya generaron el
 * reporte en pantalla (`ultimoFiltro`, SC-007). Imprimir: `window.print()` + clase
 * `no-imprimir` (`globals.css`, FR-043).
 *
 * Fecha con `formatoFecha` (solo día, huso UTC) — MISMO criterio que el backend
 * (`mapeadores-documento-reporte.ts#formatoFechaSoloDia`) para que pantalla y exportación
 * luzcan igual (SC-007); `movimiento.fecha` no se firma con "+"/"-" (a diferencia del
 * historial de producto) porque el export tampoco lo hace — mismo número en ambos lados.
 *
 * Si el usuario en sesión es Operario y entró por URL directa, la página ya lo bloqueó ANTES
 * de montar este panel (`app/(app)/reportes/movimientos/page.tsx`, mismo patrón que
 * `app/(app)/usuarios/page.tsx`); el manejo de `403` aquí es una segunda capa defensiva, nunca
 * la primera línea — esa es siempre el guard del backend.
 */
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FilePdf, FileXls, Printer } from '@phosphor-icons/react/dist/ssr';
import {
  type DocumentoTipoMovimiento,
  esquemaFiltroReporteMovimientos,
  type Cliente,
  type FiltroReporteMovimientos,
  type Proyecto,
  type ReporteMovimientos as DatosReporteMovimientos,
  type TipoMovimientoInventario,
} from '@trazo/compartido';
import { obtenerCliente } from '@/lib/api/clientes';
import {
  exportarReporteMovimientos,
  obtenerReporteMovimientos,
  usuariosConMovimientos,
} from '@/lib/api/reportes';
import { ErrorApi } from '@/lib/api/cliente';
import { formatoFecha } from '@/lib/formato';
import { ETIQUETA_TIPO_MOVIMIENTO, TipoMovimientoTag } from '@/componentes/inventario/tipo-movimiento-tag';
import { BarraFiltros, CampoFiltro } from '@/componentes/comunes/barra-filtros';
import { SelectorBuscable } from '@/componentes/comunes/selector-buscable';
import { CampoFecha } from '@/componentes/comunes/campo-fecha';

const MENSAJE_ERROR_RED = 'No fue posible comunicarse con el servidor. Intenta de nuevo.';
const MENSAJE_SIN_PERMISO = 'No tienes permiso para ver este reporte. Contacta a un administrador o gerente.';

const TIPOS_MOVIMIENTO: TipoMovimientoInventario[] = ['ENTRADA', 'SALIDA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA'];

/** Etiqueta de documento de origen — mismo criterio que
 *  `mapeadores-documento-reporte.ts#ETIQUETA_DOCUMENTO_TIPO` (el backend no puede importar
 *  código del frontend, así que ambos lados replican esta MISMA traducción). */
const ETIQUETA_DOCUMENTO_TIPO: Record<'INGRESO' | 'SALIDA', string> = {
  INGRESO: 'Ingreso',
  SALIDA: 'Salida',
};

/**
 * Cómo se lee la celda "Documento" de una fila del reporte.
 *
 * Un AJUSTE (US31, FR-130) no tiene documento: el servidor manda el texto completo —"Ajuste de
 * inventario"— en `numero`, así que anteponerle su tipo daría "Ajuste Ajuste de inventario".
 */
function textoDocumento(documento: { tipo: DocumentoTipoMovimiento; numero: string }): string {
  if (documento.tipo === 'AJUSTE') return documento.numero;
  return `${ETIQUETA_DOCUMENTO_TIPO[documento.tipo]} ${documento.numero}`;
}

/** `esquemaFiltroReporteMovimientos` (`@trazo/compartido`) acepta `undefined` como "sin
 *  filtro", pero un `<select>` vacío entrega `''`. Los campos de fecha ya no lo necesitan:
 *  `CampoFecha` entrega `undefined` cuando está vacío. */
function vacioComoIndefinido(valor: string): string | undefined {
  return valor === '' ? undefined : valor;
}

/** Mismo criterio, para el campo numérico "Usuario (ID)". */
function vacioComoNumeroIndefinido(valor: string): number | undefined {
  return valor === '' ? undefined : Number(valor);
}

export function PanelReporteMovimientos({ clientes }: { clientes: Cliente[] }) {
  const [clienteSeleccionado, setClienteSeleccionado] = useState<number | null>(null);
  const [proyectosDelCliente, setProyectosDelCliente] = useState<Proyecto[]>([]);
  const [cargandoProyectos, setCargandoProyectos] = useState(false);

  const [reporte, setReporte] = useState<DatosReporteMovimientos | null>(null);
  const [ultimoFiltro, setUltimoFiltro] = useState<FiltroReporteMovimientos>({});
  const [cargando, setCargando] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);
  /** Personas que han movido inventario (US25, FR-121) — ver el comentario del campo. */
  const [usuarios, setUsuarios] = useState<{ id: number; nombre: string }[]>([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FiltroReporteMovimientos>({
    resolver: zodResolver(esquemaFiltroReporteMovimientos),
    defaultValues: {},
  });

  // Carga (y recarga al cambiar de cliente) TODOS los proyectos del cliente elegido — mismo
  // criterio que `PanelConsumoProyecto` (ver TSDoc de cabecera).
  // La lista de personas se pide UNA vez al abrir el reporte: no cambia mientras se filtra, y
  // un fallo aquí no puede impedir usar el resto de filtros — el desplegable queda vacío y ya.
  useEffect(() => {
    let vigente = true;
    usuariosConMovimientos()
      .then((lista) => {
        if (vigente) setUsuarios(lista);
      })
      .catch(() => {
        if (vigente) setUsuarios([]);
      })
      .finally(() => {
        if (vigente) setCargandoUsuarios(false);
      });
    return () => {
      vigente = false;
    };
  }, []);

  const opcionesUsuario = useMemo(
    () => usuarios.map((usuario) => ({ valor: usuario.id, etiqueta: usuario.nombre })),
    [usuarios],
  );

  useEffect(() => {
    if (clienteSeleccionado === null) {
      setProyectosDelCliente([]);
      return;
    }
    let cancelado = false;
    setCargandoProyectos(true);
    obtenerCliente(clienteSeleccionado)
      .then((cliente) => {
        if (!cancelado) setProyectosDelCliente(cliente.proyectos);
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
  }, [clienteSeleccionado]);

  function alCambiarCliente(valor: string): void {
    const id = Number(valor) || null;
    setClienteSeleccionado(id);
    setValue('proyectoId', 0);
  }

  function manejarError(error: unknown): void {
    if (error instanceof ErrorApi) {
      if (error.status === 403) {
        setSinPermiso(true);
      } else {
        setErrorGeneral(error.mensaje);
      }
    } else {
      setErrorGeneral(MENSAJE_ERROR_RED);
    }
  }

  async function alGenerar(filtros: FiltroReporteMovimientos): Promise<void> {
    setErrorGeneral(null);
    setSinPermiso(false);
    setCargando(true);
    try {
      const datos = await obtenerReporteMovimientos(filtros);
      setReporte(datos);
      setUltimoFiltro(filtros);
    } catch (error) {
      setReporte(null);
      manejarError(error);
    } finally {
      setCargando(false);
    }
  }

  /** `clienteId` NO es un campo registrado en react-hook-form (ver TSDoc de cabecera): el
   *  `<select>` de cliente es un elemento controlado aparte porque su `onChange` también
   *  dispara la cascada de proyectos, así que se agrega al filtro validado por Zod recién acá,
   *  antes de pedir el reporte — `clienteSeleccionado` ya es un id válido (viene de una
   *  `<option>` de la lista de clientes precargada), no necesita re-validación. */
  function alEnviar(datosFormulario: FiltroReporteMovimientos): Promise<void> {
    return alGenerar({ ...datosFormulario, clienteId: clienteSeleccionado ?? undefined });
  }

  // Reporte inicial sin filtros (todos los movimientos) — ver TSDoc de cabecera.
  useEffect(() => {
    alGenerar({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function alExportar(formato: 'pdf' | 'xlsx'): Promise<void> {
    setErrorGeneral(null);
    setExportando(true);
    try {
      await exportarReporteMovimientos(ultimoFiltro, formato);
    } catch (error) {
      manejarError(error);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <BarraFiltros onSubmit={handleSubmit(alEnviar)} noValidate noImprimir>
        <CampoFiltro ancho="corto">
          <label htmlFor="desde">Desde</label>
          <Controller
            name="desde"
            control={control}
            render={({ field }) => (
              <CampoFecha
                id="desde"
                value={field.value ?? ''}
                onChange={(iso) => field.onChange(iso === '' ? undefined : iso)}
                ariaInvalid={!!errors.desde}
              />
            )}
          />
          {errors.desde && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
              {errors.desde.message}
            </p>
          )}
        </CampoFiltro>
        <CampoFiltro ancho="corto">
          <label htmlFor="hasta">Hasta</label>
          <Controller
            name="hasta"
            control={control}
            render={({ field }) => (
              <CampoFecha
                id="hasta"
                value={field.value ?? ''}
                onChange={(iso) => field.onChange(iso === '' ? undefined : iso)}
                ariaInvalid={!!errors.hasta}
              />
            )}
          />
          {errors.hasta && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}>
              {errors.hasta.message}
            </p>
          )}
        </CampoFiltro>
        <CampoFiltro>
          <label htmlFor="tipo">Tipo</label>
          <select id="tipo" className="input" {...register('tipo', { setValueAs: vacioComoIndefinido })}>
            <option value="">Todos</option>
            {TIPOS_MOVIMIENTO.map((tipo) => (
              <option key={tipo} value={tipo}>
                {ETIQUETA_TIPO_MOVIMIENTO[tipo]}
              </option>
            ))}
          </select>
        </CampoFiltro>
        <CampoFiltro ancho="largo">
          <label htmlFor="usuarioId">Persona</label>
          {/* US25 (FR-121): antes pedía el ID del usuario, un número que nadie sabe. La lista la
              alimenta `GET /api/reportes/movimientos/usuarios`, con el permiso de ESTE reporte y
              limitada a quienes tienen movimientos: ofrecer a alguien sin ellos sería ofrecer un
              filtro que siempre sale vacío. */}
          <Controller
            name="usuarioId"
            control={control}
            render={({ field }) => (
              <SelectorBuscable
                id="usuarioId"
                opciones={opcionesUsuario}
                value={field.value ?? 0}
                onChange={(usuarioId) => field.onChange(usuarioId === 0 ? undefined : usuarioId)}
                etiquetaVacia="Todas las personas"
                placeholder={
                  cargandoUsuarios ? 'Cargando…' : 'Todas las personas — escribe para buscar'
                }
                ariaInvalid={!!errors.usuarioId}
              />
            )}
          />
        </CampoFiltro>
        <CampoFiltro ancho="largo">
          <label htmlFor="clienteId">Cliente</label>
          <select
            id="clienteId"
            className="input"
            value={clienteSeleccionado ?? ''}
            onChange={(evento) => alCambiarCliente(evento.target.value)}
          >
            <option value="">Todos los clientes</option>
            {clientes.map((cliente) => (
              <option key={cliente.id} value={cliente.id}>
                {cliente.nombre}
              </option>
            ))}
          </select>
        </CampoFiltro>
        <CampoFiltro ancho="largo">
          <label htmlFor="proyectoId">Proyecto</label>
          <select
            id="proyectoId"
            className="input"
            disabled={clienteSeleccionado === null || cargandoProyectos || proyectosDelCliente.length === 0}
            {...register('proyectoId', { setValueAs: (valor: string) => (Number(valor) > 0 ? Number(valor) : undefined) })}
          >
            <option value={0}>{cargandoProyectos ? 'Cargando…' : 'Todos los proyectos'}</option>
            {proyectosDelCliente.map((proyecto) => (
              <option key={proyecto.id} value={proyecto.id}>
                {proyecto.nombre}
              </option>
            ))}
          </select>
        </CampoFiltro>
        <button type="submit" className="btn btn-primary" disabled={cargando}>
          {cargando ? 'Filtrando…' : 'Filtrar'}
        </button>
      </BarraFiltros>

      {sinPermiso && (
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {MENSAJE_SIN_PERMISO}
        </div>
      )}
      {errorGeneral && (
        <div role="alert" className="card p-4" style={{ color: 'var(--color-accent-300)' }}>
          {errorGeneral}
        </div>
      )}

      {reporte && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 no-imprimir">
            <div className="text-muted" style={{ fontSize: 13 }}>
              {reporte.movimientos.length} movimiento{reporte.movimientos.length === 1 ? '' : 's'}
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" disabled={exportando} onClick={() => alExportar('xlsx')}>
                <FileXls size={16} /> Exportar Excel
              </button>
              <button type="button" className="btn btn-secondary" disabled={exportando} onClick={() => alExportar('pdf')}>
                <FilePdf size={16} /> Exportar PDF
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
                <Printer size={16} /> Imprimir
              </button>
            </div>
          </div>

          <div className="card p-0" style={{ overflow: 'hidden' }}>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Documento</th>
                    <th>SKU</th>
                    <th>Producto</th>
                    <th>Cantidad</th>
                    <th>Usuario</th>
                    <th>Cliente</th>
                    <th>Proyecto</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.movimientos.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                        No se encontraron movimientos con los filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    reporte.movimientos.map((movimiento) => (
                      <tr key={movimiento.id}>
                        <td>{formatoFecha(movimiento.fecha)}</td>
                        <td>
                          <TipoMovimientoTag tipo={movimiento.tipo} />
                        </td>
                        <td className="text-muted">
                          {textoDocumento(movimiento.documento)}
                        </td>
                        <td>{movimiento.producto.sku}</td>
                        <td>{movimiento.producto.descripcion}</td>
                        <td>{movimiento.cantidad}</td>
                        <td className="text-muted">{movimiento.usuario}</td>
                        <td className="text-muted">{movimiento.cliente ?? '—'}</td>
                        <td className="text-muted">{movimiento.proyecto ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
