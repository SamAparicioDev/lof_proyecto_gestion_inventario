/**
 * Prueba UNITARIA de `ServicioStock` (T038) — servicio de dominio 100% PURO: sin NestJS, sin
 * Prisma, sin transacción real. Construye un `Map` de productos EN MEMORIA (como si ya
 * hubieran sido bloqueados con `SELECT ... FOR UPDATE` por el adaptador, research R4) y
 * verifica exactamente lo que `aplicarEntrada`/`aplicarReversaEntrada` devuelven — el
 * beneficio directo de la arquitectura hexagonal (docs/arquitectura.md §8): el invariante más
 * crítico del sistema (Principio I, stock nunca negativo) se prueba en milisegundos, sin
 * levantar PostgreSQL.
 *
 * Implementa la cobertura de FR-017 (`aplicarEntrada`, recibir un ingreso sube el stock) y
 * FR-019 (`aplicarReversaEntrada`, anular un ingreso RECIBIDO revierte el stock sin dejarlo
 * negativo) exigida por `tasks.md` T038.
 */
import { DisponibilidadInsuficiente, NoEncontrado } from '../../src/dominio/comunes/errores';
import { ServicioStock, type InfoProductoStock } from '../../src/dominio/servicios/servicio-stock';

/** Arma el `Map<id, InfoProductoStock>` que espera `ServicioStock` a partir de una lista plana. */
function mapaProductos(productos: InfoProductoStock[]): Map<number, InfoProductoStock> {
  return new Map(productos.map((producto) => [producto.id, producto]));
}

