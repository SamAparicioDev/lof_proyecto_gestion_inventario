# Reglas de Arquitectura y Lenguaje — Trazo

**Estado**: VINCULANTE para toda implementación (Constitución v1.1.0, Principio VI).
Cualquier código que viole estas reglas se corrige antes de integrarse. Si una regla debe
cambiar, se enmienda primero la constitución (`.specify/memory/constitution.md`).

Documentos hermanos: [spec.md](../specs/001-gestion-inventarios/spec.md) (el QUÉ),
[plan.md](../specs/001-gestion-inventarios/plan.md) (el CÓMO),
[api-rest.md](../specs/001-gestion-inventarios/contracts/api-rest.md) (el contrato),
[tasks.md](../specs/001-gestion-inventarios/tasks.md) (el orden de trabajo).

---

## 1. Vista general

```text
                    ┌─────────────────────────────────────────────┐
 Navegador ──────▶  │  frontend/ (Next.js)                        │
                    │  Solo presentación. Valida para UX con los  │
                    │  esquemas Zod compartidos. Cero negocio.    │
                    └───────────────┬─────────────────────────────┘
                                    │ proxy /api/* (mismo origen, cookie httpOnly)
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │  backend/ (NestJS) — HEXAGONAL              │
                    │                                             │
                    │   interfaces/http   ──▶  aplicacion  ──▶ ┌──┴───────┐
                    │   (controladores,        (casos de uso)  │ dominio  │
                    │    guards, pipes)                        │ (núcleo) │
                    │   infraestructura  ──implementa puertos─▶└──┬───────┘
                    │   (Prisma, bcrypt, exceljs/pdfmake)         │
                    └───────────────┬─────────────────────────────┘
                                    ▼
                              PostgreSQL 16
                    (CHECKs, UNIQUEs, trigger de inmutabilidad:
                     la última línea de defensa de los datos)

 packages/compartido/ = esquemas Zod + tipos del contrato, usados por AMBOS lados.
```

## 2. Regla de dependencia (NO NEGOCIABLE)

Las dependencias apuntan **hacia adentro**. El lint (`backend/eslint.config.mjs`) la hace
cumplir automáticamente — si el lint falla, el código no entra.

| Capa | Puede importar de | PROHIBIDO importar | Contenido |
|---|---|---|---|
| `dominio` | nada externo | NestJS, Prisma, Express, otras capas | Entidades con invariantes, errores tipados, puertos (interfaces), `ServicioStock` |
| `aplicacion` | `dominio`, `@trazo/compartido` | Prisma, `infraestructura`, `interfaces` | Un caso de uso por operación de la spec + DTOs |
| `infraestructura` | `dominio`, `aplicacion` | `interfaces` | Adaptadores: repositorios Prisma, hash, exportadores, contadores |
| `interfaces/http` | `aplicacion`, `dominio` (tipos), `@trazo/compartido` | Prisma directo | Controladores, guards, pipes, filtros |

Preguntas de control al escribir código:
- ¿Este `if` decide algo del negocio? → dominio o caso de uso, nunca controlador/adaptador.
- ¿Necesito la BD/un archivo/el reloj desde un caso de uso? → define un puerto, inyéctalo.
- ¿Estoy importando `@prisma/client` fuera de `infraestructura/persistencia`? → prohibido.

## 3. Patrones de diseño aplicados (y dónde)

Solo se usan los patrones que un requisito justifica (Principio V — nada especulativo):

| Patrón | Dónde | Por qué (requisito) |
|---|---|---|
| **Use Case / Command** | `aplicacion/*/*.caso-uso.ts` | Una operación de la spec = una clase localizable (SRP; trazabilidad exigida por el dueño) |
| **Repository (puerto/adaptador)** | `dominio/puertos` ↔ `infraestructura/persistencia` | Negocio testeable sin BD; Prisma intercambiable (DIP) |
| **Unit of Work** | `infraestructura/persistencia/unidad-de-trabajo.ts` | Atomicidad de stock con `FOR UPDATE` (Principio I, FR-028) |
| **Strategy** | `infraestructura/exportacion/exportador-{excel,pdf}.ts` | Dos formatos de export hoy, extensible sin tocar reportes (OCP, FR-043) |
| **Adapter** | `pipe-validacion-zod.ts`, `adaptador-hash-bcrypt.ts` | Integrar Zod/bcrypt sin acoplar el resto del código |
| **Guard + Decorator** | `interfaces/http/comunes/guards`, `@Roles(...)` | Control de acceso declarativo y auditable por endpoint (FR-002/FR-003) |
| **Máquina de estados** | entidades `Ingreso` y `Salida` en `dominio/entidades` | Transiciones válidas explícitas ([data-model.md](../specs/001-gestion-inventarios/data-model.md)) |

## 4. SOLID en concreto (no como eslogan)

- **S** — Una clase, una razón de cambio: `ConfirmarSalidaCasoUso` solo confirma salidas.
  Los controladores solo traducen HTTP. Los adaptadores solo hablan con su tecnología.
- **O** — Extender sin modificar: un nuevo formato de export = nueva estrategia que
  implementa `ExportadorReporte`; el controlador de reportes no cambia.
- **L** — Todo adaptador es sustituible por su puerto: las pruebas unitarias usan
  repositorios en memoria y el caso de uso no nota la diferencia.
- **I** — Puertos pequeños y específicos: `Contadores` tiene un método
  (`siguienteNumero`), no una interfaz genérica de 20 métodos.
- **D** — Los casos de uso reciben **puertos por constructor** (inyección de NestJS
  cableada en los módulos de `interfaces`); nunca instancian adaptadores con `new`.

## 5. Reglas de lenguaje y clean code

