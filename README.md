# Trazo — Sistema de Gestión de Inventarios

Sistema web para controlar inventarios con **trazabilidad de consumo por cliente y
proyecto**: registra entradas de mercancía por factura, controla stock disponible y
comprometido, registra salidas asignadas obligatoriamente a un cliente/proyecto (con
garantía de que el stock nunca queda negativo) y responde la pregunta central del negocio:
**"¿cuánto material ha consumido cada cliente en cada uno de sus proyectos?"** — con
reportes exportables a PDF y Excel.

Proyecto desarrollado con **Spec-Driven Development (Spec Kit)**: primero la
especificación, luego el plan, luego las tareas, luego el código. Toda la planeación vive
en [`specs/001-gestion-inventarios/`](specs/001-gestion-inventarios/spec.md).

---

## Stack

| Pieza | Tecnología | Rol |
|---|---|---|
| Backend | **NestJS 11** (Node 22, TypeScript) | API REST con **arquitectura hexagonal** |
| Base de datos | **PostgreSQL 16** + **Prisma** | Constraints y bloqueos que blindan el stock |
| Frontend | **Next.js 15** (App Router) | Solo presentación; consume la API vía proxy |
| Contrato compartido | **Zod** en `@trazo/compartido` | Validación idéntica en cliente y servidor |
| Autenticación | Passport-JWT en **cookie httpOnly** + bcrypt | Roles: Administrador, Gerente, Operario |
| Reportes | exceljs (Excel) + pdfmake (PDF) | Exportaciones fieles a la pantalla |
| Pruebas | Jest + Supertest (backend), Playwright (E2E) | Invariantes críticos contra BD real |

## Estructura del repositorio

```text
├── README.md                  ← estás aquí
├── docs/arquitectura.md       ← REGLAS VINCULANTES: capas, patrones, SOLID, comentarios
├── specs/001-gestion-inventarios/
│   ├── spec.md                ← especificación funcional (8 historias, 52 requisitos)
│   ├── plan.md                ← plan técnico y estructura
│   ├── research.md            ← decisiones técnicas con alternativas (R1–R14)
│   ├── data-model.md          ← modelo de datos, estados, invariantes
│   ├── contracts/api-rest.md  ← contrato REST (fuente de verdad de la API)
│   ├── contracts/rutas-frontend.md ← mapa de rutas UI y acceso por rol
│   ├── quickstart.md          ← guía de validación end-to-end
│   └── tasks.md               ← 98 tareas ordenadas; MVP = T001–T066 (US1+US2+US3+US5)
├── packages/compartido/       ← @trazo/compartido: esquemas Zod + tipos del contrato
├── backend/                   ← NestJS hexagonal (dominio/aplicacion/infraestructura/interfaces)
├── frontend/                  ← Next.js (App Router)
├── docker-compose.yml         ← PostgreSQL 16 local (BD trazo + trazo_test)
└── .specify/                  ← Spec Kit (constitución del proyecto y plantillas)
```

Cada capa del backend tiene su propio README con sus reglas y ejemplos:
[dominio](backend/src/dominio/README.md) ·
[aplicación](backend/src/aplicacion/README.md) ·
[infraestructura](backend/src/infraestructura/README.md) ·
[interfaces/http](backend/src/interfaces/http/README.md).

## Arquitectura en 30 segundos

```text
Navegador → frontend Next.js → proxy /api/* → backend NestJS → PostgreSQL

backend/src:  interfaces/http → aplicacion → dominio ← infraestructura
              (controladores)   (casos de uso) (núcleo)  (Prisma, bcrypt, export)
```

- **Regla de dependencia**: las flechas apuntan hacia adentro; el `dominio` no importa
  ningún framework (lo verifica el lint). Detalle completo en
  [docs/arquitectura.md](docs/arquitectura.md).
