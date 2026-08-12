# Sistema de diseño — Nocturne

**Estado**: VINCULANTE para todo el frontend (decisión del dueño del proyecto, 2026-08-10).
Nocturne **reemplaza** el plan original de Tailwind CSS + shadcn/ui como sistema de
componentes visuales. Tailwind sigue disponible únicamente para utilidades de layout
(flex/grid/spacing) — nunca para reinventar un botón, campo, tarjeta, tabla o diálogo que
Nocturne ya define.

**Origen**: proyecto de diseño
[`claude.ai/design/p/8015ddf5-9ef5-48d1-8857-b1eefaedb66b`](https://claude.ai/design/p/8015ddf5-9ef5-48d1-8857-b1eefaedb66b)
("Diseño web solicitado"), archivo `Trazo Inventarios.dc.html` — el mockup completo de la
aplicación (dashboard, inventario, ingresos, salidas, clientes, 4 reportes, usuarios,
login, 5 diálogos) construido sobre el sistema `_ds/nocturne-527f8044-e965-4b00-a4a9-13088fa69164/`.
Ese mockup es la **referencia visual autoritativa** de cada pantalla — antes de construir
una vista nueva, léela ahí (o pídele a alguien con acceso al proyecto que la traiga con la
tool `DesignSync`).

## Qué se trajo al repositorio (vendored)

- `frontend/src/app/globals.css` — tokens (`:root`) y clases de componentes de
  `_ds/nocturne-.../styles.css`, copiados tal cual (sección marcada `VENDORED`). **No
  edites los tokens a mano**: si el tema debe cambiar, se cambia en el proyecto de diseño
  y se vuelve a traer con `DesignSync` — editarlos aquí desincroniza el origen.
- Tipografía: Inter, cargada con `next/font/google` en `frontend/src/app/layout.tsx`
  (autohospedada — evita la llamada de red a Google Fonts del `@import` original) y
  expuesta como `--font-inter`, referenciada por `--font-heading`/`--font-body`.
- Iconos: [Phosphor](https://phosphoricons.com) vía el paquete `@phosphor-icons/react`
  (componentes React, no la fuente-icono por CSS que usa el mockup) — más idiomático en
  Next.js, sin dependencia de un CDN en runtime. Traducción: `<i class="ph ph-xxx">` del
  mockup → `<Xxx />` de `@phosphor-icons/react/dist/ssr` (PascalCase, sin el prefijo `ph-`;
  ej. `ph-cube-transparent` → `CubeTransparent`, `ph-arrow-square-in` → `ArrowSquareIn`).

## Excepción documentada: texto de ayuda/error de formularios (12px)

Nocturne define tamaños de fuente fijos para encabezados (h1–h6) y cuerpo de texto (15px
base), pero **no** define un token para texto auxiliar más pequeño (mensajes de error bajo
un campo, texto de ayuda). El mockup mismo usa `font-size:12px`/`13px` sueltos en esos
casos (ver `Trazo Inventarios.dc.html`), así que el código del proyecto hace lo mismo —
`style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 5 }}` en los mensajes
de error de campo (`formulario-login.tsx`, `formulario-cambiar-password.tsx`,
`ingreso-form.tsx` y similares). Esto es una excepción intencional a la regla "nunca un px
suelto" (hallazgo de revisión adversarial, 2026-08-10) — no la repliques para tamaños que
SÍ tienen tokens (espaciado: usa `var(--space-*)`; colores: usa `var(--color-*)`).

## Excepción documentada: etiquetas pequeñas en mayúscula (11px) y valores de layout puntuales

Dos casos más, ambos señalados por revisión adversarial (tanda US5, 2026-08-10) y
confirmados como un patrón YA consistente en todo el proyecto (ingresos, salidas,
clientes, inventario), no una regresión de una tanda en particular:

1. **Etiquetas pequeñas en mayúscula** (`<dt>` de una lista de definición, ej.
   `CifraInventario`/`DatoSoloLectura` en `componentes/inventario/panel-producto.tsx`):
   `fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em'` con color
   `.text-muted`. Nocturne define este MISMO patrón visual dentro de `.table th`
   (font-size 11, letter-spacing 0.08em, mayúscula, color atenuado) pero no como clase
   reutilizable fuera de una tabla, y `.card-kicker` es el candidato más cercano pero
   fuerza color de acento (semánticamente distinto: un kicker es un rótulo de sección
   destacado, no una etiqueta de dato secundaria). Hasta que el sistema de diseño defina
   una clase para esto, sigue usando estos valores literales — no inventes un tercer
   valor de letter-spacing/font-size para el mismo propósito.
2. **Valores de layout puntuales sin token** (`minWidth` de un campo de filtro,
   `padding`/`textAlign` de un estado vacío en una tabla — ej. `app/(app)/inventario/page.tsx`,
   y el mismo patrón ya en `ingresos/page.tsx`/`salidas/page.tsx`/`clientes/page.tsx`):
   son decisiones de layout, no de sistema de diseño — `docs/arquitectura.md` §7 ya
   autoriza Tailwind para esto. Prefiere una clase de utilidad de Tailwind
   (`min-w-[240px]`, `py-6 text-center`) sobre un objeto `style` inline cuando el valor no
   varía dinámicamente; cuando SÍ existe ya como `style` inline en un archivo que no estás
   tocando, no es necesario migrarlo solo por consistencia — hazlo si de todas formas vas
   a editar ese bloque.

## ⚠️ Regla de cascada: NUNCA mezcles una clase de Nocturne con una utilidad de Tailwind sobre la MISMA propiedad CSS en el MISMO elemento

**Esta es la regla más importante de este documento.** Se descubrió en producción (T110,
2026-08-11) después de que el dueño del proyecto mandara una captura de la barra de filtros de
`/inventario` con los campos apilados en vertical y pegados a la derecha.

### Por qué pasa

Tailwind v4 declara `@layer theme, base, components, utilities;` y mete **todas** sus
utilidades en `@layer utilities`. El CSS vendido de Nocturne en `globals.css` está **sin
capa**. En la cascada de CSS, **lo que está sin capa gana SIEMPRE sobre lo que está dentro de
una capa** — sin importar especificidad, orden de declaración ni orden de las clases en el
`className`. No es un bug de Tailwind ni de Nocturne: es cómo funciona `@layer`.

Consecuencia práctica: **cada propiedad que declara una clase de Nocturne es intocable desde
Tailwind en ese mismo elemento**. La utilidad se escribe, se compila… y no hace nada.

### El bug real que originó la regla

```tsx
// ❌ INCORRECTO — así estaban las 10 barras de filtro del proyecto
<form className="card flex flex-wrap items-end gap-3 p-4">…</form>
```

`.card` declara `display:flex; flex-direction:column; gap:var(--space-2); padding:var(--space-3)`.
Medido en el navegador sobre ese `<form>`:

| Propiedad | Valor calculado | Quién ganó |
|---|---|---|
| `flex-direction` | `column` | **Nocturne** (`.card`) — `flex`/`flex-row` no podían competir |
| `align-items` | `flex-end` | Tailwind (`items-end`) — `.card` no la declara, no hay conflicto |
| `gap` | `5.6px` | **Nocturne** — `gap-3` (12px) ignorado |
| `padding` | `8.4px` | **Nocturne** — `p-4` (16px) ignorado |

Resultado: columna vertical alineada a la derecha (`column` + `flex-end`), en **todos** los
anchos. Y lo peor: agregar `flex-row` tampoco lo arregla, porque seguiría perdiendo.

### La solución: separar CONTENEDOR de LAYOUT

```tsx
// ✅ CORRECTO — el contenedor es Nocturne, el layout va en un elemento interno distinto
<div className="card">
  <form className="flex flex-wrap items-end gap-[var(--space-4)]">…</form>
</div>
```

En el elemento interno no hay ninguna clase de Nocturne, así que las utilidades de Tailwind
aplican sin competencia. Es el patrón que implementa
[`frontend/src/componentes/comunes/barra-filtros.tsx`](../frontend/src/componentes/comunes/barra-filtros.tsx)
(`BarraFiltros`/`CampoFiltro`/`OpcionFiltro`, usado por los 7 listados, la importación y los 4
reportes) — **úsalo en vez de rearmar una barra de filtros a mano**.

Fíjate además en que el ancho de las utilidades usa tokens (`gap-[var(--space-4)]`): valor de
layout expresado con la escala del sistema, no un `gap-3` arbitrario.

### Lo que NO debes hacer

- **`!important`**: trata el síntoma, escala a una guerra de especificidad y el siguiente
  agente copia el patrón. Prohibido para resolver este conflicto.
- **Añadir la utilidad "contraria"** (`flex-row` frente a `flex-direction:column`): pierde
  igual. Si la propiedad la declara Nocturne, ninguna utilidad la gana.
- **Reescribir la clase de Nocturne en `globals.css`**: desincroniza el bloque VENDORED de su
  origen (ver cabecera del archivo).

### Escape hatch (solo si la propiedad DEBE ir en ese mismo elemento)

Cuando no hay un elemento interno ni externo al que mover el layout —por ejemplo un `<button>`
que necesita `justify-content` propio— usa un **`style` inline**, que sí gana sobre el CSS sin
capa, y **comenta por qué**. Dos casos reales en el proyecto:

1. `componentes/layout/boton-cerrar-sesion.tsx`, donde `.btn` fuerza
   `justify-content:center` y la utilidad `justify-start` no hacía nada (el botón del sidebar
   salía centrado mientras los enlaces de navegación de arriba van a la izquierda).
2. `componentes/roles/rol-form.tsx` (T107), donde `.dialog` fija `width: min(440px, 100%)` y el
   diálogo tiene que ser más ancho: su matriz son 30 casillas en 9 módulos y a 440px cada
   descripción se parte en tres líneas. Va como
   `style={{ width: 'min(720px, 100%)' }}` — misma fórmula que Nocturne, otro tope — y **solo
   el ancho**: el alto no necesita nada porque `globals.css` ya le da a `.dialog` un
   `max-height` de viewport con scroll propio.

### Cómo detectarlo antes de que lo vea el usuario

1. Antes de combinar clases, mira qué declara la clase de Nocturne en la sección VENDORED de
   `frontend/src/app/globals.css`. Las que más colisionan:

   | Clase | Propiedades que reclama (no las toques con Tailwind) |
   |---|---|
   | `.card` | `display`, `flex-direction`, `gap`, `padding`, `border-radius`, `background` |
   | `.card-meta` | `display`, `align-items`, `gap`, `font-size`, `color` |
   | `.btn` | `display`, `align-items`, `justify-content`, `gap`, `padding`, `border`, `font-*` |
   | `.tag` | `display`, `align-items`, `font-size`, `padding`, `border-radius` |
   | `.dialog` | `display`, `flex-direction`, `gap`, `padding`, `width` |
   | `.dialog-actions` | `display`, `justify-content`, `gap` |
   | `.seg` | `display`, `overflow`, `border`, `border-radius` |
   | `.seg-opt` | `display`, `align-items`, `gap`, `padding`, `font-size` |
   | `.input` | `width`, `min-height`, `padding`, `font-size`, `border` |

2. Verifica **en el navegador**, no solo que compile: `getComputedStyle(el).flexDirection` (o
   la propiedad que sea) es la única prueba real. Un `className` que "se ve bien en el código"
   puede estar renderizando otra cosa.

### Casos ya corregidos (2026-08-11, T110)

- Las 10 barras de filtro (`inventario`, `ingresos`, `salidas`, `clientes`, `usuarios`, los 4
  reportes y la importación) → `BarraFiltros`.
- `app/(app)/inventario/importar/page.tsx`: la tarjeta de "Descargar plantilla" tenía
  `card … justify-between` y el botón salía centrado debajo del párrafo en vez de a su derecha.
- `componentes/clientes/proyectos-cliente.tsx`: `card-meta … items-start` → las líneas
  "Responsable"/"Presupuesto" salían **centradas** en vez de alineadas con el título de la
  tarjeta (`.card-meta` declara `align-items:center`).
- `componentes/layout/boton-cerrar-sesion.tsx`: `btn … justify-start` no aplicaba (escape hatch
  con `style` inline, ver arriba).
- `componentes/inventario/alerta-stock-bajo.tsx`: `tag … flex items-center` eran clases muertas
  (`.tag` ya da `inline-flex` + `align-items:center`); se veía bien, se limpiaron para no
  sugerir que hacían algo.
- `componentes/layout/boton-cerrar-sesion.tsx` (segundo hallazgo en el MISMO archivo, encontrado
  en la verificación independiente de la Tanda 12 barriendo el DOM de las 10 pantallas): además
  del `justify-start` ya corregido arriba, el botón conservaba `text-[13px]`, también muerta
  —`.btn` declara `font-size:14px`, medido `getComputedStyle(...).fontSize === '14px'`—. Se quitó
  (cero cambio visual). Moraleja: al aplicar esta regla revisa TODAS las utilidades del elemento,
  no solo la que causó el síntoma visible.

Queda **anotado y sin cambiar** (se ve correcto hoy, es solo espaciado y toda la app es
consistente en ello): las utilidades `p-*`/`gap-*` sobre `.card` en el resto del proyecto
(`card gap-4 p-5`, `card p-0`, `card elev-md gap-3.5 p-[22px]`…) tampoco aplican — todas esas
tarjetas rinden con el `padding: var(--space-3)` y `gap: var(--space-2)` propios de Nocturne.
Si alguna vez una tarjeta necesita de verdad otro relleno, la solución es la misma de arriba
(un elemento interno), no pelear la cascada.

## Cómo usarlo (resumen de la guía original — ver el `readme.md` del proyecto de diseño para el detalle completo)

- Todo color, tipografía, espaciado, radio y sombra sale de las variables
  (`var(--color-*)`, `var(--font-*)`, `var(--space-*)`, `var(--radius-*)`,
  `var(--shadow-*)`). Nunca un hex, un nombre de fuente o un px sueltos.
- Construye con las clases de abajo, no inventes paralelas. `Trazo Inventarios.dc.html`
  (el mockup completo) es el ejemplo vivo de cómo se combinan.
- Fondo oscuro (`--color-bg` `#161826`), texto `--color-text` `#e9e9ed`, un único acento
  `--color-accent` `#9184d9` (esquema mono: no hay un segundo acento real). Cada rol tiene
  una rampa tonal 100–900; en este fondo oscuro usa los pasos 700–900 para rellenos/bordes
  sutiles, 500 como base del rol, 100–300 para texto sobre esos rellenos y estados
  presionados.
- Botones **con borde**, nunca rellenos sólidos (`.btn-primary` = borde de acento sobre
  transparente). Densidad compacta (0.70×) y radio de 8px ya están en las variables.
- Todo elemento interactivo tiene su propio `:hover` y estado presionado desde la rampa de
  acento; el foco de teclado es siempre `:focus-visible { outline: 2px solid
  var(--color-accent); outline-offset: 2px; }` — nunca el anillo azul por defecto.

## Clases de componentes

| Clase | Qué es | Dónde se usa en Trazo |
|---|---|---|
| `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-icon` / `.btn-block` | Acciones — la primaria es un borde de acento, nunca un relleno | Botones de guardar/crear/autorizar en toda la app |
| `.tag` + `.tag-accent` / `.tag-accent-2` / `.tag-neutral` / `.tag-outline` | Etiquetas pequeñas con tinte de las rampas | Estados (Activo/Pendiente/Confirmada…), stock bajo, rol de usuario |
| `.field` + `label`, `.input`, `.radio` + `.dot`, `.seg` + `.seg-opt` | Campos y elecciones de formulario sobre elementos nativos | Login, cambiar contraseña, y todos los formularios de US1–US7 |
| `.card` + `.card-kicker` / `.card-title` / `.card-body` / `.card-meta`; `.elev-sm/md/lg` | Tarjetas de contenido con relleno de superficie | KPIs del panel, tarjetas de cliente/proyecto, contenedor de tablas |
| `.nav` + `.nav-brand` | Patrón de barra (no usado en Trazo: la app usa un sidebar, ver `(app)/layout.tsx`) | — |
| `.table` | Tablas de datos con encabezado y reglas de fila con degradado | Inventario, ingresos, salidas, reportes, usuarios |
| `.dialog-backdrop` + `.dialog` (+ `.dialog-title/-body/-actions`) | Modal a la elevación más alta | Nueva salida/ingreso/cliente/proyecto/usuario (diálogos del mockup) |
| `.hr` | Regla horizontal — el sistema prefiere espacio en blanco; evítala | — |
| `.lighten` | Wrapper de imagen (`mix-blend-mode: lighten`) | Sin uso previsto en Trazo (no hay fotografías) |

## Iconos usados en la navegación (referencia para tandas futuras)

De `Trazo Inventarios.dc.html`, mapeados a nuestras rutas reales
(`frontend/src/lib/navegacion.ts`):

| Vista | Icono Phosphor (web) | Componente React |
|---|---|---|
| Panel (`/`) | `ph-gauge` | `Gauge` |
| Ingresos | `ph-arrow-square-in` | `ArrowSquareIn` |
| Inventario | `ph-package` | `Package` |
| Salidas | `ph-arrow-square-out` | `ArrowSquareOut` |
| Clientes y proyectos | `ph-users-three` | `UsersThree` |
| Reportes (un solo enlace; la página resuelve 4 sub-reportes con `.seg`/pestañas internas — ver `reportTabs` en el mockup) | `ph-chart-bar` | `ChartBar` |
| Usuarios | `ph-user-gear` | `UserGear` |
| Marca (logo) | `ph-cube-transparent` | `CubeTransparent` |
| Cerrar sesión | `ph-sign-out` | `SignOut` |

## Alcance implementado hasta ahora

El "shell" de la tanda Foundational (auth/roles/sesiones): login (`app/(auth)/login`), cambio
de contraseña (`app/(app)/cambiar-password`) y el layout autenticado con
sidebar/navegación/usuario (`app/(app)/layout.tsx`); y las vistas de negocio de US1–US9
(inventario, ingresos, salidas, clientes, los 4 reportes, usuarios, roles y sus diálogos).

**Dashboard con KPIs (US10/T116)**: `/` dejó de ser un aterrizaje mínimo y es el panel de
control real (`app/(app)/page.tsx` + `componentes/panel/`), con las tarjetas de cifras del
mockup enlazadas cada una a su listado ya filtrado. Dos piezas nuevas que conviene conocer
antes de construir otra pantalla parecida: `componentes/panel/tarjeta-cifra.tsx` (una `.card`
que ES un enlace) y la clase `.card-enlace` de `globals.css` —fuera del bloque VENDORED— que
le agrega el `:hover`/`:active` que `.card` no traía, porque hasta esa pantalla ninguna
tarjeta de Nocturne era interactiva.

Las vistas del mockup se implementan siempre conectadas a datos reales del backend desde el
principio (el frontend nunca inventa datos, docs/arquitectura.md §7); el mockup usa datos
ficticios en memoria solo para la demostración visual, no los repliques como comportamiento
real.
