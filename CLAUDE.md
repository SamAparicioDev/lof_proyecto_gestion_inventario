# CLAUDE.md — Guía para agentes que trabajan en Trazo

Sistema de gestión de inventarios con trazabilidad de consumo por cliente/proyecto.
Monorepo npm workspaces: `backend/` (NestJS hexagonal), `frontend/` (Next.js),
`packages/compartido/` (esquemas Zod + tipos del contrato). Metodología: **Spec-Driven
Development con Spec Kit** — el código IMPLEMENTA los artefactos de `specs/`, nunca los
contradice.

## Orden de lectura OBLIGATORIO antes de implementar

1. `.specify/memory/constitution.md` — 6 principios; I, II y VI son NO NEGOCIABLES
2. `docs/arquitectura.md` — regla de dependencia, patrones, nomenclatura, comentarios
3. `specs/001-gestion-inventarios/tasks.md` — LA lista de trabajo (90 tareas, en orden)
4. El contrato de lo que vayas a tocar: `contracts/api-rest.md` (API) o
   `contracts/rutas-frontend.md` (UI), más `data-model.md` si tocas datos

## Protocolo de trabajo

- Implementa las tareas de `tasks.md` **en su orden y respetando sus dependencias**;
  no inventes funcionalidades que ninguna tarea/FR pida (Principio V — YAGNI).
- Al terminar una tarea: marca su checkbox `[x]` en `tasks.md` y ejecuta
  `npm run verificar` (debe quedar en verde ANTES de continuar).
- Las tareas de pruebas críticas (T037, T056, T057, T058) son bloqueantes: su historia
  no se cierra sin ellas en verde (mandato constitucional).
- Los checkpoints de fase de `tasks.md` son puntos de validación reales: detente y
  comprueba lo que describen.
- Toda ruta, código de estado, forma de respuesta y esquema DEBE coincidir con
  `contracts/api-rest.md`. Si el contrato parece incompleto, se actualiza el contrato
  primero (y se anota), nunca se improvisa en el código.

## No negociables (resumen — detalle en la constitución)

1. **Stock nunca negativo**: mutaciones de stock SOLO dentro de la `UnidadDeTrabajo`
   (transacción + `FOR UPDATE`); `CHECK` en BD como red final.
2. **Trazabilidad total**: toda mutación puebla auditoría (usuario/fecha); movimientos
   inmutables; salidas siempre con cliente/proyecto.
3. **Regla de dependencia hexagonal**: `dominio` no importa frameworks; el lint la
   verifica — si `npm run lint -w backend` falla, el diseño está mal, no el lint.
4. **Validación doble**: esquemas Zod de `@trazo/compartido` en frontend (UX) y backend
   (autoridad). Mensajes SIEMPRE en español indicando el campo.
5. **Roles verificados en servidor**: `@Roles(...)` en cada endpoint; ocultar UI no es
   seguridad.
6. **Comentarios de trazabilidad**: TSDoc con `FR-###` en todo caso de uso, puerto,
   servicio de dominio y controlador (así se busca un proceso: `grep -r "FR-028"`).

## Comandos

| Comando | Uso |
|---|---|
| `npm run verificar` | Puerta de calidad: lint + typecheck + unitarias (correr tras CADA tarea) |
| `npm run dev:backend` / `npm run dev:frontend` | Desarrollo (backend :4000, frontend :3000) |
| `npm run db:up` | PostgreSQL en Docker (BD `trazo` + `trazo_test`) |
| `npm run test:integracion -w backend` | Integración contra PostgreSQL real |
| `npm run test:e2e` | Playwright (backend + frontend levantados) |
| `npm run compartido:build` | Recompilar `@trazo/compartido` tras editar esquemas |

Nota Windows: el entorno de desarrollo es Windows 11 — no uses comandos POSIX en scripts
de npm.

## Dónde va cada cosa

- Regla de negocio → `backend/src/dominio` (entidades/servicios) o el caso de uso
- Acceso a BD/tecnología → `backend/src/infraestructura` (implementando un puerto)
- Endpoint HTTP → `backend/src/interfaces/http` (controlador delgado + `@Roles` + pipe Zod)
- Esquema de validación → `packages/compartido/src/esquemas` (y reexport en `index.ts`)
- Pantalla/componente → `frontend/src` (SOLO presentación; fetch únicamente vía
  `frontend/src/lib/api/cliente.ts`)

Cada workspace tiene su propio `CLAUDE.md` con las reglas específicas de esa mitad.
