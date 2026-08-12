/**
 * Módulo raíz del backend.
 *
 * A medida que se implementan las historias de usuario (specs/001-gestion-inventarios/
 * tasks.md), cada módulo de negocio se registra aquí. El orden previsto:
 *
 *   - Fase 2 (Foundational): módulo de seguridad (T014-T016) — login, guards por rol. LISTO.
 *   - US1: módulos de productos e ingresos (T033). LISTO.
 *   - US2: módulo de clientes/proyectos (T043). LISTO.
 *   - US3: módulo de salidas (T052). LISTO.
 *   - US5: módulo de inventario (T060). LISTO.
 *   - US4: módulo de reportes (T070) — consumo-cliente/consumo-proyecto. LISTO (US7/T081
 *     amplía este mismo módulo con inventario/movimientos).
 *   - US6: módulo de usuarios (T076). LISTO.
 *   - US9: módulo de roles y permisos (T106) — `/api/roles` y `GET /api/permisos`. LISTO.
 *   - US10: módulo del panel de control (T115) — `GET /api/panel`. LISTO.
 *
 * Regla (docs/arquitectura.md): los módulos de NestJS solo CABLEAN dependencias
 * (controlador → caso de uso → puerto → adaptador). La lógica vive en dominio/aplicacion.
 *
 * Guards globales (T015): `JwtAuthGuard` corre PRIMERO (exige sesión, salvo `@Public()`) y
 * el guard de autorización DESPUÉS. El orden del arreglo `providers` importa: NestJS aplica
 * los `APP_GUARD` en el orden en que se registran.
 *
 * US9 completada (T103): la autorización tiene UN SOLO mecanismo, `PermisosGuard` +
 * `@RequierePermiso('modulo.accion')`. `RolesGuard`/`@Roles(...)` fueron retirados en la
 * misma pasada que migró los 8 controladores con autorización, tal como exige research R16
 * ("no se mantienen los dos mecanismos en paralelo"): dos guards de autorización registrados
 * a la vez serían dos fuentes de verdad y la duda permanente de cuál gana en cada endpoint,
 * justo la ambigüedad que la Constitución prohíbe en el control de acceso (Principio III).
 * Un endpoint sin `@RequierePermiso` queda abierto a cualquier usuario autenticado (mismo
 * criterio que antes; `@Public()` es lo que abre una ruta a usuarios sin sesión).
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PersistenciaModule } from './infraestructura/persistencia/persistencia.module';
import { JwtAuthGuard } from './interfaces/http/comunes/guards/jwt-auth.guard';
import { PermisosGuard } from './interfaces/http/comunes/guards/permisos.guard';
import { AuthModule } from './interfaces/http/auth/auth.module';
import { ClientesModule } from './interfaces/http/clientes/clientes.module';
import { IngresosModule } from './interfaces/http/ingresos/ingresos.module';
import { InventarioModule } from './interfaces/http/inventario/inventario.module';
import { PanelModule } from './interfaces/http/panel/panel.module';
import { ProductosModule } from './interfaces/http/productos/productos.module';
import { ReportesModule } from './interfaces/http/reportes/reportes.module';
import { RolesModule } from './interfaces/http/roles/roles.module';
import { ControladorSalud } from './interfaces/http/salud/controlador-salud';
import { SalidasModule } from './interfaces/http/salidas/salidas.module';
import { UsuariosModule } from './interfaces/http/usuarios/usuarios.module';

@Module({
  imports: [
    // Variables de entorno disponibles en toda la app (backend/.env — ver .env.example)
    ConfigModule.forRoot({ isGlobal: true }),
    // PrismaService + UnidadDeTrabajo disponibles globalmente (T010).
    PersistenciaModule,
    // Módulo de seguridad: estrategia JWT, /api/auth y cableado Hasheador/RepositorioUsuarios (T014/T016).
    AuthModule,
    // US1: alta de productos y ciclo completo de ingresos (T033).
    ProductosModule,
    IngresosModule,
    // US2: catálogo comercial de clientes/proyectos, base del destino de salidas (T043).
    ClientesModule,
    // US3: ciclo completo de salidas — correlativo, compromiso y descuento atómico de stock (T052).
    SalidasModule,
    // US5: consulta de inventario con disponibilidad y alertas — cierra el MVP (T060).
    InventarioModule,
    // US4: reportes de consumo por cliente/proyecto, con exportación PDF/Excel (T070).
    ReportesModule,
    // US6: administración de usuarios y roles — solo Administrador (T076).
    UsuariosModule,
    // US9: administración de roles y de su matriz de permisos + catálogo de permisos (T106).
    RolesModule,
    // US10: panel de control de la ruta de inicio — compone las cifras que ya existen (T115).
    PanelModule,
  ],
  controllers: [ControladorSalud],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermisosGuard },
  ],
})
export class AppModule {}
