# Implementation Plan: Sistema de Gestión de Inventarios con Trazabilidad por Cliente/Proyecto (Trazo)

**Branch**: `001-gestion-inventarios` | **Date**: 2026-08-10 (actualizado: stack definitivo NestJS + Next.js) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-gestion-inventarios/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Aplicación web que registra entradas de mercancía por factura, controla stock con cantidades
comprometidas/disponibles y registra salidas asignadas obligatoriamente a cliente/proyecto,
garantizando que el stock nunca quede negativo. Genera 4 reportes exportables a PDF/Excel.

Enfoque técnico (decisión explícita del dueño del proyecto, Constitución v1.1.0 Principio VI):
**backend NestJS 11** con **arquitectura hexagonal** (dominio → aplicación → adaptadores) sobre
**PostgreSQL 16 + Prisma**, y **frontend Next.js 15** que consume el backend únicamente a través
del contrato REST. Monorepo npm workspaces con paquete compartido de esquemas Zod (validación
idéntica en cliente y servidor). El descuento de stock es atómico vía transacciones con bloqueo
de fila ejecutadas por los adaptadores de persistencia, con `CHECK` constraints como red final.
Autenticación con Passport-JWT en cookie httpOnly, hash bcryptjs y guards de rol por endpoint.
SOLID, clean code y comentarios TSDoc con referencia a los `FR-###` de la spec en cada proceso.

## Technical Context

**Language/Version**: TypeScript 5.x estricto sobre Node.js 22 LTS (backend y frontend)

**Primary Dependencies**:
- Backend: NestJS 11 (REST, DI), Prisma ORM, Passport + @nestjs/jwt (cookie httpOnly),
  bcryptjs, Zod (pipe de validación propio), exceljs (Excel), pdfmake (PDF)
- Frontend: Next.js 15 (App Router), sistema de diseño Nocturne (docs/diseno-nocturne.md;
  reemplaza shadcn/ui — decisión del dueño del proyecto, 2026-08-10) + Tailwind CSS 4 solo
  para utilidades de layout, `@phosphor-icons/react`, TanStack Table,
  react-hook-form + Zod, Recharts
- Compartido: paquete `@trazo/compartido` (esquemas Zod + tipos del contrato API)

**Storage**: PostgreSQL 16 (Docker Compose en desarrollo: BD `trazo` + `trazo_test`;
instancia gestionada o servidor propio en producción)

**Testing**: Backend — Jest + Supertest contra PostgreSQL real (semántica de bloqueos);
unitarias de dominio/aplicación sin framework (el dominio no importa NestJS). Frontend/E2E —
Playwright (flujos críticos con backend + frontend levantados)

**Target Platform**: Aplicación web (navegadores modernos de escritorio); backend Node.js en
Linux o Windows; desarrollo en Windows 11. Frontend en :3000 con proxy `/api/*` → backend :4000
(mismo origen para el navegador — sin CORS y cookies first-party)

**Project Type**: Aplicación web con backend y frontend separados en monorepo (npm workspaces:
`backend/`, `frontend/`, `packages/compartido/`)

**Performance Goals**: Listados y reportes habituales < 2 s con 20 usuarios concurrentes
(SC-008); actualización de stock visible de inmediato tras confirmar operaciones (SC-005)

**Constraints**: Stock nunca negativo bajo concurrencia (transacción atómica en servidor);
número de factura único ante registros simultáneos; historial de movimientos inmutable;
interfaz 100% en español; paginación obligatoria; regla de dependencia hexagonal (el dominio
no importa frameworks) verificada por lint

**Scale/Scope**: ≤ 50 usuarios registrados (≤ 20 concurrentes), miles de productos, decenas de
miles de movimientos/año, ~7 módulos de UI + API REST de ~40 endpoints

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluación contra la Constitución de Trazo v1.1.0 (`.specify/memory/constitution.md`):

| Principio | Requisito clave | Cumplimiento del plan | Estado |
|-----------|-----------------|----------------------|--------|
| I. Integridad del Inventario | Stock nunca negativo; validación atómica en servidor; tiempo real; constraints en BD | Servicio de dominio `ServicioStock` ejecutado dentro de transacciones Prisma con `SELECT ... FOR UPDATE` en los adaptadores; `CHECK (stock_actual >= 0)` y `CHECK (cantidad > 0)` en migraciones; stock y movimiento se escriben en la misma transacción | ✅ PASS |
| II. Trazabilidad Total | Movimientos con usuario/fecha/documento; salida ligada a cliente/proyecto; auditoría; sin borrado de historia | Tabla `movimientos_inventario` inmutable (trigger); `proyecto_id NOT NULL` en salidas; campos de auditoría poblados por los repositorios con el usuario autenticado; anulaciones = movimiento inverso | ✅ PASS |
| III. Control de Acceso por Roles | Autenticación; verificación servidor por endpoint; hash; baja lógica | Passport-JWT (cookie httpOnly, 8 h deslizante) + `JwtAuthGuard` y `RolesGuard` globales con `@Roles(...)` por endpoint, revalidando usuario ACTIVO en BD; bcryptjs costo 12; usuarios se desactivan | ✅ PASS |
| IV. Validación Estricta | Cliente Y servidor; unicidad en BD; errores en español | Esquemas Zod en `@trazo/compartido` usados por react-hook-form (UX) y por el `PipeValidacionZod` del backend (autoridad); UNIQUEs en BD con traducción de violaciones a mensajes de campo en español | ✅ PASS |
| V. Simplicidad Primero | MVP primero; sin infraestructura especulativa dentro de la arquitectura del P-VI | Sin microservicios, colas ni caché; un backend + un frontend + un paquete compartido; caché de reportes DIFERIDO (YAGNI); un caso de uso por operación de la spec, ninguno extra | ✅ PASS |
| VI. Arquitectura Hexagonal y Calidad | Regla de dependencia; puertos/adaptadores; SOLID; TSDoc con FR-### | Estructura `dominio/aplicacion/infraestructura/interfaces` con lint de fronteras entre capas; puertos para persistencia/hash/exportación/reloj; Strategy para exportadores; convenciones vinculantes en `docs/arquitectura.md` | ✅ PASS |
| Restricciones adicionales | Español; auditoría consultable; sesiones expiran; export con filtros; paginación e índices | UI y errores en español; reporte de movimientos expone auditoría; JWT expira (8 h deslizante); endpoints de export reciben los mismos filtros Zod que la vista; paginación server-side e índices en data-model | ✅ PASS |

