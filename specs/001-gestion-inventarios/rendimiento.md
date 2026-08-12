# Revisión de rendimiento con volumen de prueba (T086)

**Fecha**: 2026-08-11
**Alcance**: [tasks.md § Phase 11](./tasks.md), T086 — generar volumen de prueba, correr
`EXPLAIN ANALYZE` sobre los listados/reportes principales, confirmar los índices de
[data-model.md § Índices](./data-model.md) y la paginación server-side de todos los listados,
y un smoke de concurrencia como evidencia de **SC-008** (20 usuarios concurrentes, listados
`<2s`).

**Ampliación (2026-08-12, T139)**: la sección **(g)** agrega la medición de los filtros de
listado nuevos de US13 (FR-075…FR-077), con el mismo método. Las secciones (a)–(f) son las de
T086 y no se han modificado.

**Cómo leer este documento**: cada sección queda marcada **OK** (verificado, sin hallazgo
bloqueante), **HALLAZGO DE ENTORNO** (algo real encontrado durante la tarea, resuelto dentro
de la propia tarea) u **OBSERVACIÓN** (limitación real pero no bloqueante, documentada para
trabajo futuro — Principio V, no se implementa sin evidencia de necesidad).

---

## Resumen ejecutivo

- Los **9 índices documentados en data-model.md § Índices** están presentes en
  `backend/prisma/schema.prisma` (verificado campo por campo) y el planner de Postgres los usa
  correctamente en el 100% de las consultas donde la selectividad los justifica — confirmado
  con `EXPLAIN (ANALYZE, BUFFERS)` real contra una base con **5.000 productos, 60 clientes, 177
  proyectos, 2.500 ingresos (4.976 líneas), 4.000 salidas (8.014 líneas) y 16.883 movimientos de
  inventario**. No se encontró ningún índice documentado que faltara en el esquema.
- **Todos** los listados paginan server-side (`pagina`/`porPagina`, tope `POR_PAGINA_MAXIMA =
  100`); los 4 reportes son **intencionalmente** sin paginar (FR-043/SC-007: la exportación debe
  reproducir exactamente los totales en pantalla) — confirmado por código y por `EXPLAIN`, y su
  tiempo real incluso sin paginar quedó siempre por debajo de 6 ms con el volumen generado.
- **Smoke de concurrencia** (20 peticiones simultáneas por ronda contra `localhost:4000` real):
  el peor caso observado fue 319 ms (arranque en frío de la primera ronda); las rondas
  siguientes bajaron a menos de 100 ms. Muy por debajo del umbral de 2 s de SC-008.
- Un hallazgo de **entorno** (no de código): `trazo_test` estaba siendo truncada por un proceso
  externo a intervalos muy cortos durante esta sesión — ver sección (b). Se resolvió para esta
  tarea envolviendo la carga + el `EXPLAIN` en una única transacción; no requirió tocar código
  del proyecto.
- No se encontró ningún índice faltante genuino → **no se creó ninguna migración**. Dos
  limitaciones reales pero no bloqueantes quedan documentadas como observaciones para trabajo
  futuro (búsqueda por subcadena sin índice trigram; topes fijos en dos selectores de
  formulario) — ver sección (f).

---

## (a) Generación de datos de volumen

**Estado: OK**

Genera dos requisitos del enunciado de T086: "miles de productos y movimientos" y "usando
factories/scripts, no a mano". Se escribió un script Node (`generar-volumen.js`, fuera del
repositorio — vive en el scratchpad de la sesión, no es una herramienta del producto) que:

1. Se conecta **exclusivamente** a `trazo_test` (verifica `current_database()` antes de tocar
   nada, mismo patrón de defensa que `backend/test/integracion/setup.ts#truncarTablas` — nunca
   se apuntó a `trazo`, la base de desarrollo real).
2. Trunca las tablas de negocio (mismo orden/lista que `setup.ts`) e inserta, con `INSERT ...
   VALUES` en lotes (500–1.000 filas por sentencia, nunca fila por fila):

   | Tabla | Filas generadas |
   |---|---|
   | `usuarios` | 3 (admin/gerente/operario sintéticos) |
   | `clientes` | 60 |
   | `proyectos` | 177 (2–4 por cliente, mezcla ACTIVO/COMPLETADO/SUSPENDIDO) |
   | `productos` | 5.000 (SKU único, descripción variada, categoría/ubicación con nulos realistas) |
   | `ingresos` | 2.500 (mezcla PENDIENTE/RECIBIDO/VERIFICADO/ANULADO) |
   | `detalles_ingresos` | 4.976 |
   | `salidas` | 4.000 (mezcla PENDIENTE/CONFIRMADA/COMPLETADA/ANULADA) |
   | `detalles_salidas` | 8.014 |
   | `movimientos_inventario` | 16.883 (ENTRADA base + ENTRADA de ingresos + SALIDA + AJUSTE_ENTRADA de anulaciones) |

