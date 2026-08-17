/**
 * Pruebas del criterio de coincidencia COMPARTIDO (US23, FR-119).
 *
 * Vive en las pruebas del backend aunque lo consuma sobre todo el navegador: es el único
 * workspace con corredor de pruebas, y lo que se fija aquí es precisamente que el criterio del
 * cliente sea el MISMO que el del servidor. Si alguien relajara uno de los dos, esta prueba es
 * la que lo detiene.
 */
import {
  coincideConTerminos,
  normalizarParaBuscar,
  terminosDeBusqueda,
} from '@trazo/compartido';

describe('Criterio de coincidencia compartido (US23)', () => {
  describe('normalizarParaBuscar', () => {
    it('quita tildes y baja a minúsculas', () => {
      expect(normalizarParaBuscar('Ferretería')).toBe('ferreteria');
      expect(normalizarParaBuscar('INSTALACIÓN')).toBe('instalacion');
      expect(normalizarParaBuscar('Compresor odontológico')).toBe('compresor odontologico');
    });

    it('la ñ NO es una n con tilde: se conserva', () => {
      // `normalize('NFD')` no descompone la ñ en n + virgulilla en el sentido que borraríamos:
      // fijarlo evita que un cambio futuro convierta "Peña" en "pena".
      expect(normalizarParaBuscar('Peña')).toBe('peña');
    });
  });

  describe('coincideConTerminos', () => {
    const producto = ['CMP-400', 'Compresor de tornillo 15 HP con secador', 'Bodega Central'];

    it('exige TODOS los términos, en cualquier orden y en cualquiera de los textos', () => {
      expect(coincideConTerminos(producto, 'compresor tornillo')).toBe(true);
      expect(coincideConTerminos(producto, 'tornillo compresor')).toBe(true);
      // Un término del SKU y otro de la descripción.
      expect(coincideConTerminos(producto, 'cmp secador')).toBe(true);
      // Una palabra que no está deja fuera la fila entera.
      expect(coincideConTerminos(producto, 'compresor pistón')).toBe(false);
    });

    it('ignora las tildes en los dos sentidos', () => {
      expect(coincideConTerminos(['Compresor odontológico'], 'odontologico')).toBe(true);
      expect(coincideConTerminos(['Compresor odontologico'], 'odontológico')).toBe(true);
    });

    it('una consulta vacía no filtra', () => {
      expect(coincideConTerminos(producto, '')).toBe(true);
      expect(coincideConTerminos(producto, '   ')).toBe(true);
    });

    it('los textos ausentes no estorban', () => {
      expect(coincideConTerminos(['Cemento', null, undefined, ''], 'cemento')).toBe(true);
    });

    it('acota los términos igual que el servidor', () => {
      const consulta = Array.from({ length: 30 }, (_, i) => `t${i}`).join(' ');
      expect(terminosDeBusqueda(consulta)).toHaveLength(10);
    });
  });
});
