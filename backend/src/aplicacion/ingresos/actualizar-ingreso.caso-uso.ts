/**
 * Caso de uso `ActualizarIngresoCasoUso` — reemplaza cabecera y líneas de un ingreso
 * (`PUT /api/ingresos/:id`, US1-AS5). Solo editable mientras está `PENDIENTE`: recalcula
 * totales (FR-014) porque las líneas cambian por completo.
 *
 * Carga el ingreso primero y valida el estado ANTES de llamar al repositorio — da un
 * mensaje de negocio inmediato en el 99% de los casos. La comprobación real y atómica
 * sigue viviendo en `RepositorioIngresosPrisma.actualizar` (dentro de su propia
 * transacción, ver T030): si el ingreso pasó a `RECIBIDO` entre esta lectura y la
 * escritura (carrera con otro usuario), el adaptador vuelve a rechazar con
 * `EstadoInvalido` — esta capa no sustituye esa garantía, solo mejora el mensaje del
 * camino feliz.
 *
 * Implementa: FR-013/FR-014 (edición de cabecera y líneas con recálculo de totales) y
 * FR-017 (un ingreso `RECIBIDO` o posterior ya no es editable — US1-AS5).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CasoDeUso } from '../comunes/caso-de-uso';
import { EstadoInvalido, NoEncontrado } from '../../dominio/comunes/errores';
import { REPOSITORIO_INGRESOS, type RepositorioIngresos } from '../../dominio/puertos/repositorio-ingresos';
import {
  REPOSITORIO_PROVEEDORES,
  type RepositorioProveedores,
} from '../../dominio/puertos/repositorio-proveedores';
import type { LineaCrearIngresoEntrada } from './crear-ingreso.caso-uso';
import { verificarProveedorAsignable } from './verificar-proveedor-asignable';

/** Entrada: datos validados por `esquemaActualizarIngreso` + auditoría (FR-045). */
export interface ActualizarIngresoEntrada {
  readonly ingresoId: number;
  readonly numeroFactura?: string;
  readonly fechaFactura?: string;
  /** Referencia al catálogo de proveedores (US15, FR-091) — obligatoria. */
  readonly proveedorId?: number;
  readonly fechaRecepcion: string;
  readonly observaciones: string | null;
  readonly lineas: readonly LineaCrearIngresoEntrada[];
  /** Quién edita el ingreso — nunca confiar en un valor del body (FR-045). */
  readonly usuarioId: number;
}

@Injectable()
export class ActualizarIngresoCasoUso implements CasoDeUso<ActualizarIngresoEntrada, void> {
  constructor(
    @Inject(REPOSITORIO_INGRESOS) private readonly repositorioIngresos: RepositorioIngresos,
    @Inject(REPOSITORIO_PROVEEDORES) private readonly repositorioProveedores: RepositorioProveedores,
  ) {}

  async ejecutar(entrada: ActualizarIngresoEntrada): Promise<void> {
    const ingreso = await this.repositorioIngresos.buscarPorId(entrada.ingresoId);
    if (!ingreso) {
      throw new NoEncontrado('El ingreso');
    }
    if (ingreso.estado !== 'PENDIENTE') {
      throw new EstadoInvalido('Solo un ingreso PENDIENTE puede editarse');
    }

    // Solo si CAMBIA: un ingreso que ya apuntaba a un proveedor luego desactivado lo conserva
    // (US15, FR-091 — ver el TSDoc de `verificarProveedorAsignable`). Exigirlo siempre dejaría
    // facturas pendientes imposibles de guardar por un cambio de catálogo ajeno a ellas.
    if (entrada.proveedorId !== undefined && entrada.proveedorId !== ingreso.proveedor?.id) {
      await verificarProveedorAsignable(this.repositorioProveedores, entrada.proveedorId);
    }

    await this.repositorioIngresos.actualizar(
      entrada.ingresoId,
      {
        // US29 (FR-126): el TIPO no se edita — se conserva el del documento guardado. Cambiarlo
        // convertiría una factura en un ajuste (o al revés) y con ella su número y su proveedor.
        tipo: ingreso.tipo,
        numeroFactura: entrada.numeroFactura ?? null,
        fechaFactura: entrada.fechaFactura === undefined ? null : new Date(entrada.fechaFactura),
        proveedorId: entrada.proveedorId ?? null,
        fechaRecepcion: new Date(entrada.fechaRecepcion),
        observaciones: entrada.observaciones,
        lineas: entrada.lineas.map((linea) => ({ ...linea })),
      },
      entrada.usuarioId,
    );
  }
}