3. Recalcula `productos.stock_actual` desde `movimientos_inventario` (agregado real, no un
   valor inventado) y corre `ANALYZE` sobre las 9 tablas afectadas para que el planner tenga
   estadísticas frescas antes de medir.

**Simplificaciones documentadas** (no afectan la validez de los resultados de `EXPLAIN`, que
miden acceso a datos, no reglas de negocio — esas ya están cubiertas por las suites de
integración T037/T056-058/etc.):

- Cada producto recibe primero un movimiento `ENTRADA` "base" grande (500–5.000 unidades,
  `documento_id=0` sintético — el FK de `movimientos_inventario.documento_id` es lógico, no
  forzado en BD, tal como documenta el TSDoc del modelo) para garantizar que ningún producto
  quede con stock negativo pese al muestreo aleatorio de las salidas; el recalculo final
  confirmó **0 productos con neto negativo** (sin necesidad de recortar/clamped).
- `movimientos_inventario.stock_resultante` de las filas generadas en lote queda en `0`
  (placeholder) en vez de un snapshot real por movimiento — irrelevante para el propósito de
  esta tarea (planes de acceso e índices), y `productos.stock_actual` sí es el valor real
  agregado.
- Los 3 usuarios sintéticos no tienen contraseña utilizable (hash placeholder) — no se
  necesitaba iniciar sesión contra `trazo_test` para esta tarea.

## (b) Hallazgo de entorno: `trazo_test` truncada por un proceso externo concurrente

**Estado: HALLAZGO DE ENTORNO — resuelto dentro de esta tarea, sin tocar código del proyecto**

Al generar el volumen por primera vez (fases secuenciales, sin transacción), la carga se
interrumpió repetidamente a mitad de camino con errores de FK
(`violates foreign key constraint ..._producto_id_fkey`) porque las tablas que acababan de
recibir filas desaparecían mientras el script seguía insertando. Se confirmó con
`pg_stat_activity` que no había ninguna conexión activa en el momento exacto de la revisión,
pero **15 reintentos consecutivos fallaron todos**, cada uno en un punto distinto de la carga —
evidencia de un proceso externo truncando `trazo_test` a intervalos muy cortos (probablemente
la investigación en curso de los 401 intermitentes, corriendo `test:integracion` en loop —
ver nota de la tarea original y `seguridad.md` §(c), del mismo día). No fue posible crear una
base exclusiva alternativa: el rol `trazo` no tiene `CREATEDB` (`rolcreatedb=false`,
confirmado con `pg_roles`), así que no había forma de aislarse en una BD nueva sin escalar
privilegios (fuera de alcance de esta tarea).

**Solución aplicada**: se reescribió el script para que TODO el cuerpo — truncar, insertar,
recalcular, `ANALYZE` y correr la batería completa de `EXPLAIN ANALYZE` — corriera dentro de
**una sola transacción interactiva** (`prisma.$transaction(async (tx) => ..., { timeout:
300000 })`). Un `TRUNCATE` externo concurrente requiere un lock `ACCESS EXCLUSIVE`, que queda
en cola detrás de los locks que ya sostiene la transacción propia hasta que esta confirma — así
que, en vez de intercalarse a mitad de la carga, el proceso externo simplemente espera. Con este
cambio la carga + el `EXPLAIN` completo corrieron de punta a punta en **3.5–3.8 s** sin ningún
error, y los resultados de `EXPLAIN` quedaron confirmados como un snapshot consistente del
volumen generado (verificado inmediatamente después: `trazo_test` ya estaba vacía otra vez, lo
que confirma que el proceso externo sigue activo pero ya no interfiere con la medición).

Esto no es un hallazgo de código del producto — no se tocó ningún archivo del repositorio para
resolverlo — pero se documenta porque cualquier script futuro de mantenimiento/diagnóstico
contra `trazo_test` en un entorno de desarrollo activo debería considerar el mismo patrón
(transacción única) en vez de asumir que la base permanece estable entre pasos.

