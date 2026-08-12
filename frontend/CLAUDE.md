# CLAUDE.md — Agente de FRONTEND (Next.js)

Lee primero el `CLAUDE.md` de la raíz. Este workspace es **solo presentación**: si estás
escribiendo una regla de negocio aquí, pertenece al backend — detente y revisa
`docs/arquitectura.md` §7.

## Fuentes de verdad

- Rutas, acceso por rol y comportamiento transversal:
  `specs/001-gestion-inventarios/contracts/rutas-frontend.md`
- API disponible (endpoints, query params, formas de respuesta/error):
  `specs/001-gestion-inventarios/contracts/api-rest.md`
- Validación de formularios: esquemas de `@trazo/compartido` (los MISMOS del backend)
- **Diseño visual de cada pantalla**: [docs/diseno-nocturne.md](../docs/diseno-nocturne.md)
  — el mockup `Trazo Inventarios.dc.html` (proyecto de diseño enlazado ahí) es la
  referencia autoritativa; antes de construir una vista nueva, léela ahí.

## Reglas duras de este workspace

- **HTTP solo vía `src/lib/api/cliente.ts`** (`api<T>()`): nunca `fetch` directo. Las
  rutas son relativas (`/api/...`) — Next las proxya al backend (next.config.ts); no
  hardcodees `localhost:4000` en componentes.
- **Formularios**: react-hook-form + `zodResolver` con el esquema compartido. Los errores
  de campo que devuelve la API (`campos`) se pintan junto al campo correspondiente; el
  `mensaje` general se muestra en un `<div role="alert">` dentro de la propia tarjeta del
  formulario (patrón establecido desde login/cambiar-password, tandas Foundational/US1) —
  NO hay sistema de toasts en el proyecto; si se necesita uno en el futuro, se decide y
  documenta explícitamente aquí antes de usarlo, no se asume. Todo en español.
- **Sesión**: la cookie es httpOnly — el frontend NO lee tokens. El estado de sesión sale
  de `GET /api/auth/perfil`. Ante `401`: aviso en español + redirección a `/login` (sin
  perder silenciosamente lo capturado).
- **Permisos** (desde US9/T108): todo lo que se muestra u oculta se decide por PERMISO, nunca
  por nombre de rol — un rol propio creado por el Administrador no tiene nombre conocido de
  antemano. Las claves viven en `src/lib/permisos.ts` (nunca literales sueltos); en Server
  Components se pregunta con `tienePermiso(perfil?.permisos, PERMISOS.X)` y en Client
  Components con `usePuede(PERMISOS.X)` de `src/lib/sesion.tsx`. Recuerda: eso es UX, la
  seguridad real son los guards del backend. No dupliques lógica de permisos compleja.
- **Páginas restringidas**: resuelve el permiso ANTES de llamar al endpoint restringido y
  muestra un `<div role="alert">` si falta (patrón de `app/(app)/usuarios/page.tsx` y
  `app/(app)/roles/page.tsx`); así quien entre por URL directa ve un mensaje en español en vez
  de la pantalla de error genérica de Next.
- **Listados**: paginación server-side con los parámetros del contrato
  (`pagina`/`porPagina`), estado vacío y estado de carga en español, siempre.
- **Dinero y fechas**: helpers de formato (COP `es-CO`, zona `America/Bogota`) en
  `src/lib/` — no formatees a mano en cada componente.
- **Sistema de diseño**: Nocturne (reemplaza shadcn/ui — docs/diseno-nocturne.md). Usa
  SIEMPRE sus clases (`.btn`, `.field`/`.input`, `.card`, `.table`, `.tag`, `.dialog`) y
  tokens (`var(--color-*)`, `var(--space-*)`, `var(--radius-*)`) — nunca hex/px sueltos ni
  clases paralelas propias. Tailwind solo para layout (flex/grid/spacing). Iconos:
  `@phosphor-icons/react` (ver tabla de mapeo en diseno-nocturne.md). Componentes de
  módulo en `src/componentes/<modulo>/`; las páginas (`src/app/`) solo componen.
- **Impresión de reportes** (FR-043): usa la clase `no-imprimir` de `globals.css` para
  ocultar controles en la vista impresa.

## Al terminar cada tarea

`npm run lint -w frontend && npm run typecheck -w frontend` en verde (o el atajo
`npm run verificar` de la raíz) → marcar el checkbox en `specs/.../tasks.md`.
