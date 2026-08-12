/**
 * Prueba UNITARIA de `esStockBajo` (T065, dominio puro — `dominio/entidades/producto.ts`).
 * Sin NestJS, sin Prisma, sin BD: verifica en aislamiento el ÚNICO criterio de "stock bajo"
 * que usa el resto del sistema (`listar-inventario.caso-uso.ts`/`fila-inventario.ts`, US5).
 *
 * El criterio es "menor o IGUAL" (FR-022, US5-AS2): un producto justo en su umbral ya debe
 * alertar, no solo por debajo de él — de ahí el caso `disponible === umbralStockBajo`.
 *
 * Implementa la cobertura exigida por `tasks.md` T065 para FR-022. Desde US13 (T138) cubre
 * además `disponibleEnRango`, el otro criterio compartido que se mide sobre `disponible`.
 */
import { esStockBajo } from '../../src/dominio/entidades/producto';
import { disponibleEnRango } from '../../src/aplicacion/inventario/fila-inventario';

describe('esStockBajo (FR-022)', () => {
  it('retorna true cuando el disponible está POR DEBAJO del umbral', () => {
    expect(esStockBajo(5, 10)).toBe(true);
  });

  it('retorna true cuando el disponible es EXACTAMENTE IGUAL al umbral (criterio "menor o igual", US5-AS2)', () => {
    expect(esStockBajo(10, 10)).toBe(true);
  });

  it('retorna false cuando el disponible está POR ENCIMA del umbral', () => {
    expect(esStockBajo(11, 10)).toBe(false);
  });

  it('con umbral 0: disponible 0 cuenta como stock bajo (0 <= 0)', () => {
    expect(esStockBajo(0, 0)).toBe(true);
  });

  it('con umbral 0: cualquier disponible positivo NO cuenta como stock bajo', () => {
    expect(esStockBajo(1, 0)).toBe(false);
  });

  it('con umbral 0: un disponible negativo (comprometido mayor al stock físico, caso límite) sigue marcando stock bajo', () => {
    expect(esStockBajo(-1, 0)).toBe(true);
  });
});

/**
 * `disponibleEnRango` (US13/T138, FR-077) — la regla que comparten el rango
 * `disponibleMin`/`disponibleMax` del listado de inventario y el `cantidadMin`/`cantidadMax` del
 * reporte de inventario actual. Vive en una sola función precisamente para que las dos pantallas
 * no puedan responder distinto a la misma pregunta; estas pruebas fijan sus bordes.
 */
describe('disponibleEnRango (FR-077)', () => {
  it('sin límites no recorta nada (un rango vacío no filtra, no deja el listado vacío)', () => {
    expect(disponibleEnRango(0, undefined, undefined)).toBe(true);
    expect(disponibleEnRango(999, undefined, undefined)).toBe(true);
  });

  it('los DOS límites son inclusive: el valor exactamente igual al mínimo o al máximo entra', () => {
    expect(disponibleEnRango(10, 10, undefined)).toBe(true);
    expect(disponibleEnRango(10, undefined, 10)).toBe(true);
  });

  it('descarta lo que queda fuera por cualquiera de los dos extremos', () => {
    expect(disponibleEnRango(9, 10, undefined)).toBe(false);
    expect(disponibleEnRango(11, undefined, 10)).toBe(false);
  });

  it('con ambos límites exige cumplir los dos a la vez', () => {
    expect(disponibleEnRango(5, 1, 10)).toBe(true);
    expect(disponibleEnRango(0, 1, 10)).toBe(false);
    expect(disponibleEnRango(11, 1, 10)).toBe(false);
  });

  it('un máximo de 0 es un filtro REAL ("productos agotados"), no un rango ausente', () => {
    expect(disponibleEnRango(0, undefined, 0)).toBe(true);
    expect(disponibleEnRango(1, undefined, 0)).toBe(false);
  });

  it('admite disponibles negativos (comprometido mayor al stock físico, mismo caso límite que esStockBajo)', () => {
    expect(disponibleEnRango(-5, undefined, 0)).toBe(true);
    expect(disponibleEnRango(-5, 0, undefined)).toBe(false);
  });
});
