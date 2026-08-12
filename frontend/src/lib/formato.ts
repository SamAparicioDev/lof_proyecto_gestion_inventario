/**
 * Helper de formato del avatar del sidebar — misma lógica que `Trazo Inventarios.dc.html`
 * (`userInitials`): iniciales a partir del nombre completo del usuario.
 */

/** Iniciales (máx. 2 letras) a partir de un nombre completo — "Laura Cifuentes" → "LC". */
export function iniciales(nombreCompleto: string): string {
  return nombreCompleto
    .split(' ')
    .filter(Boolean)
    .map((palabra) => palabra[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Formato de dinero en pesos colombianos, locale `es-CO` (frontend/CLAUDE.md: "Dinero y
 * fechas: helpers de formato... en src/lib/ — no formatees a mano en cada componente").
 * Usado por los módulos de ingresos/salidas/reportes para `valorTotal`, `precioUnitario`, etc.
 */
const FORMATEADOR_MONEDA = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' });
export function formatoMoneda(valor: number): string {
  return FORMATEADOR_MONEDA.format(valor);
}

/**
 * Formato de una fecha SOLO DÍA (columnas `DATE` de data-model.md, p. ej. `fecha_factura`/
 * `fecha_recepcion` de ingresos — sin componente de hora). Usa el huso `UTC` explícitamente
 * — NO `America/Bogota` — porque Postgres serializa estas columnas como medianoche UTC;
 * convertir a Bogotá (UTC-5) las mostraría un día antes del real. Acepta el string ISO tal
 * como llega de la API o un `Date`.
 */
const FORMATEADOR_FECHA = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
export function formatoFecha(fecha: string | Date): string {
  return FORMATEADOR_FECHA.format(new Date(fecha));
}

/**
 * Formato de un INSTANTE real (columnas `timestamptz` con hora significativa —
 * `movimientos_inventario.fecha_hora`, `productos.fecha_ultimo_movimiento`,
 * `salidas.fecha_confirmacion`; ver data-model.md § Campos) — a diferencia de
 * `formatoFecha`, aquí SÍ se convierte al huso `America/Bogota` (spec.md § Assumptions),
 * porque estas columnas NO son medianoche UTC sino el momento real en que ocurrió la
 * mutación. Usar `formatoFecha` (UTC) sobre uno de estos campos corre el "día calendario"
 * un día hacia adelante para cualquier movimiento entre las 19:00 y 23:59 hora Bogotá
 * (hallazgo T089, quickstart.md escenario 2) — mismo formato visual DD/MM/AAAA que
 * `formatoFecha`, solo cambia el huso usado para decidir a qué día calendario pertenece.
 * NO usar para los campos de los reportes (`reportes/movimientos`,
 * `reportes/consumo-proyecto`): esos truncan a "solo día" en UTC a propósito, replicando
 * `mapeadores-documento-reporte.ts#formatoFechaSoloDia` del backend para que pantalla y
 * export PDF/Excel muestren el mismo número (SC-007) — cambiar esos rompería esa paridad.
 */
const FORMATEADOR_FECHA_HORA = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
export function formatoFechaHora(fecha: string | Date): string {
  return FORMATEADOR_FECHA_HORA.format(new Date(fecha));
}
