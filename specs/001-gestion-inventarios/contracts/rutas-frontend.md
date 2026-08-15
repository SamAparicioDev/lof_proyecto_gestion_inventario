# Contracts — Rutas del frontend (Next.js) y acceso por rol

**Fase 1** | [plan.md](../plan.md) | API: [api-rest.md](./api-rest.md)

El frontend es exclusivamente presentación: consume la API REST vía el proxy `/api/*` →
backend (research R14) y NUNCA contiene reglas de negocio. La tabla es el contrato de
autorización visual; la autoridad real son los guards del backend (FR-003) — ocultar menús
no es control de acceso.

## Comportamiento transversal

- `middleware.ts` del frontend: sin cookie de sesión → redirect a `/login`; con
  `debeCambiarPassword` (vía `GET /api/auth/perfil`) → redirect forzado a
  `/cambiar-password` antes de cualquier otra ruta (FR-001/FR-004).
- Toda respuesta `401` del backend → redirección a `/login` (sesión expirada) con aviso en
  español y sin pérdida silenciosa de lo capturado (edge case de spec.md).
- Toda respuesta de error de la API (`{ error: { mensaje, campos } }`) se muestra en
  español: errores de campo junto al campo, errores generales en un `<div role="alert">`
  inline dentro de la propia tarjeta del formulario (NO existe sistema de toasts en el
  proyecto — corregido 2026-08-10, ver `frontend/CLAUDE.md`; esta línea decía "toast" por
  error en la versión original de este contrato).
- Listados: paginación server-side (parámetros `pagina`/`porPagina` de la API), estados
  vacíos y de carga en español.
- **Filtros de listado (US13, FR-075…FR-079)**: los 5 listados (inventario, ingresos, salidas,
  clientes, usuarios) comparten UNA sola pieza, `componentes/comunes/barra-filtros.tsx`
  (`BarraFiltros`/`CampoFiltro`/`OpcionFiltro`, T110) — nunca una barra propia por pantalla. En
  US13 esa pieza gana un `pie` opcional donde se pinta `ResumenFiltros`
  (`componentes/comunes/resumen-filtros.tsx`): las etiquetas de los filtros ACTIVOS con su valor
  legible y un único "Limpiar filtros" que navega a la ruta sin query. Se renderiza solo cuando
  hay al menos un filtro activo (FR-078). El estado vacío de la tabla distingue "aún no hay
  registros" de "no hay resultados con los filtros aplicados" (FR-079, helper `lib/filtros.ts`).
  El filtro sigue siendo un `<form method="GET">` nativo: el estado vive en la URL, así que un
  listado filtrado se comparte, se marca y se recarga sin perder nada — y el enlace de exportar
  (US11) hereda los mismos filtros por construcción.
- **Fechas: `dd/mm/aaaa` SIEMPRE, en pantalla y al escribirlas** (FR-047).
  - Al MOSTRAR: `formatoFecha` / `formatoFechaHora` de `lib/formato.ts` — nunca la cadena que
    llega de la API. Para el valor de un filtro que viene de la query string está
    `formatoFechaFiltro`, que además trata el filtro ausente como "sin aplicar" (los chips de
    `ResumenFiltros` mostraban `Desde: 2026-07-01` en crudo hasta que se añadió).
  - Al CAPTURAR: `componentes/comunes/campo-fecha.tsx` (`CampoFecha`). **Prohibido
    `<input type="date">` suelto**: el navegador lo pinta según SU idioma y no según el `lang`
    del documento —comprobado en Chromium, ni el `lang` del propio campo lo cambia—, así que con
    el navegador en inglés el 12/08/2026 se muestra `08/12/2026`, que aquí se lee 8 de
    diciembre. En un sistema cuya trazabilidad se apoya en fechas, eso no es un detalle
    estético. `CampoFecha` muestra y acepta `dd/mm/aaaa`, conserva el calendario nativo en un
    botón y sigue enviando el ISO `aaaa-mm-dd` que exige este contrato, de modo que ni los
    esquemas Zod compartidos ni la API cambian.

## Mapa de rutas UI (contrato de acceso por rol)

