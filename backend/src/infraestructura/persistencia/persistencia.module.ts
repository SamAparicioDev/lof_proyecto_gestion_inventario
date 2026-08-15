/**
 * Módulo de persistencia — `@Global()` para que `PrismaService` y `UnidadDeTrabajo` estén
 * disponibles en cualquier módulo de negocio (productos, ingresos, salidas, clientes...)
 * sin que cada uno tenga que reimportar este módulo explícitamente.
 *
 * Por qué `@Global` (docs/arquitectura.md — regla de dependencia): `infraestructura/
 * persistencia` es el ÚNICO lugar del backend donde vive Prisma; centralizar aquí su
 * provisión evita que cada módulo de `interfaces`/`aplicacion` tenga que conocer detalles
 * de la conexión — solo inyectan `PrismaService`/`UnidadDeTrabajo` por constructor (DIP,
 * Principio VI). Se registra una única vez en `AppModule` (tarea T010).
 *
 * Los repositorios (`RepositorioProductosPrisma`/`RepositorioIngresosPrisma`, T030;
 * `RepositorioClientesPrisma`/`RepositorioProyectosPrisma`, T041;
 * `RepositorioSalidasPrisma`, T049) también se registran aquí, tras sus tokens de puerto
 * (`REPOSITORIO_PRODUCTOS`/`REPOSITORIO_INGRESOS`/`REPOSITORIO_CLIENTES`/
 * `REPOSITORIO_PROYECTOS`/`REPOSITORIO_SALIDAS`), para que los casos de uso de aplicación
 * (US1/US2/US3) los inyecten por el puerto del dominio sin conocer la implementación
 * Prisma (DIP). `RepositorioMovimientosPrisma` (preparación US5) sigue el mismo patrón bajo
 * `REPOSITORIO_MOVIMIENTOS` — puerto de SOLO LECTURA (ver TSDoc de
 * `dominio/puertos/repositorio-movimientos.ts`).
 *
 * `RepositorioRolesPrisma`/`RepositorioPermisosPrisma` (T101, US9) siguen el mismo patrón
 * bajo `REPOSITORIO_ROLES`/`REPOSITORIO_PERMISOS`: los consumirán los casos de uso de roles
 * (T105) y el controlador `/api/roles`+`/api/permisos` (T106). La autorización NO pasa por
 * ellos: los permisos efectivos del usuario autenticado llegan en la misma lectura de
 * `RepositorioUsuarios.buscarPorId` que ya hacía la revalidación de sesión (research R16).
 *
 * `RepositorioHistorialCostosPrisma` (T124, US12) sigue el mismo patrón bajo
 * `REPOSITORIO_HISTORIAL_COSTOS` — puerto de SOLO LECTURA: los `INSERT` de
 * `historial_costos_producto` ocurren dentro de las transacciones de
 * `RepositorioProductosPrisma.actualizarCosto` y `RepositorioIngresosPrisma.recibir`, que son
 * las dueñas del `UPDATE` de `productos.ultimo_costo` (FR-072 — ver TSDoc del puerto).
 *
 * `ContadoresPrisma` (T049) se registra DOS veces a propósito: como clase concreta (para
 * que `RepositorioSalidasPrisma` inyecte `siguienteNumeroEnTransaccion`, que no forma parte
 * del puerto del dominio — ver TSDoc de `contadores.prisma.ts`) y con `useExisting` bajo el
 * token `CONTADORES` (para que cualquier consumidor futuro que solo conozca el puerto
 * `Contadores` reciba la MISMA instancia singleton, sin duplicar estado).
 */
import { Global, Module } from '@nestjs/common';
import { CONTADORES } from '../../dominio/puertos/contadores';
import { REPOSITORIO_CLIENTES } from '../../dominio/puertos/repositorio-clientes';
import { REPOSITORIO_HISTORIAL_COSTOS } from '../../dominio/puertos/repositorio-historial-costos';
import { REPOSITORIO_INGRESOS } from '../../dominio/puertos/repositorio-ingresos';
import { REPOSITORIO_MOVIMIENTOS } from '../../dominio/puertos/repositorio-movimientos';
import { REPOSITORIO_PERMISOS } from '../../dominio/puertos/repositorio-permisos';
import { REPOSITORIO_PRODUCTOS } from '../../dominio/puertos/repositorio-productos';
import { REPOSITORIO_PROYECTOS } from '../../dominio/puertos/repositorio-proyectos';
import { REPOSITORIO_CATEGORIAS } from '../../dominio/puertos/repositorio-categorias';
import { REPOSITORIO_ROLES } from '../../dominio/puertos/repositorio-roles';
import { REPOSITORIO_SALIDAS } from '../../dominio/puertos/repositorio-salidas';
import { ContadoresPrisma } from './contadores.prisma';
import { PrismaService } from './prisma.service';
import { RepositorioClientesPrisma } from './repositorio-clientes.prisma';
import { RepositorioHistorialCostosPrisma } from './repositorio-historial-costos.prisma';
import { RepositorioIngresosPrisma } from './repositorio-ingresos.prisma';
import { RepositorioMovimientosPrisma } from './repositorio-movimientos.prisma';
import { RepositorioPermisosPrisma } from './repositorio-permisos.prisma';
import { RepositorioProductosPrisma } from './repositorio-productos.prisma';
import { RepositorioProyectosPrisma } from './repositorio-proyectos.prisma';
import { RepositorioCategoriasPrisma } from './repositorio-categorias.prisma';
import { RepositorioRolesPrisma } from './repositorio-roles.prisma';
import { RepositorioSalidasPrisma } from './repositorio-salidas.prisma';
import { UnidadDeTrabajo } from './unidad-de-trabajo';

@Global()
@Module({
  providers: [
    PrismaService,
    UnidadDeTrabajo,
    ContadoresPrisma,
    { provide: CONTADORES, useExisting: ContadoresPrisma },
    { provide: REPOSITORIO_PRODUCTOS, useClass: RepositorioProductosPrisma },
    { provide: REPOSITORIO_INGRESOS, useClass: RepositorioIngresosPrisma },
    { provide: REPOSITORIO_CLIENTES, useClass: RepositorioClientesPrisma },
    { provide: REPOSITORIO_PROYECTOS, useClass: RepositorioProyectosPrisma },
    { provide: REPOSITORIO_SALIDAS, useClass: RepositorioSalidasPrisma },
    { provide: REPOSITORIO_MOVIMIENTOS, useClass: RepositorioMovimientosPrisma },
    { provide: REPOSITORIO_ROLES, useClass: RepositorioRolesPrisma },
    { provide: REPOSITORIO_CATEGORIAS, useClass: RepositorioCategoriasPrisma },
    { provide: REPOSITORIO_PERMISOS, useClass: RepositorioPermisosPrisma },
    { provide: REPOSITORIO_HISTORIAL_COSTOS, useClass: RepositorioHistorialCostosPrisma },
  ],
  exports: [
    PrismaService,
    UnidadDeTrabajo,
    CONTADORES,
    REPOSITORIO_PRODUCTOS,
    REPOSITORIO_INGRESOS,
    REPOSITORIO_CLIENTES,
    REPOSITORIO_PROYECTOS,
    REPOSITORIO_SALIDAS,
    REPOSITORIO_MOVIMIENTOS,
    REPOSITORIO_ROLES,
    REPOSITORIO_CATEGORIAS,
    REPOSITORIO_PERMISOS,
    REPOSITORIO_HISTORIAL_COSTOS,
  ],
})
export class PersistenciaModule {}