## (c) Índices — verificación con `EXPLAIN (ANALYZE, BUFFERS)` contra data-model.md § Índices

**Estado: OK** — batería completa en el archivo adjunto de esta tarea (24 consultas,
representativas de cada listado/reporte principal, con los valores reales usados sustituidos).
Resumen por grupo:

| # | Consulta (caso de uso real) | Plan elegido | Índice usado | Tiempo real |
|---|---|---|---|---|
| A1 | Inventario, paginado sin filtro (`OFFSET 4000 LIMIT 20`) | Seq Scan + Sort | — (ver nota 1) | 2.1 ms |
| A2 | Inventario, `COUNT` sin filtro | Seq Scan | — (agregado total, no hay filtro que indexar) | 0.7 ms |
| A3 | Inventario, búsqueda `sku`/`descripcion` contains + `LIMIT 20` | Index Scan | `productos_pkey` (ver nota 2) | 0.2 ms |
| A4 | Inventario, `COUNT` de la misma búsqueda (sin `LIMIT`) | **Seq Scan** | — (ver nota 2) | 7.7 ms |
| A5 | `comprometidoPorProducto` (página de 20 ids, `estado=PENDIENTE`) | Bitmap Index Scan × 2 | `salidas_estado_idx` + `detalles_salidas_producto_id_idx` | 0.7 ms |
| A6 | `comprometidoPorProducto` sin filtro de ids (stock bajo, todo el catálogo) | Bitmap Heap Scan + Seq Scan | `salidas_estado_idx` (detalles_salidas sin filtro propio → seq scan correcto) | 3.1 ms |
| B1 | Historial de producto, paginado | Bitmap Index Scan | `movimientos_inventario_producto_id_fecha_hora_idx` | 0.05 ms |
| B2 | Historial de producto, `COUNT` | Bitmap Index Scan | `movimientos_inventario_producto_id_fecha_hora_idx` | 0.04 ms |
| B3 | Historial de producto, con rango de fechas | Bitmap Index Scan | `movimientos_inventario_producto_id_fecha_hora_idx` | 0.06 ms |
| D1 | Salidas, filtro proyecto+estado | Bitmap Index Scan | `salidas_proyecto_id_estado_idx` | 0.08 ms |
| D2 | Salidas, filtro estado + `OFFSET 100` | Index Scan Backward | `salidas_fecha_salida_idx` (evita el `Sort` — ver nota 3) | 0.5 ms |
| D3 | Salidas, filtro cliente (JOIN proyectos) + rango de fechas | Seq Scan + Hash Join | — (ver nota 4) | 1.7 ms |
| D4 | Salidas, `COUNT` sin filtro | Seq Scan | — | 0.5 ms |
| E1 | Ingresos, búsqueda factura/proveedor contains + `LIMIT 20` | Index Scan Backward | `ingresos_fecha_recepcion_idx` (mismo patrón que A3) | 0.1 ms |
| E2 | Ingresos, filtro estado + rango de fechas | Index Scan Backward | `ingresos_fecha_recepcion_idx` | 0.04 ms |
| F1 | Reporte consumo-cliente (sin paginar, JOIN proyectos) | Seq Scan + Hash Join | — (ver nota 4) | 1.2 ms |
| F2 | Reporte consumo-proyecto (sin paginar) | Bitmap Index Scan | `salidas_proyecto_id_estado_idx` | 0.09 ms |
| G1 | Reporte inventario actual, TODO el catálogo (sin paginar por diseño) | Seq Scan + Sort | — (lectura completa intencional) | 1.6 ms |
| H1 | Reporte movimientos, rango de fechas + tipo (sin paginar) | Bitmap Index Scan | `movimientos_inventario_fecha_hora_idx` | 1.5 ms |
| H2a | Reporte movimientos por usuario — usuario sobrerrepresentado (52 % de la tabla, artefacto del generador) | **Seq Scan** | — (ver nota 5) | 5.9 ms |
| H2b | Reporte movimientos por usuario — usuario con selectividad realista (23 % de la tabla) | Bitmap Index Scan | `movimientos_inventario_usuario_id_idx` | 2.0 ms |
| H3 | Reporte movimientos por cliente (JOIN proyectos) | Nested Loop + Bitmap Index Scan | `movimientos_inventario_proyecto_id_idx` | 0.3 ms |
| H4 | Reporte movimientos por documento | Index Scan | `movimientos_inventario_documento_tipo_documento_id_idx` | 0.03 ms |
| I1 | Clientes, búsqueda nombre/NIT contains | Seq Scan | — (tabla de 60 filas, ver nota 6) | 0.2 ms |
| I2 | Proyectos-destino, `cliente_id`+`estado` | Seq Scan (Nested Loop) | — (tabla de 177 filas, ver nota 6) | 0.2 ms |