| Ruta | A | G | O | Contenido |
|---|:-:|:-:|:-:|---|
| `/login` | ✓ | ✓ | ✓ | Formulario de inicio de sesión (público) |
| `/cambiar-password` | ✓ | ✓ | ✓ | Cambio de contraseña obligatorio/voluntario |
| `/mi-perfil` | ✓ | ✓ | ✓ | Datos personales propios: editar nombre y correo, con usuario y rol en solo lectura, y acceso al cambio de contraseña (US14). Accesible desde el bloque de usuario de la barra lateral; NO exige permiso —son los datos de uno mismo, no la administración de otros— |
| `/` (inicio) | ✓ | ✓ | ✓ | **Panel de control** (US10, FR-060…FR-063): cifras de inventario, pendientes por atender, consumo del mes y actividad reciente, cada tarjeta enlazando a su listado ya filtrado. Hasta US10 esta ruta solo redirigía a `/inventario`, lo que dejaba el ítem "Panel" del menú apuntando al mismo destino que "Inventario" |
| `/ingresos`, `/ingresos/nuevo`, `/ingresos/[id]` | ✓ | ✓ | ✓ | Historial, alta y detalle/edición de ingresos. **US11 (T122)**: "Exportar Excel/PDF" en el encabezado del listado (con los filtros vigentes; el archivo trae TODAS las filas del filtro, no la página — FR-064) y en la ficha de cada ingreso (documento completo con cabecera, líneas, totales y auditoría — FR-065). Como todo exportable, los archivos llevan el logotipo de LOF (FR-067) |
| `/inventario`, `/inventario/[id]` | ✓ | ✓ | ✓ | Stock con alertas; detalle de producto + historial. **Es también la pantalla de administración del catálogo** (T111, FR-010…FR-012): "Nuevo producto" en el encabezado (diálogo `.dialog`, visible a los tres roles porque `POST /api/productos` es A,G,O), columna de estado ACTIVO/INACTIVO, y acciones de editar (diálogo) y activar/desactivar por fila y en la ficha — estas dos solo para A,G, igual que sus endpoints. Nunca hay borrado físico (FR-012). **US12 (T128)**: el diálogo de edición suma el campo **Costo unitario** (FR-071, precargado con el vigente; cambiarlo queda registrado, reenviarlo igual no) y la ficha suma la sección **"Historial de costos"** bajo el historial de movimientos — dos tablas separadas a propósito, porque un cambio de costo no es un movimiento (FR-073). Esa sección exige `inventario.ver_costos` (A,G): un Operario ve la ficha completa SIN ella, nunca un error |
| `/salidas`, `/salidas/nueva`, `/salidas/[id]` | ✓ | ✓ | ✓ | Listado, alta (combobox cliente→proyecto activo) y detalle. **US11 (T122)**: "Exportar Excel/PDF" en el encabezado del listado y en la ficha de cada salida. Ambos llevan el logotipo de LOF, igual que cualquier otro exportable (FR-067); el de la ficha es el archivo pensado para enviarle al cliente como soporte de entrega |
| `/clientes`, `/clientes/nuevo`, `/clientes/[id]` | ✓ | ✓ | lectura | Clientes con sus proyectos e historial de salidas. La tarjeta "Logo del cliente" que US11 añadió aquí se RETIRÓ el 2026-08-15: los exportables los firma LOF, no su destinatario (FR-066) |
| `/reportes/consumo-cliente` | ✓ | ✓ | ✗ | Reporte con filtros, export PDF/Excel, imprimir |
| `/reportes/consumo-proyecto` | ✓ | ✓ | ✗ | Ídem + margen vs presupuesto + gráfico |
| `/reportes/inventario` | ✓ | ✓ | ✗ | Inventario actual + valor total + bajo umbral |
| `/reportes/movimientos` | ✓ | ✓ | ✗ | Auditoría de movimientos con filtros |
| `/usuarios` | ✓ | ✗ | ✗ | Gestión de usuarios (FR-005/FR-006) — alta, edición, restablecer contraseña y activar/desactivar con diálogos `.dialog` (Nocturne) sobre el propio listado, no páginas separadas (corregido 2026-08-11, T077: esta fila decía `/usuarios/nuevo`, `/usuarios/[id]` por copiar el patrón de clientes; `Trazo Inventarios.dc.html` resuelve la pantalla de usuarios con diálogos, ver docs/diseno-nocturne.md) |
| `/inventario/importar` | ✓ | ✓ | ✗ | Carga masiva desde Excel: descargar plantilla vacía, descargar catálogo actual para actualización masiva (FR-053), subir archivo, resumen de creados/actualizados/errores por fila (US8) |
| `/roles` | ✓ | ✗ | ✗ | Gestión de roles y su matriz de permisos (US9, FR-055) — el catálogo de permisos se muestra agrupado por módulo, solo lectura (FR-056) |
| `/ordenes-compra` | ✓ | ✓ | ✓ | Listado de órdenes de compra (US16, FR-094…FR-097) con filtros de proveedor, estado y rango de fechas, y export del listado. Exige `ordenes_compra.ver`; los botones Enviar y Anular solo aparecen con `ordenes_compra.enviar`/`.anular` (FR-100) |
| `/ordenes-compra/nueva` | ✓ | ✓ | ✓ | Alta de orden: se elige el proveedor y la pantalla ofrece **los productos bajo umbral que ese proveedor ya ha suministrado**, con cantidad sugerida y un botón para agregarlos todos (FR-098). Las líneas se editan como en un ingreso. Exige `ordenes_compra.crear` |
| `/ordenes-compra/[id]` | ✓ | ✓ | ✓ | Detalle de la orden. En BORRADOR se edita en la misma pantalla (mismo patrón que `/ingresos/[id]`); en cualquier otro estado es solo lectura. Siempre ofrece exportar el documento en PDF/Excel (FR-097) y, si está ENVIADA, **"Registrar ingreso"**, que lleva a `/ingresos/nuevo?ordenCompraId=N` con proveedor y líneas precargados (FR-099) |
| `/administracion` | ✓ | ✓ | ✗ | **Módulo de catálogos del sistema** (US15). No tiene contenido propio: redirige a la primera sección que la sesión pueda abrir — con roles a medida no se puede asumir que quien entra tenga permiso sobre la primera (misma lección que el `/` de US9/T108). Aquí se agrupan los CRUD de los datos de apoyo que el negocio parametriza, para que la barra lateral no crezca con una entrada por catálogo |
| `/administracion/categorias` | ✓ | ✓ | ✗ | Catálogo de categorías de producto (US15, FR-084…FR-087): alta, edición y activar/desactivar con diálogos `.dialog` sobre el propio listado, mismo patrón que `/usuarios`. Exige `categorias.gestionar`; el permiso `categorias.ver` NO abre esta pantalla — sirve para clasificar productos y para el filtro del inventario, y lo tienen los tres roles (FR-088) |
| `/administracion/proveedores` | ✓ | ✓ | ✗ | Catálogo de proveedores (US15, FR-091…FR-093), mismo patrón. Exige `proveedores.gestionar` |

