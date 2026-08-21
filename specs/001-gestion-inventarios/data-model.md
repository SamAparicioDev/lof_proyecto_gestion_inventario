# Data Model: Sistema de Gestión de Inventarios (Trazo) — Fase 1

**Date**: 2026-08-10 | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

Convenciones: tablas y columnas en `snake_case` español. Todos los montos en COP con
`DECIMAL(14,2)`; cantidades con `DECIMAL(12,2)` — el tipo conserva la escala por el histórico, pero desde US26 (FR-122) toda cantidad NUEVA es entera y un `CHECK` lo exige. Timestamps en
`timestamptz` (UTC), presentación en `America/Bogota`. IDs `BIGINT` autoincrementales.

Implementación (arquitectura hexagonal — Principio VI): el esquema físico vive en
`backend/prisma/schema.prisma` + migraciones SQL (constraints/trigger); las entidades y
reglas de este documento se modelan como tipos y servicios en `backend/src/dominio/`
(sin dependencia de Prisma), y los repositorios de `backend/src/infraestructura/persistencia`
traducen entre ambos.

## Campos de auditoría (todas las tablas)

Obligatorios por Principio II y requisito técnico del documento fuente:

| Columna | Tipo | Nota |
|---|---|---|
| `fecha_creacion` | timestamptz NOT NULL DEFAULT now() | |
| `usuario_creacion_id` | FK → usuarios NOT NULL | quién creó el registro |
| `fecha_modificacion` | timestamptz NULL | se actualiza en cada UPDATE |
| `usuario_modificacion_id` | FK → usuarios NULL | quién modificó por última vez |

(En `usuarios`, los FKs de auditoría son NULLables para el admin semilla inicial.)

## Entidades

### usuarios

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `nombre_completo` | VARCHAR(150) | NOT NULL |
| `email` | VARCHAR(150) | NOT NULL, **UNIQUE** (FR-009) |
| `login` | VARCHAR(50) | NOT NULL, **UNIQUE** (FR-009) |
| `password_hash` | VARCHAR(100) | NOT NULL (bcrypt; nunca se expone — FR-007) |
| `rol_id` | FK → roles | NOT NULL (FR-002/FR-058 — reemplaza al ENUM `rol` original en US9; ver § roles) |
| `estado` | ENUM `ACTIVO/INACTIVO` | NOT NULL DEFAULT ACTIVO (FR-006/FR-008) |
| `debe_cambiar_password` | BOOLEAN | NOT NULL DEFAULT true en alta/restablecimiento |

Reglas: nunca DELETE (baja lógica, FR-008). Un usuario INACTIVO no puede autenticarse pero
sus referencias históricas permanecen (US6-AS2).

### roles (US9)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `nombre` | VARCHAR(50) | NOT NULL, **UNIQUE** (FR-055) |
| `descripcion` | VARCHAR(200) | NULL |
| `es_sistema` | BOOLEAN | NOT NULL DEFAULT false — `true` en los 3 roles semilla (Administrador/Gerente/Operario): NO se pueden eliminar ni renombrar (FR-057/FR-059) |
| `es_super_admin` | BOOLEAN | NOT NULL DEFAULT false — `true` ÚNICAMENTE en el rol de respaldo (US30, FR-127). **Índice ÚNICO parcial** `WHERE es_super_admin` : no puede haber dos. Un rol así no se crea, edita, desactiva ni elimina desde la aplicación, y solo se ASIGNA con un `UPDATE` directo sobre `usuarios.rol_id` |
| `estado` | ENUM `ACTIVO/INACTIVO` | NOT NULL DEFAULT ACTIVO (baja lógica, nunca DELETE) |

Reglas (FR-057, todas verificadas en el caso de uso, no solo en la UI):
- Un rol con `es_sistema = true` no se elimina.
- Un rol con ≥1 usuario asignado no se elimina (el mensaje indica cuántos usuarios lo tienen).
- No se puede quitar el permiso `roles.gestionar` del ÚLTIMO rol activo que lo tiene — misma
  familia de invariante que "un administrador no puede desactivarse a sí mismo" (US6): el
  sistema nunca queda sin quién lo administre.
- **El rol `es_super_admin` no participa de `roles_permisos`** (US30, FR-127): sus filas serían
  inútiles y peligrosas a la vez, porque sugerirían que borrarlas le quita capacidades. Su
  autorización la decide el guard por la columna, y lo que el sistema le REPORTA como permisos
  efectivos es el catálogo completo, resuelto en cada lectura. Vaciar `permisos` o
  `roles_permisos` no lo afecta.
- **Permisos RESERVADOS** (US31, FR-131): hoy solo `inventario.ajustar`. Se conceden y se retiran
  como cualquier otro, pero Únicamente por un super administrador. La reserva vive en el código
  (una lista en el dominio), no en una columna: es una propiedad del significado del permiso, no
  un dato que alguien deba poder editar — si fuera editable, quitarle la reserva sería el primer
  paso para saltarse la regla.

### permisos (US9)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `clave` | VARCHAR(60) | NOT NULL, **UNIQUE** — formato `modulo.accion` (ej. `productos.crear`, `salidas.confirmar`, `reportes.ver`, `roles.gestionar`) |
| `modulo` | VARCHAR(30) | NOT NULL (agrupa la lista en la UI) |
| `descripcion` | VARCHAR(200) | NOT NULL (texto en español que el Administrador lee al asignar) |

**Catálogo de SOLO LECTURA desde la aplicación** (FR-056): cada fila corresponde a una
verificación real en el código (`@RequierePermiso('...')`). Se siembra desde `prisma/seed.ts`
y se versiona con el código — permitir crear permisos desde la UI generaría filas que ningún
endpoint consulta, dando una falsa sensación de control (research R16).

### roles_permisos (US9)

| Columna | Tipo | Constraints |
|---|---|---|
| `rol_id` | FK → roles | NOT NULL, ON DELETE CASCADE |
| `permiso_id` | FK → permisos | NOT NULL |

PK compuesta `(rol_id, permiso_id)`. Es la tabla que el Administrador edita realmente al
marcar/desmarcar permisos de un rol (FR-055).