Todos los tiempos están muy por debajo del umbral de 2 s de SC-008, incluidos los 4 reportes
(que leen sin paginar por diseño).

### Notas de interpretación (ninguna requirió migración — ver conclusión)

1. **A1** (paginado profundo sin filtro): con 5.000 filas, un `Seq Scan` + `Sort` es más barato
   que recorrer el índice `id` porque de todas formas hay que materializar y ordenar para llegar
   al `OFFSET 4000`. Esto es una limitación inherente a la paginación por `OFFSET` (no un
   problema de índices) — a esta escala es irrelevante (2 ms); si el catálogo creciera a
   decenas de miles y la paginación profunda se usara con frecuencia, la solución estándar es
   paginación por cursor (`WHERE id > :ultimoId`), no un índice adicional.
2. **A3/A4/E1/I1** (búsqueda `contains`/`ILIKE '%termino%'`, FR-023/FR-018/FR-035): los índices
   `btree(descripcion)` (productos), `btree(fecha_recepcion)`/ninguno directo sobre
   `numero_factura`/`proveedor` (ingresos) y ninguno sobre `nombre`/`nit` más allá del `UNIQUE`
   (clientes) **no pueden acelerar una búsqueda de subcadena en cualquier posición** — un
   `btree` solo sirve para igualdad, rangos y prefijos (`LIKE 'termino%'`), nunca para
   `'%termino%'`. Esto es correcto y esperado: `data-model.md` documenta esos índices como
   soporte de "búsqueda FR-023" en un sentido amplio (también cubren `ORDER BY`/filtros de
   estado/fecha, que sí usan), no específicamente el patrón `contains`. En A3/E1, el plan real
   usa el índice del `ORDER BY` (`productos_pkey`/`ingresos_fecha_recepcion_idx`) y para gracias
   al `LIMIT 20` puede parar en cuanto encuentra 20 coincidencias — rápido por la combinación
   `ORDER BY`+`LIMIT`, no porque el filtro esté indexado. **A4** (el mismo filtro sin `LIMIT`,
   para un `COUNT`) sí hace `Seq Scan` completo porque no hay forma de parar antes — 7.7 ms sobre
   5.000 filas. Es un `Seq Scan` genuino donde "debería haber índice" en el sentido literal de la
   pregunta de T086, pero la causa es "el filtro no lo puede usar" (comparación de subcadena),
   no "falta el índice en el schema" — ver la recomendación no bloqueante en (f).
3. **D2**: el planner prefiere recorrer `salidas_fecha_salida_idx` en reversa (coincide con
   `ORDER BY fecha_salida DESC`) y aplicar `estado` como filtro posterior, evitando un `Sort`
   explícito — más barato que usar `salidas_estado_idx` y ordenar después. Decisión correcta del
   optimizador, ambos índices están disponibles y se usa el más conveniente según la consulta.
4. **D3/F1**: el filtro de baja selectividad (rango de 365 días cubre ~67 % de las salidas
   generadas; el filtro de estado de consumo cubre ~75 %) hace que un `Seq Scan` sobre `salidas`
   sea más barato que un `Index Scan` — comportamiento correcto del optimizador basado en costo
   (leer la mayoría de una tabla por índice, fila por fila, es más caro que un barrido
   secuencial). No es un índice faltante: con un filtro más selectivo (rango corto de fechas,
   pocos estados) el mismo optimizador elegiría índice, como se ve en D1/F2 sobre el mismo par de
   tablas.
5. **H2a**: el `Seq Scan` aquí es un **artefacto del generador de datos**, no un problema real —
   los "movimientos base" (uno por producto, 5.000 filas) se asignaron todos al mismo usuario
   sintético a propósito (simplicidad del script), dejándolo con ~52 % de las 16.883 filas de
   `movimientos_inventario`. A esa selectividad el `Seq Scan` es la decisión correcta del
   optimizador (igual que la nota 4). **H2b** repite la misma consulta con un usuario de
   cardinalidad realista (23 % de la tabla) y ahí sí se usa
   `movimientos_inventario_usuario_id_idx` vía `Bitmap Index Scan` — confirma que el índice
   funciona correctamente; el caso H2a solo refleja una distribución de datos sintética, no
   representativa de producción (donde los movimientos se reparten entre ~50 usuarios, no 3).
