/**
 * Prueba UNITARIA de `PermisosGuard` (T102, US9) — sin NestJS levantado, sin Prisma, sin BD:
 * un `ExecutionContext` falso con el usuario que traería `EstrategiaJwt` y un `Reflector`
 * REAL leyendo la metadata de `@RequierePermiso(...)` sobre un controlador falso.
 *
 * Por qué el Reflector es real y el controlador está decorado de verdad: lo que esta suite
 * debe proteger no es solo el `if` del guard, sino el CONTRATO decorador↔guard que T103
 * usará en los 11 controladores (incluida la resolución método-sobre-clase, que hoy usa
 * `ControladorUsuarios` con su `@Roles` a nivel de clase). Simular la metadata a mano
 * verificaría el guard contra una suposición, no contra el decorador que se va a usar.
 *
 * El guard no recibe puertos: los permisos efectivos llegan en `request.user.rolAsignado`,
 * resueltos desde la BD por `RepositorioUsuarios.buscarPorId` en ESA misma petición (T101,
 * research R16). Esa es justamente la propiedad que hace posible US9-AS3 — y la razón por la
 * que el guard es unitariamente testeable sin base de datos.
 *
 * Cubre: FR-003 (autorización verificada en el servidor), FR-058 (contra permisos efectivos,
 * nunca contra un nombre de rol fijo), FR-006/FR-008 (un usuario INACTIVO no opera) y
 * US9-AS2 (403 al llamar directo a un endpoint no permitido).
 */
import { ExecutionContext, ForbiddenException, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ClavePermiso } from '../../src/dominio/entidades/permiso';
import type { EstadoUsuario, Usuario } from '../../src/dominio/entidades/usuario';
import { PermisosGuard } from '../../src/interfaces/http/comunes/guards/permisos.guard';
import { RequierePermiso } from '../../src/interfaces/http/comunes/requiere-permiso.decorator';

/**
 * Controlador FALSO decorado como lo estarán los reales tras T103: un permiso a nivel de
 * clase (patrón de `ControladorUsuarios`, hoy `@Roles('ADMINISTRADOR')` de clase), uno a
 * nivel de método que debe ganar sobre el de la clase, y un método SIN decorador (patrón de
 * `/api/auth/perfil`: autenticado basta).
 */
@RequierePermiso('usuarios.gestionar')
class ControladorFalso {
  @RequierePermiso('salidas.confirmar')
  confirmarSalida(): void {}

  listarUsuarios(): void {}
}

/** Otro controlador falso SIN permiso de clase, para el caso "endpoint sin restricción". */
class ControladorSinPermiso {
  consultarPerfil(): void {}
}

/** Usuario de prueba con los permisos indicados; ACTIVO salvo que se pida lo contrario. */
function usuarioConPermisos(permisos: ClavePermiso[], estado: EstadoUsuario = 'ACTIVO'): Usuario {
  return {
    id: 1,
    nombreCompleto: 'Usuaria de Prueba',
    email: 'prueba@trazo.local',
    login: 'usuaria.prueba',
    rolAsignado: {
      id: 7,
      nombre: 'Bodeguero',
      descripcion: 'Rol propio creado por el Administrador (US9-AS1)',
      esSistema: false,
      estado: 'ACTIVO',
      permisos,
    },
    estado,
    debeCambiarPassword: false,
  };
}

/**
 * `ExecutionContext` mínimo: el guard solo usa `getHandler()`/`getClass()` (para leer la
 * metadata) y `switchToHttp().getRequest()` (para el usuario). Se construye con un doble
 * casteo porque `ExecutionContext` declara además el contexto de WebSockets/RPC, que esta
 * app no usa y el guard nunca toca — implementarlos entero sería ruido, no cobertura.
 */
