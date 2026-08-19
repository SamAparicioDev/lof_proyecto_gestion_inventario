-- US29 (T233) — Ajuste de inventario: lo que entra a la bodega sin factura.
--
-- FR-126. Un conteo físico que aparece de más, una devolución del cliente, mercancía
-- encontrada, lo que ya estaba antes de que existiera el sistema. Hasta hoy había que
-- inventarse un número de factura y elegir un proveedor cualquiera para poder registrarlo, y
-- eso ensucia justo la columna que sirve para cuadrar con contabilidad.
--
-- El ingreso gana un TIPO, y el tipo decide qué columnas son obligatorias. Todo lo registrado
-- hasta ahora queda como `FACTURA` por el DEFAULT — ningún ingreso existente cambia.

CREATE TYPE "tipo_ingreso" AS ENUM ('FACTURA', 'AJUSTE');

ALTER TABLE "ingresos"
    ADD COLUMN "tipo" "tipo_ingreso" NOT NULL DEFAULT 'FACTURA',
    -- Correlativo propio del ajuste, de `contadores['ajuste']`. BIGINT y no texto: el formato
    -- "AJU-000042" es presentación, igual que en salidas, órdenes y cotizaciones.
    ADD COLUMN "numero_ajuste" BIGINT;

-- Las tres columnas de la compra dejan de ser obligatorias EN LA BASE. Lo que las mantiene
-- obligatorias en un ingreso de factura es el CHECK de abajo, no su NOT NULL: la regla ya no es
-- "siempre", es "según el tipo", y expresarla en un solo sitio evita que las dos mitades
-- discrepen.
ALTER TABLE "ingresos"
    ALTER COLUMN "numero_factura" DROP NOT NULL,
    ALTER COLUMN "fecha_factura" DROP NOT NULL,
    ALTER COLUMN "proveedor_id" DROP NOT NULL;

-- Un índice único admite varios NULL en PostgreSQL, que es justo lo que necesitan los ajustes:
-- todos con `numero_factura` vacío y ninguno chocando con otro. El índice que ya existía sobre
-- `numero_factura` sigue sirviendo igual (FR-015: la unicidad de facturas la garantiza la BD).
CREATE UNIQUE INDEX "ingresos_numero_ajuste_key" ON "ingresos" ("numero_ajuste");

-- ---------------------------------------------------------------------------
-- La forma completa de cada tipo, en UNA restricción
-- ---------------------------------------------------------------------------
-- Cuatro columnas nullables sueltas no dicen nada sobre cuándo debe haber qué; esta sí, y
-- además impide el estado sin sentido (un ajuste con proveedor, una factura con número de
-- ajuste) que ninguna combinación de NOT NULL podría prohibir.
--
-- `observaciones IS NOT NULL` en el ajuste es su MOTIVO: la factura justifica la entrada de un
-- ingreso normal, y cuando no hay factura lo único que queda para justificarla es el motivo
-- escrito. Un movimiento de corrección sin causa registrada no es trazable (Principio II).
ALTER TABLE "ingresos"
    ADD CONSTRAINT "ingresos_tipo_check" CHECK (
        (
            "tipo" = 'FACTURA'
            AND "numero_factura" IS NOT NULL
            AND "fecha_factura" IS NOT NULL
            AND "proveedor_id" IS NOT NULL
            AND "numero_ajuste" IS NULL
        )
        OR (
            "tipo" = 'AJUSTE'
            AND "numero_factura" IS NULL
            AND "fecha_factura" IS NULL
            AND "proveedor_id" IS NULL
            AND "orden_compra_id" IS NULL
            AND "numero_ajuste" IS NOT NULL
            AND "observaciones" IS NOT NULL
        )
    );

-- ---------------------------------------------------------------------------
-- El correlativo
-- ---------------------------------------------------------------------------
-- Mismo mecanismo que salidas, órdenes y cotizaciones (research R5): `UPDATE ... RETURNING`
-- dentro de la transacción que crea el documento, nunca `MAX()+1` ni una secuencia.
-- `ON CONFLICT DO NOTHING` para que reejecutar la migración sobre una base que ya la tiene no
-- reinicie el contador.
INSERT INTO "contadores" ("clave", "valor")
VALUES ('ajuste', 0)
ON CONFLICT ("clave") DO NOTHING;