### categorias (US15)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `nombre` | VARCHAR(100) | NOT NULL; **UNIQUE sobre `lower(trim(nombre))`** vía índice funcional — no un UNIQUE normal (FR-085) |
| `descripcion` | VARCHAR(300) | NULL |
| `estado` | ENUM `ACTIVA/INACTIVA` | NOT NULL DEFAULT ACTIVA (baja lógica, nunca DELETE) |

Reglas (FR-084…FR-087, verificadas en el caso de uso, no solo en la UI):

- **La unicidad es funcional, no literal.** Un `UNIQUE(nombre)` normal dejaría convivir
  "Ferretería", "ferretería " y "FERRETERÍA", que es exactamente el problema que US15 viene a
  resolver. **Las tildes no se normalizan**: "Ferreteria" y "Ferretería" son distintas para el
  índice (haría falta la extensión `unaccent`), decisión consciente y anotada en FR-085. El índice se crea sobre `lower(trim(nombre))`, así que la base de datos es la red
  final aunque alguien inserte por SQL. El nombre se guarda tal como lo escribió el usuario:
  se normaliza para COMPARAR, no para almacenar.
- **Nunca se elimina si está en uso** (FR-087): la FK de `productos.categoria_id` es
  `ON DELETE RESTRICT`, y el caso de uso comprueba antes y devuelve un mensaje que dice cuántos
  productos la usan. La baja es `estado = INACTIVA`.
- Una categoría INACTIVA no se ofrece para clasificar productos nuevos, pero los productos que
  ya la tenían la conservan (FR-086) — mismo criterio que un producto dado de baja, que sigue
  apareciendo en el historial.

**Migración desde el texto libre de US8 (FR-089)**: la columna `productos.categoria` se
convierte en catálogo sin perder nada — se insertan en `categorias` los valores distintos ya
presentes (agrupando por `lower(trim(...))`, que es lo que colapsa las variantes tipográficas),
se rellena `categoria_id` emparejando por ese mismo criterio, y solo entonces se elimina la
columna vieja. Va en un `migration.sql` escrito a mano: Prisma no genera un traspaso de datos.

### unidades_medida (US17)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `nombre` | VARCHAR(60) | NOT NULL; **UNIQUE sobre `lower(trim(nombre))`** vía índice funcional (FR-101) |
| `abreviatura` | VARCHAR(10) | NOT NULL; **UNIQUE sobre `lower(trim(abreviatura))`** — dos unidades que se abrevien igual serían indistinguibles en una tabla de cantidades |
| `estado` | ENUM `ACTIVA/INACTIVA` | NOT NULL DEFAULT ACTIVA (baja lógica, nunca DELETE) |

Reglas (FR-101…FR-104), mismas que `categorias` salvo lo que se indica:

- **Dos unicidades funcionales, no una**: el nombre y la abreviatura se comparan cada uno por su
  cuenta con `lower(trim(...))`. Las tildes no se normalizan, igual que en el resto de catálogos.
- **Nunca se elimina si está en uso**: la FK de `productos.unidad_medida_id` es
  `ON DELETE RESTRICT` y el caso de uso comprueba antes, devolviendo cuántos productos la usan.
- **La FK es NULLABLE y eso es deliberado** (FR-103): los productos anteriores a US17 se quedan
  sin unidad. La obligatoriedad vive en la APLICACIÓN —alta y edición la exigen— y no en la base,
  porque un `NOT NULL` habría exigido inventarle una unidad a cada producto existente en la
  migración, que es precisamente el dato que nadie tiene.

### productos

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `sku` | VARCHAR(50) | NOT NULL, **UNIQUE** (FR-010) |
| `descripcion` | VARCHAR(300) | NOT NULL |
| `categoria_id` | BIGINT FK → categorias | NULL (US15, FR-086 — la categoría sigue siendo opcional, pero ya no es texto libre: sustituye a la columna `categoria VARCHAR(100)` de US8) |
| `unidad_medida_id` | BIGINT FK → unidades_medida | NULL en la BD por los productos anteriores a US17 (FR-103); OBLIGATORIA en el alta y la edición (FR-102) |
| `ubicacion` | VARCHAR(100) | NULL (texto libre, un solo almacén) |
| `umbral_stock_bajo` | DECIMAL(12,2) | NOT NULL DEFAULT 0, CHECK `>= 0`, CHECK `= trunc(...)` NOT VALID (FR-010/FR-022/FR-122 — es una cantidad, entera desde US26) |
| `stock_actual` | DECIMAL(12,2) | NOT NULL DEFAULT 0, **CHECK `stock_actual >= 0`** (Principio I — red final en BD) |
| `ultimo_costo` | DECIMAL(14,2) | NOT NULL DEFAULT 0 (se actualiza al recibir ingresos; precio de referencia para salidas) |
| `fecha_ultimo_movimiento` | timestamptz | NULL (FR-020) |
| `estado` | ENUM `ACTIVO/INACTIVO` | NOT NULL DEFAULT ACTIVO (FR-012) |

Reglas: no se elimina si tiene movimientos (FR-012) — se marca INACTIVO. `stock_actual` SOLO
se modifica dentro de transacciones del servicio de stock (research R4).

**Valores derivados (no almacenados)**:
- `comprometido(producto)` = Σ `detalles_salidas.cantidad` de salidas en estado `PENDIENTE`.
- `disponible(producto)` = `stock_actual − comprometido` (FR-020, research R4).

### clientes

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `nombre` | VARCHAR(150) | NOT NULL |
| `nit` | VARCHAR(30) | NOT NULL, **UNIQUE** (FR-035) |
| `telefono` | VARCHAR(30) | NULL |
| `email` | VARCHAR(150) | NULL |
| `direccion` | VARCHAR(200) | NULL |
| `ciudad` | VARCHAR(100) | NULL |
| `fecha_registro` | DATE | NOT NULL DEFAULT hoy (FR-034) |
| `estado` | ENUM `ACTIVO/INACTIVO` | NOT NULL DEFAULT ACTIVO |