function contextoDePrueba(
  manejador: (...args: never[]) => unknown,
  clase: Type<unknown>,
  usuario?: Usuario,
): ExecutionContext {
  return {
    getHandler: () => manejador,
    getClass: () => clase,
    switchToHttp: () => ({ getRequest: () => ({ user: usuario }) }),
  } as unknown as ExecutionContext;
}

/** Ejecuta y devuelve el error lanzado (o `undefined`), para poder afirmar sobre su cuerpo
 *  sin depender de `fail()` —que jest-circus no define— ni de un `try/catch` que pase
 *  silenciosamente si el guard NO lanzara. */
function capturarError(accion: () => unknown): unknown {
  try {
    accion();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('PermisosGuard', () => {
  const guard = new PermisosGuard(new Reflector());

  // El usuario tiene `salidas.confirmar` pero NO `usuarios.gestionar` (el permiso de la
  // clase): que pase demuestra además que el permiso del MÉTODO gana sobre el de la clase.
  it('concede el acceso cuando el rol del usuario tiene el permiso exigido por el endpoint', () => {
    const contexto = contextoDePrueba(
      ControladorFalso.prototype.confirmarSalida,
      ControladorFalso,
      usuarioConPermisos(['salidas.ver', 'salidas.crear', 'salidas.confirmar']),
    );

    expect(guard.canActivate(contexto)).toBe(true);
  });

  it('deniega con 403 y el mensaje del contrato cuando el rol NO tiene el permiso exigido', () => {
    const contexto = contextoDePrueba(
      ControladorFalso.prototype.confirmarSalida,
      ControladorFalso,
      // Permisos vecinos del mismo módulo: la comparación es exacta, sin comodines por módulo.
      usuarioConPermisos(['salidas.ver', 'salidas.crear']),
    );

    const error = capturarError(() => guard.canActivate(contexto));

    expect(error).toBeInstanceOf(ForbiddenException);
    // El cuerpo debe venir YA con el formato único del contrato `{ error: { mensaje, campos } }`:
    // `FiltroErroresDominio` lo deja pasar tal cual, así que este objeto ES la respuesta 403.
    expect((error as ForbiddenException).getResponse()).toEqual({
      error: { mensaje: 'No tienes permisos para realizar esta acción.', campos: null },
    });
  });

  it('deniega con 403 a un usuario INACTIVO aunque su rol conceda el permiso (FR-006/FR-008)', () => {
    const contexto = contextoDePrueba(
      ControladorFalso.prototype.confirmarSalida,
      ControladorFalso,
      usuarioConPermisos(['salidas.confirmar'], 'INACTIVO'),
    );

    expect(() => guard.canActivate(contexto)).toThrow(ForbiddenException);
  });

  it('deniega con 403 cuando no hay usuario en la petición (nunca concede por ausencia de datos)', () => {
    const contexto = contextoDePrueba(ControladorFalso.prototype.confirmarSalida, ControladorFalso);

    expect(() => guard.canActivate(contexto)).toThrow(ForbiddenException);
  });

  it('aplica el permiso declarado en la CLASE a los métodos que no declaran el suyo', () => {
    const conPermiso = contextoDePrueba(
      ControladorFalso.prototype.listarUsuarios,
      ControladorFalso,
      usuarioConPermisos(['usuarios.gestionar']),
    );
    const sinPermiso = contextoDePrueba(
      ControladorFalso.prototype.listarUsuarios,
      ControladorFalso,
      usuarioConPermisos(['salidas.confirmar']),
    );

    expect(guard.canActivate(conPermiso)).toBe(true);
    expect(() => guard.canActivate(sinPermiso)).toThrow(ForbiddenException);
  });

  it('deja pasar a cualquier usuario autenticado si el endpoint no declara @RequierePermiso', () => {
    const contexto = contextoDePrueba(
      ControladorSinPermiso.prototype.consultarPerfil,
      ControladorSinPermiso,
      usuarioConPermisos([]),
    );

    expect(guard.canActivate(contexto)).toBe(true);
  });
});
