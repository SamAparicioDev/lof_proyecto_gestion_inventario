/**
 * Prueba UNITARIA de la regla de dominio `esDestinoValido` (US2, FR-038) — sin NestJS, sin
 * Prisma, sin BD: solo la función pura de `dominio/entidades/proyecto.ts`.
 *
 * Es la ÚNICA definición canónica de "proyecto destino válido de una salida" en todo el
 * sistema (ver TSDoc de la función) — el adaptador `repositorio-proyectos.prisma.ts`
 * (`proyectosDestino`) y, más adelante, el caso de uso de creación de salidas (US3) deben
 * comportarse exactamente igual a estas 4 combinaciones. Cubre lo que las pruebas de
 * integración de `clientes.spec.ts` solo ejercitan indirectamente (hallazgo de revisión
 * adversarial de la tanda US2, 2026-08-10): que un cambio accidental a esta función falle
 * aquí, sin depender de Postgres.
 */
import { esDestinoValido, type Proyecto } from '../../src/dominio/entidades/proyecto';

function proyecto(estado: Proyecto['estado']): Proyecto {
  return {
    id: 1,
    clienteId: 1,
    nombre: 'Proyecto de prueba',
    descripcion: null,
    fechaInicio: null,
    fechaCierreEstimada: null,
    responsable: null,
    presupuestoEstimado: null,
    estado,
  };
}

describe('esDestinoValido (FR-038)', () => {
  it('es destino válido cuando el proyecto está ACTIVO y el cliente está ACTIVO', () => {
    expect(esDestinoValido(proyecto('ACTIVO'), 'ACTIVO')).toBe(true);
  });

  it('NO es destino válido si el proyecto está SUSPENDIDO, aunque el cliente esté ACTIVO', () => {
    expect(esDestinoValido(proyecto('SUSPENDIDO'), 'ACTIVO')).toBe(false);
  });

  it('NO es destino válido si el proyecto está COMPLETADO, aunque el cliente esté ACTIVO', () => {
    expect(esDestinoValido(proyecto('COMPLETADO'), 'ACTIVO')).toBe(false);
  });

  it('NO es destino válido si el proyecto está ACTIVO pero el cliente está INACTIVO', () => {
    expect(esDestinoValido(proyecto('ACTIVO'), 'INACTIVO')).toBe(false);
  });
});