**Nota US9**: a partir de la implementación de roles y permisos, esta tabla deja de ser el
contrato de acceso por ROL fijo y pasa a describir el permiso que exige cada ruta; las
columnas A/G/O de arriba reflejan los permisos que traen los tres roles del sistema en su
semilla (FR-059). Un rol personalizado ve exactamente los módulos cuyos permisos tenga.

**Nota de la revisión adversarial de la Tanda 13 — qué pasa cuando NO tiene el permiso.** Esa
última frase no se cumplía: un rol propio sin `inventario.ver` no podía siquiera usar la
aplicación, porque el login empuja a `/`, `/` redirigía SIEMPRE a `/inventario` y esa pantalla
llamaba a su endpoint sin comprobar el permiso, así que el `403` salía como error no capturado.
Tres reglas quedan fijadas aquí:

1. **`/` reparte hacia el primer módulo que la sesión puede abrir**, en el orden del menú
   lateral (mismo filtro que lo pinta, `frontend/src/lib/navegacion.ts`, para que menú y
   destino no puedan discrepar). Sin ningún módulo concedido, muestra el aviso en español.
2. **Toda pantalla resuelve el permiso de su endpoint principal ANTES de llamarlo** y, si
   falta, muestra un `<div role="alert">` en español (patrón ya establecido por `/usuarios`,
   `/roles` y los 4 reportes; `/inventario` se sumó en esta corrección).
3. **Los recursos AUXILIARES que exigen otro permiso nunca tumban la pantalla**: se piden con
   `apiServidorOpcional` y, ante `403`, la vista se degrada a su texto de respaldo (`—`,
   `Producto N.º 7`, combobox vacío). Aplica a `/api/clientes` en `/salidas`, `/salidas/[id]` y
   los 3 reportes que precargan clientes, y a `/api/productos` en `/ingresos/[id]` y
   `/salidas/[id]` (vistas de SOLO LECTURA que exigían `productos.ver`).

Como red de último recurso —no como sustituto de la regla 2— existe `app/(app)/error.tsx`: antes
no había ninguna frontera de error en toda la app, así que cualquier fallo no capturado se veía
como la pantalla genérica de Next, en inglés y sin navegación.

Exportaciones: los botones "Exportar PDF/Excel" navegan a
`/api/reportes/{tipo}/export?formato=…` con los filtros vigentes de la pantalla (mismo
esquema Zod — SC-007). "Imprimir" usa la vista del reporte con CSS `@media print`.
Los de ingresos y salidas (US11/T122) son `<a href>` directos al endpoint —no `fetch`—, mismo
patrón que los dos botones de descarga de la carga masiva: esas pantallas son Server Components
cuyo filtro ya vive en la URL, y quien las ve tiene por definición el permiso que exige el
export (es el MISMO `ingresos.ver`/`salidas.ver` del listado), así que no hay ningún `403` que
mostrar dentro de la página. Los paneles de reporte sí usan `fetch` porque son Client Components
que deben poder mostrar el error sin perder el reporte ya generado en pantalla.
Carga masiva (US8): los DOS botones de descarga navegan directo a su ruta —"Descargar
plantilla vacía" a `/api/productos/plantilla-importacion` (empezar de cero) y "Descargar
catálogo actual" a `/api/productos/catalogo-importacion` (actualizar lo que ya existe,
FR-053)—, presentados como dos opciones con su propio texto de ayuda para que se vea cuál
sirve para qué; "Subir archivo" hace `POST /api/productos/importar` con
`multipart/form-data` — el MISMO endpoint para los dos archivos, sin variantes— y muestra el
`ResumenImportacion` en pantalla (nunca solo un mensaje genérico de éxito — el usuario
necesita ver qué filas fallaron y por qué, mismo criterio que los errores de campo del resto
de la app).