**El logo del cliente se retiró** (2026-08-15). `clientes` tuvo dos columnas nullable, `logo`
(BYTEA) y `logo_tipo_mime`, con sus `CHECK` de consistencia y de tipo MIME admitido. Se
eliminaron —columnas y datos— junto con la capacidad: los documentos que salen del sistema los
firma LOF, no el cliente al que van dirigidos (FR-066/FR-067). El logotipo institucional NO vive
en la base de datos: es un archivo del repositorio (`backend/assets/marca/logo-lof.png`), porque es parte
del despliegue y no un dato que el negocio administre.

### proyectos

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `cliente_id` | FK → clientes | NOT NULL (FR-036) |
| `nombre` | VARCHAR(150) | NOT NULL, **UNIQUE (cliente_id, nombre)** |
| `descripcion` | TEXT | NULL |
| `fecha_inicio` | DATE | NULL |
| `fecha_cierre_estimada` | DATE | NULL, CHECK `>= fecha_inicio` cuando ambas existen |
| `responsable` | VARCHAR(150) | NULL |
| `presupuesto_estimado` | DECIMAL(14,2) | NULL, CHECK `>= 0` (base del margen FR-040) |
| `estado` | ENUM `ACTIVO/COMPLETADO/SUSPENDIDO` | NOT NULL DEFAULT ACTIVO (FR-036) |

Reglas: solo proyectos ACTIVO de clientes ACTIVO reciben nuevas salidas (FR-038, US2-AS4).

### proveedores (US15)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `nombre` | VARCHAR(150) | NOT NULL; **UNIQUE sobre `lower(trim(nombre))`** vía índice funcional, igual que `categorias` (FR-091 → FR-085) |
| `nit` | VARCHAR(20) | NULL |
| `telefono` | VARCHAR(30) | NULL |
| `email` | VARCHAR(150) | NULL |
| `estado` | ENUM `ACTIVO/INACTIVO` | NOT NULL DEFAULT ACTIVO (baja lógica, nunca DELETE) |
| `es_sistema` | BOOLEAN | NOT NULL DEFAULT false — marca el proveedor de la carga masiva (FR-093) |

Reglas (FR-091…FR-093): las MISMAS de `categorias` (unicidad funcional sin normalizar tildes,
baja lógica cuando está en uso, filtros alimentados del catálogo), más dos propias:

- **El proveedor de un ingreso es OBLIGATORIO** (`ingresos.proveedor_id` NOT NULL), a
  diferencia de `productos.categoria_id`: una factura sin saber a quién se le compró no es
  trazable.
- **`es_sistema` protege el proveedor de la carga masiva** ("Carga masiva de inventario",
  FR-050): no se renombra ni se elimina, porque la importación lo resuelve POR NOMBRE. Sus
  datos de contacto sí se pueden corregir. Misma protección que los roles del sistema (FR-059).

**Migración desde el texto libre (FR-092)**: mismo procedimiento que FR-089 —crear, sembrar
agrupando por `lower(trim(...))`, rellenar la FK, y solo entonces retirar la columna vieja—, con
una diferencia: el `SET NOT NULL` va DESPUÉS del relleno y actúa como comprobación de que ningún
ingreso quedó sin emparejar; si alguno lo hiciera, la migración aborta entera en vez de dejar
ingresos huérfanos de proveedor.

### ordenes_compra (US16)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `numero` | BIGINT | NOT NULL, **UNIQUE** — correlativo de `contadores['orden_compra']` (FR-095, mismo mecanismo que las salidas) |
| `proveedor_id` | BIGINT FK → proveedores | NOT NULL, `ON DELETE RESTRICT` (FR-094) |
| `fecha_orden` | DATE | NOT NULL |
| `fecha_entrega_esperada` | DATE | NULL (informativa: es lo que se le pide al proveedor, no un compromiso del sistema) |
| `observaciones` | TEXT | NULL |
| `estado` | ENUM `BORRADOR/ENVIADA/RECIBIDA/ANULADA` | NOT NULL DEFAULT BORRADOR (FR-096) |
| `valor_total` | DECIMAL(14,2) | NOT NULL DEFAULT 0 (recalculado al guardar líneas — FR-094) |
| `motivo_anulacion` | TEXT | NULL (obligatorio a nivel de aplicación al anular) |


**Columnas de IVA (US20, FR-109/FR-110)** — las MISMAS tres en las cuatro tablas de detalle
(`detalles_ingresos`, `detalles_salidas`, `detalles_ordenes_compra`, `detalles_cotizaciones`) y
las mismas dos en sus cabeceras:

| Columna | Tipo | Constraints |
|---|---|---|
| `tasa_iva` (detalle) | DECIMAL(5,2) | NOT NULL DEFAULT 0, CHECK `IN (0, 5, 19)` — tasas vigentes en Colombia |
| `valor_iva` (detalle) | DECIMAL(14,2) | NOT NULL DEFAULT 0 = `valor_total × tasa_iva / 100` |
| `valor_iva` (cabecera) | DECIMAL(14,2) | NOT NULL DEFAULT 0 = suma del `valor_iva` de sus líneas |

`valor_total` NO cambia de significado ni en las líneas ni en las cabeceras: sigue siendo la
BASE GRAVABLE (cantidad × precio unitario). Esa decisión es deliberada — redefinirlo como total
con impuesto habría cambiado en silencio el valor de todos los reportes de valorización y del
panel, que es justo lo que FR-111 prohíbe. El total con IVA se deriva (`valor_total + valor_iva`)
y se expone como `valorConIva`; nunca se almacena, para que no pueda contradecir a sus sumandos.

El `DEFAULT 0` es lo que hace que la migración no toque ningún documento existente: todo lo
registrado antes de US20 queda con tasa 0 y su total intacto.

### detalles_ordenes_compra (US16)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `orden_compra_id` | BIGINT FK → ordenes_compra | NOT NULL, `ON DELETE CASCADE` (solo se ejerce mientras la orden es BORRADOR) |
| `producto_id` | BIGINT FK → productos | NOT NULL, `ON DELETE RESTRICT` |
| `cantidad` | DECIMAL(12,2) | NOT NULL, CHECK `> 0`, CHECK `= trunc(cantidad)` NOT VALID (US26, FR-122) |
| `precio_unitario` | DECIMAL(14,2) | NOT NULL, CHECK `> 0` — precio ESTIMADO: el real lo fija la factura |
| `valor_total` | DECIMAL(14,2) | NOT NULL |