- **Invariante crítico**: una salida jamás puede dejar stock negativo — transacción con
  `SELECT ... FOR UPDATE` + `CHECK` en la BD (Principio I de la
  [constitución](.specify/memory/constitution.md)).
- **Trazabilidad**: todo movimiento queda auditado (usuario, fecha, documento) en una
  tabla inmutable; cada salida pertenece a un cliente/proyecto obligatoriamente.
- **Comentarios**: cada caso de uso/puerto/controlador lleva TSDoc con el requisito que
  implementa — `grep -r "FR-028" backend/src` te lleva al código de esa regla.

## Puesta en marcha con Docker (la vía corta)

Levanta la aplicación completa —base de datos, backend y frontend— sin instalar Node ni
PostgreSQL. Verificado de punta a punta el 2026-08-12.

```bash
cp .env.docker.example .env    # y edita los valores: JWT_SECRET es obligatorio
docker compose up -d --build
docker compose run --rm backend node backend/dist-seed/seed.js   # crea el administrador
```

La aplicación queda en <http://localhost:3000> y se entra con el `SEED_ADMIN_LOGIN` /
`SEED_ADMIN_PASSWORD` del `.env` (el usuario nace obligado a cambiar la contraseña, FR-005).
Añade `--demo` al final del comando de semilla para crear además `gerente.demo` y
`operario.demo`.

Cosas que conviene saber, aprendidas levantándolo:

- **Las migraciones se aplican solas** al arrancar el backend (`prisma migrate deploy`, que
  nunca borra datos y es idempotente). La semilla **no**: crear un usuario con contraseña
  conocida debe ser una decisión explícita, no un efecto secundario de `up`.
- **`JWT_SECRET` no tiene valor por defecto**: si falta, `docker compose up` aborta a
  propósito. Un secreto de firma con valor por defecto es un secreto público.
- **El backend no se publica al exterior**: solo habla con el frontend por la red interna de
  Docker. Todo el tráfico entra por el proxy `/api/*` del frontend, que es lo que mantiene la
  cookie de sesión como first-party.
- **Si ya tienes un PostgreSQL nativo ocupando el 5432**, el contenedor publica su base en el
  puerto `PUERTO_DB` del `.env` (5433 por defecto en un entorno así) para que convivan sin
  tocar tus datos locales.
- **La URL del backend queda fijada al construir la imagen del frontend**, no en ejecución:
  Next serializa el destino de las reescrituras `/api/*` durante el build. Por eso viaja como
  `args.BACKEND_URL` en `docker-compose.yml`. Si cambias esa URL, hay que reconstruir la
  imagen; ponerla como variable de entorno no surte efecto.
- Los secretos se inyectan en tiempo de ejecución y **nunca** quedan dentro de una capa de la
  imagen (`.dockerignore` excluye todos los `.env`).

```bash
docker compose logs -f            # ver qué está pasando
docker compose down               # parar (los datos sobreviven en el volumen)
docker compose down -v            # parar y BORRAR la base de datos
```

## Puesta en marcha para desarrollo (sin Docker)

Requisitos: **Node.js 22+** y una instancia de **PostgreSQL 16+** accesible — vía
`docker compose up -d db` (`docker-compose.yml`, requiere Docker Desktop) o una instalación
nativa (así corre en el entorno de desarrollo de referencia, Windows 11 con PostgreSQL
nativo); cualquiera de las dos sirve mientras existan las bases `trazo` y `trazo_test`.

1. Instalar dependencias (compila también el paquete compartido vía `postinstall`):

```bash
npm install
```

2. Variables de entorno:

```bash
copy backend\.env.example backend\.env
```

```bash
copy frontend\.env.example frontend\.env
```

Edita `backend/.env`: define `JWT_SECRET`, `DATABASE_URL`/`DATABASE_URL_TEST` (y
`DATABASE_URL_E2E` si vas a correr Playwright) y las credenciales del administrador semilla
(`SEED_ADMIN_LOGIN`/`SEED_ADMIN_PASSWORD`).

