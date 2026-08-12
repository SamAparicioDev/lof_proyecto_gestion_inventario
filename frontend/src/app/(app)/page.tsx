/**
 * PANEL DE CONTROL — ruta `/` del grupo `(app)`, el aterrizaje tras iniciar sesión (T116, US10,
 * FR-060…FR-063; contracts/rutas-frontend.md, fila "/ (inicio)").
 *
 * ## Qué cambió y por qué
 *
 * Hasta esta tarea la ruta NO mostraba nada propio: repartía hacia el primer módulo que la
 * sesión podía abrir (y antes de la Tanda 13, un `redirect('/inventario')` fijo). Con eso, el
 * ítem "Panel" del menú lateral llevaba exactamente al mismo sitio que "Inventario" — ocupaba
 * un lugar en la navegación sin aportar nada, que es el "Why this priority" de US10 y lo que el
 * dueño reportó ("le doy en panel y sigo sin poder ver nada"). Ahora `/` es la portada
 * operativa: responde "¿cómo está el negocio hoy y qué me toca hacer?" sin recorrer cinco
 * pantallas.
 *
 * ## Cada cifra es un acceso directo (FR-061)
 *
 * Cada `TarjetaCifra` es un enlace al listado YA FILTRADO por ese criterio. El mapa vive aquí,
 * en un solo sitio, y es el mismo que verifica la prueba de integración del backend contra los
 * endpoints de detalle equivalentes (T117):
 *
 * | Tarjeta | Destino |
 * |---|---|
 * | Productos en inventario | `/inventario` |
 * | Productos bajo umbral | `/inventario?soloStockBajo=true` |
 * | Valor del inventario | `/reportes/inventario` |
 * | Salidas pendientes | `/salidas?estado=PENDIENTE` |
 * | Ingresos pendientes | `/ingresos?estado=PENDIENTE` |
 * | Consumo del mes | `/reportes/consumo-cliente` |
 *
 * Los cinco primeros son "el mismo número, ya filtrado" (la cifra sale del `total` de ese mismo
 * listado). El de consumo lleva al reporte de consumo, que es LA pantalla donde el sistema
 * define el consumo (solo salidas confirmadas/completadas, FR-044) y lo desglosa por cliente y
 * proyecto; el listado de salidas no serviría de detalle, porque suma también pendientes y
 * anuladas y daría otro número.
 *
 * ## Qué se muestra lo decide el SERVIDOR (FR-062)
 *
 * Esta página NO filtra cifras por permiso: pinta lo que `GET /api/panel` le envía. El backend
 * omite del JSON las secciones que la sesión no puede consultar (valorización y consumo son
 * información de reportes), así que una clave ausente significa "no es para esta sesión" y la
 * tarjeta simplemente no existe. El único permiso que esta página consulta es `reportes.ver`, y
 * para una sola cosa de pura UX: mostrar u ocultar el enlace "Ver todos los movimientos", que
 * de otro modo llevaría a un `403`.
 *
 * Estados vacíos (US10-AS3): un sistema recién instalado responde ceros y listas vacías, y así
 * se pintan — "0", "$ 0" y "Sin movimientos registrados.", nunca una cifra en blanco, un "NaN"
 * ni una pantalla de error.
 *
 * Server Component: reenvía la cookie de sesión al backend con `apiServidor` (nunca `fetch`
 * directo) y solo compone; las piezas visuales viven en `componentes/panel/`
 * (docs/arquitectura.md §7). Referencia visual: el dashboard con KPIs de
 * `Trazo Inventarios.dc.html` (docs/diseno-nocturne.md).
 */
import { ArrowSquareIn, ArrowSquareOut, ChartLineUp, Package, Wallet, Warning } from '@phosphor-icons/react/dist/ssr';
import type { ResumenPanel } from '@trazo/compartido';
import { apiServidor } from '@/lib/api/servidor';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { formatoFecha, formatoMoneda } from '@/lib/formato';
import { PERMISOS, tienePermiso } from '@/lib/permisos';
import { ActividadReciente } from '@/componentes/panel/actividad-reciente';
import { TarjetaCifra } from '@/componentes/panel/tarjeta-cifra';

/**
 * Estado vacío de una sesión para la que el servidor no incluyó NINGUNA sección: su rol no
 * concede inventario, salidas, ingresos ni reportes (puede perfectamente concederle otros
 * módulos, como clientes, que el panel no resume). Por eso NO se usa aquí `mensajeSinPermiso`
 * ("no puedes abrir ningún módulo"): sería mentira para ese rol, y lo que la pantalla debe
 * hacer es decir la verdad y señalar la salida — el menú lateral, que ya está filtrado por sus
 * permisos.
 */
