/**
 * Casos de uso del catálogo de proveedores (US15, T160).
 *
 * Los cinco viven en un mismo archivo por el mismo motivo que los de categorías: es un CRUD de
 * catálogo cuyas únicas decisiones no triviales son las que exige la historia, y se leen mejor
 * juntas que dispersas en cinco archivos de diez líneas.
 *
 * Respecto a categorías hay UNA regla más, y es el corazón de FR-093: el proveedor que usa la
 * carga masiva no se renombra ni se borra. No es una precaución genérica —`ImportarProductos`
 * lo localiza POR NOMBRE, así que renombrarlo dejaría la importación sin proveedor al que
 * apuntar—, y por eso se rechaza con `EstadoInvalido` (409) y no con un error de permisos: no
 * depende de quién lo pide, sino de qué registro es.
 *
 * Implementa: FR-091 (catálogo administrable con las reglas de FR-084…FR-088), FR-093 (el
 * proveedor del sistema está protegido).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { Duplicado, EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import {
  normalizarNombreProveedor,
  puedeEliminarse,
  puedeRenombrarse,
  type EstadoProveedor,
  type ProveedorConUso,
} from '../../dominio/entidades/proveedor';
import {
  REPOSITORIO_PROVEEDORES,
  type FiltrosListarProveedores,
  type RepositorioProveedores,
} from '../../dominio/puertos/repositorio-proveedores';

@Injectable()
export class ListarProveedoresCasoUso implements CasoDeUso<FiltrosListarProveedores, ProveedorConUso[]> {
  constructor(@Inject(REPOSITORIO_PROVEEDORES) private readonly repositorio: RepositorioProveedores) {}

  async ejecutar(filtros: FiltrosListarProveedores): Promise<ProveedorConUso[]> {
    return this.repositorio.listar(filtros);
  }
}

export interface EntradaCrearProveedor {
  readonly nombre: string;
  readonly nit?: string;
  readonly telefono?: string;
  readonly email?: string;
  readonly usuarioId: number;
}

@Injectable()
export class CrearProveedorCasoUso implements CasoDeUso<EntradaCrearProveedor, number> {
  constructor(@Inject(REPOSITORIO_PROVEEDORES) private readonly repositorio: RepositorioProveedores) {}

  /**
   * El duplicado se comprueba ANTES de insertar aunque la base de datos ya lo impida con su
   * índice funcional: comprobándolo aquí el mensaje puede decir con qué nombre EXISTENTE choca
   * —"Formex" cuando el usuario escribió "formex "—, que es justo la información que le falta
   * para entender por qué se le rechaza algo que él ve distinto. El índice sigue siendo la red
   * final ante una carrera entre dos altas simultáneas.
   */
  async ejecutar(entrada: EntradaCrearProveedor): Promise<number> {
    const existente = await this.repositorio.buscarPorNombreNormalizado(
      normalizarNombreProveedor(entrada.nombre),
    );
    if (existente) {
      throw new Duplicado('nombre', `Ya existe un proveedor llamado "${existente.nombre}"`);
    }

    return this.repositorio.crear(datosDe(entrada), entrada.usuarioId);
  }
}

export interface EntradaActualizarProveedor extends EntradaCrearProveedor {
  readonly id: number;
}

@Injectable()
export class ActualizarProveedorCasoUso implements CasoDeUso<EntradaActualizarProveedor, void> {
  constructor(@Inject(REPOSITORIO_PROVEEDORES) private readonly repositorio: RepositorioProveedores) {}

