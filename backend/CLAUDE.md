# CLAUDE.md — Agente de BACKEND (NestJS hexagonal)

Lee primero el `CLAUDE.md` de la raíz. Este archivo añade las reglas específicas del
backend. Los README de cada capa (`src/*/README.md`) contienen el detalle y ejemplos.

## Regla de dependencia (el lint la hace cumplir — no la pelees, obedécela)

```text
interfaces/http ──▶ aplicacion ──▶ dominio ◀── infraestructura
```

- `dominio`: TypeScript puro. PROHIBIDO NestJS, Prisma, Zod, otras capas.
- `aplicacion`: solo importa `dominio` y `@trazo/compartido`. Un caso de uso por
  operación (`confirmar-salida.caso-uso.ts` — patrón de `comunes/caso-de-uso.ts`).
- `infraestructura`: adaptadores que implementan puertos (Prisma SOLO en
  `persistencia/`). Traduce errores técnicos a errores de dominio (P2002 → `Duplicado`).
- `interfaces/http`: controladores delgados — validar con `PipeValidacionZod`, exigir
  `@Roles(...)`, delegar al caso de uso, SIN try/catch (el filtro global traduce).

## Orden al implementar una tarea de historia

1. Esquema Zod en `packages/compartido` (si la tarea lo pide) + `npm run compartido:build`
2. Dominio: entidad/puerto/servicio con TSDoc `FR-###`
3. Adaptador en infraestructura (si hay puerto nuevo)
4. Caso de uso en aplicación (puertos por constructor — nunca `new` de adaptadores)
5. Controlador + cableado en el módulo NestJS correspondiente (registrar en `app.module.ts`)
6. Pruebas: unitarias (puertos falsos en memoria) y/o integración según la tarea
7. `npm run verificar` en verde → marcar checkbox en `specs/.../tasks.md`

## Reglas duras de este workspace

- **Stock**: toda mutación de `stock_actual` ocurre DENTRO de la `UnidadDeTrabajo`
  (`prisma.$transaction` + `SELECT ... FOR UPDATE ORDER BY id`) y escribe su
  `movimientos_inventario` en la MISMA transacción. Jamás un `update` suelto de stock.
- **Errores**: solo clases de `dominio/comunes/errores.ts`. Nunca `throw new Error(...)`
  en código de negocio; nunca mensajes en inglés.
- **Correlativos**: vía puerto `Contadores` (`UPDATE ... RETURNING`), dentro de la
  transacción del documento.
- **Auditoría**: repositorios pueblan `usuario_creacion/modificacion` con el usuario que
  llega en la entrada del caso de uso. Nada de DELETE en movimientos ni usuarios.
- **SQL crudo** (`$queryRaw`): permitido SOLO en `infraestructura/persistencia` para
  `FOR UPDATE`/`RETURNING`; siempre parametrizado.
- **Contrato**: rutas/códigos/formatos exactamente como `specs/001-gestion-inventarios/
  contracts/api-rest.md`. Respuestas de error SIEMPRE `{ error: { mensaje, campos } }`.
- **Migraciones**: los `CHECK`, el trigger de inmutabilidad y la fila de `contadores` van
  en SQL dentro de `prisma/migrations` (tarea T009) — Prisma no los genera solo.

## Pruebas

- `npm run test -w backend` — unitarias (dominio/aplicación, sin BD).
- `npm run test:integracion -w backend` — contra `trazo_test` (Docker); las suites
  truncan tablas: JAMÁS apuntar a la BD de desarrollo. Los invariantes críticos
  (carrera de stock, unicidad concurrente, trigger de inmutabilidad) se prueban AQUÍ,
  con la BD real — nunca con mocks.
