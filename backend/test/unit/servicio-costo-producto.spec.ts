/**
 * Prueba UNITARIA de `aplicarCambioDeCosto` (US12, T125) — el servicio de dominio PURO que
 * decide si un costo cambió y qué hay que registrar (FR-074). Sin NestJS, sin Prisma, sin BD:
 * es una función pura, así que se prueba con Jest a secas (research R10, mismo criterio que
 * `servicio-stock.spec.ts`).
 *
 * Por qué importa que esta regla esté probada aquí y no solo en integración: los TRES caminos
 * que mutan `productos.ultimo_costo` (edición manual, carga masiva y recepción de ingreso)
 * pasan por ella. Si "no cambió" devolviera un registro, la ficha de cada producto se llenaría
 * de filas idénticas —y el CHECK `costo_nuevo <> costo_anterior` de la migración rechazaría el
 * INSERT, tumbando una recepción de mercancía legítima.
 */
import { ErrorValidacionDominio } from '../../src/dominio/comunes/errores';
import { aplicarCambioDeCosto } from '../../src/dominio/servicios/servicio-costo-producto';

const BASE = { productoId: 42, costoAnterior: 1000, origen: 'EDICION_MANUAL' as const, usuarioId: 7 };

describe('aplicarCambioDeCosto — cuándo hay cambio que registrar (T125, FR-074)', () => {
  it('produce el registro cuando el costo nuevo difiere del vigente', () => {
    const registro = aplicarCambioDeCosto({ ...BASE, costoNuevo: 1500 });

    expect(registro).toEqual({
      productoId: 42,
      costoAnterior: 1000,
      costoNuevo: 1500,
      origen: 'EDICION_MANUAL',
      usuarioId: 7,
      documentoId: null,
    });
  });

  it('devuelve null cuando el costo nuevo es IGUAL al vigente — no es un cambio (FR-074)', () => {
    expect(aplicarCambioDeCosto({ ...BASE, costoNuevo: 1000 })).toBeNull();
  });

  it('devuelve null cuando el origen no trae costo (columna vacía / campo ausente), sin interpretarlo como 0', () => {
    expect(aplicarCambioDeCosto({ ...BASE, costoNuevo: undefined })).toBeNull();
    expect(aplicarCambioDeCosto({ ...BASE, costoNuevo: null })).toBeNull();
  });

  it('SÍ registra una bajada a 0 explícita: cero es un costo, "sin dato" no lo es', () => {
    expect(aplicarCambioDeCosto({ ...BASE, costoNuevo: 0 })).toMatchObject({ costoAnterior: 1000, costoNuevo: 0 });
  });

  it('conserva el ingreso que originó el cambio cuando viene de una recepción (FR-072)', () => {
    const registro = aplicarCambioDeCosto({
      ...BASE,
      origen: 'RECEPCION_INGRESO',
      costoNuevo: 1200,
      documentoId: 88,
    });

    expect(registro).toMatchObject({ origen: 'RECEPCION_INGRESO', documentoId: 88 });
  });
});

describe('aplicarCambioDeCosto — precisión de los dos decimales de la columna (T125)', () => {
  it('no considera cambio una diferencia por debajo del centavo: la BD guardaría el mismo número', () => {
    expect(aplicarCambioDeCosto({ ...BASE, costoAnterior: 1000, costoNuevo: 1000.004 })).toBeNull();
  });

  it('redondea a centavos lo que devuelve, para que el costo persistido y el registrado sean el MISMO número', () => {
    const registro = aplicarCambioDeCosto({ ...BASE, costoAnterior: 1000, costoNuevo: 1500.567 });

    expect(registro?.costoNuevo).toBe(1500.57);
  });

  it('sobrevive a la aritmética de punto flotante (0.1 + 0.2) sin inventar un cambio', () => {
    expect(aplicarCambioDeCosto({ ...BASE, costoAnterior: 0.1 + 0.2, costoNuevo: 0.3 })).toBeNull();
  });
});

describe('aplicarCambioDeCosto — invariante de costo no negativo (T125)', () => {
  it('rechaza un costo negativo con un error de dominio en español', () => {
    expect(() => aplicarCambioDeCosto({ ...BASE, costoNuevo: -1 })).toThrow(ErrorValidacionDominio);
    expect(() => aplicarCambioDeCosto({ ...BASE, costoNuevo: -1 })).toThrow('El costo unitario no puede ser negativo');
  });

  it('rechaza un costo no finito (NaN llega desde un campo numérico vacío del formulario)', () => {
    expect(() => aplicarCambioDeCosto({ ...BASE, costoNuevo: Number.NaN })).toThrow(ErrorValidacionDominio);
  });
});