  async ejecutar(entrada: EntradaActualizarProveedor): Promise<void> {
    const proveedor = await this.repositorio.buscarPorId(entrada.id);
    if (!proveedor) throw new NoEncontrado('El proveedor');

    // FR-093: lo que se bloquea es el CAMBIO DE NOMBRE, no la edición entera. Corregir el
    // teléfono del proveedor de la carga masiva es inofensivo; cambiarle el nombre rompería la
    // resolución por nombre de la importación. Comparar normalizado, además, permite arreglar
    // mayúsculas o espacios sobrantes sin considerarlo un renombrado.
    const cambiaNombre =
      normalizarNombreProveedor(entrada.nombre) !== normalizarNombreProveedor(proveedor.nombre);
    if (cambiaNombre && !puedeRenombrarse(proveedor)) {
      throw new EstadoInvalido(
        `No se puede cambiar el nombre de "${proveedor.nombre}": la carga masiva de inventario lo busca por ese nombre. Sus datos de contacto sí se pueden corregir.`,
      );
    }

    // Comparar contra sí mismo no es duplicado: renombrar "formex" a "Formex" —corregir la
    // tipografía sin cambiar la identidad— es exactamente lo que esta historia quiere permitir.
    const existente = await this.repositorio.buscarPorNombreNormalizado(
      normalizarNombreProveedor(entrada.nombre),
    );
    if (existente && existente.id !== entrada.id) {
      throw new Duplicado('nombre', `Ya existe un proveedor llamado "${existente.nombre}"`);
    }

    await this.repositorio.actualizar(entrada.id, datosDe(entrada), entrada.usuarioId);
  }
}

export interface EntradaEstadoProveedor {
  readonly id: number;
  readonly estado: EstadoProveedor;
  readonly usuarioId: number;
}

@Injectable()
export class CambiarEstadoProveedorCasoUso implements CasoDeUso<EntradaEstadoProveedor, void> {
  constructor(@Inject(REPOSITORIO_PROVEEDORES) private readonly repositorio: RepositorioProveedores) {}

  /**
   * Desactivar NO exige que el proveedor esté libre de ingresos: es justamente la vía para
   * retirar de circulación uno con historial sin tocar lo ya registrado.
   *
   * El proveedor del sistema SÍ puede desactivarse: la importación lo resuelve por nombre y no
   * consulta su estado, así que desactivarlo solo lo retira del selector de ingresos manuales
   * —que es una decisión legítima— sin romper nada. Se bloquean el renombrado y el borrado
   * porque esos sí lo romperían (FR-093).
   */
  async ejecutar(entrada: EntradaEstadoProveedor): Promise<void> {
    const proveedor = await this.repositorio.buscarPorId(entrada.id);
    if (!proveedor) throw new NoEncontrado('El proveedor');

    await this.repositorio.cambiarEstado(entrada.id, entrada.estado, entrada.usuarioId);
  }
}

@Injectable()
export class EliminarProveedorCasoUso implements CasoDeUso<number, void> {
  constructor(@Inject(REPOSITORIO_PROVEEDORES) private readonly repositorio: RepositorioProveedores) {}

  /**
   * Borrado REAL, misma excepción deliberada a "en Trazo nada se borra" que en categorías: un
   * proveedor recién creado por error y que ningún ingreso usa no merece quedarse para siempre
   * en el catálogo. En cuanto una factura lo referencia deja de poder eliminarse y la vía es
   * desactivarlo — así ningún ingreso histórico pierde a quién se le compró.
   *
   * Se cuenta primero para poder decir CUÁNTOS ingresos lo usan; la FK `RESTRICT` de la base de
   * datos es la red final si dos peticiones concurrentes cuentan cero a la vez.
   */
  async ejecutar(id: number): Promise<void> {
    const proveedor = await this.repositorio.buscarPorId(id);
    if (!proveedor) throw new NoEncontrado('El proveedor');

    if (!puedeEliminarse(proveedor)) {
      throw new EstadoInvalido(
        `No se puede eliminar "${proveedor.nombre}": es el proveedor que usa la carga masiva de inventario. Desactívalo si no quieres que aparezca al registrar ingresos.`,
      );
    }

    const ingresos = await this.repositorio.contarIngresos(id);
    if (ingresos > 0) {
      throw new EstadoInvalido(
        `No se puede eliminar el proveedor porque ${ingresos} ${ingresos === 1 ? 'ingreso lo usa' : 'ingresos lo usan'}. Desactívalo si ya no quieres ofrecerlo.`,
      );
    }

    await this.repositorio.eliminar(id);
  }
}

/** Los campos de contacto llegan `undefined` cuando el formulario los deja en blanco; el puerto
 *  y la base de datos hablan de `null` (ausencia de dato), no de "no enviado". */
function datosDe(entrada: EntradaCrearProveedor) {
  return {
    nombre: entrada.nombre,
    nit: entrada.nit ?? null,
    telefono: entrada.telefono ?? null,
    email: entrada.email ?? null,
  };
}
