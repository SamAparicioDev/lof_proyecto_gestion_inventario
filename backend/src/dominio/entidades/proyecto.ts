/**
 * Entidad de dominio `Proyecto` — TypeScript puro (Principio VI, NO NEGOCIABLE).
 *
 * Campos espejo de la tabla `proyectos` de `data-model.md`, como tipo PROPIO del dominio
 * (no se importa el modelo/enum generado por Prisma — docs/arquitectura.md §2). El
 * adaptador `infraestructura/persistencia/repositorio-proyectos.prisma.ts` traduce entre
 * el registro Prisma y esta forma.
 *
 * Incluye `esDestinoValido` — la regla de negocio de FR-038 ("solo proyectos ACTIVO de
 * clientes ACTIVO reciben nuevas salidas", data-model.md § proyectos) como función PURA.
 *
 * Implementa: FR-036 (proyecto asociado a un cliente, con fechas/presupuesto/responsable),
 * FR-038 (regla de destino válido de salida, reutilizada por el puerto `RepositorioProyectos`
 * y, más adelante, por US3 al validar el destino de una salida).
 */
import type { EstadoCliente } from './cliente';

/** Máquina de estados de un proyecto (data-model.md — FR-036). */
export type EstadoProyecto = 'ACTIVO' | 'COMPLETADO' | 'SUSPENDIDO';

export interface Proyecto {
  readonly id: number;
  readonly clienteId: number;
  readonly nombre: string;
  readonly descripcion: string | null;
  readonly fechaInicio: Date | null;
  readonly fechaCierreEstimada: Date | null;
  readonly responsable: string | null;
  readonly presupuestoEstimado: number | null;
  readonly estado: EstadoProyecto;
}

/**
 * Regla CANÓNICA de "destino válido de salida" (FR-038, data-model.md § proyectos): un
 * proyecto solo puede recibir una nueva salida si él mismo está `ACTIVO` Y el cliente al
 * que pertenece también está `ACTIVO`. Esta es la ÚNICA definición de la regla en todo el
 * sistema — el adaptador de infraestructura (`repositorio-proyectos.prisma.ts`,
 * `proyectosDestino`) debe traducir esta MISMA regla a su filtro SQL
 * (`proyecto.estado = 'ACTIVO' AND cliente.estado = 'ACTIVO'`), nunca inventar una versión
 * distinta; y el futuro caso de uso de creación de salidas (US3) la reutiliza para el
 * mensaje de rechazo cuando el `proyectoId` enviado no es un destino válido.
 */
export function esDestinoValido(proyecto: Proyecto, estadoCliente: EstadoCliente): boolean {
  return proyecto.estado === 'ACTIVO' && estadoCliente === 'ACTIVO';
}
