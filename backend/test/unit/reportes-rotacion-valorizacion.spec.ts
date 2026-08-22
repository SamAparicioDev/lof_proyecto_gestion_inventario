/**
 * Pruebas de los dos reportes de SOLO LECTURA sobre el inventario (T290/T297, US37 y US38).
 *
 * Van aquí porque lo que verifican es aritmética de negocio, no SQL: con puertos falsos se puede
 * fabricar exactamente la historia que hace falta —un producto que recibió mercancía ayer pero no
 * sale hace un año, un costo que cambió después de la fecha del cierre— y esas combinaciones son
 * caras de montar contra una base real y frágiles de mantener.
 *
 * Las cuatro reglas que se atacan son justo las que un lector distraído implementaría al revés:
 *
 * 1. El contador NO se reinicia con una entrada (FR-159). Es la regla central de US37.
 * 2. El que nunca ha salido cuenta desde su primera entrada y va SEÑALADO (FR-159).
 * 3. Sin existencias no hay inmovilizado (FR-160), y el orden es por valor (FR-161).
 * 4. La valorización usa el costo vigente A LA FECHA, no el de hoy (FR-165).
 */
import {
  ReporteInventarioInmovilCasoUso,
  type ReporteInventarioInmovilEntrada,
} from '../../src/aplicacion/reportes/reporte-inventario-inmovil.caso-uso';
import { ReporteValorizacionCasoUso } from '../../src/aplicacion/reportes/reporte-valorizacion.caso-uso';
import type { Producto } from '../../src/dominio/entidades/producto';
import type { RepositorioProductos } from '../../src/dominio/puertos/repositorio-productos';
import type {
  ExistenciasAFecha,
  RepositorioMovimientos,
  RotacionDeProducto,
} from '../../src/dominio/puertos/repositorio-movimientos';
import type {
  CostoVigenteAFecha,
  RepositorioHistorialCostos,
} from '../../src/dominio/puertos/repositorio-historial-costos';

/** "Hoy" fijo — el reloj real haría que estas pruebas cambiaran de resultado cada día. */
const HOY = new Date('2026-08-22T12:00:00.000Z');
const haceDias = (dias: number): Date => new Date(HOY.getTime() - dias * 24 * 60 * 60 * 1000);

function producto(parcial: Partial<Producto> & Pick<Producto, 'id' | 'sku'>): Producto {
  return {
    descripcion: `Producto ${parcial.id}`,
    categoria: null,
    unidadMedida: null,
    ubicacion: null,
    umbralStockBajo: 0,
    stockActual: 10,
    ultimoCosto: 1000,
    fechaUltimoMovimiento: null,
    estado: 'ACTIVO',
    ...parcial,
  } as Producto;
}

function productosFalsos(catalogo: Producto[]): RepositorioProductos {
  return { listarTodos: async () => catalogo } as unknown as RepositorioProductos;
}

function movimientosFalsos(
  rotaciones: RotacionDeProducto[],
  existencias: ExistenciasAFecha[] = [],
): RepositorioMovimientos {
  return {
    rotacionPorProducto: async () => rotaciones,
    existenciasAFecha: async () => existencias,
  } as unknown as RepositorioMovimientos;
}

function costosFalsos(costos: CostoVigenteAFecha[]): RepositorioHistorialCostos {
  return { costosVigentesAFecha: async () => costos } as unknown as RepositorioHistorialCostos;
}

function ejecutarInmovil(
  catalogo: Producto[],
  rotaciones: RotacionDeProducto[],
  entrada: Partial<ReporteInventarioInmovilEntrada> = {},
) {
  const caso = new ReporteInventarioInmovilCasoUso(productosFalsos(catalogo), movimientosFalsos(rotaciones));
  return caso.ejecutar({ diasSinSalida: 90, ahora: HOY, ...entrada });
}

