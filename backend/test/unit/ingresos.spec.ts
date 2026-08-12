/**
 * Prueba UNITARIA de las reglas de dominio de `Ingreso` (T038) — sin NestJS, sin Prisma, sin
 * BD: solo las funciones puras de `dominio/entidades/ingreso.ts`.
 *
 * Cubre dos reglas de negocio distintas:
 * 1. `calcularValorTotalLinea`/`calcularValorTotalIngreso` (FR-014): `cantidad ×
 *    precioUnitario` por línea, redondeado a 2 decimales (columnas `DECIMAL(_,2)` de
 *    data-model.md), y la suma de todas las líneas como total del ingreso.
 * 2. `transicionValidaIngreso` (FR-017/FR-019): TODAS las combinaciones de la máquina de
 *    estados de `data-model.md` — las 4 transiciones válidas y las 12 inválidas restantes
 *    (incluidas las que salen de los estados terminales `VERIFICADO`/`ANULADO`).
 */
import {
  calcularValorTotalIngreso,
  calcularValorTotalLinea,
  transicionValidaIngreso,
  type EstadoIngreso,
} from '../../src/dominio/entidades/ingreso';

describe('calcularValorTotalLinea / calcularValorTotalIngreso (FR-014)', () => {
  it('calcula el valor de una línea como cantidad × precioUnitario', () => {
    expect(calcularValorTotalLinea({ cantidad: 5, precioUnitario: 1000 })).toBe(5000);
    expect(calcularValorTotalLinea({ cantidad: 2.5, precioUnitario: 100 })).toBe(250);
  });

  it('redondea el valor de la línea a 2 decimales (DECIMAL(_,2))', () => {
    // 3 × 33.333 = 99.999 → redondea a 100.00
    expect(calcularValorTotalLinea({ cantidad: 3, precioUnitario: 33.333 })).toBe(100);
    // 0.1 × 0.1 = 0.010000000000000002 en punto flotante binario → redondea a 0.01
    expect(calcularValorTotalLinea({ cantidad: 0.1, precioUnitario: 0.1 })).toBe(0.01);
  });

  it('suma el total del ingreso a partir de los totales de TODAS sus líneas', () => {
    const total = calcularValorTotalIngreso([
      { cantidad: 5, precioUnitario: 1000 }, // 5000
      { cantidad: 2, precioUnitario: 250 }, // 500
      { cantidad: 1, precioUnitario: 99.99 }, // 99.99
    ]);

    expect(total).toBe(5599.99);
  });

  it('el total de un ingreso sin líneas es 0 (caso de borde, aunque el esquema Zod ya exige ≥1)', () => {
    expect(calcularValorTotalIngreso([])).toBe(0);
  });
});

describe('transicionValidaIngreso — máquina de estados (FR-017/FR-019)', () => {
  const ESTADOS: EstadoIngreso[] = ['PENDIENTE', 'RECIBIDO', 'VERIFICADO', 'ANULADO'];

  const TRANSICIONES_VALIDAS: Array<[EstadoIngreso, EstadoIngreso]> = [
    ['PENDIENTE', 'RECIBIDO'],
    ['PENDIENTE', 'ANULADO'],
    ['RECIBIDO', 'VERIFICADO'],
    ['RECIBIDO', 'ANULADO'],
  ];

  it.each(TRANSICIONES_VALIDAS)('acepta %s → %s', (actual, siguiente) => {
    expect(transicionValidaIngreso(actual, siguiente)).toBe(true);
  });

  // Todas las combinaciones posibles (4×4 = 16) menos las 4 válidas de arriba = 12 inválidas,
  // incluidas las "no-transiciones" (mismo estado a sí mismo) y las que salen de los estados
  // terminales VERIFICADO/ANULADO.
  const TODAS_LAS_COMBINACIONES: Array<[EstadoIngreso, EstadoIngreso]> = ESTADOS.flatMap((actual) =>
    ESTADOS.map((siguiente): [EstadoIngreso, EstadoIngreso] => [actual, siguiente]),
  );
  const esValida = (combinacion: [EstadoIngreso, EstadoIngreso]): boolean =>
    TRANSICIONES_VALIDAS.some(([a, s]) => a === combinacion[0] && s === combinacion[1]);
  const TRANSICIONES_INVALIDAS = TODAS_LAS_COMBINACIONES.filter((combinacion) => !esValida(combinacion));

  it('cubre exactamente las 12 combinaciones inválidas restantes', () => {
    expect(TRANSICIONES_INVALIDAS).toHaveLength(12);
  });

  it.each(TRANSICIONES_INVALIDAS)('rechaza %s → %s', (actual, siguiente) => {
    expect(transicionValidaIngreso(actual, siguiente)).toBe(false);
  });

  it('VERIFICADO y ANULADO son terminales: ninguna transición sale de ellos', () => {
    for (const siguiente of ESTADOS) {
      expect(transicionValidaIngreso('VERIFICADO', siguiente)).toBe(false);
      expect(transicionValidaIngreso('ANULADO', siguiente)).toBe(false);
    }
  });
});