UNIQUE `(orden_compra_id, producto_id)`: un producto por línea, mismo criterio que
`detalles_ingresos`.

**Una orden NO escribe en `movimientos_inventario`** (FR-096) y por eso no aparece en
`documento_tipo`: es un compromiso de compra, no un movimiento de mercancía. El stock se mueve
cuando el INGRESO vinculado se recibe, con el flujo atómico que ya existe (FR-017).

### cotizaciones (US21)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `numero` | BIGINT | NOT NULL, **UNIQUE** — correlativo de `contadores['cotizacion']` (FR-112, mismo mecanismo que salidas y órdenes de compra) |
| `cliente_id` | BIGINT FK → clientes | NOT NULL, `ON DELETE RESTRICT` |
| `proyecto_id` | BIGINT FK → proyectos | NOT NULL, `ON DELETE RESTRICT` |
| `fecha` | DATE | NOT NULL |
| `fecha_validez` | DATE | NOT NULL — hasta cuándo se sostiene el precio ofrecido; vencida se deriva comparando con hoy, NUNCA con un estado que alguien tenga que marcar |
| `observaciones` | TEXT | NULL |
| `estado` | ENUM `BORRADOR/ENVIADA/ACEPTADA/RECHAZADA/ANULADA` | NOT NULL DEFAULT BORRADOR (FR-112) |
| `valor_total` | DECIMAL(14,2) | NOT NULL DEFAULT 0 — base gravable |
| `valor_iva` | DECIMAL(14,2) | NOT NULL DEFAULT 0 |
| `motivo_anulacion` | TEXT | NULL (obligatorio a nivel de aplicación al anular) |

### detalles_cotizaciones (US21)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `cotizacion_id` | BIGINT FK → cotizaciones | NOT NULL, `ON DELETE CASCADE` (solo se ejerce mientras la cotización es BORRADOR) |
| `producto_id` | BIGINT FK → productos | NOT NULL, `ON DELETE RESTRICT` |
| `cantidad` | DECIMAL(12,2) | NOT NULL, CHECK `> 0`, CHECK `= trunc(cantidad)` NOT VALID (US26, FR-122) |
| `precio_unitario` | DECIMAL(14,2) | NOT NULL, CHECK `> 0` |
| `tasa_iva` | DECIMAL(5,2) | NOT NULL DEFAULT 0, CHECK `IN (0, 5, 19)` |
| `valor_iva` | DECIMAL(14,2) | NOT NULL DEFAULT 0 |
| `valor_total` | DECIMAL(14,2) | NOT NULL |

UNIQUE `(cotizacion_id, producto_id)`: un producto por línea, mismo criterio que el resto.

**Una cotización NO escribe en `movimientos_inventario`** (FR-113) y por eso no aparece en
`documento_tipo`: es una oferta, no una entrega. `salidas.cotizacion_id` (FK NULL,
`ON DELETE RESTRICT`) enlaza la salida que nace al aceptarla — espejo exacto de
`ingresos.orden_compra_id`.

### ingresos

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `tipo` | ENUM `FACTURA/AJUSTE` | NOT NULL DEFAULT FACTURA (US29, FR-126 — el defecto deja intactos los ingresos anteriores a la historia) |
| `numero_factura` | VARCHAR(50) | **UNIQUE**; NOT NULL solo en `tipo = FACTURA` (FR-015 — la unicidad concurrente la garantiza la BD; en PostgreSQL un índice único admite varios NULL, que es justo lo que necesitan los ajustes) |
| `numero_ajuste` | BIGINT | **UNIQUE**; NOT NULL solo en `tipo = AJUSTE` — correlativo de `contadores['ajuste']`, mostrado como `AJU-000042` (FR-126, mismo mecanismo que salidas, órdenes y cotizaciones) |
| `fecha_factura` | DATE | NOT NULL solo en `tipo = FACTURA` (un ajuste no tiene factura que fechar; su fecha es la de recepción) |
| `proveedor_id` | BIGINT FK → proveedores | NOT NULL solo en `tipo = FACTURA` (US15, FR-091; `ON DELETE RESTRICT`). Un ajuste no se le compra a nadie — exigir un proveedor de relleno ensuciaría el catálogo igual que un número de factura inventado |
| `fecha_recepcion` | DATE | NOT NULL |
| `observaciones` | TEXT | NULL |
| `estado` | ENUM `PENDIENTE/RECIBIDO/VERIFICADO/ANULADO` | NOT NULL DEFAULT PENDIENTE (FR-017/FR-019) |
| `valor_total` | DECIMAL(14,2) | NOT NULL DEFAULT 0 (recalculado al guardar líneas — FR-014) |
| `usuario_registra_id` | FK → usuarios | NOT NULL (FR-018) |
| `motivo_anulacion` | TEXT | NULL (obligatorio a nivel de aplicación al anular — FR-019) |
| `orden_compra_id` | BIGINT FK → ordenes_compra | NULL (US16, FR-099 — presente solo si el ingreso nació de una orden; un ingreso sin orden previa sigue siendo válido). Un AJUSTE nunca la lleva: no surte ninguna orden |

**CHECK `ingresos_tipo_check` (US29, FR-126)** — una sola restricción expresa la forma completa
de cada tipo, en vez de cuatro columnas nullables sueltas que nadie relaciona:

```sql
(tipo = 'FACTURA' AND numero_factura IS NOT NULL AND fecha_factura IS NOT NULL
                  AND proveedor_id IS NOT NULL AND numero_ajuste IS NULL)
OR
(tipo = 'AJUSTE'  AND numero_factura IS NULL AND fecha_factura IS NULL
                  AND proveedor_id IS NULL AND numero_ajuste IS NOT NULL AND observaciones IS NOT NULL)
```

El `observaciones IS NOT NULL` del ajuste es su MOTIVO: la factura justifica la entrada de un
ingreso normal, y cuando no hay factura lo único que queda para justificarla es el motivo
escrito (Principio II — un movimiento de corrección sin causa registrada no es trazable).

