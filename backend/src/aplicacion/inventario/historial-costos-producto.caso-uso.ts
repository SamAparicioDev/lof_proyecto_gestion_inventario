/**
 * Caso de uso `HistorialCostosProductoCasoUso` — historial de cambios de costo de un producto,
 * enriquecido con el nombre de quien los hizo
 * (`GET /api/inventario/:productoId/historial-costos`, US12/FR-072).
 *
 * Es el gemelo de `HistorialProductoCasoUso` (movimientos) y sigue su mismo reparto: el
 * repositorio devuelve filas "crudas" (ids de usuario/documento) y la COMPOSICIÓN de datos
 * legibles vive aquí, no en el adaptador ni en el controlador. Rendimiento (evita N+1,
 * Principio V): los ids de usuario se deduplican ANTES de consultar —una corrección masiva de
 * precios la hace UNA persona, así que una página entera suele traer un único id— y se piden
 * en paralelo (`Promise.all`), nunca uno por fila.
 *
 * Si el usuario referenciado ya no existe, se usa un texto de respaldo con el id: la consulta
 * nunca falla por un dato faltante de enriquecimiento (mismo criterio que el historial de
 * movimientos).
 *
 * Deliberadamente NO devuelve nada de stock: este historial responde "cuánto vale y desde
 * cuándo", no "cuánto hay y por qué" (FR-073). Quien quiera lo segundo tiene
 * `GET /api/inventario/:productoId/movimientos`.
 *
 * Implementa: FR-072 (el historial de costos es consultable desde la ficha del producto, con
 * costo anterior, costo nuevo, usuario, fecha/hora y origen).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import type { CambioCostoProducto, OrigenCambioCosto } from '../../dominio/entidades/cambio-costo-producto';
import {
  REPOSITORIO_HISTORIAL_COSTOS,
  type RepositorioHistorialCostos,
} from '../../dominio/puertos/repositorio-historial-costos';
import { REPOSITORIO_USUARIOS, type RepositorioUsuarios } from '../../dominio/puertos/repositorio-usuarios';

export interface HistorialCostosProductoEntrada {
  readonly productoId: number;
  readonly pagina: number;
  readonly porPagina: number;
}

/** Cambio de costo enriquecido — lo que consume la sección "Historial de costos" de la ficha. */
export interface CambioCostoHistorialProducto {
  readonly id: number;
  readonly fechaHora: Date;
  readonly costoAnterior: number;
  readonly costoNuevo: number;
  readonly origen: OrigenCambioCosto;
  /** Id del ingreso cuando `origen === 'RECEPCION_INGRESO'`; `null` en los otros orígenes. */
  readonly documentoId: number | null;
  readonly usuarioId: number;
  /** `nombreCompleto` de quien hizo el cambio; `"Usuario N.º {id}"` si no se encuentra. */
  readonly usuarioNombre: string;
}

export interface PaginaHistorialCostosProducto {
  readonly datos: CambioCostoHistorialProducto[];
  readonly total: number;
}

@Injectable()
export class HistorialCostosProductoCasoUso
  implements CasoDeUso<HistorialCostosProductoEntrada, PaginaHistorialCostosProducto>
{
  constructor(
    @Inject(REPOSITORIO_HISTORIAL_COSTOS) private readonly repositorioHistorialCostos: RepositorioHistorialCostos,
    @Inject(REPOSITORIO_USUARIOS) private readonly repositorioUsuarios: RepositorioUsuarios,
  ) {}

  async ejecutar(entrada: HistorialCostosProductoEntrada): Promise<PaginaHistorialCostosProducto> {
    const pagina = await this.repositorioHistorialCostos.listarPorProducto(entrada.productoId, {
      pagina: entrada.pagina,
      porPagina: entrada.porPagina,
    });

    const nombresUsuario = await this.resolverNombresUsuario(pagina.datos);

    const datos = pagina.datos.map(
      (cambio): CambioCostoHistorialProducto => ({
        id: cambio.id,
        fechaHora: cambio.fechaHora,
        costoAnterior: cambio.costoAnterior,
        costoNuevo: cambio.costoNuevo,
        origen: cambio.origen,
        documentoId: cambio.documentoId,
        usuarioId: cambio.usuarioId,
        usuarioNombre: nombresUsuario.get(cambio.usuarioId) ?? `Usuario N.º ${cambio.usuarioId}`,
      }),
    );

    return { datos, total: pagina.total };
  }

  /** Nombres de usuario en lote: un `buscarPorId` por id ÚNICO, en paralelo — nunca uno por fila. */
  private async resolverNombresUsuario(cambios: readonly CambioCostoProducto[]): Promise<Map<number, string>> {
    const ids = [...new Set(cambios.map((cambio) => cambio.usuarioId))];
    const usuarios = await Promise.all(ids.map((id) => this.repositorioUsuarios.buscarPorId(id)));
    const mapa = new Map<number, string>();
    ids.forEach((id, indice) => {
      const usuario = usuarios[indice];
      if (usuario) mapa.set(id, usuario.nombreCompleto);
    });
    return mapa;
  }
}
