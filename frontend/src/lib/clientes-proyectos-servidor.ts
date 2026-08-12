/**
 * Agrega TODOS los proyectos de TODOS los clientes en una sola estructura, del lado servidor
 * (T053/T055) — necesario porque el contrato NO expone un listado plano de proyectos (solo
 * `GET /api/clientes/:id` por cliente y `GET /api/clientes/:id/proyectos-destino`, filtrado a
 * ACTIVOS de un cliente ACTIVO — FR-038). Las salidas solo guardan `proyectoId`
 * (data-model.md: "guardar ambos [cliente y proyecto] duplicaría la verdad"), así que mostrar
 * las columnas "Cliente"/"Proyecto" en el listado (T053) y precargar el cliente del
 * formulario de edición (T055) exige resolver ese id hacia atrás, hasta su cliente.
 *
 * Estrategia: 1 llamada a `GET /api/clientes` + N llamadas a `GET /api/clientes/:id` en
 * paralelo (una por cliente) — coste acotado por el número TOTAL de clientes del sistema
 * (típicamente pequeño en este dominio B2B de inventario con trazabilidad por proyecto),
 * NUNCA por el número de salidas. Si el catálogo de clientes creciera mucho, la solución
 * correcta sería ampliar el contrato con un endpoint plano `GET /api/proyectos` — eso es una
 * ampliación de contrato fuera del alcance de T053-T055 (frontend/CLAUDE.md: este workspace
 * es solo presentación, no inventa endpoints nuevos sin necesidad).
 *
 * PERMISO (corrección de la revisión adversarial de la Tanda 13): estos datos son AUXILIARES
 * —ponen el nombre del cliente y del proyecto donde la API solo devuelve `proyectoId`— y
 * exigen `clientes.ver`, que es un permiso DISTINTO de `salidas.ver`. Un rol propio con
 * salidas pero sin clientes veía el enlace "Salidas" en su menú y, al pulsarlo, la pantalla de
 * error genérica de Next. Ahora se degrada: sin `clientes.ver` se devuelve la estructura vacía
 * y las columnas caen a su texto de respaldo ("—", "Proyecto N.º 7"), que ya existía para el
 * caso de un proyecto no encontrado.
 */
import type { Cliente, ClienteConProyectos, Paginado, Proyecto } from '@trazo/compartido';
import { POR_PAGINA_MAXIMA } from '@trazo/compartido';
import { apiServidorOpcional } from './api/servidor';

/** Proyecto con el nombre de su cliente ya resuelto, para mostrar en tablas sin otro JOIN. */
export interface ProyectoConCliente extends Proyecto {
  clienteNombre: string;
}

export interface ClientesYProyectos {
  clientes: Cliente[];
  proyectos: ProyectoConCliente[];
}

/** Estructura vacía: lo que ve una sesión SIN `clientes.ver` (ver TSDoc de cabecera). */
const SIN_CLIENTES_NI_PROYECTOS: ClientesYProyectos = { clientes: [], proyectos: [] };

/** Carga clientes + TODOS sus proyectos (ver TSDoc de cabecera para el porqué del N+1 acotado). */
export async function cargarClientesYProyectos(): Promise<ClientesYProyectos> {
  const pagina = await apiServidorOpcional<Paginado<Cliente> | null>(
    `/api/clientes?porPagina=${POR_PAGINA_MAXIMA}`,
    null,
  );
  if (!pagina) {
    return SIN_CLIENTES_NI_PROYECTOS;
  }
  const detalles = await Promise.all(
    pagina.datos.map((cliente) => apiServidorOpcional<ClienteConProyectos | null>(`/api/clientes/${cliente.id}`, null)),
  );
  const proyectos = detalles
    .filter((cliente): cliente is ClienteConProyectos => cliente !== null)
    .flatMap((cliente) => cliente.proyectos.map((proyecto) => ({ ...proyecto, clienteNombre: cliente.nombre })));
  return { clientes: pagina.datos, proyectos };
}