6. **I1/I2**: `clientes` (60 filas) y `proyectos` (177 filas) son tablas pequeñas incluso con el
   volumen generado — el optimizador de Postgres prefiere `Seq Scan` para tablas de este tamaño
   sin importar el índice disponible (el costo de abrir y recorrer un índice B-tree no compensa
   cuando la tabla completa cabe en unas pocas páginas). Esto es correcto y se espera que siga
   siendo así incluso a mayor escala: ni `clientes` ni `proyectos` crecen al ritmo de
   `productos`/`movimientos_inventario` (spec.md § Assumptions no proyecta miles de clientes).

**Conclusión de (c)**: los 9 índices de `data-model.md § Índices` están completos en el schema
y el planner los usa siempre que la selectividad de la consulta lo justifica. Ningún `Seq Scan`
observado se debe a un índice faltante en el sentido de "hace falta agregarlo al schema" — son
o bien decisiones de costo correctas (tabla pequeña, filtro poco selectivo, `OFFSET` profundo) o
bien un patrón de búsqueda (`contains`) que ningún `btree` puede servir de forma nativa. No se
creó ninguna migración.

## (d) Paginación server-side en todos los listados

**Estado: OK**

Confirmado por lectura de código (no solo por convención) en cada adaptador Prisma:

| Listado | Adaptador | `skip`/`take` | Tope de `porPagina` |
|---|---|---|---|
| Inventario (`GET /api/inventario`) | `RepositorioProductosPrisma.listar` | Sí | 100 (`POR_PAGINA_MAXIMA`, `esquemaPaginacion` compartido) |
| Ingresos (`GET /api/ingresos`) | `RepositorioIngresosPrisma.listar` | Sí | 100 |
| Salidas (`GET /api/salidas`) | `RepositorioSalidasPrisma.listar` | Sí | 100 |
| Clientes (`GET /api/clientes`) | `RepositorioClientesPrisma.listar` | Sí | 100 |
| Usuarios (`GET /api/usuarios`) | `RepositorioUsuariosPrisma.listar` | Sí | 100 |
| Historial de movimientos por producto (`GET /api/inventario/:id/movimientos`) | `RepositorioMovimientosPrisma.listarPorProducto` | Sí | 100 |

El tope de 100 lo impone `packages/compartido/src/esquemas/comunes.ts#esquemaPaginacion`
(`POR_PAGINA_MAXIMA`), el MISMO esquema Zod que valida `pagina`/`porPagina` en los 6 listados de
la tabla — no hay forma de que un cliente HTTP pida una página mayor a 100 filas.

Los **4 reportes** (`consumo-cliente`, `consumo-proyecto`, `inventario`, `movimientos`) son
**intencionalmente sin paginar** — confirmado en `RepositorioSalidasPrisma.listarParaConsumo`,
`RepositorioProductosPrisma.listarTodos` y `RepositorioMovimientosPrisma.listar`, ninguno de los
tres recibe `skip`/`take`. Esto es un requisito de diseño, no un olvido: FR-043/SC-007 exigen
que el archivo exportado reproduzca EXACTAMENTE los totales que se ven en pantalla, y
`ControladorReportes` invoca el MISMO caso de uso para la vista en pantalla y para `/export` — un
reporte paginado rompería esa garantía (un total "por proyecto" calculado solo sobre la página
visible sería incorrecto). Con el volumen generado (hasta 8.846 filas en el peor caso, H2a) el
tiempo real se mantuvo entre 0.7 ms y 7.7 ms — ver tabla de (c) — muy por debajo del umbral de
SC-008, así que no hay evidencia medida que justifique paginar los reportes (Principio V).

Dos selectores de formulario (no "listados" en el sentido de FR-023/FR-033, sino combos de
un formulario) tienen un tope fijo documentado en su propio TSDoc, no relacionado con el tope
general de 100 — ver observación en (f).

## (e) Smoke de concurrencia (evidencia de SC-008)

**Estado: OK**