### detalles_ingresos

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `ingreso_id` | FK → ingresos ON DELETE CASCADE (solo aplicable en PENDIENTE) | NOT NULL |
| `producto_id` | FK → productos | NOT NULL |
| `cantidad` | DECIMAL(12,2) | NOT NULL, **CHECK `cantidad > 0`** (FR-016), **CHECK `cantidad = trunc(cantidad)` NOT VALID** (US26, FR-122) |
| `precio_unitario` | DECIMAL(14,2) | NOT NULL, **CHECK `precio_unitario > 0`** (FR-016) |
| `valor_total` | DECIMAL(14,2) | NOT NULL (= cantidad × precio_unitario — FR-014) |
| | | **UNIQUE (ingreso_id, producto_id)** — un producto una vez por factura |

### salidas

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `numero` | BIGINT | NOT NULL, **UNIQUE** — correlativo de `contadores` (FR-026, research R5) |
| `fecha_salida` | DATE | NOT NULL |
| `cliente_id` | FK → clientes | **NOT NULL** (US28, FR-124 — el destino obligatorio de una salida es el CLIENTE; `ON DELETE RESTRICT`) |
| `proyecto_id` | FK → proyectos | NULL (US28, FR-124 — opcional: hay entregas del cliente que no son de una obra) |
| `observaciones` | TEXT | NULL |
| `estado` | ENUM `PENDIENTE/CONFIRMADA/COMPLETADA/ANULADA` | NOT NULL DEFAULT PENDIENTE (FR-029/FR-032) |
| `valor_total` | DECIMAL(14,2) | NOT NULL DEFAULT 0 (FR-031) |
| `usuario_autoriza_id` | FK → usuarios | NULL en PENDIENTE; NOT NULL a nivel de aplicación al confirmar (FR-030) |
| `fecha_confirmacion` | timestamptz | NULL; se fija al confirmar (FR-030) |
| `motivo_anulacion` | TEXT | NULL (obligatorio al anular — FR-032) |

Nota de trazabilidad (US28, FR-124): hasta esta historia el cliente NO se guardaba —se
derivaba del proyecto, que era obligatorio— y esa es exactamente la razón por la que ahora hay
una columna propia: al volverse opcional el proyecto, derivar el cliente de él dejaría sin
destino a las salidas que no lo llevan. `cliente_id` se rellenó en la migración desde
`proyectos.cliente_id`, así que ninguna salida histórica cambió de dueño.

La coherencia entre las dos columnas —que el proyecto elegido pertenezca al cliente elegido— la
verifica la capa de aplicación al crear y al editar (`validar-destino-salida.ts`), no un `CHECK`:
la base no puede expresar "`proyecto_id` referencia un proyecto cuyo `cliente_id` es este" sin un
disparador o una FK compuesta que obligaría a un índice artificial en `proyectos`.

### detalles_salidas

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `salida_id` | FK → salidas ON DELETE CASCADE (solo aplicable en PENDIENTE) | NOT NULL |
| `producto_id` | FK → productos | NOT NULL |
| `cantidad` | DECIMAL(12,2) | NOT NULL, **CHECK `cantidad > 0`** (FR-016/validaciones de salida), **CHECK `cantidad = trunc(cantidad)` NOT VALID** (US26, FR-122) |
| `precio_unitario` | DECIMAL(14,2) | NOT NULL, CHECK `>= 0` (referencia, editable — supuesto de spec) |
| `valor_total` | DECIMAL(14,2) | NOT NULL (= cantidad × precio_unitario — FR-031) |
| | | **UNIQUE (salida_id, producto_id)** |

### historial_costos_producto (INMUTABLE — US12, FR-071…FR-074)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `producto_id` | FK → productos | NOT NULL |
| `costo_anterior` | DECIMAL(14,2) | NOT NULL |
| `costo_nuevo` | DECIMAL(14,2) | NOT NULL, CHECK `>= 0` |
| `origen` | ENUM `IMPORTACION/EDICION_MANUAL/RECEPCION_INGRESO` | NOT NULL |
| `documento_id` | BIGINT | NULL (el ingreso, cuando `origen = RECEPCION_INGRESO`) |
| `fecha_hora` | timestamptz | NOT NULL DEFAULT now() |
| `usuario_id` | FK → usuarios | NOT NULL |

**Por qué una tabla propia y NO `movimientos_inventario`** (FR-073): un cambio de costo no
mueve cantidades. Registrarlo como movimiento rompería el invariante 2 de este documento
(`stock_actual(p) = Σ movimientos(p)`), que es la base de la prueba de conciliación y de la
confianza en el inventario. Son dos historiales distintos porque responden dos preguntas
distintas: *cuánto hay y por qué* vs. *cuánto vale y desde cuándo*.

Reglas: solo INSERT (mismo criterio de inmutabilidad que `movimientos_inventario`); se
escribe DENTRO de la misma transacción que actualiza `productos.ultimo_costo`, de modo que
jamás exista un costo cambiado sin su registro; solo se inserta cuando el costo REALMENTE
cambia (`costo_nuevo <> costo_anterior`, FR-074).

Nota semántica: `productos.ultimo_costo` nace como "último costo pagado al recibir
mercancía"; desde US12 admite además edición manual y masiva, así que su lectura correcta
pasa a ser "costo de referencia vigente" — su procedencia exacta siempre se puede reconstruir
en esta tabla.

**El costo es el ÚLTIMO, nunca un promedio (FR-138)**: recibir mercancía a un precio distinto
REEMPLAZA `ultimo_costo`; no lo promedia con las existencias previas. La razón es estructural y
no de fórmula: aquí el stock es UN número por producto (`productos.stock_actual`), no una pila de
lotes con su precio, así que no existe el dato "cuántas unidades quedan de la compra vieja" que un
promedio ponderado necesita. Una cifra promediada sobre un solo número no sería ni el costo de lo
que hay ni el precio de ninguna compra, y ningún documento podría respaldarla. Consecuencia
aceptada: tras una compra más cara, las unidades viejas quedan valorizadas por encima de lo que
costaron — una distorsión visible y reconstruible en esta tabla, que es preferible a una cifra
derivada que nadie puede explicar.