const MENSAJE_PANEL_VACIO =
  'Tu rol no incluye ninguna de las cifras de este panel (inventario, salidas, ingresos o ' +
  'reportes). Los módulos que sí puedes abrir están en el menú lateral.';

/** Etiqueta que marca una cifra que pide acción (bajo umbral o documentos pendientes > 0) —
 *  mismo `.tag tag-accent` con el que el inventario marca el stock bajo (`AlertaStockBajo`). */
function DistintivoAtencion() {
  return (
    <span className="tag tag-accent gap-1" style={{ width: 'fit-content' }}>
      <Warning size={12} weight="fill" /> Requiere atención
    </span>
  );
}

export default async function PaginaPanel() {
  const [perfil, resumen] = await Promise.all([
    obtenerPerfilServidor(),
    apiServidor<ResumenPanel>('/api/panel'),
  ]);

  const puedeVerReportes = tienePermiso(perfil?.permisos, PERMISOS.REPORTES_VER);
  const { inventario, pendientes, consumoMes, movimientosRecientes } = resumen;
  // Sin ninguna sección el panel no tiene cifras que mostrar: se explica en español (ver
  // `MENSAJE_PANEL_VACIO`) en vez de dejar una pantalla en blanco sin razón aparente.
  const sinCifras = !inventario && !pendientes && !consumoMes && !movimientosRecientes;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Resumen</h6>
        <h2 style={{ margin: 0 }}>Panel de control</h2>
      </div>

      {sinCifras ? (
        // Estado vacío, no error: va como tarjeta informativa `.text-muted` (mismo tono que los
        // estados vacíos de las tablas), NO como `role="alert"`, que en este proyecto anuncia
        // un fallo o una restricción. Sin `p-4`: `.card` declara `padding` y esa utilidad nunca
        // aplicaría (docs/diseno-nocturne.md § cascada).
        <div className="card text-muted">{MENSAJE_PANEL_VACIO}</div>
      ) : (
        <>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {inventario && (
              <TarjetaCifra
                etiqueta="Productos en inventario"
                valor={String(inventario.productosActivos)}
                destino="/inventario"
                textoDestino="Ver inventario"
                icono={Package}
              />
            )}
            {inventario && (
              <TarjetaCifra
                etiqueta="Productos bajo umbral"
                valor={String(inventario.bajoUmbral)}
                destino="/inventario?soloStockBajo=true"
                textoDestino="Ver productos bajo umbral"
                icono={Warning}
                distintivo={inventario.bajoUmbral > 0 ? <DistintivoAtencion /> : undefined}
              />
            )}
            {inventario?.valorTotal !== undefined && (
              <TarjetaCifra
                etiqueta="Valor del inventario"
                valor={formatoMoneda(inventario.valorTotal)}
                destino="/reportes/inventario"
                textoDestino="Ver reporte de inventario"
                icono={Wallet}
              />
            )}
            {pendientes?.salidasPendientes !== undefined && (
              <TarjetaCifra
                etiqueta="Salidas por confirmar"
                valor={String(pendientes.salidasPendientes)}
                destino="/salidas?estado=PENDIENTE"
                textoDestino="Ver salidas pendientes"
                icono={ArrowSquareOut}
                distintivo={pendientes.salidasPendientes > 0 ? <DistintivoAtencion /> : undefined}
              />
            )}
            {pendientes?.ingresosPendientes !== undefined && (
              <TarjetaCifra
                etiqueta="Ingresos por recibir"
                valor={String(pendientes.ingresosPendientes)}
                destino="/ingresos?estado=PENDIENTE"
                textoDestino="Ver ingresos pendientes"
                icono={ArrowSquareIn}
                distintivo={pendientes.ingresosPendientes > 0 ? <DistintivoAtencion /> : undefined}
              />
            )}
            {consumoMes && (
              <TarjetaCifra
                etiqueta="Consumo del mes"
                valor={formatoMoneda(consumoMes.total)}
                destino="/reportes/consumo-cliente"
                textoDestino="Ver reportes de consumo"
                icono={ChartLineUp}
                detalle={`Desde el ${formatoFecha(consumoMes.desde)}`}
              />
            )}
          </div>

          {movimientosRecientes && (
            <ActividadReciente movimientos={movimientosRecientes} verTodos={puedeVerReportes} />
          )}
        </>
      )}
    </div>
  );
}