Contra `localhost:4000` real (backend de desarrollo YA corriendo, apuntado a `trazo`, datos
demo — ver nota de alcance más abajo), con `fetch` nativo de Node en paralelo (sin instalar
dependencias nuevas, según lo pedido en la tarea). Sesión real vía `POST /api/auth/login`
(`operario.demo`/`gerente.demo`, cookie httpOnly reenviada en cada petición). Dos corridas
completas, 20 peticiones simultáneas por ronda:

**Corrida 1** (arranque en frío del proceso backend):

| Ronda | n | wall | min | p50 | p95 | max | errores |
|---|---|---|---|---|---|---|---|
| `GET /api/inventario` (operario) | 20 | 326 ms | 66 ms | 245 ms | 278 ms | **319 ms** | 0 |
| `GET /api/salidas` (operario) | 20 | 40 ms | 30 ms | 35 ms | 38 ms | 38 ms | 0 |
| `GET /api/ingresos` (operario) | 20 | 36 ms | 27 ms | 31 ms | 34 ms | 34 ms | 0 |
| `GET /api/reportes/inventario` (gerente) | 20 | 41 ms | 32 ms | 35 ms | 39 ms | 39 ms | 0 |
| `GET /api/reportes/movimientos` (gerente) | 20 | 126 ms | 118 ms | 122 ms | 124 ms | 124 ms | 0 |
| Mezcla: 20 concurrentes repartidas entre 4 listados | 20 | 35 ms | 25 ms | 29 ms | 33 ms | 33 ms | 0 |

**Corrida 2** (inmediatamente después, sin reiniciar el backend — confirma que el pico de la
corrida 1 fue arranque en frío, no un problema sostenido):

| Ronda | n | wall | min | p50 | p95 | max | errores |
|---|---|---|---|---|---|---|---|
| `GET /api/inventario` (operario) | 20 | 60 ms | 21 ms | 53 ms | 54 ms | 54 ms | 0 |
| `GET /api/salidas` (operario) | 20 | 32 ms | 22 ms | 28 ms | 29 ms | 30 ms | 0 |
| `GET /api/ingresos` (operario) | 20 | 29 ms | 19 ms | 22 ms | 27 ms | 27 ms | 0 |
| `GET /api/reportes/inventario` (gerente) | 20 | 31 ms | 25 ms | 27 ms | 29 ms | 29 ms | 0 |
| `GET /api/reportes/movimientos` (gerente) | 20 | 101 ms | 89 ms | 96 ms | 99 ms | 99 ms | 0 |
| Mezcla: 20 concurrentes repartidas entre 4 listados | 20 | 31 ms | 22 ms | 26 ms | 29 ms | 30 ms | 0 |

**0 errores** (ningún `401`/`403`/`5xx` inesperado) en las 240 peticiones combinadas de ambas
corridas — no se reprodujo la intermitencia de `401` documentada como investigación aparte (ver
nota de alcance del prompt original: no se insistió en reproducirla porque esta tarea no toca
`jwt-auth.guard.ts`).