### movimientos_inventario (INMUTABLE)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `fecha_hora` | timestamptz | NOT NULL DEFAULT now() (FR-045) |
| `tipo` | ENUM `ENTRADA/SALIDA/AJUSTE_ENTRADA/AJUSTE_SALIDA` | NOT NULL (anulaciones = AJUSTE_* — FR-019/FR-032/FR-046) |
| `producto_id` | FK → productos | NOT NULL |
| `cantidad` | DECIMAL(12,2) | NOT NULL, CHECK `> 0` (el signo lo define `tipo`), CHECK `= trunc(cantidad)` **NOT VALID** (US26, FR-122 — ver nota abajo) |
| `stock_resultante` | DECIMAL(12,2) | NOT NULL (snapshot post-movimiento — facilita auditoría) |
| `documento_tipo` | ENUM `INGRESO/SALIDA/AJUSTE` | NOT NULL (FR-045). `AJUSTE` es la corrección hecha desde el inventario (US31, FR-130): no la respalda ningún documento, la respalda su motivo |
| `documento_id` | BIGINT | NULL solo cuando `documento_tipo = AJUSTE` (FK lógico al ingreso o salida en los otros dos). **CHECK**: `(documento_tipo = 'AJUSTE') = (documento_id IS NULL)` — la base no admite un movimiento de ingreso/salida huérfano ni un ajuste que finja tener documento |
| `proyecto_id` | FK → proyectos | NULL — se puebla cuando la salida que lo origina tiene proyecto (US28, FR-124: ya no siempre lo tiene; antes era NOT NULL de facto para `documento_tipo = SALIDA`, FR-042) |
| `usuario_id` | FK → usuarios | NOT NULL (FR-045) |
| `motivo` | TEXT | NULL (obligatorio en AJUSTE_*) |

**Inmutabilidad (Principio II / FR-046)**: trigger de BD que rechaza `UPDATE` y `DELETE`
sobre esta tabla (`RAISE EXCEPTION`); la migración lo crea junto a la tabla. Solo INSERT,
siempre dentro de la transacción que modifica `stock_actual`.

**Por qué los CHECK de cantidad entera son `NOT VALID` (US26, FR-122)**: `ADD CONSTRAINT` valida
por defecto las filas existentes y abortaría la migración si alguna cantidad histórica tiene
decimales. `NOT VALID` hace que PostgreSQL exija la regla a todo INSERT/UPDATE futuro sin tocar
lo ya escrito — que es exactamente la política de la constitución: se cierra la puerta, no se
reescribe la historia (y en esta tabla reescribirla está prohibido por el trigger de arriba).

### contadores

| Columna | Tipo | Constraints |
|---|---|---|
| `clave` | VARCHAR(30) PK | `'salida'` (FR-026), `'orden_compra'` (US16, FR-095), `'cotizacion'` (US21, FR-112) y `'ajuste'` (US29, FR-126) |
| `valor` | BIGINT | NOT NULL DEFAULT 0 |

Uso exclusivo vía `UPDATE ... RETURNING` dentro de transacciones (research R5). Sin campos de
auditoría (tabla técnica).


### notificaciones (US35, FR-139…FR-147)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | BIGINT PK | |
| `tipo` | ENUM `INGRESO_REGISTRADO/INGRESO_RECIBIDO/INGRESO_ANULADO/SALIDA_POR_APROBAR/SALIDA_CONFIRMADA/SALIDA_ANULADA/STOCK_BAJO/CANTIDAD_CORREGIDA` | NOT NULL — decide el permiso de suscripción y el de lectura que exige (catálogo en `dominio/entidades/notificacion.ts`) |
| `titulo` | VARCHAR(150) | NOT NULL — redactado en el momento del hecho |
| `detalle` | VARCHAR(300) | NULL — la segunda línea del aviso |
| `entidad_tipo` | ENUM `INGRESO/SALIDA/PRODUCTO` | NOT NULL — a dónde lleva el aviso (FR-140) |
| `entidad_id` | BIGINT | NOT NULL |
| `usuario_origen_id` | FK → usuarios | NULL — quien provocó el hecho; se EXCLUYE de los destinatarios (FR-143). Nulo cuando lo provoca el sistema |
| `creada_en` | timestamptz | NOT NULL DEFAULT now() |

**Una fila por HECHO, no por destinatario.** Es la decisión de diseño de la tabla y tiene tres
consecuencias que se buscaron: (1) cambiar los permisos de un rol surte efecto de inmediato,
también sobre los avisos ya creados, porque los destinatarios se resuelven al CONSULTAR y no al
escribir; (2) un usuario dado de alta después no arrastra el fan-out de nadie; (3) el número de
filas no se multiplica por la plantilla. El costo es que "quién puede ver esto" se calcula en cada
lectura — barato, porque son dos conjuntos de claves de permiso comparados en memoria.

**Solo INSERT.** Un aviso no se edita ni se anula: es lo que se supo en ese momento. Si el hecho
se revierte (una anulación), lo que corresponde es OTRO aviso, no reescribir el anterior — mismo
criterio que `movimientos_inventario` (Principio II).

**No es el archivo permanente** (FR-147): la bandeja muestra una ventana reciente. Lo que pasó de
verdad vive en `movimientos_inventario` y en la auditoría de cada documento.

### notificaciones_lecturas (US35, FR-144)

| Columna | Tipo | Constraints |
|---|---|---|
| `notificacion_id` | FK → notificaciones | NOT NULL, ON DELETE CASCADE |
| `usuario_id` | FK → usuarios | NOT NULL |
| `leida_en` | timestamptz | NOT NULL DEFAULT now() |

PK compuesta `(notificacion_id, usuario_id)`: la existencia de la fila ES el estado "leída" para
ESE usuario. No hay columna booleana ni fila previa "no leída" — el no-leído es la ausencia, que
es lo que hace que un aviso nuevo no necesite escribir nada por cada destinatario posible.

Marcar todo como leído es un único `INSERT ... SELECT ... ON CONFLICT DO NOTHING` sobre lo que ese
usuario puede ver y aún no ha leído.

## Relaciones (resumen)