describe('Inventario inmóvil — US37 (FR-158…FR-162)', () => {
  it('el contador NO se reinicia porque haya entrado mercancía hoy (FR-159)', async () => {
    // Salió por última vez hace 200 días, pero HOY se recibió más. Si el reporte contara el
    // último movimiento cualquiera, este producto desaparecería justo cuando se inmovilizó
    // todavía más plata en algo que no rota. Es el modo de fallo que esta prueba existe para
    // impedir.
    const reporte = await ejecutarInmovil(
      [producto({ id: 1, sku: 'CEM-50', stockActual: 240, ultimoCosto: 28500 })],
      [{ productoId: 1, ultimaSalida: haceDias(200), primeraEntrada: haceDias(400) }],
    );

    expect(reporte.productos).toHaveLength(1);
    expect(reporte.productos[0]?.diasSinSalida).toBe(200);
    expect(reporte.productos[0]?.valorInmovilizado).toBe(240 * 28500);
  });

  it('el que nunca ha salido cuenta desde su primera entrada y va SEÑALADO (FR-159)', async () => {
    const reporte = await ejecutarInmovil(
      [producto({ id: 2, sku: 'VAR-12' })],
      [{ productoId: 2, ultimaSalida: null, primeraEntrada: haceDias(365) }],
    );

    expect(reporte.productos).toHaveLength(1);
    expect(reporte.productos[0]?.diasSinSalida).toBe(365);
    expect(reporte.productos[0]?.nuncaHaSalido).toBe(true);
    expect(reporte.productos[0]?.ultimaSalida).toBeNull();
  });

  it('un producto que salió dentro del umbral no aparece', async () => {
    const reporte = await ejecutarInmovil(
      [producto({ id: 3, sku: 'ARE-40' })],
      [{ productoId: 3, ultimaSalida: haceDias(10), primeraEntrada: haceDias(300) }],
    );
    expect(reporte.productos).toHaveLength(0);
    expect(reporte.valorTotalInmovilizado).toBe(0);
  });

  it('sin existencias no hay inmovilizado, por antiguo que sea (FR-160)', async () => {
    const reporte = await ejecutarInmovil(
      [producto({ id: 4, sku: 'OBS-01', stockActual: 0, ultimoCosto: 999999 })],
      [{ productoId: 4, ultimaSalida: haceDias(900), primeraEntrada: haceDias(1000) }],
    );
    expect(reporte.productos).toHaveLength(0);
  });

  it('ordena por VALOR inmovilizado, no por antigüedad (FR-161)', async () => {
    // El más viejo es el más barato — el caso normal en una bodega, y la razón por la que
    // ordenar por antigüedad haría parecer pequeño el problema.
    const reporte = await ejecutarInmovil(
      [
        producto({ id: 5, sku: 'BARATO-VIEJO', stockActual: 1, ultimoCosto: 500 }),
        producto({ id: 6, sku: 'CARO-MENOS-VIEJO', stockActual: 100, ultimoCosto: 40000 }),
      ],
      [
        { productoId: 5, ultimaSalida: haceDias(900), primeraEntrada: haceDias(1000) },
        { productoId: 6, ultimaSalida: haceDias(120), primeraEntrada: haceDias(200) },
      ],
    );

    expect(reporte.productos.map((fila) => fila.sku)).toEqual(['CARO-MENOS-VIEJO', 'BARATO-VIEJO']);
    expect(reporte.valorTotalInmovilizado).toBe(100 * 40000 + 500);
  });

  it('un producto sin ningún movimiento no aparece: no tiene antigüedad que mostrar', async () => {
    const reporte = await ejecutarInmovil([producto({ id: 7, sku: 'NUEVO' })], []);
    expect(reporte.productos).toHaveLength(0);
  });
});

