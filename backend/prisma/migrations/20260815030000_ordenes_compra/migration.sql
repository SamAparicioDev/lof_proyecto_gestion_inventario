-- US16 (T164) — Órdenes de compra: qué se le pidió a cada proveedor y qué falta por llegar.
--
-- FR-094 (una orden se dirige a un proveedor del catálogo y lleva líneas), FR-095 (correlativo
-- propio con el mismo mecanismo que las salidas), FR-096 (máquina de estados; la orden NUNCA
-- mueve stock), FR-099 (el ingreso que surte la orden queda vinculado a ella).
--
-- Los `CHECK` van aquí y no en `schema.prisma` porque Prisma no los genera (misma decisión que
-- la migración inicial T009): son la red final del invariante "no se pide cantidad ni precio
-- cero o negativo", válida aunque alguien inserte por SQL.

-- ---------------------------------------------------------------------------
-- 1. La orden
-- ---------------------------------------------------------------------------
CREATE TYPE "estado_orden_compra" AS ENUM ('BORRADOR', 'ENVIADA', 'RECIBIDA', 'ANULADA');

CREATE TABLE "ordenes_compra" (
    "id"                      BIGSERIAL NOT NULL,
    -- Correlativo de `contadores['orden_compra']` (FR-095). BIGINT y no texto, igual que
    -- `salidas.numero`: el formato "OC-000042" es presentación, no dato.
    "numero"                  BIGINT NOT NULL,
    "proveedor_id"            BIGINT NOT NULL,
    "fecha_orden"             DATE NOT NULL,
    -- Informativa: es lo que se le PIDE al proveedor, no un compromiso que el sistema controle.
    "fecha_entrega_esperada"  DATE,
    "observaciones"           TEXT,
    "estado"                  "estado_orden_compra" NOT NULL DEFAULT 'BORRADOR',
    "valor_total"             DECIMAL(14,2) NOT NULL DEFAULT 0,
    "motivo_anulacion"        TEXT,
    "fecha_creacion"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_creacion_id"     BIGINT NOT NULL,
    "fecha_modificacion"      TIMESTAMPTZ(6),
    "usuario_modificacion_id" BIGINT,

    CONSTRAINT "ordenes_compra_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ordenes_compra_numero_key" ON "ordenes_compra" ("numero");
-- El compuesto responde la pregunta del módulo: "¿qué le pedí a este proveedor y qué sigue
-- pendiente de llegar?".
CREATE INDEX "ordenes_compra_proveedor_id_estado_idx" ON "ordenes_compra" ("proveedor_id", "estado");
CREATE INDEX "ordenes_compra_fecha_orden_idx" ON "ordenes_compra" ("fecha_orden");
CREATE INDEX "ordenes_compra_estado_idx" ON "ordenes_compra" ("estado");

ALTER TABLE "ordenes_compra"
    ADD CONSTRAINT "ordenes_compra_proveedor_id_fkey"
        FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "ordenes_compra_usuario_creacion_id_fkey"
        FOREIGN KEY ("usuario_creacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "ordenes_compra_usuario_modificacion_id_fkey"
        FOREIGN KEY ("usuario_modificacion_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Sus líneas
-- ---------------------------------------------------------------------------
CREATE TABLE "detalles_ordenes_compra" (
    "id"               BIGSERIAL NOT NULL,
    "orden_compra_id"  BIGINT NOT NULL,
    "producto_id"      BIGINT NOT NULL,
    "cantidad"         DECIMAL(12,2) NOT NULL,
    -- Precio ESTIMADO: el real lo fija la factura del proveedor cuando llega la mercancía.
    "precio_unitario"  DECIMAL(14,2) NOT NULL,
    "valor_total"      DECIMAL(14,2) NOT NULL,

    CONSTRAINT "detalles_ordenes_compra_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "detalles_ordenes_compra_cantidad_check" CHECK ("cantidad" > 0),
    CONSTRAINT "detalles_ordenes_compra_precio_check" CHECK ("precio_unitario" > 0)
);

-- Un producto por línea, mismo criterio que `detalles_ingresos`.
CREATE UNIQUE INDEX "detalles_ordenes_compra_orden_producto_key"
    ON "detalles_ordenes_compra" ("orden_compra_id", "producto_id");
CREATE INDEX "detalles_ordenes_compra_producto_id_idx" ON "detalles_ordenes_compra" ("producto_id");

ALTER TABLE "detalles_ordenes_compra"
    -- CASCADE: solo se ejerce mientras la orden es BORRADOR (editarla reescribe sus líneas).
    ADD CONSTRAINT "detalles_ordenes_compra_orden_compra_id_fkey"
        FOREIGN KEY ("orden_compra_id") REFERENCES "ordenes_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "detalles_ordenes_compra_producto_id_fkey"
        FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. El vínculo con el ingreso que la surte (FR-099)
-- ---------------------------------------------------------------------------
-- NULL a propósito: un ingreso puede seguir registrándose sin orden previa, que es como
-- funcionó el sistema hasta esta historia.
ALTER TABLE "ingresos" ADD COLUMN "orden_compra_id" BIGINT;

ALTER TABLE "ingresos"
    ADD CONSTRAINT "ingresos_orden_compra_id_fkey"
        FOREIGN KEY ("orden_compra_id") REFERENCES "ordenes_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ingresos_orden_compra_id_idx" ON "ingresos" ("orden_compra_id");

-- ---------------------------------------------------------------------------
-- 4. El correlativo (FR-095)
-- ---------------------------------------------------------------------------
-- La fila debe existir ANTES del primer uso: `UPDATE ... RETURNING` sobre una clave inexistente
-- no afecta ninguna fila y el caso de uso no tendría número que asignar (research R5).
INSERT INTO "contadores" ("clave", "valor")
VALUES ('orden_compra', 0)
ON CONFLICT ("clave") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Permisos nuevos del catálogo (US9/FR-056: un permiso por verificación real del código)
-- ---------------------------------------------------------------------------
-- Por qué van en una MIGRACIÓN y no solo en `prisma/seed.ts`: la semilla es quien mantiene el
-- catálogo al día en una base creada desde cero, pero en una base YA DESPLEGADA nadie la
-- ejecuta —correr la semilla en producción crearía además un usuario con contraseña conocida—,
-- así que sin esto los endpoints nuevos responderían 403 con el código correcto. Mismo patrón
-- que `20260812150000_historial_costos_producto` con `inventario.ver_costos`.
--
-- Se incluyen también los DOS permisos de proveedores (US15): su migración ya está aplicada en
-- las bases de desarrollo y pruebas, y editarla ahora rompería su checksum — Prisma rechazaría
-- toda migración posterior. Este es el lugar correcto para ponerlos al día.
--
-- `ON CONFLICT DO NOTHING` en ambos INSERT: en las bases donde la semilla ya corrió, estas
-- filas existen y la migración debe ser inofensiva, no fallar.
INSERT INTO "permisos" ("clave", "modulo", "descripcion") VALUES
    ('proveedores.ver',        'proveedores',    'Consultar el catálogo de proveedores para registrar ingresos y filtrar.'),
    ('proveedores.gestionar',  'proveedores',    'Administrar el catálogo de proveedores: alta, edición y estado.'),
    ('ordenes_compra.ver',     'ordenes_compra', 'Consultar las órdenes de compra y su detalle.'),
    ('ordenes_compra.crear',   'ordenes_compra', 'Crear órdenes de compra en borrador.'),
    ('ordenes_compra.editar',  'ordenes_compra', 'Editar una orden de compra mientras sigue en borrador.'),
    ('ordenes_compra.enviar',  'ordenes_compra', 'Marcar una orden como enviada al proveedor: compromete el gasto.'),
    ('ordenes_compra.anular',  'ordenes_compra', 'Anular una orden de compra indicando el motivo.')
ON CONFLICT ("clave") DO NOTHING;

-- Matriz rol → permiso (FR-059/FR-100). Los TRES roles del sistema pueden consultar el catálogo
-- de proveedores y armar órdenes: quien ve faltar la mercancía es quien arma el pedido. ENVIAR y
-- ANULAR —las dos acciones que comprometen o liberan un gasto frente a un tercero— y administrar
-- el catálogo quedan en Administrador y Gerente.
INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" IN ('Administrador', 'Gerente', 'Operario')
  AND p."clave" IN ('proveedores.ver', 'ordenes_compra.ver', 'ordenes_compra.crear', 'ordenes_compra.editar')
ON CONFLICT DO NOTHING;

INSERT INTO "roles_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permisos" p
WHERE r."nombre" IN ('Administrador', 'Gerente')
  AND p."clave" IN ('proveedores.gestionar', 'ordenes_compra.enviar', 'ordenes_compra.anular')
ON CONFLICT DO NOTHING;