```text
usuarios 1───n ingresos (usuario_registra)
usuarios 1───n salidas (usuario_autoriza)
usuarios 1───n movimientos_inventario
clientes 1───n proyectos
clientes 1───n salidas              (OBLIGATORIO — FR-124)
proyectos 1───n salidas             (OPCIONAL desde US28 — FR-124)
categorias 1───n productos          (opcional — FR-086)
unidades_medida 1───n productos     (obligatoria desde US17 — FR-102/FR-103)
proveedores 1───n ingresos          (OBLIGATORIO — FR-091)
proveedores 1───n ordenes_compra    (OBLIGATORIO — FR-094)
ordenes_compra 1───n detalles_ordenes_compra n───1 productos
ordenes_compra 1───n ingresos       (OPCIONAL — FR-099: el ingreso que la surte)
ingresos 1───n detalles_ingresos n───1 productos
salidas  1───n detalles_salidas  n───1 productos
productos 1───n movimientos_inventario n───1 (ingresos|salidas) [documento_tipo+documento_id]
proyectos 1───n movimientos_inventario (solo tipo SALIDA/AJUSTE de salida)
usuarios 1───n notificaciones       (usuario_origen — quien provocó el hecho, US35)
notificaciones 1───n notificaciones_lecturas n───1 usuarios  (leída por, US35)
```

## Máquinas de estado

### Ingreso (FR-017, FR-019)

```text
PENDIENTE ──recibir──▶ RECIBIDO ──verificar──▶ VERIFICADO
    │                      │
 (editable,             anular (solo Gerente/Admin, con motivo,
  eliminable)           requiere disponible suficiente para revertir)
    │                      │
    ▼                      ▼
 ANULADO               ANULADO
(sin efecto stock)    (genera AJUSTE_SALIDA inverso por línea)
```

- `PENDIENTE`: editable; sin efecto en stock.
- `recibir`: transacción atómica — bloquea productos, `stock_actual += cantidad` por línea,
  INSERT movimiento ENTRADA por línea, actualiza `ultimo_costo` y `fecha_ultimo_movimiento`.
- `VERIFICADO`: terminal e inmutable.
- Reversa de RECIBIDO exige `disponible >= cantidad` por línea (no dejar stock comprometido
  colgando); si no alcanza, la anulación se rechaza explicando el conflicto.

### Salida (FR-029, FR-032)

```text
PENDIENTE ──confirmar──▶ CONFIRMADA ──completar──▶ COMPLETADA
    │                        │
 (editable/cancelable;    anular (solo Gerente/Admin, con motivo)
  compromete disponible)     │
    ▼                        ▼
 ANULADA                  ANULADA
(sin efecto stock)       (genera AJUSTE_ENTRADA inverso por línea)
```

- `PENDIENTE`: compromete disponibilidad (vía agregado), stock físico intacto; crear/editar
  valida `cantidad ≤ disponible` para no sobre-comprometer.
- `confirmar`: transacción atómica — bloquea productos en orden por id, revalida
  `cantidad ≤ stock_actual` (el valor REAL recién bloqueado con `FOR UPDATE`, no un
  "disponible" que reste el compromiso de otras salidas `PENDIENTE` — ver nota de
  corrección T056 abajo) por línea, `stock_actual −= cantidad`, INSERT movimiento SALIDA
  por línea (con `proyecto_id`), fija `usuario_autoriza_id` y `fecha_confirmacion`. Si falla
  una línea → rollback total con mensaje del disponible real.

  **Corrección T056 (bug de diseño encontrado por la prueba de carrera SC-002)**: una
  versión anterior de esta regla revalidaba `disponible + compromiso_propio ≥ cantidad`,
  restándole a `stock_actual` el `comprometido` de las OTRAS salidas `PENDIENTE`. Bajo dos
  confirmaciones concurrentes de salidas que compiten por el mismo producto (cada una cabría
  sola, pero juntas exceden el stock), esa fórmula hacía que CADA transacción viera a la
  OTRA todavía `PENDIENTE` (sin commitear) en el momento de calcular su propio compromiso
  ajeno — así que AMBAS se rechazaban mutuamente y NINGUNA ganaba, en vez de exactamente una
  (viola SC-002). El `SELECT ... FOR UPDATE` ya es el mecanismo de serialización correcto:
  basta con validar contra el `stock_actual` real que ese candado expone. El agregado de
  `comprometido` sigue siendo válido y necesario para la UX de creación/edición (aviso
  temprano al usuario), simplemente ya no participa en la revalidación atómica de
  `confirmar`.
- `COMPLETADA`: terminal (cierre administrativo de entrega), inmutable.

### Consumo para reportes (FR-044)

`consumo = Σ detalles de salidas en estado CONFIRMADA o COMPLETADA` (PENDIENTE y ANULADA no
cuentan). El margen del proyecto = `consumo / presupuesto_estimado` (si hay presupuesto);
si `presupuesto_estimado` es `NULL` **o** es `0`, el margen no se calcula (`null`) — dividir
entre `0` produciría `Infinity`/`NaN`, no serializables en JSON (hallazgo de revisión
adversarial, tanda US4): un presupuesto de `0` se trata igual que "sin presupuesto
asignado" para efectos de esta razón, no como "presupuesto agotado".

### Carga masiva de inventario (US8, FR-048…FR-051)

No existe un tercer `documento_tipo` para "carga masiva" en `movimientos_inventario`
(`ENUM INGRESO/SALIDA`, ver arriba) — a propósito: inventar uno nuevo solo para esta
historia duplicaría la máquina de mutación de stock que `ingresos`/`RepositorioIngresos`
ya resuelve de forma atómica y probada (research R4). En su lugar, cuando el archivo
subido trae al menos una fila con `cantidad_inicial > 0`, el caso de uso de importación
COMPONE (no reimplementa) el flujo existente: agrupa esas filas en un único `Ingreso`
sintético (`numero_factura` autogenerado, `proveedor = 'Carga masiva de inventario'`,
`estado` pasa por `PENDIENTE → RECIBIDO` igual que un ingreso manual) y llama
`RepositorioIngresos.crear` + `.recibir` tal cual los usa el flujo normal de US1 — mismo
bloqueo `FOR UPDATE`, mismos movimientos `ENTRADA`, misma auditoría. El alta/actualización
del CATÁLOGO (SKU/descripción/categoría/ubicación/umbral) es una operación aparte, no
transaccional (igual que el alta manual de producto hoy — `RepositorioProductos.crear`/
`actualizar` no mutan stock), así que ocurre ANTES de armar el `Ingreso`, fila por fila.

