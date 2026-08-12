/**
 * Puerto `RepositorioProyectos` — acceso a la persistencia de proyectos de cliente visto
 * desde el dominio (patrón Repository, docs/arquitectura.md §3). Implementado por
 * `infraestructura/persistencia/repositorio-proyectos.prisma.ts`.
 *
 * Implementa: FR-036 (alta/edición de proyecto asociado a un cliente, con `UNIQUE(cliente_id,
 * nombre)` reforzado por la BD y traducido a `Duplicado('nombre', ...)` en el adaptador) y
 * FR-038 (destino válido de salida vía `proyectosDestino`).
 */
import type { EstadoProyecto, Proyecto } from '../entidades/proyecto';

/** Datos de alta de un proyecto — el cliente al que pertenece viaja embebido porque la ruta
 *  del contrato es anidada (`POST /api/clientes/:id/proyectos`, FR-036). */
export interface DatosNuevoProyecto {
  readonly clienteId: number;
  readonly nombre: string;
  readonly descripcion: string | null;
  readonly fechaInicio: Date | null;
  readonly fechaCierreEstimada: Date | null;
  readonly responsable: string | null;
  readonly presupuestoEstimado: number | null;
}

/** Datos editables de un proyecto (`PUT /api/proyectos/:id`) — el `clienteId` NO se edita
 *  tras el alta (la ruta no es anidada; un proyecto no cambia de cliente). */
export interface DatosActualizarProyecto {
  readonly nombre: string;
  readonly descripcion: string | null;
  readonly fechaInicio: Date | null;
  readonly fechaCierreEstimada: Date | null;
  readonly responsable: string | null;
  readonly presupuestoEstimado: number | null;
}

export interface RepositorioProyectos {
  /** Busca un proyecto por id. `null` si no existe. */
  buscarPorId(id: number): Promise<Proyecto | null>;

  /** Todos los proyectos de un cliente, sin filtrar por estado (vista de detalle del
   *  cliente — FR-037). */
  listarPorCliente(clienteId: number): Promise<Proyecto[]>;

  /**
   * Proyectos que son destino VÁLIDO de una nueva salida para el cliente dado
   * (`GET /api/clientes/:id/proyectos-destino`, combobox de salidas — FR-038). Aplica la
   * regla `esDestinoValido` de `dominio/entidades/proyecto.ts`: el adaptador filtra en SQL
   * por `proyecto.estado = 'ACTIVO' AND cliente.estado = 'ACTIVO'`, equivalente a esa
   * función pura — no una versión distinta de la regla.
   */
  proyectosDestino(clienteId: number): Promise<Proyecto[]>;

  /**
   * Da de alta un proyecto para un cliente (FR-036). El adaptador traduce la violación
   * `UNIQUE(cliente_id, nombre)` de PostgreSQL a `Duplicado('nombre', ...)` — el campo que
   * el usuario ve en el formulario (`clienteId` es implícito en la ruta, no un campo
   * visible), sin importar el detalle exacto de `target` que reporte Prisma para esa
   * constraint compuesta.
   */
  crear(datos: DatosNuevoProyecto, usuarioId: number): Promise<Proyecto>;

  /** Actualiza los datos editables de un proyecto existente (FR-036). */
  actualizar(id: number, datos: DatosActualizarProyecto, usuarioId: number): Promise<void>;

  /** Cambia el estado (`ACTIVO`/`COMPLETADO`/`SUSPENDIDO`) de un proyecto — nunca DELETE
   *  (US2-AS4). Un proyecto `SUSPENDIDO`/`COMPLETADO` deja de ser destino válido de salidas
   *  (FR-038, ver `esDestinoValido`). */
  cambiarEstado(id: number, estado: EstadoProyecto, usuarioId: number): Promise<void>;
}

/** Token de inyección de NestJS para el puerto `RepositorioProyectos`. */
export const REPOSITORIO_PROYECTOS = 'RepositorioProyectos';