**Nota de alcance**: este smoke corre contra `trazo` (desarrollo), que en este momento tiene
datos de escala demo (20 productos, 22 movimientos, 12 salidas/ingresos, 3 clientes, 5
proyectos, 14 usuarios — confirmado por lectura, sin modificar nada) — **no** contra el volumen
generado en `trazo_test` de la sección (a)/(c), porque el prompt de la tarea es explícito en no
generar volumen en `trazo` bajo ninguna circunstancia. El resultado de esta sección demuestra
que 20 peticiones simultáneas no saturan el proceso Node/NestJS ni el pool de conexiones de
Prisma; el resultado de la sección (c) demuestra por separado que las consultas individuales
siguen siendo rápidas con miles de filas. Ambas piezas de evidencia son necesarias y se
complementan — SC-008 exige las dos condiciones a la vez ("20 usuarios... Y ninguna operación de
stock produce datos inconsistentes"), pero no fue posible medirlas en una sola corrida sin violar
la restricción de nunca cargar volumen en la base de desarrollo real.

## (f) Observaciones no bloqueantes (documentadas, no se implementan sin evidencia de necesidad — Principio V)

1. **Búsqueda por subcadena sin índice trigram** (productos.descripcion/sku,
   ingresos.numero_factura/proveedor, clientes.nombre/nit): como se explica en la nota 2 de (c),
   los `btree` actuales no aceleran `ILIKE '%termino%'`; el `COUNT` de una búsqueda así hace
   `Seq Scan` completo (7.7 ms sobre 5.000 productos en esta medición). A la escala documentada
   en `spec.md § Assumptions` ("miles de productos... decenas de miles de movimientos por año")
   el impacto es despreciable frente al umbral de 2 s de SC-008. Si el catálogo creciera un
   orden de magnitud más (decenas de miles de productos), la mejora estándar sería la extensión
   `pg_trgm` + índices `GIN` sobre esas columnas — un cambio de infraestructura de BD más allá
   de "agregar un índice faltante", así que se documenta como recomendación futura en vez de
   implementarse ahora sin evidencia medida de necesidad (Principio V, mandato explícito de la
   tarea: "si es más grande, documéntalo sin arreglarlo").
2. **Topes fijos en dos selectores de formulario** (no relacionados con los 6 listados
   paginados de (d)): `ListarResumenProductosCasoUso` (combo de producto en
   ingreso/salida) trae como máximo 500 productos por búsqueda
   (`LIMITE_PRODUCTOS_SELECTOR`, documentado en su propio TSDoc como decisión de Principio V);
   varias páginas de servidor (`salidas/nueva`, los 4 `reportes/*`) precargan el combo de
   cliente con `porPagina=${POR_PAGINA_MAXIMA}` (100), es decir, el mismo tope general de
   paginación aplicado a un preload completo en vez de a un listado paginado — si la empresa
   llegara a tener más de 100 clientes activos, el combo del formulario no mostraría los
   clientes más allá del top 100. Con el volumen generado (60 clientes, 5.000 productos con
   `buscar` acotando el resultado en la práctica) ninguno de los dos topes se alcanzó en las
   pruebas. Ninguna tarea/FR de la spec pide un catálogo de clientes de ese tamaño (`spec.md §
   Assumptions` no proyecta más de unas pocas decenas), así que no se toca sin una señal real de
   necesidad — se documenta aquí para que quede localizable si la escala del negocio cambia.

## (g) Filtros de listado de US13 — plan de acceso de cada campo nuevo (T139, 2026-08-12)

**Estado: OK, con una corrección de una afirmación propia** (ver nota al final de la sección).

Requisito de la tanda: *cada campo filtrable nuevo que se traduzca a SQL debe apoyarse en un
índice existente o justificar por qué no lo necesita; si obliga a un `Seq Scan` sobre una tabla
que crecerá, se dice, no se agrega en silencio*. Se midió con `EXPLAIN (ANALYZE, BUFFERS)` real
contra `trazo_test` con volumen generado dentro de **una sola transacción con `ROLLBACK` final**
(no quedó una fila en la base; mismo patrón de transacción única que recomienda la sección (b)):
**6.000 productos** repartidos en 6 categorías y 5 ubicaciones, y **4.000 salidas** repartidas
entre 10 autorizantes con un 25 % en `PENDIENTE` (sin autorizante, como en producción).

| Filtro nuevo | Consulta medida | Plan elegido | Índice usado | Tiempo real |
|---|---|---|---|---|
| `categoria` (inventario) | página de 20 (`ORDER BY id LIMIT 20`) | Index Scan | `productos_pkey` (para el `ORDER BY`; para en cuanto junta 20 — mismo patrón que A3) | 0.17 ms |
| `categoria` (inventario) | `COUNT` del mismo filtro (sin `LIMIT`: no puede parar antes) | **Bitmap Index Scan** | **`productos_categoria_idx`** (nuevo) | 0.51 ms |
| `categoria` + `ubicacion` | `COUNT` de los dos combinados | Bitmap Index Scan + Filter | `productos_categoria_idx` (el segundo campo se resuelve como filtro sobre 1.000 filas ya acotadas — correcto, no hace falta un índice compuesto) | 0.44 ms |
| `estado` (inventario) | ya cubierto por `productos_estado_idx` desde la migración inicial | — | `productos_estado_idx` | — |
| `usuarioAutorizaId` (salidas) | página de 20 (`ORDER BY fecha_salida DESC LIMIT 20`) | Index Scan Backward | `salidas_fecha_salida_idx` (evita el `Sort`; misma decisión que la nota 3/D2) | 0.12 ms |
| `usuarioAutorizaId` (salidas) | `COUNT` del mismo filtro | **Bitmap Index Scan** | **`salidas_usuario_autoriza_id_idx`** (nuevo) | 0.17 ms |
| `numero` (salidas) | lectura por correlativo | Index Scan | `salidas_numero_key` (el `UNIQUE` que ya exige FR-026) | 0.02 ms |
| `disponibleMin`/`disponibleMax` (inventario) | — | no llega a SQL | — (se aplica en memoria sobre `disponible`, ver abajo) | — |
| `proveedor` (ingresos) | `ILIKE '%termino%'` | Seq Scan en el `COUNT` | — (ningún `btree` puede servirlo, ver abajo) | — |
| `ciudad` (clientes), `rolId` (usuarios) | igualdad sobre tabla pequeña | Seq Scan | — (decisión de costo correcta, ver abajo) | — |

**Los tres filtros que NO reciben índice, y por qué** (misma justificación que quedó escrita en
data-model.md § Índices, aquí con el respaldo medido):

1. **`ingresos.proveedor`** — es una búsqueda de subcadena (`contains`), y un `btree` solo sirve
   para igualdad, rangos y prefijos: **ningún índice puede acelerarla** (nota 2 de la sección (c),
   ya medida sobre este mismo patrón). No empeora nada: el `buscar` que esa pantalla ya tenía
   cruza `numero_factura` **OR** `proveedor`, así que el perfil de costo del filtro nuevo es el
   mismo que el de una consulta que la pantalla hace desde T034. Si algún día el volumen de
   ingresos lo justificara, la mejora es `pg_trgm` + `GIN` sobre esas columnas (observación 1 de
   la sección (f)), no un índice más.
2. **`clientes.ciudad`** y **`usuarios.rol_id`** — tablas pequeñas por diseño del negocio
   (`spec.md § Assumptions`: decenas de clientes, hasta ~50 usuarios). El planner prefiere
   `Seq Scan` a esa escala sin importar el índice disponible, exactamente como se midió en la
   nota 6 sobre `clientes`/`proyectos`. Un índice ahí sería peso muerto en cada escritura sin un
   solo plan que lo usara.
3. **El rango `disponibleMin`/`disponibleMax` no toca SQL en absoluto**: se mide sobre
   `disponible` (= `stock` − `comprometido`) y `comprometido` es un agregado sobre `salidas`, así
   que se aplica en memoria en `ListarInventarioCasoUso`, DESPUÉS de que los filtros de columna ya
   acotaron el conjunto en la base — mismo reparto (y mismo motivo) que `soloStockBajo` desde US5
   y que el `cantidadMin`/`cantidadMax` del reporte de inventario desde US7.

**Corrección de una afirmación propia (lo que la medición desmintió)**: el comentario de la
migración `20260812220000_indices_filtros_listados` afirma que `productos_categoria_idx`/
`productos_ubicacion_idx` sirven DOS consultas —el filtro y el `SELECT DISTINCT` que alimenta los
selectores de FR-076—. **La primera mitad es cierta y está medida arriba; la segunda no**: el
`DISTINCT` real se resuelve con `Seq Scan` + `HashAggregate` (1.8–1.9 ms sobre 6.000 productos),
porque con solo 6 categorías distintas leer la tabla entera y agrupar sale más barato que recorrer
el índice — PostgreSQL no hace *loose index scan*. Los índices se justifican igual por el filtro,
que es su uso principal, y 1.9 ms por carga de pantalla está tres órdenes de magnitud por debajo
del umbral de SC-008. La corrección se anota **aquí** y no editando el comentario de la migración
a propósito: esa migración ya está aplicada en `trazo` y `trazo_test`, y Prisma guarda el checksum
del archivo — modificarlo rompería la verificación de integridad del historial de migraciones por
arreglar un comentario.

---

## Conclusión

Los índices de `data-model.md § Índices` están completos y se usan correctamente; los 6
listados paginan server-side con un tope duro de 100 filas compartido por un único esquema Zod;
los 4 reportes son sin paginar por diseño (requisito FR-043/SC-007) y su tiempo real con
volumen generado se mantuvo muy por debajo de 2 s; el smoke de concurrencia contra el backend
real no mostró degradación ni errores con 20 peticiones simultáneas. No se encontró ningún
problema de rendimiento genuino que requiriera una migración — las dos observaciones de (f)
quedan documentadas para revisarlas si la escala real del negocio las vuelve relevantes.

**T086: sin código nuevo en el repositorio** (no se requería — ningún hallazgo ameritó una
corrección; `npm run verificar` no aplica a esta tarea porque no se tocó código de
`backend/`/`frontend/`/`packages/compartido/`).