Consecuencia aceptada de esta composición (documentada, no un defecto): si el catálogo se
actualiza correctamente pero `recibir()` falla por una causa ajena (ej. corte de conexión a
BD a mitad del archivo), los productos quedan creados/actualizados pero sin el stock de esa
corrida — recuperable resubiendo el mismo archivo (SKU ya existente ⇒ solo actualiza,
`cantidad_inicial` se puede volver a aplicar). Una saga multi-documento con rollback
cruzado sería sobre-ingeniería para este caso de uso (Principio V, YAGNI).

## Índices (Restricciones adicionales de la constitución — búsqueda frecuente y paginación)

| Tabla | Índice | Justifica |
|---|---|---|
| productos | UNIQUE(sku); btree(descripcion); btree(estado); btree(categoria_id); btree(ubicacion) | búsqueda FR-023; los dos últimos, filtro por categoría/ubicación de FR-075 (US13) — medido en rendimiento.md § (g), que además corrige la expectativa de que sirvieran al `DISTINCT` de FR-076. Desde US15 el índice es sobre la FK `categoria_id`, no sobre el texto |
| unidades_medida | UNIQUE funcional sobre `lower(trim(nombre))` y sobre `lower(trim(abreviatura))`; btree(estado) | las dos unicidades de FR-101 y el listado de las activas para el selector |
| categorias | UNIQUE funcional sobre `lower(trim(nombre))`; btree(estado) | unicidad insensible a mayúsculas/espacios (FR-085) y listado de las activas para los selectores (FR-088) |
| proveedores | UNIQUE funcional sobre `lower(trim(nombre))`; btree(estado) | lo mismo que `categorias`, aplicado a proveedores (FR-091) |
| ordenes_compra | UNIQUE(numero); btree(proveedor_id, estado); btree(fecha_orden); btree(estado) | listado y filtros de US16; el compuesto responde "qué le pedí a este proveedor y qué sigue pendiente" |
| detalles_ordenes_compra | btree(producto_id); UNIQUE(orden_compra_id, producto_id) | historial por producto, un producto por línea |
| ingresos | UNIQUE(numero_factura); btree(fecha_recepcion); btree(estado); btree(proveedor_id) | historial/filtros FR-018; el último, filtro por proveedor de FR-075, que desde US15 es una igualdad por FK y no un `LIKE` sobre texto |
| salidas | UNIQUE(numero); btree(cliente_id, estado); btree(proyecto_id, estado); btree(fecha_salida); btree(estado); btree(usuario_autoriza_id) | filtros FR-033, comprometido R4; el de autorizante, FR-075 (US13); el de cliente, FR-124 (US28) — el filtro por cliente dejó de resolverse con un JOIN contra `proyectos` |
| detalles_salidas | btree(producto_id); UNIQUE(salida_id, producto_id) | agregado de comprometido R4 |
| detalles_ingresos | btree(producto_id); UNIQUE(ingreso_id, producto_id) | historial por producto |
| movimientos_inventario | btree(producto_id, fecha_hora); btree(documento_tipo, documento_id); btree(proyecto_id); btree(usuario_id); btree(fecha_hora) | reportes FR-024/FR-042 |
| proyectos | btree(cliente_id, estado); UNIQUE(cliente_id, nombre) | combobox FR-038, listados FR-037 |
| usuarios | UNIQUE(login); UNIQUE(email) | FR-009 |
| clientes | UNIQUE(nit); btree(nombre) | FR-035, búsqueda |
| notificaciones | btree(creada_en); btree(tipo, creada_en) | la bandeja se lee siempre "lo más reciente primero" y filtrada a los TIPOS que la sesión puede ver (FR-141/FR-142), que es justo el compuesto |
| notificaciones_lecturas | PK(notificacion_id, usuario_id); btree(usuario_id) | "¿esta la leí?" por la PK y "¿cuántas me faltan?" por el segundo |

**Filtros de US13 que NO reciben índice, y por qué** (anotado en T132; ninguno se agregó ni se
omitió en silencio — ver [rendimiento.md](./rendimiento.md) § (g) para los planes medidos):

- `ingresos.proveedor` (filtro por subcadena): **ningún `btree` puede servir un
  `ILIKE '%termino%'`** — solo igualdad, rangos y prefijos. Es exactamente la limitación ya
  documentada en rendimiento.md nota 2 para el `buscar` que HOY cruza esa misma columna, así que
  el filtro nuevo no empeora nada: reproduce el perfil de costo que la pantalla ya tenía. La
  mejora, si algún día hace falta, es `pg_trgm` + `GIN`, no un índice más.
- `clientes.ciudad` y `usuarios.rol_id` (igualdad): tablas pequeñas por diseño del negocio
  (`spec.md § Assumptions` proyecta decenas de clientes y hasta ~50 usuarios). Postgres prefiere
  `Seq Scan` a esa escala sin importar el índice disponible — es el mismo razonamiento de la
  nota 6 de rendimiento.md, verificado allí con `EXPLAIN` real sobre `clientes`/`proyectos`.
- `salidas.numero`: ya lo cubre el `UNIQUE(numero)` que exige FR-026.

## Invariantes verificables (base de las pruebas de integración)

1. `productos.stock_actual >= 0` siempre (CHECK + transacciones R4).
2. `stock_actual(p) = Σ movimientos(p)` con signo por tipo — conciliación exacta.
3. Toda salida CONFIRMADA/COMPLETADA tiene `proyecto_id`, `usuario_autoriza_id` y
   `fecha_confirmacion` no nulos, y ≥ 1 movimiento SALIDA asociado.
4. Todo ingreso RECIBIDO/VERIFICADO tiene ≥ 1 movimiento ENTRADA asociado.
5. No existen dos ingresos activos con el mismo `numero_factura` (UNIQUE).
6. Los `numero` de salidas son únicos y crecientes sin duplicados bajo concurrencia.
7. `movimientos_inventario` no admite UPDATE/DELETE (trigger).
8. Documentos ANULADOS conservan sus líneas y quedan excluidos de consumo (FR-044).