**Resultado pre-Phase 0**: PASS — sin violaciones que justificar.

**Resultado post-Phase 1 (re-evaluación tras el diseño)**: PASS — [data-model.md](./data-model.md)
materializa los constraints; [contracts/api-rest.md](./contracts/api-rest.md) define permisos y
validación por endpoint; [contracts/rutas-frontend.md](./contracts/rutas-frontend.md) define el
acceso por rol en UI. La separación backend/frontend y la arquitectura hexagonal no son
complejidad especulativa: son mandato constitucional del Principio VI (ver Complexity Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/001-gestion-inventarios/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── api-rest.md      # Contrato REST del backend (fuente de verdad API)
│   └── rutas-frontend.md# Mapa de rutas UI y acceso por rol
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
package.json                  # Workspaces: backend, frontend, packages/* + scripts raíz
docker-compose.yml            # PostgreSQL 16 (trazo + trazo_test)
README.md                     # Guía del proyecto (setup, arquitectura, comandos)
docs/
└── arquitectura.md           # Reglas vinculantes: capas, patrones, SOLID, comentarios

packages/compartido/          # @trazo/compartido — contrato compartido front/back
└── src/
    ├── esquemas/             # Esquemas Zod por módulo (mensajes en español)
    └── tipos/                # Tipos del contrato API (ApiError, paginación)

backend/                      # NestJS 11 — arquitectura hexagonal
├── prisma/
│   ├── schema.prisma         # Modelo de datos + constraints (data-model.md)
│   ├── migrations/           # SQL: CHECKs, trigger de inmutabilidad, contadores
│   └── seed.ts               # Admin semilla + usuarios/datos demo (--demo)
└── src/
    ├── dominio/              # NÚCLEO: sin imports de NestJS/Prisma
    │   ├── comunes/          # Errores de dominio, tipos base
    │   ├── entidades/        # Producto, Ingreso, Salida, Cliente, Proyecto, Usuario…
    │   ├── puertos/          # Interfaces: repositorios, contadores, hash, reloj
    │   └── servicios/        # ServicioStock (aplicarEntrada/aplicarSalida)
    ├── aplicacion/           # Casos de uso (uno por operación de la spec) + DTOs
    │   └── <modulo>/         # ingresos/, salidas/, clientes/, inventario/, reportes/…
    ├── infraestructura/      # Adaptadores que implementan puertos
    │   ├── persistencia/     # PrismaService, repositorios Prisma, UnidadDeTrabajo
    │   ├── seguridad/        # AdaptadorHashBcrypt, estrategia JWT
    │   └── exportacion/      # ExportadorExcel, ExportadorPdf (patrón Strategy)
    └── interfaces/
        └── http/             # Controladores REST, guards, pipes Zod, filtros de error
            └── comunes/      # PipeValidacionZod, FiltroErroresDominio, @Roles

frontend/                     # Next.js 15 — solo presentación
└── src/
    ├── app/
    │   ├── (auth)/login/     # Login
    │   └── (app)/            # Layout autenticado con navegación por rol
    │       ├── ingresos/  inventario/  salidas/  clientes/  reportes/  usuarios/
    │       └── cambiar-password/
    ├── componentes/          # UI compartida (clases Nocturne, tablas, formularios)
    └── lib/                  # cliente API (fetch), sesión, formato COP/fechas

tests/  (por workspace)
├── backend/test/unit/        # Dominio y aplicación puros (sin BD)
├── backend/test/integracion/ # API + PostgreSQL real (invariantes críticos)
└── e2e/                      # Playwright: flujos completos backend+frontend
```

**Structure Decision**: Monorepo npm workspaces con backend NestJS hexagonal, frontend Next.js
y paquete compartido de contratos (Opción 2 del template: web application backend+frontend).
El navegador solo habla con el frontend; Next.js hace proxy de `/api/*` al backend (mismo
origen → cookies httpOnly first-party y sin CORS). Estructura mandatada por el Principio VI.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Sin violaciones bajo la Constitución v1.1.0. Registro de decisión (transparencia): el plan
original (2026-08-10 AM) proponía un monolito Next.js con Server Actions bajo el Principio V
v1.0.0; el dueño del proyecto decidió explícitamente separar backend (NestJS) y frontend
(Next.js) con arquitectura hexagonal, y esa decisión se ratificó como Principio VI en la
Constitución v1.1.0 — por lo que la separación y las capas hexagonales son mandato, no
complejidad especulativa. El costo aceptado: un contrato REST explícito y un paquete
compartido de esquemas; el beneficio: reglas de negocio críticas aisladas de frameworks y
testeables en aislamiento.
