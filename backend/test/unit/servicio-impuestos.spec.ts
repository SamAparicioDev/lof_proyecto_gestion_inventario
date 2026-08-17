/**
 * Pruebas del servicio de impuestos (US20, FR-109/FR-110).
 *
 * Unitarias y sin base de datos: el servicio es 100% puro, y estas pruebas fijan las dos
 * decisiones que de verdad importan y que ninguna prueba de integración distinguiría —
 * el IVA se calcula línea a línea, y se redondea por línea, no al final.
 */
import { ErrorValidacionDominio } from '../../src/dominio/comunes/errores';
import {
  impuestosDeDocumento,
  impuestosDeLinea,
  esTasaIvaValida,
} from '../../src/dominio/servicios/servicio-impuestos';

describe('ServicioImpuestos (US20)', () => {
  describe('impuestosDeLinea', () => {
    it('calcula el 19% sobre la base de la línea y deriva el total', () => {
      expect(impuestosDeLinea({ cantidad: 10, precioUnitario: 1_000, tasaIva: 19 })).toEqual({
        base: 10_000,
        iva: 1_900,
        total: 11_900,
      });
    });

    it('sin tasa se comporta como antes de US20: base igual a total y cero impuesto', () => {
      expect(impuestosDeLinea({ cantidad: 3, precioUnitario: 2_500 })).toEqual({
        base: 7_500,
        iva: 0,
        total: 7_500,
      });
    });

    it('rechaza una tasa que no es de las vigentes, señalando el campo', () => {
      expect(() => impuestosDeLinea({ cantidad: 1, precioUnitario: 100, tasaIva: 12 })).toThrow(
        ErrorValidacionDominio,
      );
    });

    it('redondea a los dos decimales que admite la columna', () => {
      // 3 × 333.33 = 999.99 → IVA 19% = 189.9981, que no cabe en DECIMAL(14,2).
      const { base, iva, total } = impuestosDeLinea({ cantidad: 3, precioUnitario: 333.33, tasaIva: 19 });
      expect(base).toBe(999.99);
      expect(iva).toBe(190);
      expect(total).toBe(1_189.99);
    });
  });

  describe('impuestosDeDocumento', () => {
    /**
     * El caso que justifica que la función reciba LÍNEAS y no un total (FR-110): con dos tasas
     * distintas conviviendo, aplicar una sola al total daría otro número. Aquí, aplicar 19% al
     * total (30.000) daría 5.700 en vez de los 1.900 correctos.
     */
    it('suma el impuesto línea a línea cuando conviven varias tasas', () => {
      const impuestos = impuestosDeDocumento([
        { cantidad: 10, precioUnitario: 1_000, tasaIva: 19 },
        { cantidad: 10, precioUnitario: 1_000, tasaIva: 0 },
        { cantidad: 10, precioUnitario: 1_000 },
      ]);

      expect(impuestos).toEqual({ base: 30_000, iva: 1_900, total: 31_900 });
    });

    it('un documento sin líneas no tiene impuesto que sumar', () => {
      expect(impuestosDeDocumento([])).toEqual({ base: 0, iva: 0, total: 0 });
    });

    /**
     * El total del documento tiene que ser exactamente la suma de lo que se guardó en cada
     * línea. Si se redondeara solo al final, la cabecera podría diferir de sus propias líneas
     * por unos pesos — la clase de descuadre que obliga a revisar un mes entero de facturas.
     */
    it('el total coincide con la suma de las líneas ya redondeadas', () => {
      const lineas = [
        { cantidad: 1, precioUnitario: 0.05, tasaIva: 19 },
        { cantidad: 1, precioUnitario: 0.05, tasaIva: 19 },
        { cantidad: 1, precioUnitario: 0.05, tasaIva: 19 },
      ];
      const porLinea = lineas.map((linea) => impuestosDeLinea(linea));
      const documento = impuestosDeDocumento(lineas);

      // Se compara contra la suma REDONDEADA, no contra la suma cruda: `0.05 × 3` en coma
      // flotante da 0.15000000000000002, un valor que la columna `DECIMAL(14,2)` no puede
      // guardar. Que el servicio devuelva 0.15 exacto es justamente lo que se está fijando
      // aquí — acumular redondeando en cada paso es lo que hace que la cabecera coincida con
      // lo que quedó escrito en sus líneas.
      const sumaRedondeada = (valores: number[]): number =>
        Math.round(valores.reduce((suma, valor) => suma + valor, 0) * 100) / 100;

      expect(documento.iva).toBe(sumaRedondeada(porLinea.map((linea) => linea.iva)));
      expect(documento.base).toBe(sumaRedondeada(porLinea.map((linea) => linea.base)));
      expect(documento.base).toBe(0.15);
    });
  });

  it('esTasaIvaValida solo acepta las tasas vigentes en Colombia', () => {
    expect([0, 5, 19].every(esTasaIvaValida)).toBe(true);
    expect([1, 12, 16, 21, -19].some(esTasaIvaValida)).toBe(false);
  });
});
