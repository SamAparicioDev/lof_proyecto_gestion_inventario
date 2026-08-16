/**
 * Casos de uso del catálogo de unidades de medida (US17, T180).
 *
 * Los cinco viven juntos por el mismo motivo que en categorías y proveedores: es un CRUD de
 * catálogo cuyas decisiones no triviales son las dos de siempre —duplicado normalizado y no
 * borrar lo que está en uso— y se leen mejor seguidas.
 *
 * Lo propio de este catálogo es que el duplicado puede venir por DOS campos, y el error tiene
 * que decir por cuál: mandar al usuario a corregir el nombre cuando lo que chocó fue la
 * abreviatura es peor que no decirle nada.
 *
 * Implementa: FR-101 (catálogo con dos unicidades), FR-105 (baja lógica cuando está en uso).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { Duplicado, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import {
  normalizarTextoUnidadMedida,
  type EstadoUnidadMedida,
  type UnidadMedidaConUso,
} from '../../dominio/entidades/unidad-medida';
import {
  REPOSITORIO_UNIDADES_MEDIDA,
  type FiltrosListarUnidadesMedida,
  type RepositorioUnidadesMedida,
} from '../../dominio/puertos/repositorio-unidades-medida';

@Injectable()
export class ListarUnidadesMedidaCasoUso
  implements CasoDeUso<FiltrosListarUnidadesMedida, UnidadMedidaConUso[]>
{
  constructor(@Inject(REPOSITORIO_UNIDADES_MEDIDA) private readonly repositorio: RepositorioUnidadesMedida) {}

  async ejecutar(filtros: FiltrosListarUnidadesMedida): Promise<UnidadMedidaConUso[]> {
    return this.repositorio.listar(filtros);
  }
}

export interface EntradaCrearUnidadMedida {
  readonly nombre: string;
  readonly abreviatura: string;
  readonly usuarioId: number;
}

@Injectable()
export class CrearUnidadMedidaCasoUso implements CasoDeUso<EntradaCrearUnidadMedida, number> {
  constructor(@Inject(REPOSITORIO_UNIDADES_MEDIDA) private readonly repositorio: RepositorioUnidadesMedida) {}

  async ejecutar(entrada: EntradaCrearUnidadMedida): Promise<number> {
    await verificarTextosLibres(this.repositorio, entrada, null);
    return this.repositorio.crear(
      { nombre: entrada.nombre, abreviatura: entrada.abreviatura },
      entrada.usuarioId,
    );
  }
}

export interface EntradaActualizarUnidadMedida extends EntradaCrearUnidadMedida {
  readonly id: number;
}

@Injectable()
export class ActualizarUnidadMedidaCasoUso implements CasoDeUso<EntradaActualizarUnidadMedida, void> {
  constructor(@Inject(REPOSITORIO_UNIDADES_MEDIDA) private readonly repositorio: RepositorioUnidadesMedida) {}

  async ejecutar(entrada: EntradaActualizarUnidadMedida): Promise<void> {
    const unidad = await this.repositorio.buscarPorId(entrada.id);
    if (!unidad) throw new NoEncontrado('La unidad de medida');

    await verificarTextosLibres(this.repositorio, entrada, entrada.id);

    await this.repositorio.actualizar(
      entrada.id,
      { nombre: entrada.nombre, abreviatura: entrada.abreviatura },
      entrada.usuarioId,
    );
  }
}

export interface EntradaEstadoUnidadMedida {
  readonly id: number;
  readonly estado: EstadoUnidadMedida;
  readonly usuarioId: number;
}

@Injectable()
export class CambiarEstadoUnidadMedidaCasoUso implements CasoDeUso<EntradaEstadoUnidadMedida, void> {
  constructor(@Inject(REPOSITORIO_UNIDADES_MEDIDA) private readonly repositorio: RepositorioUnidadesMedida) {}

  /** Desactivar NO exige que la unidad esté libre de productos: es justamente la vía para
   *  retirarla de circulación sin tocar lo ya medido con ella (FR-101 → FR-086/FR-087). */
  async ejecutar(entrada: EntradaEstadoUnidadMedida): Promise<void> {
    const unidad = await this.repositorio.buscarPorId(entrada.id);
    if (!unidad) throw new NoEncontrado('La unidad de medida');

    await this.repositorio.cambiarEstado(entrada.id, entrada.estado, entrada.usuarioId);
  }
}

@Injectable()
export class EliminarUnidadMedidaCasoUso implements CasoDeUso<number, void> {
  constructor(@Inject(REPOSITORIO_UNIDADES_MEDIDA) private readonly repositorio: RepositorioUnidadesMedida) {}

  /**
   * Borrado REAL, misma excepción deliberada que en los otros catálogos: una unidad creada por
   * error y que ningún producto usa no merece quedarse para siempre. En cuanto un producto la
   * usa deja de poder eliminarse y la vía es desactivarla — así ningún producto pierde la
   * unidad con la que se registró su historial.
   */
  async ejecutar(id: number): Promise<void> {
    const unidad = await this.repositorio.buscarPorId(id);
    if (!unidad) throw new NoEncontrado('La unidad de medida');

    const productos = await this.repositorio.contarProductos(id);
    if (productos > 0) {
      throw new EstadoInvalido(
        `No se puede eliminar la unidad de medida porque ${productos} ${productos === 1 ? 'producto la usa' : 'productos la usan'}. Desactívala si ya no quieres ofrecerla.`,
      );
    }

    await this.repositorio.eliminar(id);
  }
}

/**
 * Comprueba que ni el nombre ni la abreviatura choquen con otra unidad, y ancla el error al
 * campo que realmente chocó (FR-101).
 *
 * Se hace ANTES de escribir aunque los índices funcionales ya lo impidan: comprobándolo aquí el
 * mensaje puede nombrar la unidad EXISTENTE con la que choca —"Ya existe «Kilogramo» con la
 * abreviatura kg"—, que es lo que le falta al usuario para entender por qué se le rechaza algo
 * que él ve distinto. Los índices siguen siendo la red final ante dos altas simultáneas.
 *
 * `idQueSeEdita` excluye la propia unidad: corregir "kilogramo" a "Kilogramo" sin tocar la
 * abreviatura es exactamente lo que la edición debe permitir.
 */
async function verificarTextosLibres(
  repositorio: RepositorioUnidadesMedida,
  datos: { nombre: string; abreviatura: string },
  idQueSeEdita: number | null,
): Promise<void> {
  const coincidencia = await repositorio.buscarPorTexto(
    normalizarTextoUnidadMedida(datos.nombre),
    normalizarTextoUnidadMedida(datos.abreviatura),
  );
  if (!coincidencia || coincidencia.unidad.id === idQueSeEdita) return;

  const { unidad, campo } = coincidencia;
  throw new Duplicado(
    campo,
    campo === 'abreviatura'
      ? `La abreviatura "${unidad.abreviatura}" ya la usa la unidad "${unidad.nombre}"`
      : `Ya existe una unidad de medida llamada "${unidad.nombre}"`,
  );
}