3. Base de datos (omite este paso si ya usas una instancia nativa):

```bash
npm run db:up
```

4. Migraciones y usuario administrador inicial:

```bash
npm run prisma:migrate -w backend
```

```bash
npm run seed -w backend
```

Para una demo completa con los tres roles y datos de ejemplo (usuarios
`gerente.demo`/`operario.demo`, productos, cliente "Jumbo" con proyectos, ingresos y
salidas con totales conocidos):

```bash
npm run seed:demo -w backend
```

5. Levantar en desarrollo (dos terminales):

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

- Frontend: <http://localhost:3000> (redirige a `/login`)
- API: <http://localhost:4000/api/salud>

## Comandos útiles

| Comando | Qué hace |
|---|---|
| `npm run verificar` | Lint (incluida la regla de capas) + typecheck + unitarias de ambos workspaces — la puerta de calidad local, correr tras cada tarea |
| `npm run dev:backend` / `npm run dev:frontend` | Desarrollo (backend `:4000`, frontend `:3000`) |
| `npm run db:up` | Levanta PostgreSQL en Docker (bases `trazo` + `trazo_test`) |
| `npm run test -w backend` | Unitarias de dominio/aplicación (sin BD) |
| `npm run test:integracion -w backend` | Integración contra PostgreSQL real (`trazo_test`) |
| `npm run test:e2e` | Playwright end-to-end (levanta backend + frontend en puertos dedicados 4100/3100) |
| `npm run seed -w backend` | Usuario Administrador semilla |
| `npm run seed:demo -w backend` | + usuarios demo por rol y datos de ejemplo ("Jumbo") |
| `npm run compartido:build` | Recompila `@trazo/compartido` tras editar esquemas |

## Estado y hoja de ruta

**Las 8 historias de usuario (US1–US8) están implementadas** de punta a punta (API +
interfaz), siguiendo el orden de [tasks.md](specs/001-gestion-inventarios/tasks.md):

1. **Fases 1–2** — Setup + fundación (BD blindada, login por roles, guards, lint de capas) ✅
2. **Fases 3–6 = MVP** — Ingresos (US1) → Clientes/Proyectos (US2) → Salidas trazables
   (US3) → Inventario con alertas (US5) ✅
3. **Post-MVP** — Reportes de consumo (US4), gestión de usuarios (US6), reportes de
   auditoría e inventario (US7), carga masiva de catálogo desde Excel (US8) ✅
4. **Fase 11 — Polish** (en curso) — consolidación de estados vacíos/errores, revisión de
   rendimiento y seguridad transversal, y validación final contra los criterios de éxito
   (SC-001…SC-011) de la spec

Dos suites E2E de Playwright (`flujo-nucleo.spec.ts`/T066, `roles.spec.ts`/T079) tienen su
código completo pero pendiente de una corrida en verde fuera de un agente de IA: su
`global-setup` necesita `prisma migrate reset` contra la BD `trazo_e2e`, y el CLI de Prisma
rechaza ese comando cuando detecta que quien lo invoca es un agente, exigiendo el consentimiento
explícito del usuario (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`) — corre
`npm run test:e2e` desde tu propia terminal para completarlas.

La validación manual del sistema está guiada por
[quickstart.md](specs/001-gestion-inventarios/quickstart.md).

## Reglas del proyecto (léelas antes de escribir código)

1. [Constitución](.specify/memory/constitution.md) — 6 principios; I (stock nunca
   negativo), II (trazabilidad total) y VI (hexagonal + calidad) son innegociables.
2. [docs/arquitectura.md](docs/arquitectura.md) — regla de dependencia, patrones,
   nomenclatura en español, convención de comentarios TSDoc + `FR-###` y checklist de
   revisión.
3. [Contrato REST](specs/001-gestion-inventarios/contracts/api-rest.md) — la API se
   implementa tal cual está escrita; si algo debe cambiar, se cambia primero el contrato.