describe('Valorización a una fecha — US38 (FR-163…FR-168)', () => {
  const FECHA = new Date('2025-12-31T23:59:59.999Z');

  it('usa el costo VIGENTE a la fecha, no el de hoy (FR-165)', async () => {
    // El producto hoy cuesta 40.000, pero en diciembre costaba 26.000. Valorizar el cierre con
    // el precio de hoy daría una cifra que no existió nunca — el error más silencioso posible,
    // porque el archivo se ve perfectamente normal.
    const caso = new ReporteValorizacionCasoUso(
      productosFalsos([producto({ id: 1, sku: 'CEM-50', stockActual: 240, ultimoCosto: 40000 })]),
      movimientosFalsos([], [{ productoId: 1, existencias: 180 }]),
      costosFalsos([{ productoId: 1, costo: 26000 }]),
    );

    const reporte = await caso.ejecutar({ fecha: FECHA });

    expect(reporte.productos[0]?.existencias).toBe(180);
    expect(reporte.productos[0]?.costoVigente).toBe(26000);
    expect(reporte.productos[0]?.valorLinea).toBe(180 * 26000);
    expect(reporte.valorTotalInventario).toBe(180 * 26000);
  });

  it('las existencias salen de los MOVIMIENTOS, nunca del stock de hoy (FR-164)', async () => {
    const caso = new ReporteValorizacionCasoUso(
      productosFalsos([producto({ id: 1, sku: 'CEM-50', stockActual: 999, ultimoCosto: 1000 })]),
      movimientosFalsos([], [{ productoId: 1, existencias: 12 }]),
      costosFalsos([{ productoId: 1, costo: 1000 }]),
    );

    const reporte = await caso.ejecutar({ fecha: FECHA });
    expect(reporte.productos[0]?.existencias).toBe(12);
  });

  it('un producto sin historial de costos se valoriza a su costo actual: nunca cambió', async () => {
    const caso = new ReporteValorizacionCasoUso(
      productosFalsos([producto({ id: 2, sku: 'ESTABLE', ultimoCosto: 7500 })]),
      movimientosFalsos([], [{ productoId: 2, existencias: 4 }]),
      costosFalsos([]),
    );

    const reporte = await caso.ejecutar({ fecha: FECHA });
    expect(reporte.productos[0]?.costoVigente).toBe(7500);
    expect(reporte.productos[0]?.valorLinea).toBe(4 * 7500);
  });

  it('sin existencias esa fecha —o creado después— no aparece (FR-166)', async () => {
    const caso = new ReporteValorizacionCasoUso(
      productosFalsos([
        producto({ id: 3, sku: 'AGOTADO', stockActual: 50 }),
        producto({ id: 4, sku: 'POSTERIOR', stockActual: 80 }),
      ]),
      // El agotado tiene una fila explícita en cero; el posterior no tiene ninguna, porque a esa
      // fecha no existía. Los dos tienen que quedar fuera, por caminos distintos.
      movimientosFalsos([], [{ productoId: 3, existencias: 0 }]),
      costosFalsos([]),
    );

    const reporte = await caso.ejecutar({ fecha: FECHA });
    expect(reporte.productos).toHaveLength(0);
    expect(reporte.valorTotalInventario).toBe(0);
  });

  it('ordena por valor y totaliza sobre lo que muestra', async () => {
    const caso = new ReporteValorizacionCasoUso(
      productosFalsos([
        producto({ id: 5, sku: 'MENOR', ultimoCosto: 100 }),
        producto({ id: 6, sku: 'MAYOR', ultimoCosto: 100 }),
      ]),
      movimientosFalsos([], [
        { productoId: 5, existencias: 2 },
        { productoId: 6, existencias: 30 },
      ]),
      costosFalsos([]),
    );

    const reporte = await caso.ejecutar({ fecha: FECHA });
    expect(reporte.productos.map((fila) => fila.sku)).toEqual(['MAYOR', 'MENOR']);
    expect(reporte.valorTotalInventario).toBe(30 * 100 + 2 * 100);
  });
});