**Nomenclatura** (el glosario es la spec — sus Key Entities):

| Elemento | Convención | Ejemplo |
|---|---|---|
| Archivos | `kebab-case` con sufijo de rol | `confirmar-salida.caso-uso.ts`, `repositorio-salidas.prisma.ts` |
| Clases | `PascalCase` en español | `ConfirmarSalidaCasoUso`, `FiltroErroresDominio` |
| Variables/funciones | `camelCase` en español | `cantidadDisponible`, `aplicarSalida()` |
| Tablas/columnas BD | `snake_case` español | `movimientos_inventario.stock_resultante` |
| Rutas API | `kebab-case` plural | `/api/reportes/consumo-cliente` |

**Reglas de código** (el lint refuerza las marcadas con ⚙):
- ⚙ Sin `any` ni `@ts-ignore`; `unknown` + narrowing cuando el tipo es incierto.
- ⚙ Sin variables sin usar; imports limpios.
- Errores SOLO con las clases tipadas de `dominio/comunes/errores.ts` — nunca
  `throw new Error('texto')` en código de negocio.
- Funciones cortas, un nivel de abstracción por función; si necesitas un comentario para
  separar secciones dentro de una función, son dos funciones.
- Sin números/textos mágicos: constantes con nombre (`PAGINA_MAXIMA = 100`).
- Todo dinero y cantidad se maneja como decimal exacto (nunca `float` binario para COP).
- Mensajes al usuario SIEMPRE en español, indicando campo y corrección esperada (FR-016).

## 6. Convención de comentarios (requisito del dueño del proyecto)

Los comentarios existen para **encontrar y entender procesos en el futuro**:

1. **TSDoc obligatorio** en: casos de uso, puertos, servicios de dominio, controladores,
   adaptadores y esquemas Zod. Estructura: qué hace, por qué existe / decisión que lo
   respalda, y **qué requisito implementa (`FR-###` de la spec)**.
2. **Encabezado de archivo** en piezas transversales (main, guards, pipes, filtros,
   configs) explicando su rol en el sistema — ver `backend/src/main.ts` como ejemplar.
3. Comentarios de línea solo para el **porqué** no evidente (decisiones, invariantes,
   referencias a research R#), nunca para narrar el qué (`// suma 1 a i` prohibido).
4. Los `FR-###` en TSDoc son buscables: `grep -r "FR-028" backend/src` responde "¿dónde se
   implementa la validación de disponibilidad?" en un segundo.

## 7. Reglas del frontend

- El frontend es presentación: **cero reglas de negocio**. Si dudas dónde va una regla,
  va en el backend.
- Todas las llamadas HTTP pasan por `frontend/src/lib/api/cliente.ts` (nunca `fetch`
  directo) — manejo uniforme de errores del contrato y de sesión expirada.
- Formularios: react-hook-form + esquema Zod de `@trazo/compartido` (el mismo del
  backend). Los errores de campo de la API (`campos`) se pintan junto al campo.
- **Sistema de diseño**: [Nocturne](../docs/diseno-nocturne.md) — decisión del dueño del
  proyecto (2026-08-10), reemplaza el plan original de shadcn/ui. Los componentes visuales
  (botones, campos, tarjetas, tablas, tags, diálogos) usan SIEMPRE las clases de Nocturne
  vendidas en `frontend/src/app/globals.css` (`.btn`, `.field`/`.input`, `.card`, `.table`,
  `.tag`, `.dialog`) y sus tokens (`var(--color-*)`, `var(--space-*)`, `var(--radius-*)`) —
  nunca hex/px sueltos ni clases paralelas propias. Tailwind sigue disponible solo para
  utilidades de layout (flex/grid/spacing). `Trazo Inventarios.dc.html` (proyecto de
  diseño enlazado en diseno-nocturne.md) es la referencia visual de cada pantalla.
  Iconos: `@phosphor-icons/react` (ver tabla de mapeo en diseno-nocturne.md).
- Componentes reutilizables en `frontend/src/componentes/`; páginas solo componen, no
  contienen lógica de datos compleja.
- Listados: paginación server-side (parámetros del contrato), estados de carga y vacíos
  en español.
- Ocultar una opción del menú NO es seguridad (FR-003): la autoridad es siempre el guard
  del backend.

## 8. Pruebas por capa (puertas de calidad de la constitución)

| Nivel | Dónde | Qué prueba | Herramienta |
|---|---|---|---|
| Unitarias | `backend/test/unit` | Dominio y casos de uso con puertos en memoria: estados, totales, disponibilidad | Jest |
| Integración | `backend/test/integracion` | API + PostgreSQL REAL: carrera de stock, UNIQUEs concurrentes, trigger de inmutabilidad, guards | Jest + Supertest |
| E2E | `tests/e2e` | Flujos completos con backend+frontend: ciclo núcleo del MVP, matriz de roles | Playwright |

Innegociables (constitución): rechazo de salida sin stock, rechazo de salida sin
cliente/proyecto, unicidad de factura y guards — sus pruebas van en verde ANTES de cerrar
la historia correspondiente.

## 9. Checklist de revisión (antes de dar por terminada una tarea)

- [ ] `npm run verificar` en verde (lint de fronteras + typecheck + unitarias).
- [ ] Regla de dependencia intacta (ninguna importación prohibida).
- [ ] TSDoc con `FR-###` en todo caso de uso/puerto/controlador nuevo.
- [ ] Errores al usuario en español con campo señalado.
- [ ] Mutaciones con auditoría (usuario/fecha) pobladas.
- [ ] Si toca stock: dentro de `UnidadDeTrabajo`, jamás fuera de transacción.
- [ ] La tarea correspondiente de `tasks.md` marcada como completada.
