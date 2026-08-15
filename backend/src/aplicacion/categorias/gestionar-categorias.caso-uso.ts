/**
 * Casos de uso del catálogo de categorías (US15, T150).
 *
 * Los cinco están en un mismo archivo, a diferencia del resto de la aplicación —donde cada
 * operación tiene el suyo—, porque aquí no hay reglas de negocio repartidas: son un CRUD de
 * catálogo cuyas ÚNICAS decisiones no triviales son las dos que exige la historia
 * (duplicado normalizado y no borrar lo que está en uso), y ambas se leen mejor juntas que
 * dispersas en cinco archivos de diez líneas. Si alguna gana lógica propia, se separa.
 *
 * Implementa: FR-084 (catálogo administrable), FR-085 (unicidad ignorando mayúsculas y
 * espacios), FR-086 (solo las activas se ofrecen), FR-087 (baja lógica cuando está en uso).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { Duplicado, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import {
  normalizarNombreCategoria,
  type CategoriaConUso,
  type EstadoCategoria,
} from '../../dominio/entidades/categoria';
import {
  REPOSITORIO_CATEGORIAS,
  type FiltrosListarCategorias,
  type RepositorioCategorias,
} from '../../dominio/puertos/repositorio-categorias';

@Injectable()
export class ListarCategoriasCasoUso implements CasoDeUso<FiltrosListarCategorias, CategoriaConUso[]> {
  constructor(@Inject(REPOSITORIO_CATEGORIAS) private readonly repositorio: RepositorioCategorias) {}

  async ejecutar(filtros: FiltrosListarCategorias): Promise<CategoriaConUso[]> {
    return this.repositorio.listar(filtros);
  }
}

export interface EntradaCrearCategoria {
  readonly nombre: string;
  readonly descripcion?: string;
  readonly usuarioId: number;
}

@Injectable()
export class CrearCategoriaCasoUso implements CasoDeUso<EntradaCrearCategoria, number> {
  constructor(@Inject(REPOSITORIO_CATEGORIAS) private readonly repositorio: RepositorioCategorias) {}

  /**
   * El duplicado se comprueba ANTES de insertar aunque la base de datos ya lo impida con su
   * índice funcional. No es redundancia inútil: comprobándolo aquí el mensaje puede decir con
   * qué nombre EXISTENTE choca —"Ferretería" cuando el usuario escribió "ferreteria "—, que es
   * justo la información que le falta para entender por qué se le rechaza algo que él ve
   * distinto. El índice sigue siendo la red final ante una carrera entre dos altas simultáneas.
   */
  async ejecutar(entrada: EntradaCrearCategoria): Promise<number> {
    await this.verificarNombreLibre(entrada.nombre, null);

    return this.repositorio.crear(
      { nombre: entrada.nombre, descripcion: entrada.descripcion ?? null },
      entrada.usuarioId,
    );
  }

  private async verificarNombreLibre(nombre: string, idQueSeEdita: number | null): Promise<void> {
    const existente = await this.repositorio.buscarPorNombreNormalizado(normalizarNombreCategoria(nombre));
    if (existente && existente.id !== idQueSeEdita) {
      throw new Duplicado('nombre', `Ya existe una categoría llamada "${existente.nombre}"`);
    }
  }
}

export interface EntradaActualizarCategoria extends EntradaCrearCategoria {
  readonly id: number;
}

@Injectable()
export class ActualizarCategoriaCasoUso implements CasoDeUso<EntradaActualizarCategoria, void> {
  constructor(@Inject(REPOSITORIO_CATEGORIAS) private readonly repositorio: RepositorioCategorias) {}

  async ejecutar(entrada: EntradaActualizarCategoria): Promise<void> {
    const categoria = await this.repositorio.buscarPorId(entrada.id);
    if (!categoria) throw new NoEncontrado('La categoría');

    // Comparar contra sí misma no es duplicado: renombrar "ferreteria" a "Ferretería" —corregir
    // la tipografía sin cambiar la identidad— es exactamente lo que esta historia quiere permitir.
    const existente = await this.repositorio.buscarPorNombreNormalizado(
      normalizarNombreCategoria(entrada.nombre),
    );
    if (existente && existente.id !== entrada.id) {
      throw new Duplicado('nombre', `Ya existe una categoría llamada "${existente.nombre}"`);
    }

    await this.repositorio.actualizar(
      entrada.id,
      { nombre: entrada.nombre, descripcion: entrada.descripcion ?? null },
      entrada.usuarioId,
    );
  }
}

export interface EntradaEstadoCategoria {
  readonly id: number;
  readonly estado: EstadoCategoria;
  readonly usuarioId: number;
}

@Injectable()
export class CambiarEstadoCategoriaCasoUso implements CasoDeUso<EntradaEstadoCategoria, void> {
  constructor(@Inject(REPOSITORIO_CATEGORIAS) private readonly repositorio: RepositorioCategorias) {}

  /** Desactivar NO exige que la categoría esté libre de productos: es justamente la vía para
   *  retirar de circulación una categoría en uso sin tocar lo ya clasificado (FR-086/FR-087). */
  async ejecutar(entrada: EntradaEstadoCategoria): Promise<void> {
    const categoria = await this.repositorio.buscarPorId(entrada.id);
    if (!categoria) throw new NoEncontrado('La categoría');

    await this.repositorio.cambiarEstado(entrada.id, entrada.estado, entrada.usuarioId);
  }
}

@Injectable()
export class EliminarCategoriaCasoUso implements CasoDeUso<number, void> {
  constructor(@Inject(REPOSITORIO_CATEGORIAS) private readonly repositorio: RepositorioCategorias) {}

  /**
   * Borrado REAL, y es la excepción deliberada a "en Trazo nada se borra": una categoría
   * recién creada por error y que nadie ha usado no merece quedarse para siempre en el
   * catálogo. En cuanto un producto la usa, deja de poder eliminarse (FR-087) y la vía es
   * desactivarla — así ningún producto ni movimiento histórico pierde su clasificación.
   *
   * Se cuenta primero para poder decir CUÁNTOS productos la usan; la FK `RESTRICT` de la base
   * de datos es la red final si dos peticiones concurrentes cuentan cero a la vez.
   */
  async ejecutar(id: number): Promise<void> {
    const categoria = await this.repositorio.buscarPorId(id);
    if (!categoria) throw new NoEncontrado('La categoría');

    const productos = await this.repositorio.contarProductos(id);
    if (productos > 0) {
      throw new EstadoInvalido(
        `No se puede eliminar la categoría porque ${productos} ${productos === 1 ? 'producto la usa' : 'productos la usan'}. Desactívala si ya no quieres ofrecerla.`,
      );
    }

    await this.repositorio.eliminar(id);
  }
}
