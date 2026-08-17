/**
 * Pruebas del buscador por términos (US22, FR-118).
 *
 * Fijan la forma del `where` que se le entrega a Prisma, que es donde vive la decisión: Y entre
 * términos, O entre campos. Si alguien invirtiera esa anidación, el buscador seguiría
 * "funcionando" —devolvería filas— pero ampliaría el resultado en vez de estrecharlo, y eso no
 * lo nota nadie leyendo el código.
 */
import {
  construirBusquedaPorTerminos,
  digitosDelTermino,
  separarEnTerminos,
} from '../../src/infraestructura/persistencia/busqueda-por-terminos';

/**
 * Campos de ejemplo con la misma forma que usan los repositorios reales. El tipo va explícito
 * —como en ellos, donde es `Prisma.XWhereInput`— porque el genérico se fija con el primer campo
 * y sin él TypeScript exigiría que todos tuvieran la misma clave.
 */
interface WhereDePrueba {
  nombre?: { contains: string; mode: string };
  sku?: { contains: string; mode: string };
}
const porNombre = (termino: string): WhereDePrueba => ({ nombre: { contains: termino, mode: 'insensitive' } });
const porSku = (termino: string): WhereDePrueba => ({ sku: { contains: termino, mode: 'insensitive' } });

describe('Buscador por términos (US22)', () => {
  describe('separarEnTerminos', () => {
    it('parte por espacios y descarta los vacíos', () => {
      expect(separarEnTerminos('  cemento   gris  ')).toEqual(['cemento', 'gris']);
    });

    it('una consulta de solo espacios no tiene términos', () => {
      expect(separarEnTerminos('    ')).toEqual([]);
      expect(separarEnTerminos(undefined)).toEqual([]);
    });

    it('acota el número de términos para que una consulta larga no dispare el WHERE', () => {
      const consulta = Array.from({ length: 30 }, (_, i) => `t${i}`).join(' ');
      expect(separarEnTerminos(consulta)).toHaveLength(10);
    });
  });

  describe('construirBusquedaPorTerminos', () => {
    it('sin nada que buscar devuelve `undefined`, no un filtro vacío', () => {
      // Es la diferencia entre "no filtres" y "filtra por nada": quien llama decide.
      expect(construirBusquedaPorTerminos<WhereDePrueba>('   ', [porNombre])).toBeUndefined();
      expect(construirBusquedaPorTerminos<WhereDePrueba>(undefined, [porNombre])).toBeUndefined();
    });

    /** LA decisión de esta historia: cada palabra ESTRECHA, no amplía. */
    it('exige TODOS los términos (Y), cada uno en CUALQUIER campo (O)', () => {
      const where = construirBusquedaPorTerminos<WhereDePrueba>('cemento gris', [porNombre, porSku]);

      expect(where).toEqual({
        AND: [
          { OR: [porNombre('cemento'), porSku('cemento')] },
          { OR: [porNombre('gris'), porSku('gris')] },
        ],
      });
    });

    it('un solo término se comporta como la búsqueda de siempre', () => {
      expect(construirBusquedaPorTerminos<WhereDePrueba>('cemento', [porNombre])).toEqual({
        AND: [{ OR: [porNombre('cemento')] }],
      });
    });
  });

  describe('digitosDelTermino', () => {
    it('extrae el correlativo escrito de cualquiera de sus formas', () => {
      expect(digitosDelTermino('COT-000042')).toBe(BigInt(42));
      expect(digitosDelTermino('42')).toBe(BigInt(42));
      expect(digitosDelTermino('000042')).toBe(BigInt(42));
    });

    it('un término sin dígitos no aporta número', () => {
      expect(digitosDelTermino('formex')).toBeNull();
      expect(digitosDelTermino('OC-')).toBeNull();
    });

    it('un número absurdamente largo no revienta: simplemente no es un correlativo', () => {
      expect(digitosDelTermino('9'.repeat(400))).not.toBeUndefined();
    });
  });
});