describe('ServicioStock', () => {
  const servicio = new ServicioStock();

  describe('aplicarEntrada (FR-017)', () => {
    it('suma la cantidad de cada línea al stock actual del producto correspondiente', () => {
      const productos = mapaProductos([
        { id: 1, stockActual: 10, descripcion: 'Producto 1' },
        { id: 2, stockActual: 3, descripcion: 'Producto 2' },
      ]);

      const resultado = servicio.aplicarEntrada(productos, [
        { productoId: 1, cantidad: 5 },
        { productoId: 2, cantidad: 2 },
      ]);

      expect(resultado.productosActualizados).toEqual(
        expect.arrayContaining([
          { id: 1, stockActualNuevo: 15 },
          { id: 2, stockActualNuevo: 5 },
        ]),
      );
      expect(resultado.movimientos).toEqual([
        { productoId: 1, cantidad: 5, stockResultante: 15 },
        { productoId: 2, cantidad: 2, stockResultante: 5 },
      ]);
    });

    it('acumula varias líneas del MISMO producto en vez de sobreescribir el stock de trabajo', () => {
      const productos = mapaProductos([{ id: 1, stockActual: 10 }]);

      const resultado = servicio.aplicarEntrada(productos, [
        { productoId: 1, cantidad: 5 },
        { productoId: 1, cantidad: 3 },
      ]);

      expect(resultado.productosActualizados).toEqual([{ id: 1, stockActualNuevo: 18 }]);
      expect(resultado.movimientos).toEqual([
        { productoId: 1, cantidad: 5, stockResultante: 15 },
        { productoId: 1, cantidad: 3, stockResultante: 18 },
      ]);
    });

    it('lanza NoEncontrado si una línea referencia un producto fuera del mapa bloqueado', () => {
      const productos = mapaProductos([{ id: 1, stockActual: 10 }]);

      expect(() => servicio.aplicarEntrada(productos, [{ productoId: 99, cantidad: 1 }])).toThrow(NoEncontrado);
    });
  });

  describe('aplicarReversaEntrada (FR-019)', () => {
    it('resta la cantidad de cada línea del stock actual cuando hay disponibilidad suficiente', () => {
      const productos = mapaProductos([
        { id: 1, stockActual: 15, descripcion: 'Producto 1' },
        { id: 2, stockActual: 5, descripcion: 'Producto 2' },
      ]);

      const resultado = servicio.aplicarReversaEntrada(productos, [
        { productoId: 1, cantidad: 5 },
        { productoId: 2, cantidad: 2 },
      ]);

      expect(resultado.productosActualizados).toEqual(
        expect.arrayContaining([
          { id: 1, stockActualNuevo: 10 },
          { id: 2, stockActualNuevo: 3 },
        ]),
      );
      expect(resultado.movimientos).toEqual([
        { productoId: 1, cantidad: 5, stockResultante: 10 },
        { productoId: 2, cantidad: 2, stockResultante: 3 },
      ]);
    });

    it('permite dejar el stock exactamente en 0 (frontera válida, no negativa)', () => {
      const productos = mapaProductos([{ id: 1, stockActual: 5 }]);

      const resultado = servicio.aplicarReversaEntrada(productos, [{ productoId: 1, cantidad: 5 }]);

      expect(resultado.productosActualizados).toEqual([{ id: 1, stockActualNuevo: 0 }]);
    });

    it('lanza DisponibilidadInsuficiente con el detalle de TODAS las líneas insuficientes, sin aplicar ningún cambio parcial', () => {
      const productos = mapaProductos([
        { id: 1, stockActual: 2, descripcion: 'Producto Escaso' },
        { id: 2, stockActual: 1, descripcion: 'Producto Escaso 2' },
        { id: 3, stockActual: 10, descripcion: 'Producto Suficiente' },
      ]);

      let errorCapturado: unknown;
      try {
        servicio.aplicarReversaEntrada(productos, [
          { productoId: 1, cantidad: 5 }, // insuficiente: 2 - 5 = -3
          { productoId: 2, cantidad: 3 }, // insuficiente: 1 - 3 = -2
          { productoId: 3, cantidad: 4 }, // suficiente: 10 - 4 = 6, no debe aparecer en el detalle
        ]);
      } catch (error) {
        errorCapturado = error;
      }

      expect(errorCapturado).toBeInstanceOf(DisponibilidadInsuficiente);
      expect((errorCapturado as DisponibilidadInsuficiente).detalles).toEqual([
        { productoId: 1, descripcion: 'Producto Escaso', solicitado: 5, disponible: 2 },
        { productoId: 2, descripcion: 'Producto Escaso 2', solicitado: 3, disponible: 1 },
      ]);
    });

    it('usa un texto de respaldo con el id cuando la descripción no viene en el mapa bloqueado', () => {
      const productos = mapaProductos([{ id: 7, stockActual: 1 }]); // sin `descripcion`

      let errorCapturado: unknown;
      try {
        servicio.aplicarReversaEntrada(productos, [{ productoId: 7, cantidad: 3 }]);
      } catch (error) {
        errorCapturado = error;
      }

      expect((errorCapturado as DisponibilidadInsuficiente).detalles).toEqual([
        { productoId: 7, descripcion: 'Producto 7', solicitado: 3, disponible: 1 },
      ]);
    });

    it('lanza NoEncontrado si una línea referencia un producto fuera del mapa bloqueado', () => {
      const productos = mapaProductos([{ id: 1, stockActual: 10 }]);

      expect(() => servicio.aplicarReversaEntrada(productos, [{ productoId: 99, cantidad: 1 }])).toThrow(
        NoEncontrado,
      );
    });
  });

  describe('aplicarSalida (FR-028/FR-029)', () => {
    it('resta la cantidad de cada línea del stockActual REAL cuando alcanza', () => {
      const productos = mapaProductos([
        { id: 1, stockActual: 100, descripcion: 'Producto 1' },
        { id: 2, stockActual: 30, descripcion: 'Producto 2' },
      ]);

      const resultado = servicio.aplicarSalida(productos, [
        { productoId: 1, cantidad: 70 },
        { productoId: 2, cantidad: 30 },
      ]);

      expect(resultado.productosActualizados).toEqual(
        expect.arrayContaining([
          { id: 1, stockActualNuevo: 30 },
          { id: 2, stockActualNuevo: 0 }, // frontera válida: dejar el stock en 0 no es negativo
        ]),
      );
      expect(resultado.movimientos).toEqual([
        { productoId: 1, cantidad: 70, stockResultante: 30 },
        { productoId: 2, cantidad: 30, stockResultante: 0 },
      ]);
    });

    it(
      'valida SIEMPRE contra el stockActual real bloqueado, NUNCA contra un "disponible" neto de otras ' +
        'salidas PENDIENTE (corrección T056/SC-002): dos líneas que juntas excederían un compromiso ' +
        'ajeno hipotético igual caben si el stockActual real alcanza',
      () => {
        // Antes de la corrección T056, este escenario habría exigido que el llamador pasara
        // un `disponible` ya neto de terceros; ahora `aplicarSalida` solo conoce `stockActual`
        // (InfoProductoStock, igual que `aplicarReversaEntrada`) — no hay forma de que un
        // compromiso ajeno la haga fallar por error, porque ya no recibe ese dato.
        const productos = mapaProductos([{ id: 1, stockActual: 100 }]);

        const resultado = servicio.aplicarSalida(productos, [{ productoId: 1, cantidad: 70 }]);

        expect(resultado.productosActualizados).toEqual([{ id: 1, stockActualNuevo: 30 }]);
      },
    );

    it('lanza DisponibilidadInsuficiente con el disponible REAL (stockActual) cuando una línea excede, sin aplicar cambios parciales', () => {
      const productos = mapaProductos([
        { id: 1, stockActual: 100, descripcion: 'Producto Popular' },
        { id: 2, stockActual: 10, descripcion: 'Producto Suficiente' },
      ]);

      let errorCapturado: unknown;
      try {
        servicio.aplicarSalida(productos, [
          { productoId: 1, cantidad: 150 }, // insuficiente: 150 > 100
          { productoId: 2, cantidad: 5 }, // suficiente, no debe aparecer en el detalle
        ]);
      } catch (error) {
        errorCapturado = error;
      }

      expect(errorCapturado).toBeInstanceOf(DisponibilidadInsuficiente);
      expect((errorCapturado as DisponibilidadInsuficiente).detalles).toEqual([
        { productoId: 1, descripcion: 'Producto Popular', solicitado: 150, disponible: 100 },
      ]);
    });

    it('permite dejar el stock exactamente en 0 (frontera válida, no negativa)', () => {
      const productos = mapaProductos([{ id: 1, stockActual: 20 }]);

      const resultado = servicio.aplicarSalida(productos, [{ productoId: 1, cantidad: 20 }]);

      expect(resultado.productosActualizados).toEqual([{ id: 1, stockActualNuevo: 0 }]);
    });

    it('lanza NoEncontrado si una línea referencia un producto fuera del mapa bloqueado', () => {
      const productos = mapaProductos([{ id: 1, stockActual: 10 }]);

      expect(() => servicio.aplicarSalida(productos, [{ productoId: 99, cantidad: 1 }])).toThrow(NoEncontrado);
    });
  });
});
